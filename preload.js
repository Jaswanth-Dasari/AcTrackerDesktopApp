const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    send: (channel, data) => ipcRenderer.send(channel, data),
    captureScreenshot: () => ipcRenderer.invoke('capture-screenshot'),
    fetchRecentScreenshots: () => ipcRenderer.invoke('fetch-recent-screenshots'),
    fetchScreenshots: () => ipcRenderer.invoke('fetch-recent-screenshots'),
    startScreenshotCapture: (data) => ipcRenderer.invoke('start-screenshot-capture', data),
    stopScreenshotCapture: () => ipcRenderer.invoke('stop-screenshot-capture'),
    onScreenshotCaptured: (callback) => ipcRenderer.on('screenshot-captured', callback),
    onScreenshotError: (callback) => ipcRenderer.on('screenshot-error', callback),
    fetchBrowserActivity: () => ipcRenderer.invoke('fetch-browser-activity'),
    startTrackingBrowserActivity: () => ipcRenderer.invoke('start-browser-activity-tracking'),
    stopTrackingBrowserActivity: () => ipcRenderer.invoke('stop-browser-activity-tracking'),
    onBrowserActivityUpdated: (callback) => ipcRenderer.on('browser-activity-updated', (event, data) => callback(data)),
    getRecentActivities: () => ipcRenderer.invoke('get-recent-activities'),
    removeScreenshotListeners: () => {
        ipcRenderer.removeAllListeners('screenshot-captured');
        ipcRenderer.removeAllListeners('screenshot-error');
    }
});
