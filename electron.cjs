const { app } = require('electron');

// Import your ES module main file
require('electron').app.whenReady().then(async () => {
    await import('./main.mjs');
});

// Handle window-all-closed event
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
}); 