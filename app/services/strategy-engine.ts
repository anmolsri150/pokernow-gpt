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
  action: string;
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
    const street = this.table.getStreet();
    const hero = this.game.getHero();
    if (!hero) return this.getDefaultDecision();

    if (!street || street === 'preflop') {
      return this.getPreflopDecision();
    }
    return this.getPostflopDecision();
  }

// --- ADD: compact helpers ---
private vpipCap = (pos:string)=>{ const p=pos.toLowerCase();
    return (p.startsWith('utg')||p==='ep'||p==='lojack')?0.15:(p==='hijack'||p==='mp')?0.20:(p==='cutoff')?0.28:(p==='button')?0.40:(p==='sb')?0.18:0.22; };
  private overCap = (pos:string)=>{ try{ const n=this.table.getNameFromId(this.game.getHero()!.getPlayerId());
    const s=this.table.getPlayerStatsFromName(n); return s.computeVPIPStat()>this.vpipCap(pos)+0.05; }catch{ return false; } };
    private coldCallOK = (pos: string, str: number, price: number) => {
        // Late position only
        if (!this.isLatePosition(pos)) return false;
        // Strong/Playable (str>=5) includes small/mid pairs + suited broadways.
        // Give pocket pairs a higher price requirement than broadways.
        const hand = this.getHandNotation(this.game.getHero()!.getHand());
        const isPocketPair = /^([2-9TJQKA])\1[so]$/.test(hand);
        const need = isPocketPair ? 5.5 : 3.5;   // pairs want a better price IP
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
    // Axs wheels, KTs+, QTs+, JTs, KQo as a mix (position-dependent)
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
      // If 3-bet stat exists, use it; otherwise infer from PFR
      const t3b  = typeof (st as any).computeThreeBetStat === 'function'
        ? (st as any).computeThreeBetStat()
        : (pfr >= 0.20 ? 0.10 : 0.03);
  
      if (vpip >= 0.40 && pfr <= 0.12) return 'station';
      if (vpip <= 0.18 && pfr <= 0.12) return 'nit';
      if (t3b >= 0.09 || pfr >= 0.22)  return 'aggro';
      return 'unknown';
    } catch { return 'unknown'; }
  }
  
// replace your boardTextureFlags with this richer version
private boardTextureFlags(): { 
    paired: boolean; 
    fourFlush: boolean; 
    monoFlush: boolean;    // 3+ to a suit on board
    fourStraight: boolean; // 4 in a row on board
    straightOnBoard: boolean; // 5 in a row on board
    flushOnBoard: boolean; // 5 to a suit on board
  } {
    const board = this.parseCommunityCards(this.table.getRunout());
    if (!board.length) return { paired:false, fourFlush:false, monoFlush:false, fourStraight:false, straightOnBoard:false, flushOnBoard:false };
  
    // Pairing
    const rankCounts: Record<string, number> = {};
    for (const c of board) { const r = c[0]; rankCounts[r] = (rankCounts[r]||0)+1; }
    const paired = Object.values(rankCounts).some(v => v >= 2);
  
    // Suits
    const suitCounts: Record<string, number> = {};
    for (const c of board) { const s = c[c.length-1]; suitCounts[s] = (suitCounts[s]||0)+1; }
    const maxSuit = Math.max(...Object.values(suitCounts));
    const monoFlush = maxSuit >= 3;
    const fourFlush = maxSuit >= 4;
    const flushOnBoard = maxSuit >= 5;
  
    // Straights on board
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
    if (pip >= 3) s += 1;                // multiway => more combos live
    if (tex.paired) s += 0.5;            // boats possible / counterfeit risk
    if (tex.monoFlush) s += 1;           // monotone boards give lots of flushes/FDs
    if (tex.fourFlush) s += 1.5;         // someone already there often
    if (tex.fourStraight) s += 1;        // many straights available
    if (tex.straightOnBoard) s += 1.5;   // chop/2nd-best danger
    if (tex.flushOnBoard) s += 1.5;
  
    // population tweaks: stations = more calls with suited junk; aggro = more semibluffs (reduces "already has it" a bit)
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
    // Need 5 to a suit and hero holds the Ace of that suit
    const boardSuitCount = board.filter(c => c[c.length-1]===dom).length;
    const heroHasAce = hero.some(c => c[0]==='A' && c[c.length-1]===dom);
    return boardSuitCount + hero.filter(c => c[c.length-1]===dom).length >= 5 && heroHasAce;
  }
  
  private isNutStraight(hero: string[], board: string[]): boolean {
    const vals = this.cardsToRankVals([...board, ...hero], true);
    const longest = this.maxConsecutive(vals, true) >= 5;
    if (!longest) return false;
    // crude: if top of the straight is A/K and hero holds one of those ranks, treat as near-nut
    const set = new Set(vals);
    const hasBroadway = [10,11,12,13,14].every(v => set.has(v));
    const heroVals = new Set(this.cardsToRankVals(hero, true));
    return hasBroadway && (heroVals.has(14) || heroVals.has(13));
  }
  
  private hasNutBlockerForFlushDraw(hero: string[]): boolean {
    // crude: holding the ace of the board’s dominant suit
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
    // Standard: (4–5)BB + 1BB per limper (bigger OOP).
    return (ip ? 4.0 : 5.0) + limpers * 1.0;
  }
  
  // helper: cheap equity proxy (backdoors/overcards/BDNFD)
private hasLightEquity(hero: string[], board: string[]): boolean {
    const vals = this.cardsToRankVals([...hero, ...board], true);
    // Two overs, or one over + backdoor (monotone not required):
    const heroVals = this.cardsToRankVals(hero, true);
    const maxBoard = Math.max(...this.cardsToRankVals(board, true), 0);
    const overs = heroVals.filter(v => v > maxBoard).length;
    return overs >= 2 || overs === 1; // intentionally liberal for HU stab
  }
  // helper
private shouldJamLowSPR(h: HandStrength): boolean {
    if (this.spr() > 1.2) return false;
    // Jam value with trips+; jam strong draws (≥12 outs) or pair+FD
    if (h.strength >= 6) return true; // trips or better
    if (h.type.includes('draw') && (h.outs ?? 0) >= 12) return true;
    return false;
  }
  

  /* -------------------- Preflop -------------------- */

  private getPreflopDecision(): StrategyDecision {
    const hero = this.game.getHero()!;
    const heroCards = hero.getHand();
    const position = this.table.getPlayerPositionFromId(hero.getPlayerId());
    const playerActions = this.table.getPlayerActions();

    const handNotation = this.getHandNotation(heroCards); // e.g., AKo, T9s
    const handStrength = this.evaluatePreflopHand(handNotation, position);

    // hard blocklist guard (prevents 32s/32o raising etc.)
    if (StrategyEngine.HARD_BLOCKLIST_NO_RAISE.has(handNotation)) {
      // Only overcall BB vs min-open with great price; otherwise fold
      const hasRaises = playerActions.some(a => a.getAction() === 'raise' || a.getAction() === 'bet');
      if (hasRaises) {
        return { action: "fold", reasoning: `Trash hand (${handNotation}) in blocklist`, confidence: 0.95 };
      }
      // unopened: just fold rather than open trash
      return { action: "fold", reasoning: `Trash hand (${handNotation}) in blocklist`, confidence: 0.95 };
    }

    const hasRaises = playerActions.some(a => a.getAction() === 'raise' || a.getAction() === 'bet');
    const lastRaiseSize = this.getLastRaiseSize();

    // BB defend sanity vs open size (overfold trash to big sizes)
    if (hasRaises && /bb/i.test(position)) {
        if (!this.bbDefendOK(lastRaiseSize, handNotation) && handStrength.strength < 7) {
        return { action:"fold", reasoning:"BB vs large/open size — fold marginal/offsuit", confidence:0.85 };
        }
    }
  
    return hasRaises
      ? this.handlePreflopRaise(handStrength, lastRaiseSize, position)
      : this.handlePreflopNoRaise(handStrength, position);
  }

  private evaluatePreflopHand(handNotation: string, position: string): HandStrength {
    // Tighter, safer buckets. No low trash connectors.
    const premiumHands = ["AA","KK","QQ","JJ","AKs","AKo","AQs","AQo"];
    const strongHands  = ["TT","99","88","AJs","ATs","KQs","KQo","KJs"];
    const playableHands = ["77","66","55","A9s","A8s","A7s","KTs","QJs","QTs","JTs"];
    // Position-only adds (late position IP only):
    const positionHands = ["44","33","22","A6s","A5s","A4s","A3s","A2s","K9s","Q9s","J9s","T9s","98s","87s","76s","65s"];
    const suitedConnectors = ["T9s","98s","87s","76s","65s"]; // 65s+ only
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
        return { action: "check", reasoning: "Invalid raise size detected — safe check", confidence: 0.9 };
    }
    // BB defend sanity: overfold marginals to larger opens
    if (/bb/i.test(position)) {
      // If the open size is big, only continue with solid hands
      if (raiseSize >= 3.0 && handStrength.strength < 6) {
        return { action: "fold", reasoning: "BB vs 3x+ open — fold marginals", confidence: 0.88 };
      }
      if (raiseSize >= 2.6 && handStrength.strength < 5) {
        return { action: "fold", reasoning: "BB vs larger open — tighten defend", confidence: 0.86 };
      }
    }
  
    // Squeeze: open + >=1 caller → punish with bigger 3-bet
    if (this.isSqueezeSpot()) {
        // Value squeeze with strong hands
        if (handStrength.strength >= 6) {
        const ip = this.isLatePosition(position);
        const size = Math.min((ip ? 4.0 : 5.0) * raiseSize, 12);
        return {
            action: "raise",
            betSize: size,
            reasoning: "Squeeze spot — linear value 3-bet",
            confidence: 0.88
        };
        }
        // Blocker-bluff squeeze (only IP, only with blockers)
        if (this.isLatePosition(position) && handStrength.strength >= 4 && this.hasSqueezeBlocker(this.getHandNotation(this.game.getHero()!.getHand()))) {
            const size = Math.min(4.0 * raiseSize, 10);
            return {
                action: "raise",
                betSize: size,
                reasoning: "Squeeze spot (IP) — blocker 3-bet bluff",
                confidence: 0.72
            };
        }
    }
  

    //raise for value
    if (handStrength.strength >= 8) {
      return {
        action: "raise",
        betSize: Math.min(raiseSize * 2.5, 10),
        reasoning: `Premium (${handStrength.description}) — 3-betting for value`,
        confidence: 0.95
      };
    } else if (handStrength.strength >= 6) {
      if (this.isLatePosition(position)) {
        return {
          action: "raise",
          betSize: Math.min(raiseSize * 2, 8),
          reasoning: `Strong (${handStrength.description}) IP — 3-bet`,
          confidence: 0.85
        };
      }
      // OOP policy: no cold call with strong-but-not-premium; 3-bet or fold based on price
      if (!this.coldCallOK(position, handStrength.strength, potOdds)) {
        return {
          action: "raise",
          betSize: Math.min(raiseSize * 2, 8),
          reasoning: `Strong OOP — avoid cold-call; 3-bet or fold policy`,
          confidence: 0.8
        };
      }
      return {
        action: "call",
        betSize: raiseSize,
        reasoning: `Strong (${handStrength.description}) — calling with acceptable price`,
        confidence: 0.75
      };
    } else if (handStrength.strength >= 4 && potOdds > 3) {
      // Only allow calls when it satisfies cold-call policy (IP, good price, playable)
      if (!this.coldCallOK(position, handStrength.strength, potOdds)) {
        return { action: "fold", reasoning: "No cold call OOP / poor price — fold", confidence: 0.85 };
      }
      return {
        action: "call",
        betSize: raiseSize,
        reasoning: `Playable (${handStrength.description}) with good price (pot odds ${potOdds.toFixed(2)}:1)`,
        confidence: 0.65
      };
    }
    return { action: "fold", reasoning: `Weak — fold vs raise`, confidence: 0.9 };
  }
  

  private handlePreflopNoRaise(handStrength: HandStrength, position: string): StrategyDecision {
     // ISO over limpers (value heavy, some suited-broadway bluffs IP)
    if (this.hasLimpersBeforeHero()) {
        const acts = this.table.getPlayerActions();
        const limpers = acts.filter(a => a.getAction()==='call').length;
        if (handStrength.strength >= 5 || (this.isLatePosition(position) && handStrength.strength >= 4)) {
        return {
            action: "raise",
            betSize: this.getIsoSizeBB(position, limpers),
            reasoning: `Isolate ${limpers} limper(s) — attack dead money`,
            confidence: 0.85
        };
        }
        return { action: "check", reasoning: "Limp pot — skip marginal ISO", confidence: 0.75 };
    }
    if (handStrength.strength >= 7) {
      return {
        action: "raise",
        betSize: this.getPositionRaiseSize(position),
        reasoning: `Strong (${handStrength.description}) — open for value`,
        confidence: 0.9
      };
    } else if (handStrength.strength >= 5) {
      if (this.isLatePosition(position)) {
        // VPIP cap: if you're already loose for this seat, skip marginal opens
        if (this.overCap(position)) {
          return { action: "fold", reasoning: "Above VPIP cap for seat — tighten marginal opens", confidence: 0.85 };
        }
        return {
          action: "raise",
          betSize: this.getPositionRaiseSize(position),
          reasoning: `Playable (${handStrength.description}) IP — open to steal`,
          confidence: 0.75
        };
      }
      return { action: "fold", reasoning: `Playable but OOP/early — avoid marginal opens`, confidence: 0.7 };
    } else if (handStrength.strength >= 3 && this.isLatePosition(position)) {
      // VPIP cap gate for the lightest opens
      if (this.overCap(position)) {
        return { action: "fold", reasoning: "Above VPIP cap for seat — skip light opens", confidence: 0.85 };
      }
      return {
        action: "raise",
        betSize: this.getPositionRaiseSize(position),
        reasoning: `IP mix open — but fold to aggression if dominated`,
        confidence: 0.6
      };
    }
    return { action: "fold", reasoning: `Weak — fold`, confidence: 0.85 };
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

    // Made hands first
    if (this.hasStraightFlush(allCards)) return { type: "straight_flush", description: "Straight flush", strength: 10 };
    if (this.hasNKind(allCards, 4)) return { type: "four_of_a_kind", description: "Four of a kind", strength: 10 };
    if (this.hasFullHouse(allCards)) return { type: "full_house", description: "Full house", strength: 9 };
    if (madeFlush) return { type: "flush", description: "Flush", strength: 8 };
    if (hasStraight) return { type: "straight", description: "Straight", strength: 7 };
    if (this.hasNKind(allCards, 3)) return { type: "three_of_a_kind", description: "Trips", strength: 6 };
    if (this.hasTwoPair(allCards)) return { type: "two_pair", description: "Two pair", strength: 5 };
    if (this.hasPair(allCards)) return { type: "one_pair", description: "One pair", strength: 3 };

    // Draws
    if (flushDraw) {
      return { type: "flush_draw", description: "Flush draw", strength: 6, outs: 9, odds: 4.3 };
    }
    if (hasOESD) {
      return { type: "straight_draw", description: "Open-ended straight draw", strength: 5, outs: 8, odds: 4.9 };
    }
    if (hasGutshot) {
      return { type: "gutshot_draw", description: "Gutshot straight draw", strength: 4, outs: 4, odds: 10.5 };
    }
    return { type: "high_card", description: "High card / no draw", strength: 1 };
  }

  private handlePostflopRaise(handStrength: HandStrength, position: string, potSize: number): StrategyDecision {
    const lastRaise = this.getLastRaiseSize();
    const potOdds = this.calculatePotOdds(lastRaise);
    if (this.shouldJamLowSPR(handStrength)) {
        return {
          action: "raise",
          betSize: this.game.getHero()!.getStackSize(), // NOTE: ensure this is in BBs
          reasoning: "Low SPR — maximize fold equity / value via jam",
          confidence: 0.82
        };
      }
      
    if (lastRaise <= 0) {
        // Treat as no actionable raise — default to value bet with strong, otherwise check/call logic
        if (handStrength.strength >= 7) {
          return { action: "raise", betSize: Math.min(potSize * 0.75, 10), reasoning: "Data guard: value line", confidence: 0.8 };
        }
        return { action: "call", betSize: 0, reasoning: "Data guard: treat as small probe; keep pot controlled", confidence: 0.7 };
    }
  
    // Draws: call if the price meets the ratio
    if (handStrength.type.includes('draw') && handStrength.odds && potOdds >= handStrength.odds) {
      return {
        action: "call",
        betSize: lastRaise,
        reasoning: `Draw (${handStrength.description}) — pot odds ${potOdds.toFixed(2)}:1 ≥ ${handStrength.odds}:1`,
        confidence: 0.8
      };
    }
  
    // High SPR guard: avoid bloating the pot with one-pair hands
    if (handStrength.type === "one_pair" && this.spr() > 4) {
      return {
        action: "call",
        betSize: lastRaise,
        reasoning: "TPTK/overpair at high SPR — pot control over raise",
        confidence: 0.75
      };
    }

    // Villain tag bias when facing aggression
    const tag = this.getPrimaryVillainTag();

    // Stations: go bigger for value, avoid thin bluffs (we already rarely bluff-raise here)
    const threat = this.boardThreatScore();
    const board = this.parseCommunityCards(this.table.getRunout());
    const heroCards = this.game.getHero()!.getHand();
    const haveNut = this.isNutFlush(heroCards, board) || this.isNutStraight(heroCards, board);
    
    // If threat is high, downgrade thin value / marginal continues
    if (threat >= 2.5 && !haveNut) {
        // one-pair at high threat: prefer fold OOP, call IP only with strong kickers/backdoors
        if (handStrength.type === "one_pair") {
        if (this.isLatePosition(position)) {
            return { action:"call", betSize:lastRaise, reasoning:"High-threat board — keep one pair to call IP, avoid raises", confidence:0.7 };
        }
        return { action:"fold", reasoning:"High-threat board OOP — overfold one-pair to aggression", confidence:0.8 };
        }
    
        // non-nut flush / weak straights: avoid reraising; prefer call/fold based on SPR
        if (handStrength.strength >= 7) {
        // made straight/flush but not nut? nudge to call more
        return { action:"call", betSize:lastRaise, reasoning:"High-threat board — control with non-nut strong hand", confidence:0.72 };
        }
    }
  
    // Strong made hands
    if (handStrength.strength >= 7) {
        // Stations pay bigger
        const base = (tag === 'station') ? 1.0 : 0.75;
        return {
        action: "raise",
        betSize: Math.min(potSize * base, 12),
        reasoning: `Strong (${handStrength.description}) — raise for value${tag==='station'?' vs station (bigger)': ''}`,
        confidence: 0.9
        };
    }
  
  
    // Medium strength: in position call, OOP fold more (except vs aggro)
    if (handStrength.strength >= 5) {
        if (this.isLatePosition(position)) {
        return {
            action: "call",
            betSize: lastRaise,
            reasoning: `Medium (${handStrength.description}) IP — call vs aggression`,
            confidence: 0.7
        };
        }
        if (tag === 'aggro') {
        return {
            action: "call",
            betSize: lastRaise,
            reasoning: "Vs aggro: widen bluff-catch instead of folding medium strength OOP",
            confidence: 0.68
        };
        }
        return { action: "fold", reasoning: `Medium (${handStrength.description}) OOP — fold to raise`, confidence: 0.8 };
    }
  
    return { action: "fold", reasoning: `Weak — fold to aggression`, confidence: 0.9 };
  }
  

  private handlePostflopNoRaise(handStrength: HandStrength, position: string, potSize: number): StrategyDecision {
    // Multiway discipline: no c-bet bluffs without equity/backdoors
    const pip = this.table.getPlayersInPot?.() ?? 2;
    const tag = this.getPrimaryVillainTag();
  
    const threat = this.boardThreatScore();
  
    // Heads-up, checked to us: cheap stab on low-threat boards with light equity
    if ((this.table.getPlayersInPot?.() ?? 2) === 2 && threat < 2.0) {
      const heroCards = this.game.getHero()!.getHand();
      const board = this.parseCommunityCards(this.table.getRunout());
      if (this.hasLightEquity(heroCards, board) && handStrength.strength <= 3 && !handStrength.type.includes('draw')) {
        if (this.isLatePosition(position)) {
          return { action:"bet", betSize: potSize * 0.33, reasoning:"HU missed c-bet: auto-stab low threat", confidence:0.66 };
        }
      }
    }
  
    // On high-threat textures, shrink c-bet size and frequency with medium strength
    if (handStrength.strength >= 4 && handStrength.strength < 7 && threat >= 2.5) {
      if (this.isLatePosition(position)) {
        return { action:"bet", betSize: potSize * 0.33, reasoning:"High-threat board — smaller stab with medium strength", confidence:0.6 };
      }
      return { action:"check", reasoning:"High-threat board OOP — pot control with medium strength", confidence:0.7 };
    }
    
    // Non-nut made hands on very high-threat boards: prefer check rather than build a pot
    if (handStrength.strength >= 7 && threat >= 3.5) {
      return { action:"bet", betSize: potSize * 0.5, reasoning:"Value, but cap size on scary texture", confidence:0.7 };
    }
  
    if (pip >= 3 && !handStrength.type.includes("draw") && handStrength.strength < 4) {
      return { action: "check", reasoning: "Multiway: skip air c-bet", confidence: 0.8 };
    }
  
    // 🚀 Low-SPR jam takes priority over the default strong value bet
    if (this.shouldJamLowSPR(handStrength)) {
      // NOTE: ensure betSize units match your engine (BBs vs chips). If chips, divide by big blind.
      const jamSize = this.game.getHero()!.getStackSize();
      return {
        action: "bet",
        betSize: jamSize,
        reasoning: "Low SPR — jam with value/robust draws to maximize realization",
        confidence: 0.82
      };
    }
  
    if (handStrength.strength >= 7) {
      return { action: "bet", betSize: potSize * 0.75, reasoning: `Strong — value bet`, confidence: 0.9 };
    }
  
    const tex = this.boardTextureFlags();
  
    if (handStrength.type.includes('draw') && (handStrength.outs ?? 0) >= 8) {
      // Station rule stays
      if (tag === 'station' && (handStrength.outs ?? 0) < 12) {
        return { action: "check", reasoning: "Station: realize equity with weaker draws; bet stronger combos only", confidence: 0.76 };
      }
      // Board rule: avoid semibluffing non-nut draws on paired/4-flush boards
      const heroCards = this.game.getHero()!.getHand();
      const okToBlast =
        (!tex.paired && !tex.fourFlush) ||
        this.hasNutBlockerForFlushDraw(heroCards) ||
        (handStrength.outs ?? 0) >= 12; // combo draws
      if (!okToBlast) {
        return { action: "check", reasoning: "Paired/4-flush board — avoid semibluffing non-nut draws", confidence: 0.78 };
      }
      return { action: "bet", betSize: potSize * 0.5, reasoning: `Strong draw — semi-bluff`, confidence: 0.75 };
    }
      
    if (handStrength.strength >= 4) {
      if (this.isLatePosition(position)) {
        const size = (tag === 'nit') ? (potSize * 0.55) : (potSize * 0.5);
        return { action: "bet", betSize: size, reasoning: `Medium IP — thin value/deny${tag==='nit'?' vs nit':''}`, confidence: 0.62 };
      }
      return { action: "check", reasoning: `Medium OOP — pot control`, confidence: 0.7 };
    }
      
    return { action: "check", reasoning: `Weak — check/fold`, confidence: 0.8 };
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
    const re = /(?:10|T|[2-9]|[JQKA])[shdc]/g; // matches T or 10
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
    if (addAceLow && vals.includes(14) && !vals.includes(1)) vals.unshift(1); // A as 1 for A-5
    return vals;
  }

  private hasStraight(vals: number[]): boolean {
    return this.maxConsecutive(vals, true) >= 5;
  }

    // Add this helper:
    private hasStraightFlush(cards: string[]): boolean {
        // group by suit, check straight within that suit
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
    const hasOESD = longest === 4; // four in a row
    let hasGutshot = false;
    // window-of-5 with exactly 4 ranks present (gap inside)
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
    return p === 'button' || p === 'cutoff'; // blinds are NOT late position
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
    // returns ratio (pot:bet) ~ compare to odds thresholds
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
    return { action: "check", reasoning: "No hero info — fold", confidence: 0.5 };
  }

  // helper for hasStraight (not used after refactor but kept minimal)
  private rev(v: number): number { return v; }
}
