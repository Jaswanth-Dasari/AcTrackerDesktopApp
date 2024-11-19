import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import screenshot from 'screenshot-desktop';
import AWS from 'aws-sdk';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { browserActivities } from './server.js';
import { activeWindow } from 'active-win'; // Import `activeWindow` directly
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// AWS S3 configuration
const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION,
});

const bucketName = process.env.S3_BUCKET_NAME;

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            enableRemoteModule: false,
            nodeIntegration: false,
        },
    });

    win.loadFile(path.join(__dirname, 'public', 'index.html'));
   
}

// Capture screenshot and upload to AWS S3
ipcMain.handle('capture-screenshot', async () => {
    try {
        const timestamp = new Date();
        const img = await screenshot({ format: 'png' });

        const data = await s3.upload({
            Bucket: bucketName,
            Key: `screenshots/screenshot-${timestamp.toISOString()}.png`,
            Body: img,
            ContentType: 'image/png',
            Metadata: { timestamp: timestamp.toISOString() }
        }).promise();

        return { success: true, url: data.Location, timestamp: timestamp.toISOString() };
    } catch (error) {
        console.error('Error capturing screenshot or uploading:', error);
        return { success: false, error: error.message };
    }
});

// Fetch recent screenshots from the server
ipcMain.handle('fetch-recent-screenshots', async () => {
    try {
        const response = await fetch('http://localhost:5001/api/recent-screenshots');
        const screenshots = await response.json();
        return screenshots;
    } catch (error) {
        console.error('Error fetching screenshots from backend:', error.message);
        return { error: 'Failed to fetch screenshots' };
    }
});

ipcMain.on('stop-tracking', async (event, activityData) => {
    const { mouseUsagePercentage, keyboardUsagePercentage, mouseEvents, keyboardEvents, browserActivity } = activityData;

    try {
        await saveActivityData(activityData);
        await saveBrowserActivityData(browserActivity);
    } catch (error) {
        console.error('Error saving activity and browser data:', error.message);
    }
});

let browserActivityInterval;
let currentWindowId = null;
let windowTimeTracker = {}; // Track time spent on each window

// Helper function to fetch the 5 most recent rows from MongoDB
async function fetchRecentActivities() {
    try {
        const recentActivities = await browserActivities.find({})
            .sort({ _id: -1 }) // Sort by newest first
            .limit(5); // Limit to 5 rows
        return recentActivities;
    } catch (error) {
        console.error('Error fetching recent activities:', error);
        return [];
    }
}// Send the latest 5 rows to the renderer when the renderer is ready


// Start tracking active window activity
ipcMain.handle('start-browser-activity-tracking', () => {
    console.log('Starting active window tracking');

    // Track active window every 5 seconds
    browserActivityInterval = setInterval(async () => {
        try {
            const window = await activeWindow();
            console.log('Active window details:', window);

            if (window && window.id) {
                const windowId = window.id;

                if (windowId !== currentWindowId) {
                    // Add time to the previous window
                    if (currentWindowId && windowTimeTracker[currentWindowId]) {
                        windowTimeTracker[currentWindowId].timeSpent += 5;
                    }

                    // Update current window and initialize tracking
                    currentWindowId = windowId;
                    if (!windowTimeTracker[windowId]) {
                        windowTimeTracker[windowId] = { ...window, timeSpent: 0 };
                    }
                }
            }
        } catch (error) {
            console.error('Error tracking active window:', error);
        }
    }, 5000); // Check every 5 seconds
});

// Stop tracking and save data to MongoDB
ipcMain.handle('stop-browser-activity-tracking', async (event, userId, projectId) => {
    console.log('Stopping active window tracking');
    clearInterval(browserActivityInterval);

    // Add time for the last active window
    if (currentWindowId && windowTimeTracker[currentWindowId]) {
        windowTimeTracker[currentWindowId].timeSpent += 5;
    }

    // Format data for MongoDB
    const totalTime = Object.values(windowTimeTracker).reduce((acc, data) => acc + data.timeSpent, 0);
    const activityData = Object.values(windowTimeTracker).map((window) => ({
        userId:userId,
        projectId:projectId,
        title: window.title,
        application: window.owner.name,
        processId: window.owner.processId,
        timeSpentPercentage: totalTime > 0 ? (window.timeSpent / totalTime) * 100 : 0,
    }));

    if (activityData.length > 0) {
        try {
            console.log('Saving active window data to MongoDB:', activityData);
            await browserActivities.insertMany(activityData);
            event.sender.send('browser-activity-updated', activityData);
            
        } catch (error) {
            console.error('Error saving active window data:', error);
        }
    } else {
        console.log('No active window data to save.');
    }

    // Reset tracking data
    windowTimeTracker = {};
    currentWindowId = null;
});

ipcMain.handle('get-recent-activities', async (event) => {
    const recentActivities = await fetchRecentActivities();
    event.sender.send('browser-activity-updated', recentActivities);
});
// App lifecycle event handlers
app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
