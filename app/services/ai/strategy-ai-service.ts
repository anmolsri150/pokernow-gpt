import { AIService, BotAction, AIMessage, AIResponse } from "../../interfaces/ai-client-interfaces.ts";
import { StrategyEngine, StrategyDecision } from "../strategy-engine.ts";
import { Game } from "../../models/game.ts";

/**
 * StrategyAIService (v1.1)
 * - Converts strategy decisions to pot-fraction-aware bets
 * - Emits reasoning with EVs, equity, blockers, and board tags
 * - Falls back to base AI if the engine errors
 *
 * Assumptions:
 * - StrategyEngine exposes getDecision() and getState() with current pot and sizing bounds.
 * - StrategyDecision optionally carries: potFraction, heroEquity, evBet, evCall, boardTags, blockers, villainArchetype, plan.
 * - Game exposes bigBlind/chipDenom if you need BB conversions.
 */
export class StrategyAIService extends AIService {
  private strategyEngine: StrategyEngine;
  private baseAIService: AIService;
  private useStrategyEngine: boolean;
  private game: Game;

  constructor(baseAIService: AIService, game: Game, useStrategyEngine: boolean = true) {
    super("", "", "winning");
    this.baseAIService = baseAIService;
    this.strategyEngine = new StrategyEngine(game);
    this.useStrategyEngine = useStrategyEngine;
    this.game = game;
  }

  init(): void {
    this.baseAIService.init();
  }

  async query(input: string, prev_messages: AIMessage[]): Promise<AIResponse> {
    if (!this.useStrategyEngine) {
      return this.baseAIService.query(input, prev_messages);
    }

    try {
      // Get strategy recommendation first
      let strategyDecision = this.strategyEngine.getDecision();
      
      // Check if this is the first hand and apply first-hand rules
      const isFirstHand = this.isFirstHand();
      if (isFirstHand) {
        strategyDecision = this.applyFirstHandRules(strategyDecision);
      }
      
      // Create enhanced prompt with strategy reasoning
      const enhancedPrompt = this.createEnhancedPrompt(input, strategyDecision);
      
      // Let AI make the final decision with strategy context
      const aiResponse = await this.baseAIService.query(enhancedPrompt, prev_messages);
      
      // Add strategy context to the response
      const enhancedReasoning = this.createEnhancedReasoning(strategyDecision);
      aiResponse.curr_message.text_content = `STRATEGY RECOMMENDATION:\n${enhancedReasoning}\n\nAI FINAL DECISION:\n${aiResponse.curr_message.text_content}`;
      
      return aiResponse;
    } catch (error) {
      console.error("Strategy engine error:", error);
      return this.baseAIService.query(input, prev_messages);
    }
  }

  /**
   * Convert a StrategyDecision to a BotAction.
   * Prefers pot-fraction sizing if provided; converts to BBs using current pot and table rules.
   */
  private convertStrategyDecisionToBotAction(decision: StrategyDecision): BotAction {
    const action = normalizeAction(decision.action);

    if (action === "all-in") {
      // All-in action - bet size will be handled by the bot
      return { action_str: "all-in", bet_size_in_BBs: 0 };
    }

    if (action === "bet" || action === "raise") {
      // Prefer potFraction -> chips -> BB.
      let betBBs = 0;

      const state = safeGetState(this.strategyEngine);
      const bigBlind = this.game?.getBigBlind() ?? 1;

      if (decision.potFraction != null && decision.potFraction > 0 && state.pot > 0) {
        const rawChips = state.pot * decision.potFraction;
        const clampedChips = clampToLegal(rawChips, state.minBet, state.maxBet);
        betBBs = roundToBBs(clampedChips, bigBlind);
      } else if (decision.betSize && decision.betSize > 0) {
        // Backward compat: engine returned betSize in BBs
        betBBs = decision.betSize;
      } else {
        // Fallback default: half-pot
        const rawChips = state.pot * 0.5;
        const clampedChips = clampToLegal(rawChips, state.minBet, state.maxBet);
        betBBs = roundToBBs(clampedChips, bigBlind);
      }

      return { action_str: action, bet_size_in_BBs: Math.max(0, Math.round(betBBs)) };
    }

    // Non-betting actions
    return { action_str: action, bet_size_in_BBs: 0 };
  }

  /**
   * Rich, compact reasoning for the UI/logs.
   */
  private createEnhancedReasoning(d: StrategyDecision): string {
    const pct = (x?: number) => (typeof x === "number" ? `${(x * 100).toFixed(1)}%` : "—");
    const conf = typeof d.confidence === "number" ? Math.round(d.confidence * 100) : undefined;
    const sz = d.potFraction != null ? ` (${Math.round(d.potFraction * 100)}% pot)` : (d.betSize ? ` (${d.betSize} BB)` : "");
    const boardTags = Array.isArray(d.boardTags) && d.boardTags.length ? d.boardTags.join(", ") : "—";
    const blockers = Array.isArray(d.blockers) && d.blockers.length ? d.blockers.join(", ") : "—";
    const villain = d.villainArchetype ?? "unknown";
    const plan = d.plan ?? "Play standard on future streets; re-evaluate sizing by texture and villain response.";

    const lines = [
      `DECISION: ${String(d.action || "").toUpperCase()}${sz}`,
      `EV — bet: ${fmtNum(d.evBet)} | call: ${fmtNum(d.evCall)} | fold: 0.00`,
      `Equity vs ${villain}: ${pct(d.heroEquity)}`,
      `Board: ${boardTags} | Blockers: ${blockers}`,
      `Reason: ${d.reasoning || "Range advantage / pot-odds / blockers alignment"}`,
      ...(conf != null ? [`Confidence: ${conf}%`] : []),
      `Next plan: ${plan}`
    ];

    return lines.join("\n");
  }

  public setUseStrategyEngine(use: boolean): void {
    this.useStrategyEngine = use;
  }

  public getStrategyEngine(): StrategyEngine {
    return this.strategyEngine;
  }

  public getPlaystyle(): string {
    return "winning";
  }

  processMessages(messages: any[]): Array<{role: string, content: string}> {
    // Delegate to base service for message processing
    return this.baseAIService.processMessages(messages);
  }

  /**
   * Check if this is the first hand of the session
   */
  private isFirstHand(): boolean {
    // Check if we have any hand history or if this is the initial hand
    return !this.game.getHero() || this.game.getHero()!.getHand().length === 0;
  }

  /**
   * Apply special rules for the first hand - never fold unless bet is unusually high
   */
  private applyFirstHandRules(decision: StrategyDecision): StrategyDecision {
    if (decision.action === "fold") {
      // Check if the bet size is unusually high (more than 5 BB)
      const lastRaiseSize = this.getLastRaiseSize();
      const heroCards = this.game.getHero()?.getHand() || [];
      const handStrength = this.evaluateHandStrength(heroCards);
      
             // Only fold if bet is unusually high (>3 BB for 5/10, >2 BB for 10/20) AND we have very weak cards
       const bigBlind = this.game?.getBigBlind() ?? 10;
       const highBetThreshold = bigBlind === 10 ? 3 : 2; // 3BB for 5/10, 2BB for 10/20
       
       if (lastRaiseSize > highBetThreshold && handStrength < 2) {
         return decision; // Keep the fold
       } else {
        // Convert fold to call/check for first hand
        return {
          ...decision,
          action: lastRaiseSize > 0 ? "call" : "check",
          reasoning: `First hand rule: ${decision.reasoning} - but playing first hand to establish table presence`,
          confidence: Math.max(0.3, decision.confidence - 0.2)
        };
      }
    }
    return decision;
  }

  /**
   * Create enhanced prompt that includes strategy reasoning
   */
  private createEnhancedPrompt(originalInput: string, strategyDecision: StrategyDecision): string {
    const enhancedReasoning = this.createEnhancedReasoning(strategyDecision);
    
    return `${originalInput}

=== STRATEGY ENGINE RECOMMENDATION ===
${enhancedReasoning}

=== INSTRUCTIONS ===
The strategy engine above has analyzed the situation and provided a recommendation. 
Consider this recommendation carefully, but you may override it if you have additional insights.

Key considerations:
- If strategy recommends fold but you see exploitative opportunities, consider calling
- If strategy recommends call but you see strong value betting opportunities, consider raising
- Always consider position, stack sizes, and opponent tendencies
- The strategy engine uses proven poker principles, but you can adapt to specific situations

Make your final decision based on both the strategy recommendation and your poker knowledge.`;
  }

  /**
   * Get the last raise size from the table
   */
  private getLastRaiseSize(): number {
    try {
      const actions = this.game.getTable().getPlayerActions();
      for (let i = actions.length - 1; i >= 0; i--) {
        const action = actions[i];
        if (action.getAction() === 'raise' || action.getAction() === 'bet') {
          return action.getBetAmount() || 0;
        }
      }
    } catch (error) {
      console.error("Error getting last raise size:", error);
    }
    return 0;
  }

  /**
   * Evaluate hand strength for first hand rules
   */
  private evaluateHandStrength(cards: string[]): number {
    if (cards.length !== 2) return 1;
    
    const card1 = cards[0];
    const card2 = cards[1];
    
    const rank1 = card1.charAt(0);
    const rank2 = card2.charAt(0);
    const suit1 = card1.charAt(1);
    const suit2 = card2.charAt(1);
    
    // Simple hand strength evaluation
    const rankOrder = { 'A': 14, 'K': 13, 'Q': 12, 'J': 11, 'T': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2 };
    const rank1Value = rankOrder[rank1 as keyof typeof rankOrder] || parseInt(rank1);
    const rank2Value = rankOrder[rank2 as keyof typeof rankOrder] || parseInt(rank2);
    
    const isSuited = suit1 === suit2;
    const isPaired = rank1Value === rank2Value;
    const isBroadway = rank1Value >= 10 && rank2Value >= 10;
    
    if (isPaired) {
      if (rank1Value >= 10) return 8; // TT+
      if (rank1Value >= 7) return 6;  // 77-99
      return 4; // 22-66
    }
    
    if (isBroadway) {
      if (isSuited) return 7; // Broadway suited
      return 5; // Broadway offsuit
    }
    
    if (isSuited) return 3; // Suited connectors
    return 1; // Weak hand
  }
}

/* ------------------------------ helpers ------------------------------ */

function fmtNum(x?: number): string {
  return typeof x === "number" && isFinite(x) ? x.toFixed(2) : "—";
}

function normalizeAction(a?: string): "bet" | "raise" | "call" | "check" | "fold" | "all-in" {
  switch ((a || "").toLowerCase()) {
    case "bet": return "bet";
    case "raise": return "raise";
    case "call": return "call";
    case "check": return "check";
    case "fold": return "fold";
    case "all-in": return "all-in";
    default: return "check";
  }
}

function safeGetState(engine: StrategyEngine): { pot: number; minBet: number; maxBet: number } {
  try {
    const s = (engine as any).getState?.();
    const pot = Math.max(0, Number(s?.pot ?? 0));
    const minBet = Math.max(0, Number(s?.minBet ?? 0));
    const maxBet = Math.max(minBet, Number(s?.maxBet ?? Number.POSITIVE_INFINITY));
    return { pot, minBet, maxBet };
  } catch {
    // Sensible defaults if engine state isn’t exposed
    return { pot: 0, minBet: 0, maxBet: Number.POSITIVE_INFINITY };
  }
}

function clampToLegal(chips: number, minBet: number, maxBet: number): number {
  const x = Math.max(chips, minBet);
  return Math.min(x, maxBet);
}

function roundToBBs(chips: number, bigBlind: number): number {
  if (!bigBlind || bigBlind <= 0) return chips; // assume already BBs
  return chips / bigBlind;
}
