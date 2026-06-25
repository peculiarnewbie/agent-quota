import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { getAllUsage } from "./src/lib/usage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Configuration ──────────────────────────────────────────────────────────

const VITE_DEV_PORT = 6769;
const VITE_DEV_URL = `http://localhost:${VITE_DEV_PORT}`;
const DEFAULT_REFRESH_MS = 10 * 60 * 1000;
const STALE_CACHE_MS = 3 * 60 * 1000;

// ─── Settings persistence ───────────────────────────────────────────────────

function getConfigDir() {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return path.join(home, ".config", "agent-quota");
}

function getSettingsPath() {
  return path.join(getConfigDir(), "settings.json");
}

function getCachePath() {
  return path.join(getConfigDir(), "usage-cache.json");
}

function loadSettings() {
  try {
    const data = fs.readFileSync(getSettingsPath(), "utf-8");
    return JSON.parse(data);
  } catch {
    return { refreshIntervalMs: DEFAULT_REFRESH_MS, autoLaunch: false };
  }
}

function saveSettings(settings) {
  const dir = getConfigDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2));
}

function loadCache() {
  try {
    const data = fs.readFileSync(getCachePath(), "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function writeCache(payload) {
  try {
    const dir = getConfigDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getCachePath(), JSON.stringify(payload));
  } catch (e) {
    console.error("[electron] Cache write failed:", e.message);
  }
}

function shouldRefreshFromCache(payload) {
  const fetchedAtMs = Number(payload?.fetchedAtMs || 0);
  if (fetchedAtMs <= 0) return true;
  return Date.now() - fetchedAtMs >= STALE_CACHE_MS;
}

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

let useDevServer = false;

// ─── State ──────────────────────────────────────────────────────────────────

let tray = null;
let mainWindow = null;
let refreshTimer = null;
let latestUsage = null;
let settings = loadSettings();

// ─── Single instance lock ───────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.log("[electron] Another Agent Quota instance is already running. Exiting this launch.");
  app.quit();
}

app.on("second-instance", () => {
  showOrCreateWindow();
});

// ─── Data fetching ──────────────────────────────────────────────────────────

async function fetchUsageData() {
  try {
    return await getAllUsage();
  } catch (e) {
    console.error("[electron] Fetch error:", e.message);
    return null;
  }
}

async function refreshData() {
  const data = await fetchUsageData();
  if (data) {
    latestUsage = data;
    const payload = { ok: true, fetchedAtMs: Date.now(), data };
    writeCache(payload);
    if (tray) tray.setToolTip(buildTooltip(data));
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("usage-update", data);
    }
  }
}

// ─── Refresh interval management ────────────────────────────────────────────

function startRefreshTimer() {
  stopRefreshTimer();
  const intervalMs = settings.refreshIntervalMs || DEFAULT_REFRESH_MS;
  if (intervalMs <= 0) return;
  refreshTimer = setInterval(refreshData, intervalMs);
}

function stopRefreshTimer() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

function updateRefreshInterval(intervalMs) {
  settings.refreshIntervalMs = intervalMs;
  saveSettings(settings);
  startRefreshTimer();
}

// ─── Auto-launch ────────────────────────────────────────────────────────────

function setAutoLaunch(enabled) {
  settings.autoLaunch = enabled;
  saveSettings(settings);
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: app.getPath("exe"),
  });
}

function getAutoLaunch() {
  return app.getLoginItemSettings().openAtLogin;
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

// ─── Window management ──────────────────────────────────────────────────────

function getRendererIndexPath() {
  const candidates = [
    path.join(__dirname, "..", "vite+bun", "dist", "index.html"),
    path.join(app.getAppPath(), "..", "vite+bun", "dist", "index.html"),
    path.join(process.resourcesPath, "..", "vite+bun", "dist", "index.html"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

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

ipcMain.on("quit-app", () => quitApp());
ipcMain.on("refresh-usage", () => refreshData());
ipcMain.on("request-usage", () => {
  if (latestUsage && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("usage-update", latestUsage);
  } else {
    refreshData();
  }
});

ipcMain.handle("get-settings", () => {
  return {
    refreshIntervalMs: settings.refreshIntervalMs || DEFAULT_REFRESH_MS,
    autoLaunch: getAutoLaunch(),
  };
});

ipcMain.handle("set-refresh-interval", (_event, intervalMs) => {
  updateRefreshInterval(intervalMs);
  return { ok: true };
});

ipcMain.handle("set-auto-launch", (_event, enabled) => {
  setAutoLaunch(enabled);
  return { ok: true, autoLaunch: getAutoLaunch() };
});

// ─── App lifecycle ──────────────────────────────────────────────────────────

function quitApp() {
  stopRefreshTimer();
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
  // Detect Vite dev server (for HMR during development)
  if (await isViteDevRunning()) {
    useDevServer = true;
    console.log(`[electron] Using Vite dev server at ${VITE_DEV_URL}`);
  } else {
    console.log("[electron] Using built files from vite+bun/dist/");
  }

  // Apply saved auto-launch setting
  app.setLoginItemSettings({
    openAtLogin: settings.autoLaunch || false,
    path: app.getPath("exe"),
  });

  // Create the tray icon
  createTray();

  // Open the dashboard window
  createMainWindow();

  // Load from cache first for instant display
  const cached = loadCache();
  if (cached && cached.ok && Array.isArray(cached.data)) {
    latestUsage = cached.data;
    if (tray) tray.setToolTip(buildTooltip(cached.data));
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("usage-update", cached.data);
    }
    // If cache is stale, fetch fresh data
    if (shouldRefreshFromCache(cached)) {
      await refreshData();
    }
  } else {
    await refreshData();
  }

  // Start background polling
  startRefreshTimer();
});
