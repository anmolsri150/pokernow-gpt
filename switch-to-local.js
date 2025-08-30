import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const configPath = join(process.cwd(), 'app', 'configs', 'ai-config.json');
const localConfigPath = join(process.cwd(), 'app', 'configs', 'ai-config-local.json');

function switchToLocal() {
    console.log('🔄 Switching to local Ollama model...\n');

    try {
        // Check if local config exists
        if (!existsSync(localConfigPath)) {
            console.error('❌ Local config file not found:', localConfigPath);
            return;
        }

        // Read local config
        const localConfig = readFileSync(localConfigPath, 'utf8');
        const config = JSON.parse(localConfig);

        // Backup current config if it exists
        if (existsSync(configPath)) {
            const backupPath = configPath + '.backup';
            const currentConfig = readFileSync(configPath, 'utf8');
            writeFileSync(backupPath, currentConfig);
            console.log('✅ Current config backed up to:', backupPath);
        }

        // Write new config
        writeFileSync(configPath, JSON.stringify(config, null, 4));
        console.log('✅ Switched to local configuration:');
        console.log('   Provider:', config.provider);
        console.log('   Model:', config.model_name);
        console.log('   Playstyle:', config.playstyle);

        console.log('\n📋 Next steps:');
        console.log('1. Install Ollama: https://ollama.ai/download');
        console.log('2. Pull the model: ollama pull ' + config.model_name);
        console.log('3. Start Ollama: ollama serve');
        console.log('4. Run your poker bot!');

    } catch (error) {
        console.error('❌ Error switching to local config:', error.message);
    }
}

function switchToCloud() {
    console.log('🔄 Switching to cloud model...\n');

    try {
        // Check if backup exists
        const backupPath = configPath + '.backup';
        if (!existsSync(backupPath)) {
            console.error('❌ No backup config found. Please manually restore your cloud configuration.');
            return;
        }

        // Restore backup
        const backupConfig = readFileSync(backupPath, 'utf8');
        writeFileSync(configPath, backupConfig);
        console.log('✅ Restored cloud configuration from backup');

    } catch (error) {
        console.error('❌ Error switching to cloud config:', error.message);
    }
}

// Check command line arguments
const args = process.argv.slice(2);
if (args.includes('--cloud') || args.includes('-c')) {
    switchToCloud();
} else {
    switchToLocal();
} 