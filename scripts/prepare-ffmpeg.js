const fs = require('fs-extra');
const path = require('path');

async function copyFFmpeg() {
    const ffmpegSrc = require('@ffmpeg-installer/ffmpeg').path;
    const resourcesDir = path.join(__dirname, '..', 'resources', 'ffmpeg');
    
    try {
        // Ensure the directory exists
        await fs.ensureDir(resourcesDir);
        
        // Copy FFmpeg
        await fs.copy(ffmpegSrc, path.join(resourcesDir, 'ffmpeg.exe'));
        
        console.log('FFmpeg copied successfully');
    } catch (error) {
        console.error('Error copying FFmpeg:', error);
        process.exit(1);
    }
}

copyFFmpeg(); 