const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    send: (channel, data) => ipcRenderer.send(channel, data),
    captureScreenshot: async (userId) => {
        try {
            const result = await ipcRenderer.invoke('capture-screenshot', userId);
            return { success: true, ...result };
        } catch (error) {
            console.error('Screenshot capture error:', error);
            return { success: false, error: error.message };
        }
    },
    fetchRecentScreenshots: (userId) => ipcRenderer.invoke('fetch-recent-screenshots', userId),
    fetchScreenshots: () => ipcRenderer.invoke('fetch-recent-screenshots'),
    startScreenshotCapture: (data) => ipcRenderer.invoke('start-screenshot-capture', data),
    stopScreenshotCapture: () => ipcRenderer.invoke('stop-screenshot-capture'),
    onScreenshotCaptured: (callback) => ipcRenderer.on('screenshot-captured', callback),
    onScreenshotError: (callback) => ipcRenderer.on('screenshot-error', callback),
    fetchBrowserActivity: (userId) => ipcRenderer.invoke('fetch-browser-activity', userId),
    startTrackingBrowserActivity: (userId, projectId) => 
        ipcRenderer.invoke('start-browser-activity-tracking', userId, projectId),
    stopTrackingBrowserActivity: (userId, projectId, workedTime) => 
        ipcRenderer.invoke('stop-browser-activity-tracking', userId, projectId, workedTime),
    onBrowserActivityUpdated: (callback) => ipcRenderer.on('browser-activity-updated', (event, data) => callback(data)),
    getRecentActivities: () => ipcRenderer.invoke('get-recent-activities'),
    removeScreenshotListeners: () => {
        ipcRenderer.removeAllListeners('screenshot-captured');
        ipcRenderer.removeAllListeners('screenshot-error');
    },
    pauseTracking: () => ipcRenderer.invoke('pause-tracking'),
    resumeTracking: (projectId) => ipcRenderer.invoke('resume-tracking', projectId),
    trackMouseActivity: () => ipcRenderer.send('mouse-activity'),
    trackKeyboardActivity: () => ipcRenderer.send('keyboard-activity'),
    getActivityStats: () => ipcRenderer.invoke('get-activity-stats'),
    pauseTrackingBrowserActivity: () => 
        ipcRenderer.invoke('pause-browser-activity'),
    resumeTrackingBrowserActivity: (projectId) => 
        ipcRenderer.invoke('resume-browser-activity', projectId),
    pauseActiveWindowTracking: () => ipcRenderer.invoke('pause-window-tracking'),
    resumeActiveWindowTracking: () => ipcRenderer.invoke('resume-window-tracking'),
    onTimerUpdate: (callback) => {
        const newCallback = (_event, seconds) => callback(seconds);
        ipcRenderer.on('timer-update', newCallback);
        return () => ipcRenderer.removeListener('timer-update', newCallback);
    },
    onTrackingPaused: (callback) => {
        ipcRenderer.on('tracking-paused', (_event, seconds) => callback(seconds));
    },
    onTrackingResumed: (callback) => {
        ipcRenderer.on('tracking-resumed', (_event, seconds) => callback(seconds));
    },
    startScreenRecording: (userId, projectId) => 
        ipcRenderer.invoke('start-screen-recording', userId, projectId),
    stopScreenRecording: (userId, projectId) => 
        ipcRenderer.invoke('stop-screen-recording', userId, projectId),
    pauseScreenRecording: (userId, projectId) => 
        ipcRenderer.invoke('pause-screen-recording', userId, projectId),
    resumeScreenRecording: (userId, projectId) => 
        ipcRenderer.invoke('resume-screen-recording', userId, projectId),
    onRecordingComplete: (callback) => ipcRenderer.on('recording-complete', callback),
    onRecordingError: (callback) => ipcRenderer.on('recording-error', callback),
    removeRecordingListeners: () => {
        ipcRenderer.removeAllListeners('recording-complete');
        ipcRenderer.removeAllListeners('recording-error');
    },
    getRecordings: (projectId, limit) => ipcRenderer.invoke('get-recordings', projectId, limit),
    onRecordingsUpdated: (callback) => 
        ipcRenderer.on('recordings-updated', (_event, recordings) => callback(recordings)),
    onActivityUpdate: (callback) => 
        ipcRenderer.on('activity-update', (_event, stats) => callback(stats))
});

contextBridge.exposeInMainWorld('auth', {
    getToken: () => localStorage.getItem('token'),
    getUserId: () => {
        const userId = localStorage.getItem('userId');
        if (!userId) {
            console.error('No userId found in localStorage');
        }
        return userId;
    },
    isAuthenticated: () => {
        const token = localStorage.getItem('token');
        const userId = localStorage.getItem('userId');
        return !!(token && userId);
    },
    logout: () => {
        localStorage.removeItem('token');
        localStorage.removeItem('userId');
        localStorage.removeItem('fullName');
        window.location.href = 'login.html';
    },
    getFullName: () => localStorage.getItem('fullName'),
    getEmail: () => {
        const token = localStorage.getItem('token');
        if (token) {
            const tokenPayload = JSON.parse(atob(token.split('.')[1]));
            return tokenPayload.email;
        }
        return null;
    }
});
