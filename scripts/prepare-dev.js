const fs = require('fs');
const path = require('path');

function prepareDevEnvironment() {
    try {
        const rootDir = path.join(__dirname, '..');
        
        // Check if .env exists, if not copy from template
        if (!fs.existsSync(path.join(rootDir, '.env'))) {
            console.log('Creating .env from template...');
            fs.copyFileSync(
                path.join(rootDir, '.env.template'),
                path.join(rootDir, '.env')
            );
            console.log('Created .env file. Please update it with your credentials.');
        }
        
        // Check if credentials.json exists, if not copy from template
        if (!fs.existsSync(path.join(rootDir, 'credentials.json'))) {
            console.log('Creating credentials.json from template...');
            fs.copyFileSync(
                path.join(rootDir, 'credentials.template.json'),
                path.join(rootDir, 'credentials.json')
            );
            console.log('Created credentials.json file. Please update it with your AWS credentials.');
        }
        
        console.log('\nDevelopment environment prepared successfully!');
        console.log('Please update the following files with your credentials:');
        console.log('1. .env - For development environment variables');
        console.log('2. credentials.json - For AWS credentials in production');
    } catch (error) {
        console.error('Error preparing development environment:', error);
        process.exit(1);
    }
}

prepareDevEnvironment(); 