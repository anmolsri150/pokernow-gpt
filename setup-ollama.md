# Ollama Setup Guide for Poker Bot

## Prerequisites
Your hardware specs are perfect for running local models:
- **RAM**: 32GB (excellent)
- **GPU**: RTX 3070 8GB mobile (good for inference)
- **CPU**: Ryzen 7 5800H (good for CPU fallback)

## Step 1: Install Ollama

### Windows (WSL2 recommended)
1. Install WSL2 if you haven't already:
   ```bash
   wsl --install
   ```

2. Install Ollama in WSL2:
   ```bash
   curl -fsSL https://ollama.ai/install.sh | sh
   ```

3. Start Ollama:
   ```bash
   ollama serve
   ```

### Alternative: Windows Native (if WSL2 not available)
1. Download from: https://ollama.ai/download
2. Install and run the application

## Step 2: Pull Recommended Models

For your hardware, I recommend starting with these models:

### Option 1: Llama 3.1 8B (Recommended)
```bash
ollama pull llama3.1:8b
```
- **Size**: ~4.7GB
- **RAM Usage**: ~8-12GB
- **Performance**: Excellent reasoning, good for poker decisions

### Option 2: Phi-3 Mini 3.8B (Fastest)
```bash
ollama pull phi3:mini
```
- **Size**: ~2.3GB
- **RAM Usage**: ~4-6GB
- **Performance**: Very fast, surprisingly good reasoning

### Option 3: Code Llama 7B (Good for structured output)
```bash
ollama pull codellama:7b
```
- **Size**: ~4.1GB
- **RAM Usage**: ~8-10GB
- **Performance**: Excellent for following instructions

## Step 3: Test the Setup

1. Test if Ollama is running:
   ```bash
   ollama list
   ```

2. Test a model:
   ```bash
   ollama run llama3.1:8b "You are a poker player. What would you do with pocket aces preflop?"
   ```

## Step 4: Configure Your Poker Bot

1. Update your AI configuration to use the local model:
   ```json
   {
       "provider": "Ollama",
       "model_name": "llama3.1:8b",
       "playstyle": "neutral"
   }
   ```

2. Or use the provided config file:
   ```bash
   cp app/configs/ai-config-local.json app/configs/ai-config.json
   ```

## Step 5: Run Your Bot

Your bot will now use the local model instead of cloud APIs!

## Performance Tips

1. **GPU Acceleration**: Ollama will automatically use your RTX 3070 if available
2. **Memory Management**: Close other applications to free up RAM
3. **Model Selection**: Start with Phi-3 Mini for speed, upgrade to Llama 3.1 for quality

## Troubleshooting

### Model not found
```bash
ollama pull <model_name>
```

### Out of memory
- Try a smaller model like `phi3:mini`
- Close other applications
- Restart Ollama

### Slow performance
- Ensure GPU drivers are up to date
- Check if GPU is being used: `nvidia-smi` (in WSL2)

## Available Models for Your Hardware

| Model | Size | RAM Usage | Speed | Quality |
|-------|------|-----------|-------|---------|
| phi3:mini | 2.3GB | 4-6GB | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| codellama:7b | 4.1GB | 8-10GB | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| llama3.1:8b | 4.7GB | 8-12GB | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| llama2:13b | 7.3GB | 12-16GB | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |

**Recommendation**: Start with `llama3.1:8b` for the best balance of speed and quality. 