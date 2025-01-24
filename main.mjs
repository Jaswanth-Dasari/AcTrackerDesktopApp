import { app, BrowserWindow, ipcMain, desktopCapturer } from 'electron';
import path from 'path';
import screenshot from 'screenshot-desktop';
import dotenv from 'dotenv';
import { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import { activeWindow } from 'active-win';
import { writeFile, readFile } from 'fs/promises';
import sharp from 'sharp';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import fs from 'fs/promises';
import { Readable } from 'stream';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import { spawn } from 'child_process';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Function to load config
async function loadConfig() {
    if (app.isPackaged) {
        try {
            const configPath = path.join(process.resourcesPath, 'config.json');
            const configData = await readFile(configPath, 'utf8');
            return JSON.parse(configData);
        } catch (error) {
            console.error('Error loading config:', error);
            return null;
        }
    }
    return null;
}

// AWS S3 configuration using SDK v3
let s3;

async function initializeS3() {
    const config = await loadConfig();
    
    s3 = new S3Client({
        region: process.env.AWS_REGION || (config?.aws?.region || 'us-east-1'),
        credentials: {
            accessKeyId: app.isPackaged 
                ? config?.aws?.accessKeyId
                : process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: app.isPackaged
                ? config?.aws?.secretAccessKey
                : process.env.AWS_SECRET_ACCESS_KEY
        }
    });

    // Add warning about credentials in development
    if (!app.isPackaged) {
        console.warn('Running in development mode - using environment variables for AWS credentials');
    } else {
        console.log('Running in production mode - using packaged credentials');
    }
}

// Global reference to prevent garbage collection
let mainWindow = null;

// Create the Electron window
function createWindow() {
    // Check if window already exists
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        return;
    }

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        icon: 'public/Actracker_Icon.ico',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            enableRemoteModule: false,
            nodeIntegration: true,
        },
    });

    mainWindow.loadFile(path.join(__dirname, 'public', 'login.html'));

    // Handle window close
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// Modify app lifecycle events
app.whenReady().then(async () => {
    await initializeS3();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Handle second-instance
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Someone tried to run a second instance, we should focus our window.
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}

// Determine the FFmpeg path based on environment
const getFfmpegPath = () => {
    if (app.isPackaged) {
        // When running as packaged app
        const ffmpegDir = path.join(process.resourcesPath, 'ffmpeg');
        const ffmpegExecutable = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
        const ffmpegPath = path.join(ffmpegDir, ffmpegExecutable);
        
        // Verify FFmpeg exists
        try {
            fs.access(ffmpegPath).catch(async (err) => {
                console.error('FFmpeg not found at:', ffmpegPath);
                // Create directory if it doesn't exist
                await ensureDirectoryExists(ffmpegDir);
                throw new Error(`FFmpeg not found: ${err.message}`);
            });
        } catch (error) {
            console.error('Error checking FFmpeg:', error);
        }
        
        return ffmpegPath;
    } else {
        // When running in development
        return ffmpegPath.path;
    }
};

// Set FFmpeg path
const ffmpegExecutablePath = getFfmpegPath();
ffmpeg.setFfmpegPath(ffmpegExecutablePath);

console.log('FFmpeg Path:', ffmpegExecutablePath); // For debugging

const bucketName = process.env.S3_BUCKET_NAME || 'time-tracking-persist-ventures';

// State variables
let browserActivityInterval = null;
let currentWindowId = null;
let windowTimeTracker = {};
let isTracking = false;
let pendingStop = false;
let isPaused = false;
let mouseEvents = 0;
let keyboardEvents = 0;
let activityInterval = null;
let windowTrackingInterval = null;
let screenshotInterval = null;
let activeTimerSeconds = 0;
let screenshotDue = false;
let lastFetchTime = null;
let gifRecordingInterval = null;
let isGifRecordingEnabled = true;
let gifIntervalSeconds = 25;
let recordingInterval = null;
let isRecording = false;
let recordingPaused = false;
let currentRecordingPath = null;
let ffmpegProcess = null;
let uploadInProgress = false;

// Add this helper function at the top level
const ensureDirectoryExists = async (dirPath) => {
    try {
        await fs.access(dirPath);
    } catch {
        await fs.mkdir(dirPath, { recursive: true });
    }
};

// Add formatTime function at the top level
function formatTimerDisplay(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

// Update startActivityTracking function
function startActivityTracking(userId, projectId) {
    if (isPaused) return;

    clearAllIntervals(); // Clear any existing intervals first

    if (!isTracking) {
        console.log('\n=== Starting New Tracking Session ===');
        console.log(`User ID: ${userId}`);
        console.log(`Project ID: ${projectId}`);
        
        mouseEvents = 0;
        keyboardEvents = 0;
        activeTimerSeconds = 0;
        windowTimeTracker = {}; // Reset the tracker
        isTracking = true;
        isPaused = false;

        // Start screen recording immediately
        startRecording(userId, projectId).catch(err => {
            console.error('Failed to start initial recording:', err);
        });
    }

    // Single timer interval for everything
    const mainInterval = setInterval(async () => {
        if (!isPaused && isTracking && !pendingStop) {
            activeTimerSeconds++;
            
            // Log timer update to console only every minute (60 seconds)
            if (activeTimerSeconds % 60 === 0) {
                console.log(`Timer Update: ${formatTimerDisplay(activeTimerSeconds)}`);
            }
            
            const mainWindow = BrowserWindow.getAllWindows()[0];
            if (mainWindow) {
                mainWindow.webContents.send('timer-update', activeTimerSeconds);
                
                // Handle screenshot at 10-minute intervals (600 seconds)
                if (activeTimerSeconds % 600 === 0) {
                    console.log('\n=== Capturing Screenshot (10-minute interval) ===');
                    const result = await captureScreenshot(userId);
                    if (result.success) {
                        mainWindow.webContents.send('screenshot-captured', result);
                    }
                }

                // Handle screen recording at 15-minute intervals (900 seconds)
                if (activeTimerSeconds % 900 === 0 && !isRecording) {
                    console.log('\n=== Starting New Recording Segment (15-minute interval) ===');
                    startRecording(userId, projectId).catch(err => {
                        console.error('Failed to start recording segment:', err);
                    });
                }
                
                // Track window activity every 5 seconds
                if (activeTimerSeconds % 5 === 0) {
                    trackWindowActivity(userId, projectId, mainWindow);
                }
            }
        }
    }, 1000);

    screenshotInterval = mainInterval;
    setupEventListeners();
}

// Add new function to initialize recording
async function initializeRecording(userId, projectId) {
    try {
        console.log('\n=== Initializing Screen Recording System ===');
        
        // Start initial recording
        console.log('Starting initial recording...');
        await recordVideo(userId, projectId);

        // Set up recording interval (every 15 minutes)
        console.log('Setting up recording interval (15 minutes)');
        if (recordingInterval) {
            clearInterval(recordingInterval);
        }
        
        recordingInterval = setInterval(async () => {
            if (!isPaused && isTracking && !pendingStop) {
                console.log('\n=== Starting New Recording Segment (15-minute interval) ===');
                await recordVideo(userId, projectId);
            }
        }, 900000); // 15 minutes in milliseconds

        console.log('Screen recording system initialized successfully');
    } catch (error) {
        console.error('Failed to initialize recording system:', error);
    }
}

// Helper function to format window titles
function formatWindowTitle(window) {
    if (!window.title || window.title.trim() === '') {
        // Handle different cases for empty titles
        if (window.owner.name === 'Windows Explorer') {
            return 'Windows Home Screen';
        } else if (window.url) {
            return `${window.owner.name} - ${window.url}`;
        } else {
            return `${window.owner.name} Window`;
        }
    }
    return window.title;
}

// Update start tracking handler
ipcMain.handle('start-browser-activity-tracking', async (event, userId, projectId) => {
    if (!userId || !projectId) {
        console.error('Missing required fields for tracking:', { userId, projectId });
        return { error: 'User ID and Project ID are required' };
    }

    console.log('Starting activity tracking for user:', userId, 'project:', projectId);
    
    isTracking = true;
    isPaused = false;
    windowTimeTracker = {}; // Reset the tracker
    
    try {
        startActivityTracking(userId, projectId);
        return { success: true };
    } catch (error) {
        console.error('Failed to start tracking:', error);
        return { error: error.message };
    }
});

// Update the stop tracking handler
ipcMain.handle('stop-browser-activity-tracking', async (event, userId, projectId, workedTime) => {
    if (!isTracking || pendingStop) return;

    console.log('Stopping all tracking activities');
    pendingStop = true;
    isTracking = false; // Set this immediately to prevent new recordings
    
    try {
        // Stop screen recording first and wait for it to complete
        await stopRecording(userId, projectId);

        // Calculate final activity data
        const activities = calculateActivityData(userId, projectId);
        
        // Calculate final usage percentages
        const totalEvents = mouseEvents + keyboardEvents;
        const mouseUsagePercentage = totalEvents > 0 ? (mouseEvents / totalEvents) * 100 : 0;
        const keyboardUsagePercentage = totalEvents > 0 ? (keyboardEvents / totalEvents) * 100 : 0;

        // Save all data at once
        await Promise.all([
            // Save time entry
            fetch('https://actracker.onrender.com/api/save-time-entry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId,
                    projectId,
                    workedTime: parseInt(workedTime),
                    timestamp: new Date().toISOString()
                })
            }),

            // Save user activity
            fetch('https://actracker.onrender.com/api/save-activity', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId,
                    projectId,
                    mouseEvents,
                    keyboardEvents,
                    mouseUsagePercentage,
                    keyboardUsagePercentage,
                    totalTime: workedTime
                })
            }),

            // Save accumulated browser activity
            saveBrowserActivity(userId, projectId, activities)
        ]);

        console.log('All activity data saved successfully');
        
        // Clear all intervals and reset states
        clearAllIntervals();
        
        // Reset all tracking data
        mouseEvents = 0;
        keyboardEvents = 0;
        windowTimeTracker = {};
        currentWindowId = null;
        activeTimerSeconds = 0;
        lastFetchTime = null;
        
        pendingStop = false;
        return true;
    } catch (error) {
        console.error('Error saving activity data:', error);
        pendingStop = false;
        throw error;
    }
});

// Helper function to calculate activity data
function calculateActivityData(userId, projectId) {
    const totalTrackCount = Object.values(windowTimeTracker).reduce((acc, data) => acc + data.trackCount, 0) || 1;
    
    return Object.entries(windowTimeTracker).map(([key, window]) => ({
        userId: userId.toString(),
        projectId: projectId.toString(),
        title: window.title || formatWindowTitle(window),
        application: window.owner.name,
        path: window.owner.path,
        url: window.url || null,
        timeSpentPercentage: (window.trackCount / totalTrackCount) * 100,
        trackCount: window.trackCount,
        timestamp: new Date().toISOString()
    }));
}

// Helper function to reset tracking data
function resetTrackingData() {
    // Clear all data
    windowTimeTracker = {};
    currentWindowId = null;
    mouseEvents = 0;
    keyboardEvents = 0;
    isTracking = false;
    pendingStop = false;
    isPaused = false;

    // Clear all intervals to ensure nothing continues running
    if (browserActivityInterval) {
        clearInterval(browserActivityInterval);
        browserActivityInterval = null;
    }
    if (windowTrackingInterval) {
        clearInterval(windowTrackingInterval);
        windowTrackingInterval = null;
    }
    if (activityInterval) {
        clearInterval(activityInterval);
        activityInterval = null;
    }

    // Remove any remaining event listeners
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
        mainWindow.webContents.removeAllListeners('before-input-event');
    }
    
    console.log('All tracking data and intervals have been reset');
}

ipcMain.handle('get-recent-activities', async (event) => {
    try {
        const response = await fetch('https://actracker.onrender.com/api/browser-activities');
        const recentActivities = await response.json();
        console.log('Recent activities fetched:', recentActivities);
        event.sender.send('browser-activity-updated', recentActivities);
    } catch (error) {
        console.error('Error fetching recent activities:', error);
    }
});

ipcMain.handle('fetch-browser-activity', async (event, userId) => {
    try {
        if (!userId) {
            return { error: 'User ID is required' };
        }

        const response = await fetch(`https://actracker.onrender.com/api/browser-activities/${userId}`, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            return { error: `Failed to fetch data. Status: ${response.status}` };
        }
        
        const activities = await response.json();
        return activities;
    } catch (error) {
        return { error: error.message };
    }
});

// Add these IPC handlers
ipcMain.handle('pause-browser-activity', async () => {
    if (browserActivityInterval) {
        clearInterval(browserActivityInterval);
        browserActivityInterval = null;
    }
    isPaused = true;
    return true;
});

ipcMain.handle('resume-browser-activity', async (event, projectId) => {
    if (!browserActivityInterval && !isPaused) {
        startBrowserActivityTracking(projectId);
    }
    isPaused = false;
    return true;
});

ipcMain.handle('pause-window-tracking', async () => {
    if (windowTrackingInterval) {
        clearInterval(windowTrackingInterval);
        windowTrackingInterval = null;
    }
    return true;
});

ipcMain.handle('resume-window-tracking', async (event, projectId) => {
    if (!windowTrackingInterval && !isPaused) {
        startWindowTracking(projectId);
    }
    return true;
});

// New function to handle window activity
async function trackWindowActivity(userId, projectId, mainWindow) {
    if (isPaused || !userId) return;
    
    try {
        const window = await activeWindow();
        if (window && window.id) {
            const windowKey = `${window.owner.name}-${window.title || 'Home Screen'}`;
            const formattedTitle = formatWindowTitle(window);
            
            if (windowTimeTracker[windowKey]) {
                windowTimeTracker[windowKey].trackCount++;
            } else {
                windowTimeTracker[windowKey] = { 
                    ...window, 
                    trackCount: 1,
                    userId: userId,
                    projectId: projectId,
                    title: formattedTitle
                };
            }

            // Only send updates to renderer, don't save to database
            if (mainWindow) {
                const activities = calculateActivityData(userId, projectId);
                mainWindow.webContents.send('browser-activity-updated', activities);
            }
        }
    } catch (error) {
        console.error('Error tracking window activity:', error);
    }
}

// Update pause handler
ipcMain.handle('pause-tracking', () => {
    if (!isTracking || pendingStop) {
        console.log('Cannot pause: invalid state');
        return;
    }
    
    console.log('Pausing activity tracking');
    isPaused = true;
    
    // Clear GIF interval on pause
    if (gifRecordingInterval) {
        clearInterval(gifRecordingInterval);
        gifRecordingInterval = null;
    }

    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
        mainWindow.webContents.send('tracking-paused', activeTimerSeconds);
    }
});

// Update resume handler
ipcMain.handle('resume-tracking', (event, projectId) => {
    if (!isTracking || pendingStop || !isPaused) {
        console.log('Cannot resume: invalid state');
        return;
    }
    
    console.log('Resuming tracking');
    isPaused = false;
    
    // Restart GIF recording on resume
    if (isGifRecordingEnabled) {
        gifRecordingInterval = setInterval(() => {
            if (!isPaused && isTracking && !pendingStop) {
                recordVideo(userId, projectId);
            }
        }, gifIntervalSeconds * 1000);
    }

    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
        mainWindow.webContents.send('tracking-resumed', activeTimerSeconds);
    }
});

// Add this function after the createWindow function
async function captureScreenshot(userId) {
    if (screenshotDue) {
        console.log('Screenshot already in progress, skipping...');
        return { success: false, error: 'Screenshot already in progress' };
    }

    try {
        screenshotDue = true;
        console.log('Taking screenshot...');
        const timestamp = new Date();
        const img = await screenshot({ format: 'png' });

        const key = `screenshots/${userId}/${timestamp.toISOString()}.png`;
        
        console.log('Uploading screenshot to S3...');
        const command = new PutObjectCommand({
            Bucket: bucketName,
            Key: key,
            Body: img,
            ContentType: 'image/png',
        });

        await s3.send(command);
        console.log('Screenshot uploaded successfully');

        const screenshotUrl = `https://${bucketName}.s3.us-east-1.amazonaws.com/${key}`;
        console.log('Screenshot URL:', screenshotUrl);

        return { 
            success: true, 
            url: screenshotUrl,
            userId,
            timestamp: timestamp.toISOString(),
            activeTime: activeTimerSeconds 
        };
    } catch (error) {
        console.error('Error capturing screenshot:', error);
        return { success: false, error: error.message };
    } finally {
        screenshotDue = false;
    }
}

// Add this handler for fetching recent screenshots
ipcMain.handle('fetch-recent-screenshots', async (event, userId) => {
    try {
        if (!userId) {
            console.error('No userId provided for fetching screenshots');
            return { screenshots: [] };
        }

        console.log('Fetching screenshots for user:', userId);
        
        const response = await fetch(`https://actracker.onrender.com/api/recent-screenshots/${userId}`);
        
        // Check if the response is JSON
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            console.error('Unexpected response format:', text);
            return { screenshots: [] };
        }

        const data = await response.json();
        
        if (!data.success) {
            console.error('Error in response:', data.message);
            return { screenshots: [] };
        }
        
        // Return the screenshots array from the response
        return data.screenshots.filter(screenshot => 
            screenshot.userId === userId.toString()
        );

    } catch (error) {
        console.error('Error fetching screenshots:', error);
        return { screenshots: [] };
    }
});

// Add this IPC handler near the other ipcMain handlers
ipcMain.handle('capture-screenshot', async (event, userId) => {
    if (!userId) {
        console.error('No userId provided for capturing screenshot');
        return { success: false, error: 'User ID is required' };
    }

    try {
        const result = await captureScreenshot(userId);
        
        if (!result.success) {
            console.error('Screenshot capture failed:', result.error);
            return result;
        }

        // Verify the screenshot belongs to the current user
        if (result.userId !== userId) {
            console.error('Screenshot userId mismatch');
            return { success: false, error: 'Screenshot user verification failed' };
        }
        
        return result;
    } catch (error) {
        console.error('Error in capture-screenshot handler:', error);
        return { success: false, error: error.message };
    }
});

// Add these helper functions to better manage intervals and listeners
function clearAllIntervals() {
    console.log('Clearing all intervals...');
    
    // Stop any active recording first
    if (ffmpegProcess) {
        try {
            ffmpegProcess.kill('SIGKILL');
            ffmpegProcess = null;
        } catch (err) {
            console.warn('Error killing FFmpeg process:', err.message);
        }
    }
    
    // Clear all intervals
    [recordingInterval, screenshotInterval, browserActivityInterval, gifRecordingInterval].forEach(interval => {
        if (interval) {
            clearInterval(interval);
        }
    });

    // Reset all intervals to null
    recordingInterval = null;
    screenshotInterval = null;
    browserActivityInterval = null;
    gifRecordingInterval = null;

    console.log('All intervals cleared');
}

function setupEventListeners() {
    console.log('Setting up event listeners');
    const mainWindow = BrowserWindow.getAllWindows()[0];
    
    // Remove existing listeners
    mainWindow.webContents.removeAllListeners('before-input-event');
    ipcMain.removeAllListeners('mouse-activity');
    
    // Add new listeners
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (!isPaused) {
            keyboardEvents++;
        }
    });

    ipcMain.on('mouse-activity', () => {
        if (!isPaused) {
            mouseEvents++;
        }
    });
}

// Add this function to handle GIF recording
ipcMain.handle('toggle-gif-recording', (event, enabled) => {
    isGifRecordingEnabled = enabled;
    console.log('GIF recording toggled:', enabled);
    return true;
});

ipcMain.handle('set-gif-interval', (event, minutes) => {
    gifIntervalSeconds = minutes;
    console.log('GIF interval set to:', minutes, 'seconds');
    return true;
});

// Add this function to handle screen recording
async function startRecording(userId, projectId) {
    if (!userId || !projectId) {
        console.error('Missing required fields for recording:', { userId, projectId });
        return;
    }

    if (isRecording) {
        console.log('Recording already in progress, skipping...');
        return;
    }

    console.log('\n=== Starting Screen Recording ===');
    console.log('User ID:', userId);
    console.log('Project ID:', projectId);

    try {
        isRecording = true;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const tempDir = path.join(app.getPath('temp'), 'screen-recordings');
        await ensureDirectoryExists(tempDir);
        
        const tempPath = path.join(tempDir, `recording-${timestamp}.mp4`);
        currentRecordingPath = tempPath;

        console.log('Recording to:', tempPath);
        console.log('Using FFmpeg path:', getFfmpegPath());

        // Start FFmpeg process with 5-second duration
        ffmpegProcess = spawn(getFfmpegPath(), [
            '-f', 'gdigrab',
            '-framerate', '30',
            '-video_size', '1280x720',
            '-offset_x', '0',
            '-offset_y', '0',
            '-draw_mouse', '1',
            '-i', 'desktop',
            '-t', '5',  // Changed from 30 to 5 seconds
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-y',
            tempPath
        ]);

        console.log('FFmpeg process started (5-second recording)');

        // Handle FFmpeg process events
        ffmpegProcess.stderr.on('data', (data) => {
            const message = data.toString();
            if (message.includes('frame=')) {
                console.log('Recording progress:', message.trim());
            }
        });

        // Wait for recording to complete
        await new Promise((resolve, reject) => {
            ffmpegProcess.on('close', async (code) => {
                console.log('FFmpeg process finished with code:', code);
                if (code === 0) {
                    try {
                        await uploadAndCleanup(currentRecordingPath, userId, projectId);
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                } else {
                    reject(new Error(`FFmpeg process failed with code ${code}`));
                }
                isRecording = false;
                ffmpegProcess = null;
            });
        });

    } catch (error) {
        console.error('Recording error:', error);
        isRecording = false;
        ffmpegProcess = null;
    }
}

// Update the recordVideo function
async function recordVideo(userId, projectId) {
    if (!userId || !projectId) {
        console.error('Missing required fields for recording:', { userId, projectId });
        return;
    }

    if (!isTracking || pendingStop) {
        console.log('Cannot start recording: tracking stopped or pending stop');
        return;
    }

    if (isRecording) {
        console.log('Another recording in progress, waiting...');
        return;
    }

    let tempPath = null;
    let localFfmpegProcess = null;

    try {
        isRecording = true;
        console.log('\n=== Starting New Video Recording Segment ===');
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const tempDir = path.join(app.getPath('temp'), 'screen-recordings');
        await ensureDirectoryExists(tempDir);
        
        tempPath = path.join(tempDir, `recording-${timestamp}-output.mp4`);
        currentRecordingPath = tempPath;

        console.log('Recording to:', tempPath);

        // Get FFmpeg path
        const execPath = getFfmpegPath();
        console.log('FFmpeg executable path:', execPath);

        await new Promise((resolve, reject) => {
            const ffmpegArgs = [
                '-f', 'gdigrab',
                '-framerate', '30',
                '-video_size', '1280x720',
                '-offset_x', '0',
                '-offset_y', '0',
                '-draw_mouse', '1',
                '-probesize', '42M',
                '-i', 'desktop',
                '-t', '30',  // Record for 30 seconds
                '-c:v', 'libx264',
                '-preset', 'ultrafast',
                '-y',
                tempPath
            ];

            console.log('Starting FFmpeg with command:', ffmpegArgs.join(' '));

            localFfmpegProcess = spawn(execPath, ffmpegArgs);
            ffmpegProcess = localFfmpegProcess;

            let errorOutput = '';

            localFfmpegProcess.stderr.on('data', (data) => {
                const message = data.toString();
                errorOutput += message;
                if (message.includes('frame=')) {
                    console.log('Recording in progress:', message.trim());
                }
            });

            localFfmpegProcess.on('close', async (code) => {
                console.log(`FFmpeg process finished with code: ${code}`);
                if (code === 0) {
                    try {
                        const stats = await fs.stat(tempPath);
                        if (stats.size === 0) {
                            console.error('Error: Output file is empty');
                            isRecording = false;
                            reject(new Error('Output file is empty'));
                            return;
                        }
                        console.log(`Recording completed successfully. File size: ${stats.size} bytes`);
                        resolve();
                    } catch (err) {
                        console.error('Failed to verify output file:', err);
                        isRecording = false;
                        reject(new Error(`Failed to verify output file: ${err.message}`));
                    }
                } else {
                    console.error(`FFmpeg error (code ${code}):`, errorOutput);
                    isRecording = false;
                    reject(new Error(`FFmpeg failed with code ${code}`));
                }
            });

            localFfmpegProcess.on('error', (err) => {
                console.error('FFmpeg process error:', err);
                isRecording = false;
                reject(err);
            });
        });

        // Upload the recording
        console.log('\n=== Uploading Recording to S3 ===');
        await uploadAndCleanup(tempPath, userId, projectId);
        console.log('Recording uploaded successfully to S3');

    } catch (error) {
        console.error('Recording error:', error);
    } finally {
        if (localFfmpegProcess) {
            try {
                localFfmpegProcess.kill('SIGKILL');
                console.log('FFmpeg process terminated');
            } catch (err) {
                console.warn('Error terminating FFmpeg process:', err);
            }
        }
        
        if (!pendingStop) {
            isRecording = false;
            ffmpegProcess = null;
            currentRecordingPath = null;
            console.log('Recording segment completed');
        }
    }
}

// Update the uploadAndCleanup function
async function uploadAndCleanup(tempPath, userId, projectId) {
    if (!tempPath || !userId || !projectId) {
        console.error('Missing required fields for upload:', { tempPath, userId, projectId });
        return;
    }
    
    try {
        console.log('Checking file existence...');
        await fs.access(tempPath);
        
        console.log('Reading file for upload...');
        const fileBuffer = await fs.readFile(tempPath);
        
        if (fileBuffer.length === 0) {
            console.error('File is empty, skipping upload');
            return;
        }

        console.log(`File size: ${fileBuffer.length} bytes`);
        uploadInProgress = true;
        
        const timestamp = new Date().toISOString();
        const s3Key = `recordings/${userId}/${projectId}/${timestamp}.mp4`;
        
        console.log('Uploading to S3:', s3Key);
        
        const uploadCommand = new PutObjectCommand({
            Bucket: bucketName,
            Key: s3Key,
            Body: fileBuffer,
            ContentType: 'video/mp4'
        });

        await s3.send(uploadCommand);
        console.log('Upload successful');

        // Clean up temp file
        try {
            await fs.unlink(tempPath);
            console.log('Temporary file cleaned up');
        } catch (cleanupError) {
            console.warn('Failed to clean up temporary file:', cleanupError);
        }

    } catch (error) {
        console.error('Upload and cleanup error:', error);
        throw error;
    } finally {
        uploadInProgress = false;
    }
}

// Add IPC handlers
ipcMain.handle('start-screen-recording', async (event, projectId) => {
    await startRecording(projectId);
    return true;
});

ipcMain.handle('stop-screen-recording', async (event, userId, projectId) => {
    console.log('Stopping screen recording...');
    
    try {
        // Set stop flag first
        pendingStop = true;
        
        // Kill any active ffmpeg process first
        if (ffmpegProcess) {
            try {
                ffmpegProcess.kill('SIGKILL');
                ffmpegProcess = null;
            } catch (err) {
                console.warn('Error killing FFmpeg process:', err.message);
            }
        }

        // Clear recording interval
        if (recordingInterval) {
            clearInterval(recordingInterval);
            recordingInterval = null;
        }

        // Wait a moment for any in-progress recordings to finish
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Handle any pending recording
        if (currentRecordingPath) {
            try {
                console.log('Uploading final recording...');
                await uploadAndCleanup(currentRecordingPath, userId, projectId);
            } catch (err) {
                console.warn('Error handling final recording:', err.message);
            }
            currentRecordingPath = null;
        }

        // Reset recording states
        isRecording = false;
        recordingPaused = false;
        isTracking = false;
        
        // Clear intervals but don't interfere with ongoing uploads
        clearAllIntervals();

        // Wait for any ongoing uploads to complete
        if (uploadInProgress) {
            console.log('Waiting for ongoing uploads to complete...');
            // Check every second if upload is complete
            while (uploadInProgress) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            console.log('All uploads completed');
        }

        console.log('Screen recording stopped successfully');
        return true;
    } catch (error) {
        console.error('Error stopping screen recording:', error.message);
        return false;
    } finally {
        pendingStop = false;
    }
});

ipcMain.handle('pause-screen-recording', async (event, userId, projectId) => {
    try {
        if (isRecording && !recordingPaused) {
            console.log('Pausing screen recording');
            recordingPaused = true;
            
            // Upload any pending recording
            if (currentRecordingPath) {
                await uploadAndCleanup(currentRecordingPath, userId, projectId);
                currentRecordingPath = null;
            }
            
            // Clear recording interval
            if (recordingInterval) {
                clearInterval(recordingInterval);
                recordingInterval = null;
            }
        }
        return true;
    } catch (error) {
        console.error('Error pausing recording:', error);
        return false;
    }
});

ipcMain.handle('resume-screen-recording', async (event, userId, projectId) => {
    try {
        if (isRecording && recordingPaused) {
            console.log('Resuming screen recording');
            recordingPaused = false;
            
            // Start new recording session
            await startRecording(userId, projectId);
            
            // Set up recording interval (15 minutes)
            recordingInterval = setInterval(async () => {
                if (!recordingPaused && !isRecording) {
                    await recordVideo(userId, projectId);
                }
            }, 900000); // 15-minute intervals
        }
        return true;
    } catch (error) {
        console.error('Error resuming recording:', error);
        return false;
    }
});

// Add this new function to get recordings
async function getProjectRecordings(projectId = null, limit = 7) {
    try {
        const command = new ListObjectsV2Command({
            Bucket: bucketName,
            Prefix: projectId ? `recordings/${projectId}/` : 'recordings/',
            MaxKeys: 100
        });

        const response = await s3.send(command);
        
        if (!response.Contents || response.Contents.length === 0) {
            return [];
        }

        // Generate signed URLs for all recordings
        const recordings = await Promise.all(
            response.Contents.map(async (item) => {
                const signedUrl = await getSignedUrl(s3, new GetObjectCommand({
                    Bucket: bucketName,
                    Key: item.Key
                }), { expiresIn: 3600 }); // URL expires in 1 hour

                return {
                    url: signedUrl,
                    timestamp: item.LastModified,
                    key: item.Key
                };
            })
        );

        // Sort by timestamp in descending order and take only the latest ones
        return recordings.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, limit);

    } catch (error) {
        console.error('Error fetching recordings:', error);
        return [];
    }
}

// Add this new IPC handler
ipcMain.handle('get-recordings', async (event, projectId, limit = 7) => {
    try {
        const recordings = await getProjectRecordings(projectId, limit);
        return recordings;
    } catch (error) {
        console.error('Error handling get-recordings request:', error);
        return [];
    }
});

// Add a function to notify renderer about new recordings
function notifyNewRecording(projectId) {
    try {
        const mainWindow = BrowserWindow.getAllWindows()[0];
        if (mainWindow) {
            setTimeout(async () => {
                // Get only the latest recording
                const recordings = await getProjectRecordings(projectId, 1);
                if (recordings && recordings.length > 0) {
                    mainWindow.webContents.send('recordings-updated', recordings);
                }
            }, 1000);
        }
    } catch (error) {
        console.error('Error notifying about new recording:', error);
    }
}

// Update the browser activity saving endpoint call
async function saveBrowserActivity(userId, projectId, activities) {
    try {
        if (!userId || !projectId) {
            console.error('Missing required fields:', { userId, projectId });
            return;
        }

        const response = await fetch('https://actracker.onrender.com/api/browser-activities', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                userId: userId.toString(),
                projectId: projectId.toString(),
                activities: activities.map(activity => ({
                    ...activity,
                    userId: userId.toString(),
                    projectId: projectId.toString(),
                    timestamp: new Date().toISOString()
                }))
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Failed to save activities. Status: ${response.status}. Details: ${JSON.stringify(errorData)}`);
        }

        const data = await response.json();
        console.log('Browser activity saved successfully:', data);
    } catch (error) {
        console.error('Error saving browser activity:', error);
        // Don't throw the error, just log it to prevent breaking the tracking flow
    }
}

// Add helper function to stop recording
async function stopRecording(userId, projectId) {
    console.log('\n=== Stopping Screen Recording System ===');
    
    try {
        // Clear recording interval first
        if (recordingInterval) {
            clearInterval(recordingInterval);
            recordingInterval = null;
            console.log('Recording interval cleared');
        }

        // Stop any active FFmpeg process immediately
        if (ffmpegProcess) {
            console.log('Stopping active FFmpeg process');
            try {
                // Force kill the FFmpeg process
                ffmpegProcess.kill('SIGKILL');
                console.log('FFmpeg process killed');
            } catch (err) {
                console.warn('Error killing FFmpeg process:', err);
            }
            ffmpegProcess = null;
        }

        // Upload any pending recording
        if (currentRecordingPath) {
            try {
                console.log('Uploading final recording');
                await uploadAndCleanup(currentRecordingPath, userId, projectId);
                console.log('Final recording uploaded');
                currentRecordingPath = null;
            } catch (err) {
                console.error('Error uploading final recording:', err);
            }
        }

        // Reset all recording-related states
        isRecording = false;
        recordingPaused = false;
        console.log('Screen recording system stopped successfully');
    } catch (error) {
        console.error('Error stopping screen recording system:', error);
    }
}

// Update the togglePause function
async function togglePause(userId, projectId) {
    if (!isTracking) return;

    isPaused = !isPaused;
    console.log(`Tracking ${isPaused ? 'paused' : 'resumed'}`);

    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (!mainWindow) return;

    if (isPaused) {
        // Pause all activities
        clearInterval(recordingInterval);
        recordingInterval = null;
        mainWindow.webContents.send('tracking-paused');
    } else {
        // Resume all activities
        initializeRecording(userId, projectId);
        mainWindow.webContents.send('tracking-resumed');
    }
}
