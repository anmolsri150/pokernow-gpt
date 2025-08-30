import { Ollama } from "ollama";
import { AIMessage, AIResponse, AIService, BotAction } from "../../interfaces/ai-client-interfaces.ts";
import { getPromptFromPlaystyle, parseResponse } from "../../helpers/ai-query-helper.ts";

export class OllamaService extends AIService {
    private client!: Ollama;
    private modelName: string;

    constructor(api_key: string, model: string, playstyle: string) {
        // For Ollama, we don't need an API key, but we'll use the model name
        super("", model, playstyle);
        this.modelName = model;
    }

    init(): void {
        this.client = new Ollama({
            host: "http://localhost:11434" // Default Ollama host
        });
    }
    
    async query(input: string, prev_messages: AIMessage[]): Promise<AIResponse> {
        if (prev_messages.length === 0) {
            try {
                const playstyle_prompt = getPromptFromPlaystyle(this.getPlaystyle());
                prev_messages = [
                    {text_content: playstyle_prompt, metadata: {"role": "system"}},
                    {text_content: input, metadata: {"role": "user"}}
                ];
            } catch (err) {
                console.log(err);
                prev_messages = [
                    {text_content: input, metadata: {"role": "user"}}
                ];
            }
        } else {
            if (input !== prev_messages[prev_messages.length - 1].text_content) {
                prev_messages.push({text_content: input, metadata: {"role": "user"}});
            }
        }

        console.log("prev_messages:", prev_messages);
        
        // Convert messages to Ollama format
        const messages = this.processMessages(prev_messages);
        
        try {
            const response = await this.client.chat({
                model: this.modelName,
                messages: messages,
                options: {
                    temperature: 0.1,
                    top_p: 0.9,
                    num_predict: 256
                }
            });

            const text_content = response.message.content;

            let bot_action: BotAction = {
                action_str: "",
                bet_size_in_BBs: 0
            };

            if (response && text_content) {
                bot_action = parseResponse(text_content);
            }

            return {
                bot_action: bot_action,
                prev_messages: prev_messages,
                curr_message: {
                    text_content: text_content!,
                    metadata: {
                        "role": "assistant"
                    }
                }
            };
        } catch (error) {
            console.error("Ollama API error:", error);
            // Return a default response in case of error
            return {
                bot_action: {
                    action_str: "fold",
                    bet_size_in_BBs: 0
                },
                prev_messages: prev_messages,
                curr_message: {
                    text_content: "Error: Unable to get response from local model. Defaulting to fold.",
                    metadata: {
                        "role": "assistant"
                    }
                }
            };
        }
    }

    processMessages(messages: AIMessage[]): Array<{role: string, content: string}> {
        const output: Array<{role: string, content: string}> = [];
        for (const message of messages) {
            // Map roles to Ollama format
            let role = message.metadata.role;
            if (role === "model") role = "assistant";
            if (role === "user") role = "user";
            if (role === "system") role = "system";
            
            output.push({
                role: role,
                content: message.text_content
            });
        }
        return output;
    }

    // Method to check if the model is available
    async checkModelAvailability(): Promise<boolean> {
        try {
            const models = await this.client.list();
            return models.models.some((model: any) => model.name === this.modelName);
        } catch (error) {
            console.error("Error checking model availability:", error);
            return false;
        }
    }

    // Method to pull the model if not available
    async pullModel(): Promise<void> {
        try {
            console.log(`Pulling model ${this.modelName}...`);
            await this.client.pull({ model: this.modelName });
            console.log(`Model ${this.modelName} pulled successfully`);
        } catch (error) {
            console.error(`Error pulling model ${this.modelName}:`, error);
            throw error;
        }
    }
} 