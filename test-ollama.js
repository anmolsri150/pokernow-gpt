import { OllamaService } from './app/services/ai/ollama-service.ts';
import { readFileSync } from 'fs';

async function testOllamaIntegration() {
    console.log('🧪 Testing Ollama Integration for Poker Bot...\n');

    try {
        // Create Ollama service instance
        const ollamaService = new OllamaService('', 'llama3.1:8b', 'neutral');
        ollamaService.init();

        console.log('✅ Ollama service initialized');

        // Check if model is available
        const isAvailable = await ollamaService.checkModelAvailability();
        if (!isAvailable) {
            console.log('⚠️  Model not found. Please run: ollama pull llama3.1:8b');
            console.log('   Or try a different model like: phi3:mini');
            return;
        }

        console.log('✅ Model available');

        // Test poker decision
        const testQuery = `You are playing poker. You have pocket aces (A♠ A♥) and are in early position. 
        The pot is 3 big blinds, you have 100 big blinds, and it's your turn to act. 
        What action do you take? Respond with just the action and bet size, like "raise 3" or "fold".`;

        console.log('🤔 Testing poker decision...');
        console.log('Query:', testQuery);

        const response = await ollamaService.query(testQuery, []);
        
        console.log('\n📝 Model Response:');
        console.log('Text:', response.curr_message.text_content);
        console.log('Parsed Action:', response.bot_action.action_str);
        console.log('Bet Size (BBs):', response.bot_action.bet_size_in_BBs);

        if (response.bot_action.action_str) {
            console.log('\n✅ Success! Local model is working correctly.');
        } else {
            console.log('\n⚠️  Model responded but action parsing failed.');
        }

    } catch (error) {
        console.error('❌ Error testing Ollama integration:', error.message);
        console.log('\n🔧 Troubleshooting:');
        console.log('1. Make sure Ollama is running: ollama serve');
        console.log('2. Check if model is installed: ollama list');
        console.log('3. Pull the model: ollama pull llama3.1:8b');
    }
}

// Run the test
testOllamaIntegration(); 