const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getApiUrl: () => ipcRenderer.invoke("get-api-url"),
  quitApp: () => ipcRenderer.send("quit-app"),
  onUsageUpdate: (callback) => {
    ipcRenderer.on("usage-update", (_event, data) => callback(data));
  },
});
