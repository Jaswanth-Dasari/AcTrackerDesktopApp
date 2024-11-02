const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const screenshot = require('screenshot-desktop');
const AWS = require('aws-sdk');
require('dotenv').config();

// Configure AWS S3
const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION,
});

const bucketName = process.env.S3_BUCKET_NAME;

// Create the main window
function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),  // Preload file for secure context bridging
            contextIsolation: true,
            enableRemoteModule: false,
            nodeIntegration: false,
        },
    });

    win.loadFile(path.join(__dirname, 'public', 'index.html'));
    // Open devtools only in development mode
    win.webContents.openDevTools();
}

// Handle screenshot capture and upload to S3
ipcMain.handle('capture-screenshot', async () => {
    try {
        const timestamp = new Date();  // Capture the current date and time
        const img = await screenshot({ format: 'png' });

        // Upload the screenshot to S3
        const data = await s3.upload({
            Bucket: bucketName,
            Key: `screenshots/screenshot-${timestamp.toISOString()}.png`,
            Body: img,
            ContentType: 'image/png',
            Metadata: { timestamp: timestamp.toISOString() } // Add timestamp as metadata
        }).promise();

        // Return the S3 URL and timestamp to the renderer process
        return { success: true, url: data.Location, timestamp: timestamp.toISOString() };
    } catch (error) {
        console.error('Error capturing screenshot or uploading:', error);
        return { success: false, error: error.message };
    }
});



app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });