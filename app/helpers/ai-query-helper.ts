import { BotAction } from "../interfaces/ai-client-interfaces.ts";

export const playstyleToPrompt: Map<string, string> = new Map<string, string>([
    ["pro", "You are a professional poker player who plays strong ranges preflop and plays aggressively postflop. You understand position, pot odds, and implied odds. You make disciplined folds when you don't have the odds to continue."],
    ["aggressive", "You are an experienced poker player who plays aggressively like a maniac. You bet and raise frequently to put pressure on opponents. Be aware that this style can be expensive if not executed properly."],
    ["passive", "You are an experienced poker player who plays passively like a nit. You only play premium hands and fold most marginal situations. You avoid calling with weak hands and prefer to fold when uncertain."],
    ["neutral", "You are an experienced poker player who plays strong ranges preflop, has a balanced playstyle, and makes disciplined decisions. You fold when you don't have a strong hand or proper odds. You avoid calling with weak hands and prefer to fold rather than call with marginal holdings. You only bet or raise when you have a strong hand or good drawing odds. Remember: when in doubt, fold. It's better to fold a marginal hand than to lose money calling with weak holdings."],
    ["winning", "Hybrid poker for 5/10 & 10/20 (50–100BB): Follow strategy engine; when in doubt, FOLD. \
 Only open/3-bet from the listed ranges. Never raise with trash (e.g., 32o, 42o, 52o; low suited like 32s/42s). \
 First hand: no heroics—only play if in-range or clearly +EV to call. \
 Value bet strong; semi-bluff only with ≥8 clean outs or nut draws; don’t c-bet air multiway. \
 Respect position, pot odds, and opponent tendencies. Optimize for risk-adjusted EV, not hand count."]
]);

export function getPromptFromPlaystyle(playstyle: string) {
    const prompt = playstyleToPrompt.get(playstyle);
    if (prompt !== undefined) {
        return prompt;
    }
    throw new Error("Invalid playstyle, could not get playstyle prompt.");
}

export function parseResponse(msg: string): BotAction {
    msg = processOutput(msg);

    if (!msg) {
        return {
            action_str: "",
            bet_size_in_BBs: 0
        }
    }
    
    const action_matches = msg.match(/(bet|raise|call|check|fold|all.in)/);
    let action_str = "";
    if (action_matches) {
        action_str = action_matches[0];
        if (action_str.includes("in")) {
            action_str = "all-in";
        }
    }

    const bet_size_matches = msg.match(/[+]?([0-9]+(?:[\.][0-9]*)?|\.[0-9]+)/);
    let bet_size_in_BBs = 0;
    if (bet_size_matches) {
        bet_size_in_BBs = parseFloat(bet_size_matches[0]);
        // Safety check: limit bet sizes for 5/10 and 10/20 games (50-100BB stacks)
        if (bet_size_in_BBs > 25) {
            bet_size_in_BBs = 25; // Cap at 25 BB (25% of 100BB stack) to prevent huge bets
        }
    }
    return {
        action_str: action_str,
        bet_size_in_BBs: bet_size_in_BBs
    }
}

function processOutput(msg: string): string {
    msg = msg.toLowerCase();
    const start_index = msg.indexOf("{");
    const end_index = msg.indexOf("}");
    if (start_index != -1 && end_index != -1) {
        return msg.substring(start_index + 1, end_index);
    }
    return msg;
}