import {
	type ApplicationMenuItemConfig,
	BrowserWindow,
	ContextMenu,
	Screen,
	Tray,
	Updater,
} from "electrobun/bun";
import Electrobun from "electrobun/bun";
import { appRpc } from "./rpc";
import { quitApp, setMainWindow, setTray } from "./app-lifecycle";
import { join } from "path";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;
const DEV_SERVER_WAIT_MS = 6000;
const DEV_SERVER_POLL_MS = 250;
const forceBundledViews = process.env.AGENT_QUOTA_FORCE_BUNDLED_VIEWS === "1";

async function waitForDevServer(timeoutMs: number) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			await fetch(DEV_SERVER_URL, { method: "HEAD" });
			return true;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, DEV_SERVER_POLL_MS));
		}
	}
	return false;
}

async function getMainViewUrl(): Promise<string> {
	const channel = await Updater.localInfo.channel();
	if (channel === "dev") {
		if (forceBundledViews) {
			console.log("Bundled views forced.");
			return "views://mainview/index.html";
		}

		if (await waitForDevServer(DEV_SERVER_WAIT_MS)) {
			console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);
			return DEV_SERVER_URL;
		}

		console.log(
			`Vite dev server not ready after ${DEV_SERVER_WAIT_MS}ms. Falling back to bundled views.`,
		);
	}
	return "views://mainview/index.html";
}

// --- Tray icon setup ---

function getTrayIconPath(): string {
	// In dev mode, use the source asset directly
	const devPath = join(import.meta.dir, "..", "mainview", "assets", "tray-icon.png");
	return devPath;
}

const tray = new Tray({
	title: "AQ",
	image: getTrayIconPath(),
	template: true,
	width: 16,
	height: 16,
});
setTray(tray);

const trayMenu: ApplicationMenuItemConfig[] = [
	{
		label: "Show Agent Quota",
		type: "normal",
		action: "show-window",
	},
	{ type: "separator" },
	{
		label: "Quit",
		type: "normal",
		action: "quit-app",
	},
];

// --- Window management ---

const url = await getMainViewUrl();
let mainWindow: BrowserWindow | null = null;

function createMainWindow() {
	mainWindow = new BrowserWindow({
		title: "Agent Quota",
		url,
		rpc: appRpc,
		frame: {
			width: 1024,
			height: 780,
			x: 200,
			y: 200,
		},
	});

	// When the window is closed, just null out the reference.
	// The app stays alive because exitOnLastWindowClosed is false.
	mainWindow.on("close", () => {
		mainWindow = null;
		setMainWindow(null);
	});
	setMainWindow(mainWindow);
}

function showOrCreateWindow() {
	if (mainWindow) {
		mainWindow.focus();
	} else {
		createMainWindow();
	}
}

// --- Tray event handling ---

tray.on("tray-clicked", (event: unknown) => {
	const e = event as { data?: { action?: string } };
	const action = e?.data?.action;

	if (action === "show-window") {
		showOrCreateWindow();
	} else if (action === "quit-app") {
		quitApp();
	} else {
		const mouseButtons = Number(Screen.getMouseButtons());
		const rightButtonDown = (mouseButtons & 0b10) !== 0;

		if (rightButtonDown) {
			ContextMenu.showContextMenu(trayMenu);
			return;
		}

		showOrCreateWindow();
	}
});

ContextMenu.on("context-menu-clicked", (event: unknown) => {
	const e = event as { data?: { action?: string } };
	const action = e?.data?.action;

	if (action === "show-window") {
		showOrCreateWindow();
	} else if (action === "quit-app") {
		quitApp();
	}
});

// Also handle the "reopen" event (e.g. clicking dock icon on macOS)
Electrobun.events.on("reopen", () => {
	showOrCreateWindow();
});

// --- Create the initial window ---

createMainWindow();

console.log("Agent Quota started! (tray icon active)");
