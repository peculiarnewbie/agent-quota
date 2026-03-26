import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } from "electron";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Configuration ──────────────────────────────────────────────────────────

const API_PORT = 6767;
const API_URL = `http://localhost:${API_PORT}`;
const VITE_DEV_PORT = 5173;
const VITE_DEV_URL = `http://localhost:${VITE_DEV_PORT}`;
const REFRESH_MS = 10 * 60 * 1000;
const API_WAIT_TIMEOUT_MS = 10_000;
const API_POLL_INTERVAL_MS = 250;

// ─── Dev server detection ───────────────────────────────────────────────────

async function isViteDevRunning() {
  try {
    await fetch(VITE_DEV_URL, {
      method: "HEAD",
      signal: AbortSignal.timeout(1000),
    });
    return true;
  } catch {
    return false;
  }
}

async function waitForViteDev(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isViteDevRunning()) return true;
    await new Promise((r) => setTimeout(r, API_POLL_INTERVAL_MS));
  }
  return false;
}

let useDevServer = false;

// ─── State ──────────────────────────────────────────────────────────────────

let tray = null;
let mainWindow = null;
let apiProcess = null;
let refreshInterval = null;
let latestUsage = null;
let weSpawnedApi = false;

// ─── Single instance lock ───────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.log("[electron] Another Agent Quota instance is already running. Exiting this launch.");
  app.quit();
}

app.on("second-instance", () => {
  showOrCreateWindow();
});

// ─── API server management ──────────────────────────────────────────────────

async function isApiRunning() {
  try {
    const res = await fetch(`${API_URL}/api/usage`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForApi(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isApiRunning()) return true;
    await new Promise((r) => setTimeout(r, API_POLL_INTERVAL_MS));
  }
  return false;
}

function getApiDir() {
  // When packaged, API files are in resources/api/
  // In dev, they're in the sibling vite+bun/ directory
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "api");
  }
  return path.join(__dirname, "..", "vite+bun");
}

function getRendererIndexPath() {
  if (!app.isPackaged) {
    return path.join(__dirname, "renderer-dist", "index.html");
  }

  const candidates = [
    path.join(app.getAppPath(), "renderer-dist", "index.html"),
    path.join(process.resourcesPath, "renderer-dist", "index.html"),
    path.join(app.getAppPath(), "dist", "index.html"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

async function ensureApiServer() {
  // Check if already running (e.g. user started vite+bun separately)
  if (await isApiRunning()) {
    console.log("[electron] API server already running on port", API_PORT);
    return true;
  }

  // Spawn the Bun API server
  const apiDir = getApiDir();
  console.log("[electron] Spawning Bun API server from", apiDir);

  apiProcess = spawn("bun", ["api.ts"], {
    cwd: apiDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
    shell: process.platform === "win32",
  });

  weSpawnedApi = true;

  apiProcess.stdout?.on("data", (data) => {
    console.log("[api]", data.toString().trim());
  });

  apiProcess.stderr?.on("data", (data) => {
    console.error("[api:err]", data.toString().trim());
  });

  apiProcess.on("exit", (code) => {
    console.log("[electron] API server exited with code", code);
    apiProcess = null;
  });

  // Wait for it to be ready
  const ready = await waitForApi(API_WAIT_TIMEOUT_MS);
  if (!ready) {
    console.error("[electron] API server did not become ready in time");
  }
  return ready;
}

function killApiServer() {
  if (apiProcess && weSpawnedApi) {
    console.log("[electron] Killing API server");
    if (process.platform === "win32") {
      // On Windows, spawn('bun', ..., { shell: true }) creates a cmd.exe wrapper.
      // We need to kill the whole process tree.
      spawn("taskkill", ["/pid", String(apiProcess.pid), "/f", "/t"], {
        shell: true,
      });
    } else {
      apiProcess.kill("SIGTERM");
    }
    apiProcess = null;
  }
}

// ─── Tooltip builder ────────────────────────────────────────────────────────

function buildTooltip(usage) {
  if (!usage || !Array.isArray(usage)) return "Agent Quota";

  const parts = [];
  for (const r of usage) {
    if (r.status === "no_credentials") continue;
    const name = r.service.toUpperCase();

    if (r.status !== "ok") {
      parts.push(`${name}: ${r.error || "?"}`);
      continue;
    }

    const segs = [];
    if (r.fiveHour?.usedPercent != null) {
      segs.push(`5h:${Math.round(r.fiveHour.usedPercent)}%`);
    }
    if (r.sevenDay?.usedPercent != null) {
      segs.push(`7d:${Math.round(r.sevenDay.usedPercent)}%`);
    }

    if (segs.length) {
      parts.push(`${name} ${segs.join(" ")}`);
    } else if (r.fiveHour?.remaining) {
      parts.push(`${name} ${r.fiveHour.remaining}`);
    } else {
      parts.push(`${name} ok`);
    }
  }

  let tooltip = parts.length
    ? "Agent Quota\n" + parts.join("\n")
    : "Agent Quota";
  // Windows tray tooltip limit: 127 chars
  if (tooltip.length > 127) tooltip = tooltip.slice(0, 124) + "...";
  return tooltip;
}

// ─── Data fetching ──────────────────────────────────────────────────────────

async function fetchUsageData() {
  try {
    const res = await fetch(`${API_URL}/api/usage`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error("[electron] Fetch error:", e.message);
    return null;
  }
}

async function refreshData() {
  const data = await fetchUsageData();
  if (data) {
    latestUsage = data;
    if (tray) tray.setToolTip(buildTooltip(data));
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("usage-update", data);
    }
  }
}

// ─── Window management ──────────────────────────────────────────────────────

function createMainWindow() {
  mainWindow = new BrowserWindow({
    title: "Agent Quota",
    width: 1024,
    height: 780,
    show: false,
    backgroundColor: "#0a0a0b",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (useDevServer) {
    mainWindow.loadURL(VITE_DEV_URL);
  } else {
    mainWindow.loadFile(getRendererIndexPath());
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function showOrCreateWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else {
    createMainWindow();
  }
}

// ─── Tray setup ─────────────────────────────────────────────────────────────

function createTray() {
  const iconPath = path.join(__dirname, "assets", "tray-icon.png");
  const icon = nativeImage.createFromPath(iconPath);
  // Resize for tray (16x16 is standard on Windows)
  const resized = icon.resize({ width: 16, height: 16 });

  tray = new Tray(resized);
  tray.setToolTip("Agent Quota – loading...");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show Dashboard",
      click: () => showOrCreateWindow(),
    },
    {
      label: "Refresh",
      click: () => refreshData(),
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => quitApp(),
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on("click", () => {
    showOrCreateWindow();
  });
}

// ─── IPC handlers ───────────────────────────────────────────────────────────

ipcMain.handle("get-api-url", () => API_URL);
ipcMain.on("quit-app", () => quitApp());

// ─── App lifecycle ──────────────────────────────────────────────────────────

function quitApp() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
  killApiServer();
  if (tray) {
    tray.destroy();
    tray = null;
  }
  app.quit();
}

app.on("window-all-closed", () => {
  // Do nothing — keep the app alive for the tray icon
});

app.whenReady().then(async () => {
  // Start the API server
  const apiReady = await ensureApiServer();
  if (!apiReady) {
    console.error("[electron] Could not start API server. Continuing anyway...");
  }

  // Detect Vite dev server (for HMR during development)
  if (await isViteDevRunning()) {
    useDevServer = true;
    console.log(`[electron] Using Vite dev server at ${VITE_DEV_URL}`);
  } else {
    console.log("[electron] Using built files from dist/");
  }

  // Create the tray icon
  createTray();

  // Open the dashboard window
  createMainWindow();

  // Start background polling
  await refreshData();
  refreshInterval = setInterval(refreshData, REFRESH_MS);
});
