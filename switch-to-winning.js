const fs = require('fs');
const path = require('path');

// Read the winning strategy config
const winningConfig = JSON.parse(fs.readFileSync('./app/configs/ai-config-winning.json', 'utf8'));

// Write it to the main config file
fs.writeFileSync('./app/configs/ai-config.json', JSON.stringify(winningConfig, null, 4));

console.log('✅ Switched to winning strategy configuration!');
console.log('📋 Strategy features:');
console.log('   - Tight-aggressive preflop play');
console.log('   - Position-based hand selection');
console.log('   - Drawing hand evaluation with pot odds');
console.log('   - Value betting with strong hands');
console.log('   - Rule-based decision making');
console.log('');
console.log('🎯 The bot will now use the winning strategy with fixed rules for:');
console.log('   - Preflop hand selection based on position');
console.log('   - Postflop drawing hand play when odds are good');
console.log('   - Bet sizing based on hand strength');
console.log('   - Position-based aggression');
console.log('');
console.log('📖 See WINNING_STRATEGY_GUIDE.md for detailed strategy information');
