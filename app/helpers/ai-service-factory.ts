import { AIService } from "../interfaces/ai-client-interfaces.ts";
import { GoogleAIService } from "../services/ai/googleai-service.ts";
import { OpenAIService } from "../services/ai/openai-service.ts";
import { OllamaService } from "../services/ai/ollama-service.ts";
import { StrategyAIService } from "../services/ai/strategy-ai-service.ts";
import { Game } from "../models/game.ts";

export class AIServiceFactory {
    private supportedModels: Map<string, string[]>;

    constructor(){
        this.supportedModels = new Map<string, string[]>([
            ["OpenAI", ["gpt-3.5-turbo", "gpt-4-turbo", "gpt-4o"]],
            ["Google", ["gemini-1.5-flash", "gemini-1.0-pro", "gemini-1.5-pro"]],
            ["Ollama", ["llama3.1:8b", "llama3.1:8b-instruct", "codellama:7b", "phi3:mini", "mistral:7b", "llama2:7b", "llama2:13b"]]
        ]);
    }

    createAIService(provider: string, model_name: string, playstyle: string = "neutral", game?: Game): AIService {
        if (!(this.supportedModels.has(provider) && this.supportedModels.get(provider)!.includes(model_name))) {
            throw new Error("AI provider or model not supported, please check the list of supported models.")
        }
        
        let baseService: AIService;
        
        switch(provider) {
            case ("OpenAI"):
                const openai_auth_key = process.env.OPENAI_API_KEY;
                if (!openai_auth_key) {
                    throw new Error(`Invalid ${provider} auth key.`);
                }
                baseService = new OpenAIService(openai_auth_key, model_name, playstyle);
                break;
            case ("Google"):
                const googleai_auth_key = process.env.GOOGLEAI_API_KEY;
                console.log("Google AI Key:", googleai_auth_key);
                if (!googleai_auth_key) {
                    throw new Error (`Invalid ${provider} auth key.`);
                }
                baseService = new GoogleAIService(googleai_auth_key, model_name, playstyle);
                break;
            case ("Ollama"):
                // For Ollama, we don't need an API key, but we'll use a placeholder
                baseService = new OllamaService("", model_name, playstyle);
                break;
            default:
                throw new Error("Failed to create AI service.");
        }
        
        // If using winning strategy and game is provided, wrap with strategy service
        if (playstyle === "winning" && game) {
            return new StrategyAIService(baseService, game, true);
        }
        
        return baseService;
    }

    printSupportedModels(): void {
        console.log("Supported models:")
        for (const provider of Array.from(this.supportedModels.keys())) {
            let out = provider.concat(": ");
            out = out.concat(this.supportedModels.get(provider)!.join(", "));
            console.log(out);
        }
    }
}