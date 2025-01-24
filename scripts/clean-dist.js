const fs = require('fs');
const path = require('path');

const distPath = path.join(__dirname, '..', 'dist');

function deleteFolderRecursive(path) {
    if (fs.existsSync(path)) {
        fs.readdirSync(path).forEach((file) => {
            const curPath = path + "/" + file;
            if (fs.lstatSync(curPath).isDirectory()) {
                deleteFolderRecursive(curPath);
            } else {
                try {
                    fs.unlinkSync(curPath);
                } catch (err) {
                    console.warn(`Failed to delete file ${curPath}:`, err);
                }
            }
        });
        try {
            fs.rmdirSync(path);
        } catch (err) {
            console.warn(`Failed to delete directory ${path}:`, err);
        }
    }
}

try {
    console.log('Cleaning dist folder...');
    deleteFolderRecursive(distPath);
    console.log('Dist folder cleaned successfully');
} catch (err) {
    console.error('Error cleaning dist folder:', err);
    process.exit(1);
} 