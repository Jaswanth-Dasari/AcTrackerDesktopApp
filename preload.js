const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    captureScreenshot: () => ipcRenderer.invoke('capture-screenshot'),
    fetchRecentScreenshots: () => ipcRenderer.invoke('fetch-recent-screenshots'),
    startScreenshotCapture: (data) => ipcRenderer.invoke('start-screenshot-capture', data),
    stopScreenshotCapture: () => ipcRenderer.invoke('stop-screenshot-capture'),
    onScreenshotCaptured: (callback) => ipcRenderer.on('screenshot-captured', callback),
    onScreenshotError: (callback) => ipcRenderer.on('screenshot-error', callback),
    removeScreenshotListeners: () => {
        ipcRenderer.removeAllListeners('screenshot-captured');
        ipcRenderer.removeAllListeners('screenshot-error');
    }
});
