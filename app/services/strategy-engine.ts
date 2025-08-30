import { Game } from '../models/game.ts';
import { Table } from '../models/table.ts';
import { BotAction } from '../interfaces/ai-client-interfaces.ts';

export interface HandStrength {
  type: string;
  description: string;
  strength: number;
  outs?: number;
  odds?: number; // pot-odds ratio threshold ~ (1/equity - 1)
}

export interface StrategyDecision {
  action: "bet" | "raise" | "call" | "check" | "fold" | "all-in" | "wait";
  betSize?: number;       // in BBs
  potFraction?: number;   // optional
  reasoning: string;
  confidence: number;
  evBet?: number;
  evCall?: number;
  heroEquity?: number;
  boardTags?: string[];
  blockers?: string[];
  villainArchetype?: string;
  plan?: string;
}

export class StrategyEngine {
  private game: Game;
  private table: Table;

  // trash hands that should NEVER raise/iso; overfold vs opens if needed
  private static HARD_BLOCKLIST_NO_RAISE = new Set([
    // offsuit 2x (already great)
    "32o","42o","52o","62o","72o","82o","92o","T2o","J2o","Q2o","K2o",
    // suited 2x — finish the sweep
    "32s","42s","52s","62s","72s","82s","92s","T2s","J2s","Q2s","K2s"
  ]);
  
  constructor(game: Game) {
    this.game = game;
    this.table = game.getTable();
  }

  public getDecision(): StrategyDecision {
    const street = this.table.getStreet?.();
    const hero = this.game.getHero?.();

    // 🔒 GLOBAL GUARD: don't act until the hand is live & we have 2 cards
    if (!hero) return this.waitDecision("No hero/seat yet");
    const heroCards = hero.getHand?.() ?? [];
    if (!street || heroCards.length < 2) return this.waitDecision("Hand not dealt / not actionable");

    // Optional: if it's not our turn, just wait (if your Table has such a method)
    try {
      const isOurTurn = (this.table as any).isHerosTurn?.(hero.getPlayerId());
      if (isOurTurn === false) return this.waitDecision("Not our turn");
    } catch {}

    if (street === 'preflop') {
      return this.getPreflopDecision();
    }
    return this.getPostflopDecision();
  }

  private waitDecision(reason = "Wait"): StrategyDecision {
    return { action: "wait", reasoning: reason, confidence: 0.5 };
  }

  /**
   * Validate and normalize action to ensure it's a valid poker action
   */
  private validateAction(action: string): "bet" | "raise" | "call" | "check" | "fold" | "all-in" | "wait" {
    const validActions = ["bet", "raise", "call", "check", "fold", "all-in", "wait"];
    const normalizedAction = action.toLowerCase();
    
    if (validActions.includes(normalizedAction)) {
      return normalizedAction as "bet" | "raise" | "call" | "check" | "fold" | "all-in" | "wait";
    }
    
    // Default fallback based on context
    console.warn(`Invalid action "${action}" detected, defaulting to "check"`);
    return "check";
  }

  /**
   * Check if an action is valid for the current game state
   */
  private isActionValidForState(action: string, hasRaises: boolean): boolean {
    const normalizedAction = action.toLowerCase();
    
    // Check if action makes sense for current state
    if (normalizedAction === "check" && hasRaises) {
      console.warn("Cannot check when there are raises - action invalid");
      return false;
    }
    
    if ((normalizedAction === "bet" || normalizedAction === "raise") && !hasRaises) {
      // Bet/raise is valid when no raises
      return true;
    }
    
    if (normalizedAction === "call" && hasRaises) {
      // Call is valid when there are raises
      return true;
    }
    
    if (normalizedAction === "fold") {
      // Fold is always valid
      return true;
    }
    
    if (normalizedAction === "all-in") {
      // All-in is always valid
      return true;
    }
    
    return true; // Default to valid
  }

  /**
   * Create a strategy decision with proper validation
   */
  private createDecision(
    action: string, 
    reasoning: string, 
    confidence: number, 
    betSize?: number,
    potFraction?: number,
    hasRaises?: boolean
  ): StrategyDecision {
    // Validate action for current game state
    const hasRaisesInState = hasRaises ?? this.table.getPlayerActions().some(a => a.getAction() === 'raise' || a.getAction() === 'bet');
    
    if (!this.isActionValidForState(action, hasRaisesInState)) {
      console.warn(`Action "${action}" invalid for current state, converting to check`);
      action = "check";
    }

    // Validate and clamp bet size to reasonable limits
    let validatedBetSize = betSize;
    if (betSize && betSize > 0) {
      const heroStack = this.game.getHero()?.getStackSize() ?? 100;
      const maxBetSize = Math.min(25, heroStack * 0.25); // Max 25BB or 25% of stack
      validatedBetSize = Math.min(betSize, maxBetSize);
      
      if (validatedBetSize !== betSize) {
        console.log(`Bet size clamped from ${betSize}BB to ${validatedBetSize}BB for safety`);
      }
    }

    return {
      action: this.validateAction(action),
      reasoning,
      confidence: Math.max(0, Math.min(1, confidence)), // Clamp confidence to 0-1
      betSize: validatedBetSize,
      potFraction: potFraction && potFraction > 0 ? Math.min(potFraction, 1.0) : undefined // Clamp pot fraction to 0-1
    };
  }

// --- ADD: compact helpers ---
  private vpipCap = (pos:string)=>{ const p=pos.toLowerCase();
    return (p.startsWith('utg')||p==='ep'||p==='lojack')?0.15:(p==='hijack'||p==='mp')?0.20:(p==='cutoff')?0.28:(p==='button')?0.40:(p==='sb')?0.18:0.22; };
  private overCap = (pos:string)=>{ try{ const n=this.table.getNameFromId(this.game.getHero()!.getPlayerId());
    const s=this.table.getPlayerStatsFromName(n); return s.computeVPIPStat()>this.vpipCap(pos)+0.05; }catch{ return false; } };
  private coldCallOK = (pos: string, str: number, price: number) => {
    if (!this.isLatePosition(pos)) return false;
    const hand = this.getHandNotation(this.game.getHero()!.getHand());
    const isPocketPair = /^([2-9TJQKA])\1[so]$/.test(hand);
    const need = isPocketPair ? 5.5 : 3.5;
    return str >= 5 && price >= need;
  };
  private bbDefendOK = (sizeBB:number,hand:string)=> {
    if (sizeBB <= 2.1) return true;
    if (sizeBB <= 2.6) return !/(K9o|Q9o|J9o|T9o)/.test(hand);
    return /s$/.test(hand) || /(AJo|KQo|KJo|QJo|TT|JJ|QQ|KK|AA)/.test(hand);
  };
  private spr = ()=>{ const h=this.game.getHero()!.getStackSize(); const p=Math.max(1,this.table.getPot()); return h/p; };
  
// --- OPTIONAL EXPLOITS HELPERS ---

  // Detect open + >=1 caller before hero acts (simple squeeze spot detector)
  private isSqueezeSpot(): boolean {
    try {
      const acts = this.table.getPlayerActions();
      let sawOpen = false, callers = 0;
      for (const a of acts) {
        const act = a.getAction();
        if (act === 'raise') { sawOpen = true; }
        else if (sawOpen && act === 'call') { callers++; }
      }
      return sawOpen && callers >= 1;
    } catch { return false; }
  }
  
  // Very small blocker check for squeeze bluffs
  private hasSqueezeBlocker(handNotation: string): boolean {
    return /(A[2-5]s|KTs|KQs|QTs|QJs|JTs|KQo)/.test(handNotation);
  }
  
  // Pull the likely villain (last aggressor) and tag them by stat buckets
  private getPrimaryVillainTag(): 'station'|'nit'|'aggro'|'unknown' {
    try {
      const acts = this.table.getPlayerActions();
      let name: string | undefined;
      for (let i = acts.length - 1; i >= 0; i--) {
        const a = acts[i];
        if (a.getAction() === 'raise' || a.getAction() === 'bet') {
          name = this.table.getNameFromId(a.getPlayerId());
          break;
        }
      }
      if (!name) return 'unknown';
      const st = this.table.getPlayerStatsFromName(name);
      const vpip = st.computeVPIPStat();   // 0..1
      const pfr  = st.computePFRStat();    // 0..1
      const t3b  = typeof (st as any).computeThreeBetStat === 'function'
        ? (st as any).computeThreeBetStat()
        : (pfr >= 0.20 ? 0.10 : 0.03);
      if (vpip >= 0.40 && pfr <= 0.12) return 'station';
      if (vpip <= 0.18 && pfr <= 0.12) return 'nit';
      if (t3b >= 0.09 || pfr >= 0.22)  return 'aggro';
      return 'unknown';
    } catch { return 'unknown'; }
  }
  
  // richer texture flags
  private boardTextureFlags(): { 
    paired: boolean; 
    fourFlush: boolean; 
    monoFlush: boolean;
    fourStraight: boolean;
    straightOnBoard: boolean;
    flushOnBoard: boolean;
  } {
    const board = this.parseCommunityCards(this.table.getRunout());
    if (!board.length) return { paired:false, fourFlush:false, monoFlush:false, fourStraight:false, straightOnBoard:false, flushOnBoard:false };
    const rankCounts: Record<string, number> = {};
    for (const c of board) { const r = c[0]; rankCounts[r] = (rankCounts[r]||0)+1; }
    const paired = Object.values(rankCounts).some(v => v >= 2);
    const suitCounts: Record<string, number> = {};
    for (const c of board) { const s = c[c.length-1]; suitCounts[s] = (suitCounts[s]||0)+1; }
    const maxSuit = Math.max(...Object.values(suitCounts));
    const monoFlush = maxSuit >= 3;
    const fourFlush = maxSuit >= 4;
    const flushOnBoard = maxSuit >= 5;
    const vals = this.cardsToRankVals(board, true);
    const longest = this.maxConsecutive(vals, true);
    const fourStraight = longest >= 4;
    const straightOnBoard = longest >= 5;
    return { paired, fourFlush, monoFlush, fourStraight, straightOnBoard, flushOnBoard };
  }
  
  private boardThreatScore(): number {
    const pip = this.table.getPlayersInPot?.() ?? 2;
    const tag = this.getPrimaryVillainTag();
    const tex = this.boardTextureFlags();
    let s = 0;
    if (pip >= 3) s += 1;
    if (tex.paired) s += 0.5;
    if (tex.monoFlush) s += 1;
    if (tex.fourFlush) s += 1.5;
    if (tex.fourStraight) s += 1;
    if (tex.straightOnBoard) s += 1.5;
    if (tex.flushOnBoard) s += 1.5;
    if (tag === 'station') s += 0.3;
    if (tag === 'aggro')   s -= 0.2;
    return s; // ~0..6
  }
  
  private isNutFlush(hero: string[], board: string[]): boolean {
    const suits = [...board, ...hero].map(c => c[c.length-1]);
    const suitCounts: Record<string, number> = {};
    for (const s of suits) suitCounts[s] = (suitCounts[s]||0)+1;
    const dom = Object.entries(suitCounts).sort((a,b)=>b[1]-a[1])[0]?.[0];
    if (!dom) return false;
    const boardSuitCount = board.filter(c => c[c.length-1]===dom).length;
    const heroHasAce = hero.some(c => c[0]==='A' && c[c.length-1]===dom);
    return boardSuitCount + hero.filter(c => c[c.length-1]===dom).length >= 5 && heroHasAce;
  }
  
  private isNutStraight(hero: string[], board: string[]): boolean {
    const vals = this.cardsToRankVals([...board, ...hero], true);
    const longest = this.maxConsecutive(vals, true) >= 5;
    if (!longest) return false;
    const set = new Set(vals);
    const hasBroadway = [10,11,12,13,14].every(v => set.has(v));
    const heroVals = new Set(this.cardsToRankVals(hero, true));
    return hasBroadway && (heroVals.has(14) || heroVals.has(13));
  }
  
  private hasNutBlockerForFlushDraw(hero: string[]): boolean {
    const board = this.parseCommunityCards(this.table.getRunout());
    const suitCounts: Record<string, number> = {};
    for (const c of board) { const s = c[c.length-1]; suitCounts[s] = (suitCounts[s]||0)+1; }
    const domSuit = Object.entries(suitCounts).sort((a,b)=>b[1]-a[1])[0]?.[0];
    return !!domSuit && hero.some(c => c[0]==='A' && c[c.length-1]===domSuit);
  }

// --- helpers (near other helpers) ---
  private hasLimpersBeforeHero(): boolean {
    try {
      const acts = this.table.getPlayerActions();
      let sawLimp = false, sawRaise = false;
      for (const a of acts) {
        if (a.getAction() === 'raise' || a.getAction() === 'bet') { sawRaise = true; break; }
        if (a.getAction() === 'call') sawLimp = true;
      }
      return sawLimp && !sawRaise;
    } catch { return false; }
  }
  
  private getIsoSizeBB(position: string, limpers: number): number {
    const ip = this.isLatePosition(position);
    return (ip ? 4.0 : 5.0) + limpers * 1.0;
  }
  
  private hasLightEquity(hero: string[], board: string[]): boolean {
    const heroVals = this.cardsToRankVals(hero, true);
    const maxBoard = Math.max(...this.cardsToRankVals(board, true), 0);
    const overs = heroVals.filter(v => v > maxBoard).length;
    return overs >= 1; // liberal for HU stab
  }
  private shouldJamLowSPR(h: HandStrength): boolean {
    if (this.spr() > 1.2) return false;
    if (h.strength >= 6) return true; // trips+ (per your scale)
    if (h.type.includes('draw') && (h.outs ?? 0) >= 12) return true;
    return false;
  }
  

  /* -------------------- Preflop -------------------- */

  private getPreflopDecision(): StrategyDecision {
    const hero = this.game.getHero()!;
    const heroCards = hero.getHand();
    const position = this.table.getPlayerPositionFromId(hero.getPlayerId());
    const playerActions = this.table.getPlayerActions();

    const handNotation = this.getHandNotation(heroCards);
    const handStrength = this.evaluatePreflopHand(handNotation, position);

    if (StrategyEngine.HARD_BLOCKLIST_NO_RAISE.has(handNotation)) {
      const hasRaises = playerActions.some(a => a.getAction() === 'raise' || a.getAction() === 'bet');
      if (hasRaises) {
        return this.createDecision("fold", `Trash hand (${handNotation}) in blocklist`, 0.95, undefined, undefined, hasRaises);
      }
      return this.createDecision("fold", `Trash hand (${handNotation}) in blocklist`, 0.95, undefined, undefined, hasRaises);
    }

    const hasRaises = playerActions.some(a => a.getAction() === 'raise' || a.getAction() === 'bet');
    const lastRaiseSize = this.getLastRaiseSize();

    if (hasRaises && /bb/i.test(position)) {
      if (!this.bbDefendOK(lastRaiseSize, handNotation) && handStrength.strength < 7) {
        return this.createDecision("fold", "BB vs large/open size — fold marginal/offsuit", 0.85);
      }
    }
  
    return hasRaises
      ? this.handlePreflopRaise(handStrength, lastRaiseSize, position)
      : this.handlePreflopNoRaise(handStrength, position);
  }

  private evaluatePreflopHand(handNotation: string, position: string): HandStrength {
    const premiumHands = ["AA","KK","QQ","JJ","AKs","AKo","AQs","AQo"];
    const strongHands  = ["TT","99","88","AJs","ATs","KQs","KQo","KJs"];
    const playableHands = ["77","66","55","A9s","A8s","A7s","KTs","QJs","QTs","JTs"];
    const positionHands = ["44","33","22","A6s","A5s","A4s","A3s","A2s","K9s","Q9s","J9s","T9s","98s","87s","76s","65s"];
    const suitedConnectors = ["T9s","98s","87s","76s","65s"];
    const broadwayOffsuit = ["AJo","ATo","KJo","KTo","QJo","QTo","JTo"];

    if (premiumHands.includes(handNotation)) {
      return { type: "premium", description: "Premium hand", strength: 9 };
    } else if (strongHands.includes(handNotation)) {
      return { type: "strong", description: "Strong hand", strength: 7 };
    } else if (playableHands.includes(handNotation)) {
      return { type: "playable", description: "Playable hand", strength: 5 };
    } else if ((positionHands.includes(handNotation) || suitedConnectors.includes(handNotation)) && this.isLatePosition(position)) {
      return { type: "position", description: "Playable in position", strength: 4 };
    } else if (broadwayOffsuit.includes(handNotation) && this.isLatePosition(position)) {
      return { type: "broadway_offsuit", description: "Broadway offsuit (IP mix)", strength: 3 };
    }
    return { type: "weak", description: "Weak hand", strength: 1 };
  }

  private handlePreflopRaise(handStrength: HandStrength, raiseSize: number, position: string): StrategyDecision {
    const potOdds = this.calculatePotOdds(raiseSize);
    if (raiseSize <= 0) {
      return this.waitDecision("Invalid raise size detected");
    }
    if (/bb/i.test(position)) {
      if (raiseSize >= 3.0 && handStrength.strength < 6) {
        return this.createDecision("fold", "BB vs 3x+ open — fold marginals", 0.88);
      }
      if (raiseSize >= 2.6 && handStrength.strength < 5) {
        return this.createDecision("fold", "BB vs larger open — tighten defend", 0.86);
      }
    }
    if (this.isSqueezeSpot()) {
      if (handStrength.strength >= 6) {
        const ip = this.isLatePosition(position);
        const size = Math.min((ip ? 4.0 : 5.0) * raiseSize, 12);
        return this.createDecision("raise", "Squeeze spot — linear value 3-bet", 0.88, size);
      }
      if (this.isLatePosition(position) && handStrength.strength >= 4 && this.hasSqueezeBlocker(this.getHandNotation(this.game.getHero()!.getHand()))) {
        const size = Math.min(4.0 * raiseSize, 10);
        return this.createDecision("raise", "Squeeze spot (IP) — blocker 3-bet bluff", 0.72, size);
      }
    }
    if (handStrength.strength >= 8) {
      return this.createDecision("raise", `Premium (${handStrength.description}) — 3-betting for value`, 0.95, Math.min(raiseSize * 2.5, 10));
    } else if (handStrength.strength >= 6) {
      if (this.isLatePosition(position)) {
        return this.createDecision("raise", `Strong (${handStrength.description}) IP — 3-bet`, 0.85, Math.min(raiseSize * 2, 8));
      }
      if (!this.coldCallOK(position, handStrength.strength, potOdds)) {
        return this.createDecision("raise", `Strong OOP — avoid cold-call; 3-bet or fold policy`, 0.8, Math.min(raiseSize * 2, 8));
      }
      return this.createDecision("call", `Strong (${handStrength.description}) — calling with acceptable price`, 0.75, raiseSize);
    } else if (handStrength.strength >= 4 && potOdds > 3) {
      if (!this.coldCallOK(position, handStrength.strength, potOdds)) {
        return this.createDecision("fold", "No cold call OOP / poor price — fold", 0.85);
      }
      return this.createDecision("call", `Playable (${handStrength.description}) with good price (pot odds ${potOdds.toFixed(2)}:1)`, 0.65, raiseSize);
    }
    return this.createDecision("fold", `Weak — fold vs raise`, 0.9);
  }
  
  private handlePreflopNoRaise(handStrength: HandStrength, position: string): StrategyDecision {
    // ISO over limpers
    if (this.hasLimpersBeforeHero()) {
      const acts = this.table.getPlayerActions();
      const limpers = acts.filter(a => a.getAction()==='call').length;
      if (handStrength.strength >= 5 || (this.isLatePosition(position) && handStrength.strength >= 4)) {
        return this.createDecision("raise", `Isolate ${limpers} limper(s) — attack dead money`, 0.85, this.getIsoSizeBB(position, limpers));
      }
      return this.createDecision("check", "Limp pot — skip marginal ISO", 0.75);
    }
    if (handStrength.strength >= 7) {
      return this.createDecision("raise", `Strong (${handStrength.description}) — open for value`, 0.9, this.getPositionRaiseSize(position));
    } else if (handStrength.strength >= 5) {
      if (this.isLatePosition(position)) {
        if (this.overCap(position)) {
          return this.createDecision("fold", "Above VPIP cap for seat — tighten marginal opens", 0.85);
        }
        return this.createDecision("raise", `Playable (${handStrength.description}) IP — open to steal`, 0.75, this.getPositionRaiseSize(position));
      }
      // OOP: still raise with playable hands, just be more selective
      if (handStrength.strength >= 6) {
        return this.createDecision("raise", `Strong playable (${handStrength.description}) — open for value`, 0.7, this.getPositionRaiseSize(position));
      }
      return this.createDecision("fold", `Playable but OOP/early — avoid marginal opens`, 0.7);
    } else if (handStrength.strength >= 3 && this.isLatePosition(position)) {
      if (this.overCap(position)) {
        return this.createDecision("fold", "Above VPIP cap for seat — skip light opens", 0.85);
      }
      return this.createDecision("raise", `IP mix open — but fold to aggression if dominated`, 0.6, this.getPositionRaiseSize(position));
    }
    return this.createDecision("fold", `Weak — fold`, 0.85);
  }
  

  /* -------------------- Postflop -------------------- */

  private getPostflopDecision(): StrategyDecision {
    const hero = this.game.getHero()!;
    const heroCards = hero.getHand();
    const communityCards = this.table.getRunout();
    const position = this.table.getPlayerPositionFromId(hero.getPlayerId());
    const potSize = this.table.getPot();
    const playerActions = this.table.getPlayerActions();

    const handStrength = this.evaluatePostflopHand(heroCards, communityCards);
    const hasRaises = playerActions.some(a => a.getAction() === 'raise' || a.getAction() === 'bet');

    return hasRaises
      ? this.handlePostflopRaise(handStrength, position, potSize)
      : this.handlePostflopNoRaise(handStrength, position, potSize);
  }

  private evaluatePostflopHand(heroCards: string[], communityCards: string): HandStrength {
    const board = this.parseCommunityCards(communityCards);
    const allCards = [...heroCards, ...board];

    const flushCountMap = this.countSuits(allCards);
    const maxSuitCount = Math.max(...Object.values(flushCountMap));
    const madeFlush = maxSuitCount >= 5;
    const flushDraw = maxSuitCount === 4;

    const ranks = this.cardsToRankVals(allCards);
    const hasStraight = this.hasStraight(ranks);
    const { hasOESD, hasGutshot } = this.hasStraightDraws(this.cardsToRankVals([...heroCards, ...board], true));

    if (this.hasStraightFlush(allCards)) return { type: "straight_flush", description: "Straight flush", strength: 10 };
    if (this.hasNKind(allCards, 4)) return { type: "four_of_a_kind", description: "Four of a kind", strength: 10 };
    if (this.hasFullHouse(allCards)) return { type: "full_house", description: "Full house", strength: 9 };
    if (madeFlush) return { type: "flush", description: "Flush", strength: 8 };
    if (hasStraight) return { type: "straight", description: "Straight", strength: 7 };
    if (this.hasNKind(allCards, 3)) return { type: "three_of_a_kind", description: "Trips", strength: 6 };
    if (this.hasTwoPair(allCards)) return { type: "two_pair", description: "Two pair", strength: 5 };
    if (this.hasPair(allCards)) return { type: "one_pair", description: "One pair", strength: 3 };

    if (flushDraw) return { type: "flush_draw", description: "Flush draw", strength: 6, outs: 9, odds: 4.3 };
    if (hasOESD)    return { type: "straight_draw", description: "Open-ended straight draw", strength: 5, outs: 8, odds: 4.9 };
    if (hasGutshot) return { type: "gutshot_draw", description: "Gutshot straight draw", strength: 4, outs: 4, odds: 10.5 };
    return { type: "high_card", description: "High card / no draw", strength: 1 };
  }

  private handlePostflopRaise(handStrength: HandStrength, position: string, potSize: number): StrategyDecision {
    const lastRaise = this.getLastRaiseSize();
    const potOdds = this.calculatePotOdds(lastRaise);

    // 🚀 Low-SPR jam first
    if (this.shouldJamLowSPR(handStrength)) {
        const jamSize = this.game.getHero()!.getStackSize();
        return {
            action: "bet",
            betSize: jamSize,
            reasoning: "Low SPR — jam with value/robust draws to maximize realization",
            confidence: 0.82
        };
    //   return this.createDecision("all-in", "Low SPR — maximize fold equity / value via jam", 0.82);
    }

    if (lastRaise <= 0) {
      if (handStrength.strength >= 7) {
        return this.createDecision("raise", "Data guard: value line", 0.8, Math.min(potSize * 0.75, 10));
      }
      return this.createDecision("call", "Data guard: treat as small probe; keep pot controlled", 0.7);
    }
  
    if (handStrength.type.includes('draw') && handStrength.odds && potOdds >= handStrength.odds) {
      return this.createDecision("call", `Draw (${handStrength.description}) — pot odds ${potOdds.toFixed(2)}:1 ≥ ${handStrength.odds}:1`, 0.8, lastRaise);
    }
  
    if (handStrength.type === "one_pair" && this.spr() > 4) {
      return this.createDecision("call", "TPTK/overpair at high SPR — pot control over raise", 0.75, lastRaise);
    }

    const tag = this.getPrimaryVillainTag();
    const threat = this.boardThreatScore();
    const board = this.parseCommunityCards(this.table.getRunout());
    const heroCards = this.game.getHero()!.getHand();
    const haveNut = this.isNutFlush(heroCards, board) || this.isNutStraight(heroCards, board);
    
    if (threat >= 2.5 && !haveNut) {
      if (handStrength.type === "one_pair") {
        if (this.isLatePosition(position)) {
          return this.createDecision("call", "High-threat board — keep one pair to call IP, avoid raises", 0.7, lastRaise);
        }
        return this.createDecision("fold", "High-threat board OOP — overfold one-pair to aggression", 0.8);
      }
      if (handStrength.strength >= 7) {
        return this.createDecision("call", "High-threat board — control with non-nut strong hand", 0.72, lastRaise);
      }
    }
  
    if (handStrength.strength >= 7) {
      const base = (tag === 'station') ? 1.0 : 0.75;
      return this.createDecision("raise", `Strong (${handStrength.description}) — raise for value${tag==='station'?' vs station (bigger)': ''}`, 0.9, Math.min(potSize * base, 12));
    }
  
    if (handStrength.strength >= 5) {
      if (this.isLatePosition(position)) {
        return this.createDecision("call", `Medium (${handStrength.description}) IP — call vs aggression`, 0.7, lastRaise);
      }
      if (tag === 'aggro') {
        return this.createDecision("call", "Vs aggro: widen bluff-catch instead of folding medium strength OOP", 0.68, lastRaise);
      }
      return this.createDecision("fold", `Medium (${handStrength.description}) OOP — fold to raise`, 0.8);
    }
  
    return this.createDecision("fold", `Weak — fold to aggression`, 0.9);
  }
  

  private handlePostflopNoRaise(handStrength: HandStrength, position: string, potSize: number): StrategyDecision {
    const pip = this.table.getPlayersInPot?.() ?? 2;
    const tag = this.getPrimaryVillainTag();
    const threat = this.boardThreatScore();

    // HU cheap stab on low-threat boards with light equity
    if ((this.table.getPlayersInPot?.() ?? 2) === 2 && threat < 2.0) {
      const heroCards = this.game.getHero()!.getHand();
      const board = this.parseCommunityCards(this.table.getRunout());
      if (this.hasLightEquity(heroCards, board) && handStrength.strength <= 3 && !handStrength.type.includes('draw')) {
        if (this.isLatePosition(position)) {
          return this.createDecision("bet", "HU missed c-bet: auto-stab low threat", 0.66, potSize * 0.33);
        }
      }
    }
  
    // Allow betting with medium strength hands even on high-threat boards
    if (handStrength.strength >= 4 && handStrength.strength < 7 && threat >= 2.5) {
      if (this.isLatePosition(position)) {
        return this.createDecision("bet", "High-threat board IP — value bet with medium strength", 0.7, potSize * 0.5);
      }
      // OOP: still bet with decent hands, just smaller size
      return this.createDecision("bet", "High-threat board OOP — smaller value bet with medium strength", 0.65, potSize * 0.33);
    }
    
    if (handStrength.strength >= 7 && threat >= 3.5) {
      return this.createDecision("bet", "Value, but cap size on scary texture", 0.7, potSize * 0.5);
    }
  
    // Only skip air c-bets multiway, but allow value bets with decent hands
    if (pip >= 3 && handStrength.strength < 3 && !handStrength.type.includes("draw")) {
      return this.createDecision("check", "Multiway: skip air c-bet", 0.8);
    }
  
    // 🚀 Low-SPR jam takes priority over default value bet
    if (this.shouldJamLowSPR(handStrength)) {
    //   return this.createDecision("all-in", "Low SPR — jam with value/robust draws to maximize realization", 0.82);
        const jamSize = this.game.getHero()!.getStackSize();
        return {
            action: "bet",
            betSize: jamSize,
            reasoning: "Low SPR — jam with value/robust draws to maximize realization",
            confidence: 0.82
        };
    }
  
    if (handStrength.strength >= 7) {
      return this.createDecision("bet", `Strong — value bet`, 0.9, potSize * 0.75);
    }
  
    const tex = this.boardTextureFlags();
  
    if (handStrength.type.includes('draw') && (handStrength.outs ?? 0) >= 8) {
      if (tag === 'station' && (handStrength.outs ?? 0) < 12) {
        return this.createDecision("check", "Station: realize equity with weaker draws; bet stronger combos only", 0.76);
      }
      const heroCards = this.game.getHero()!.getHand();
      const okToBlast =
        (!tex.paired && !tex.fourFlush) ||
        this.hasNutBlockerForFlushDraw(heroCards) ||
        (handStrength.outs ?? 0) >= 12;
      if (!okToBlast) {
        return this.createDecision("check", "Paired/4-flush board — avoid semibluffing non-nut draws", 0.78);
      }
      return this.createDecision("bet", `Strong draw — semi-bluff`, 0.75, potSize * 0.5);
    }
      
    if (handStrength.strength >= 4) {
      if (this.isLatePosition(position)) {
        const size = (tag === 'nit') ? (potSize * 0.55) : (potSize * 0.5);
        return this.createDecision("bet", `Medium IP — thin value/deny${tag==='nit'?' vs nit':''}`, 0.7, size);
      }
      // OOP: still bet with medium hands, just smaller size
      return this.createDecision("bet", `Medium OOP — smaller value bet`, 0.65, potSize * 0.33);
    }
      
    return this.createDecision("check", `Weak — check/fold`, 0.8);
  }
  
  
  /* -------------------- Helpers -------------------- */

  private getHandNotation(cards: string[]): string {
    if (cards.length !== 2) return "XX";
    const [r1, s1] = this.normalizeCard(cards[0]);
    const [r2, s2] = this.normalizeCard(cards[1]);
    const isSuited = s1 === s2;
    const [hi, lo] = this.rankVal(r1) >= this.rankVal(r2) ? [r1, r2] : [r2, r1];
    return `${hi}${lo}${isSuited ? "s" : "o"}`;
  }

  private parseCommunityCards(cc: string): string[] {
    if (!cc) return [];
    const re = /(?:10|T|[2-9]|[JQKA])[shdc]/g;
    const matches = cc.match(re);
    return matches ? matches.map(c => this.toTwoChar(c)) : [];
  }

  private toTwoChar(card: string): string {
    const rank = card.startsWith('10') ? 'T' : card[0];
    const suit = card[card.length - 1];
    return `${rank}${suit}`;
  }

  private normalizeCard(card: string): [string, string] {
    const r = card[0] === '1' ? 'T' : card[0];
    return [r, card[card.length - 1]];
  }

  private rankVal(r: string): number {
    switch (r) {
      case 'A': return 14;
      case 'K': return 13;
      case 'Q': return 12;
      case 'J': return 11;
      case 'T': return 10;
      default: return parseInt(r, 10);
    }
  }

  private countSuits(cards: string[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const c of cards) {
      const suit = c[c.length - 1];
      counts[suit] = (counts[suit] || 0) + 1;
    }
    return counts;
  }

  private cardsToRankVals(cards: string[], addAceLow = false): number[] {
    const vals = Array.from(new Set(cards.map(c => this.rankVal(c[0] === '1' ? 'T' : c[0])))).sort((a,b)=>a-b);
    if (addAceLow && vals.includes(14) && !vals.includes(1)) vals.unshift(1);
    return vals;
  }

  private hasStraight(vals: number[]): boolean {
    return this.maxConsecutive(vals, true) >= 5;
  }

  private hasStraightFlush(cards: string[]): boolean {
    const bySuit: Record<string, string[]> = {};
    for (const c of cards) {
      const s = c[c.length - 1];
      (bySuit[s] ||= []).push(c);
    }
    for (const suit of Object.keys(bySuit)) {
      if (bySuit[suit].length >= 5) {
        const ranks = this.cardsToRankVals(bySuit[suit], true);
        if (this.maxConsecutive(ranks, true) >= 5) return true;
      }
    }
    return false;
  }
  
  private hasStraightDraws(vals: number[]): { hasOESD: boolean; hasGutshot: boolean } {
    const longest = this.maxConsecutive(vals, true);
    const hasOESD = longest === 4;
    let hasGutshot = false;
    const set = new Set(vals);
    for (let s = 1; s <= 10; s++) {
      const window = [s, s+1, s+2, s+3, s+4];
      const cnt = window.reduce((acc,v)=>acc + (set.has(v) ? 1 : 0), 0);
      if (cnt === 4) { hasGutshot = true; break; }
    }
    return { hasOESD, hasGutshot: hasGutshot && !hasOESD };
  }

  private maxConsecutive(vals: number[], aceLow: boolean): number {
    const set = new Set(vals);
    if (aceLow && set.has(14)) set.add(1);
    const sorted = Array.from(set).sort((a,b)=>a-b);
    let best = 1, cur = 1;
    for (let i=1; i<sorted.length; i++) {
      if (sorted[i] === sorted[i-1] + 1) { cur++; best = Math.max(best, cur); }
      else { cur = 1; }
    }
    return best;
  }

  private hasNKind(cards: string[], n: number): boolean {
    const counts: Record<string, number> = {};
    for (const c of cards) {
      const r = c[0] === '1' ? 'T' : c[0];
      counts[r] = (counts[r] || 0) + 1;
    }
    return Object.values(counts).some(c => c >= n);
  }

  private hasFullHouse(cards: string[]): boolean {
    const counts: Record<string, number> = {};
    for (const c of cards) {
      const r = c[0] === '1' ? 'T' : c[0];
      counts[r] = (counts[r] || 0) + 1;
    }
    const vals = Object.values(counts);
    return vals.includes(3) && vals.filter(v => v >= 2).length >= 2;
  }

  private hasTwoPair(cards: string[]): boolean {
    const counts: Record<string, number> = {};
    for (const c of cards) {
      const r = c[0] === '1' ? 'T' : c[0];
      counts[r] = (counts[r] || 0) + 1;
    }
    return Object.values(counts).filter(v => v >= 2).length >= 2;
  }

  private hasPair(cards: string[]): boolean {
    const counts: Record<string, number> = {};
    for (const c of cards) {
      const r = c[0] === '1' ? 'T' : c[0];
      counts[r] = (counts[r] || 0) + 1;
    }
    return Object.values(counts).some(v => v >= 2);
  }

  private calculateOuts(heroCards: string[], communityCards: string): { flushOuts: number, straightOuts: number, gutshotOuts: number } {
    const board = this.parseCommunityCards(communityCards);
    const allCards = [...heroCards, ...board];
    const flushCountMap = this.countSuits(allCards);
    const maxSuit = Math.max(...Object.values(flushCountMap));
    const flushOuts = maxSuit === 4 ? 9 : 0;
    const vals = this.cardsToRankVals(allCards, true);
    const { hasOESD, hasGutshot } = this.hasStraightDraws(vals);
    const straightOuts = hasOESD ? 8 : 0;
    const gutshotOuts = hasGutshot ? 4 : 0;
    return { flushOuts, straightOuts, gutshotOuts };
  }

  private hasFlushDraw(heroCards: string[], communityCards: string): boolean {
    const board = this.parseCommunityCards(communityCards);
    const allCards = [...heroCards, ...board];
    const flushCountMap = this.countSuits(allCards);
    return Math.max(...Object.values(flushCountMap)) === 4;
  }

  private hasStraightDraw(heroCards: string[], communityCards: string): boolean {
    const board = this.parseCommunityCards(communityCards);
    const vals = this.cardsToRankVals([...heroCards, ...board], true);
    return this.hasStraightDraws(vals).hasOESD;
  }

  private hasGutshotDraw(heroCards: string[], communityCards: string): boolean {
    const board = this.parseCommunityCards(communityCards);
    const vals = this.cardsToRankVals([...heroCards, ...board], true);
    const d = this.hasStraightDraws(vals);
    return d.hasGutshot && !d.hasOESD;
  }

  private isLatePosition(position: string): boolean {
    const p = position.toLowerCase();
    return p === 'button' || p === 'cutoff';
  }

  private getPositionRaiseSize(position: string): number {
    const p = position.toLowerCase();
    if (p === 'utg' || p === 'ep' || p === 'lojack') return 3.0;
    if (p === 'hijack' || p === 'mp') return 2.7;
    if (p === 'button' || p === 'cutoff') return 2.5;
    if (p === 'sb') return 3.2;
    return 2.5;
  }

  private calculatePotOdds(betSize: number): number {
    const potSize = Math.max(0, this.table.getPot());
    if (betSize <= 0) return 0;
    return potSize / betSize;
  }

  private getLastRaiseSize(): number {
    const actions = this.table.getPlayerActions();
    for (let i = actions.length - 1; i >= 0; i--) {
      const a = actions[i];
      if (a.getAction() === 'raise' || a.getAction() === 'bet') {
        return a.getBetAmount() || 0;
      }
    }
    return 0;
  }

  private getDefaultDecision(): StrategyDecision {
    // 🔒 Default should never trigger an in-hand action; always wait.
    return { action: "check", reasoning: "No hero info — wait", confidence: 1.0 };

    // return this.waitDecision("No hero info — wait");
  }

  // helper for hasStraight (not used after refactor but kept minimal)
  private rev(v: number): number { return v; }
}
