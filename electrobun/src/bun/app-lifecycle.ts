import type { BrowserWindow, Tray } from "electrobun/bun";
import { Utils } from "electrobun/bun";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

export function setMainWindow(window: BrowserWindow | null) {
	mainWindow = window;
}

export function setTray(nextTray: Tray | null) {
	tray = nextTray;
}

export function quitApp() {
	if (quitting) return;
	quitting = true;

	try {
		mainWindow?.close();
	} catch (error) {
		console.error("[lifecycle] failed to close main window", error);
	}

	try {
		tray?.remove();
	} catch (error) {
		console.error("[lifecycle] failed to remove tray", error);
	}

	Utils.quit();
}
