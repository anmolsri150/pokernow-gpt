const fs = require('fs');
const path = require('path');

const configs = {
    'conservative': 'app/configs/ai-config-conservative.json',
    'passive': 'app/configs/ai-config.json',
    'neutral': 'app/configs/ai-config-neutral.json'
};

function switchConfig(configName) {
    if (!configs[configName]) {
        console.log('Available configs:', Object.keys(configs).join(', '));
        return;
    }

    const sourcePath = configs[configName];
    const targetPath = 'app/configs/ai-config.json';

    if (!fs.existsSync(sourcePath)) {
        console.log(`Config file ${sourcePath} does not exist`);
        return;
    }

    try {
        fs.copyFileSync(sourcePath, targetPath);
        console.log(`Switched to ${configName} configuration`);
    } catch (error) {
        console.error('Error switching config:', error);
    }
}

const configName = process.argv[2];
if (!configName) {
    console.log('Usage: node switch-config.js <config-name>');
    console.log('Available configs:', Object.keys(configs).join(', '));
} else {
    switchConfig(configName);
}
