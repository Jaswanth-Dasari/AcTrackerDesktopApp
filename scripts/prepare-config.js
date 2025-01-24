const fs = require('fs');
const path = require('path');

function prepareConfig() {
    try {
        // Read the template
        const templatePath = path.join(__dirname, '..', 'config.template.json');
        const configPath = path.join(__dirname, '..', 'config.json');
        const credentialsPath = path.join(__dirname, '..', 'credentials.json');
        
        // Read template and credentials
        const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
        
        // Check if credentials file exists
        if (!fs.existsSync(credentialsPath)) {
            console.log('No credentials.json found. Copying template...');
            fs.copyFileSync(
                path.join(__dirname, '..', 'credentials.template.json'),
                credentialsPath
            );
            console.error('Please fill in your AWS credentials in credentials.json');
            process.exit(1);
        }
        
        const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
        
        // Inject credentials
        template.aws.accessKeyId = credentials.accessKeyId;
        template.aws.secretAccessKey = credentials.secretAccessKey;
        
        // Write the config
        fs.writeFileSync(configPath, JSON.stringify(template, null, 4));
        
        console.log('Config file prepared successfully');
    } catch (error) {
        console.error('Error preparing config:', error);
        process.exit(1);
    }
}

prepareConfig(); 