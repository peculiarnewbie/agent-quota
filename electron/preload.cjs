const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  quitApp: () => ipcRenderer.send("quit-app"),
  refreshUsage: () => ipcRenderer.send("refresh-usage"),
  requestUsage: () => ipcRenderer.send("request-usage"),
  onUsageUpdate: (callback) => {
    ipcRenderer.on("usage-update", (_event, data) => callback(data));
  },
  getSettings: () => ipcRenderer.invoke("get-settings"),
  setRefreshInterval: (intervalMs) => ipcRenderer.invoke("set-refresh-interval", intervalMs),
  setAutoLaunch: (enabled) => ipcRenderer.invoke("set-auto-launch", enabled),
});
