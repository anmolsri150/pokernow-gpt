import { Game } from '../models/game.ts';
import { Table } from '../models/table.ts';
import { BotAction } from '../interfaces/ai-client-interfaces.ts';

export interface HandStrength {
    type: string;
    description: string;
    strength: number;
    outs?: number;
    odds?: number;
}

export interface StrategyDecision {
    action: string;
    betSize?: number;
    potFraction?: number;
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

    constructor(game: Game) {
        this.game = game;
        this.table = game.getTable();
    }

    public getDecision(): StrategyDecision {
        const street = this.table.getStreet();
        const hero = this.game.getHero();
        
        if (!hero) {
            return this.getDefaultDecision();
        }

        if (!street || street === 'preflop') {
            return this.getPreflopDecision();
        } else {
            return this.getPostflopDecision();
        }
    }

    private getPreflopDecision(): StrategyDecision {
        const hero = this.game.getHero()!;
        const heroCards = hero.getHand();
        const position = this.table.getPlayerPositionFromId(hero.getPlayerId());
        const potSize = this.table.getPot();
        const playerActions = this.table.getPlayerActions();
        
        // Convert cards to hand notation (e.g., ["Ah", "Kd"] -> "AKo")
        const handNotation = this.getHandNotation(heroCards);
        const handStrength = this.evaluatePreflopHand(handNotation, position);
        
        // Check if there are any raises before us
        const hasRaises = playerActions.some(action => action.getAction() === 'raise' || action.getAction() === 'bet');
        const lastRaiseSize = this.getLastRaiseSize();
        
        if (hasRaises) {
            return this.handlePreflopRaise(handStrength, lastRaiseSize, position);
        } else {
            return this.handlePreflopNoRaise(handStrength, position);
        }
    }

    private getPostflopDecision(): StrategyDecision {
        const hero = this.game.getHero()!;
        const heroCards = hero.getHand();
        const communityCards = this.table.getRunout();
        const position = this.table.getPlayerPositionFromId(hero.getPlayerId());
        const potSize = this.table.getPot();
        const playerActions = this.table.getPlayerActions();
        
        const handStrength = this.evaluatePostflopHand(heroCards, communityCards);
        const hasRaises = playerActions.some(action => action.getAction() === 'raise' || action.getAction() === 'bet');
        
        if (hasRaises) {
            return this.handlePostflopRaise(handStrength, position, potSize);
        } else {
            return this.handlePostflopNoRaise(handStrength, position, potSize);
        }
    }

    private evaluatePreflopHand(handNotation: string, position: string): HandStrength {
        const premiumHands = ["AA", "KK", "QQ", "JJ", "AKs", "AKo", "AQs", "AQo"];
        const strongHands = ["TT", "99", "88", "AJs", "ATs", "KQs", "KQo", "KJs"];
        const playableHands = ["77", "66", "55", "A9s", "A8s", "A7s", "KTs", "QJs", "QTs", "JTs"];
        const positionHands = ["44", "33", "22", "A6s", "A5s", "A4s", "A3s", "A2s", "K9s", "K8s", "Q9s", "J9s", "T9s", "98s", "87s", "76s", "65s", "54s"];
        const suitedConnectors = ["T8s", "97s", "86s", "75s", "64s", "53s", "43s", "32s"];
        const broadwayOffsuit = ["AJo", "ATo", "KJo", "KTo", "QJo", "QTo", "JTo"];

        if (premiumHands.includes(handNotation)) {
            return { type: "premium", description: "Premium hand", strength: 9 };
        } else if (strongHands.includes(handNotation)) {
            return { type: "strong", description: "Strong hand", strength: 7 };
        } else if (playableHands.includes(handNotation)) {
            return { type: "playable", description: "Playable hand", strength: 5 };
        } else if (positionHands.includes(handNotation) && this.isLatePosition(position)) {
            return { type: "position", description: "Position hand", strength: 4 };
        } else if (suitedConnectors.includes(handNotation) && this.isLatePosition(position)) {
            return { type: "suited_connector", description: "Suited connector", strength: 3 };
        } else if (broadwayOffsuit.includes(handNotation) && this.isLatePosition(position)) {
            return { type: "broadway_offsuit", description: "Broadway offsuit", strength: 2 };
        } else {
            return { type: "weak", description: "Weak hand", strength: 1 };
        }
    }

    private evaluatePostflopHand(heroCards: string[], communityCards: string): HandStrength {
        const allCards = [...heroCards, ...this.parseCommunityCards(communityCards)];
        const handRank = this.rankHand(allCards);
        const outs = this.calculateOuts(heroCards, communityCards);
        
        // Evaluate drawing hands
        if (this.hasFlushDraw(heroCards, communityCards)) {
            return {
                type: "flush_draw",
                description: "Flush draw",
                strength: 6,
                outs: outs.flushOuts,
                odds: 4.22
            };
        }
        
        if (this.hasStraightDraw(heroCards, communityCards)) {
            return {
                type: "straight_draw",
                description: "Open-ended straight draw",
                strength: 5,
                outs: outs.straightOuts,
                odds: 4.88
            };
        }
        
        if (this.hasGutshotDraw(heroCards, communityCards)) {
            return {
                type: "gutshot_draw",
                description: "Gutshot straight draw",
                strength: 4,
                outs: outs.gutshotOuts,
                odds: 10.5
            };
        }
        
        // Evaluate made hands
        switch (handRank) {
            case 0: // Straight flush
                return { type: "straight_flush", description: "Straight flush", strength: 10 };
            case 1: // Four of a kind
                return { type: "four_of_a_kind", description: "Four of a kind", strength: 10 };
            case 2: // Full house
                return { type: "full_house", description: "Full house", strength: 9 };
            case 3: // Flush
                return { type: "flush", description: "Flush", strength: 8 };
            case 4: // Straight
                return { type: "straight", description: "Straight", strength: 7 };
            case 5: // Three of a kind
                return { type: "three_of_a_kind", description: "Three of a kind", strength: 6 };
            case 6: // Two pair
                return { type: "two_pair", description: "Two pair", strength: 5 };
            case 7: // One pair
                return { type: "one_pair", description: "One pair", strength: 3 };
            default: // High card
                return { type: "high_card", description: "High card", strength: 1 };
        }
    }

    private handlePreflopRaise(handStrength: HandStrength, raiseSize: number, position: string): StrategyDecision {
        const potOdds = this.calculatePotOdds(raiseSize);
        
        if (handStrength.strength >= 8) {
            // Premium hands - always raise or re-raise
            return {
                action: "raise",
                betSize: Math.min(raiseSize * 2.5, 10),
                reasoning: `Premium hand (${handStrength.description}) - raising for value`,
                confidence: 0.95
            };
        } else if (handStrength.strength >= 6) {
            // Strong hands - call or raise depending on position
            if (this.isLatePosition(position)) {
                return {
                    action: "raise",
                    betSize: Math.min(raiseSize * 2, 8),
                    reasoning: `Strong hand (${handStrength.description}) in late position - raising`,
                    confidence: 0.85
                };
            } else {
                return {
                    action: "call",
                    betSize: raiseSize,
                    reasoning: `Strong hand (${handStrength.description}) - calling`,
                    confidence: 0.75
                };
            }
        } else if (handStrength.strength >= 4 && potOdds > 3) {
            // Playable hands with good pot odds
            return {
                action: "call",
                betSize: raiseSize,
                reasoning: `Playable hand (${handStrength.description}) with good pot odds`,
                confidence: 0.65
            };
        } else {
            return {
                action: "fold",
                reasoning: `Weak hand (${handStrength.description}) - folding`,
                confidence: 0.9
            };
        }
    }

    private handlePreflopNoRaise(handStrength: HandStrength, position: string): StrategyDecision {
        if (handStrength.strength >= 7) {
            // Strong hands - always raise
            const raiseSize = this.getPositionRaiseSize(position);
            return {
                action: "raise",
                betSize: raiseSize,
                reasoning: `Strong hand (${handStrength.description}) - raising for value`,
                confidence: 0.9
            };
        } else if (handStrength.strength >= 5) {
            // Playable hands - raise in late position
            if (this.isLatePosition(position)) {
                const raiseSize = this.getPositionRaiseSize(position);
                return {
                    action: "raise",
                    betSize: raiseSize,
                    reasoning: `Playable hand (${handStrength.description}) in late position - raising`,
                    confidence: 0.75
                };
            } else {
                return {
                    action: "call",
                    reasoning: `Playable hand (${handStrength.description}) - calling`,
                    confidence: 0.6
                };
            }
        } else if (handStrength.strength >= 3 && this.isLatePosition(position)) {
            // Position hands in late position
            const raiseSize = this.getPositionRaiseSize(position);
            return {
                action: "raise",
                betSize: raiseSize,
                reasoning: `Position hand (${handStrength.description}) in late position - raising`,
                confidence: 0.6
            };
        } else {
            return {
                action: "fold",
                reasoning: `Weak hand (${handStrength.description}) - folding`,
                confidence: 0.8
            };
        }
    }

    private handlePostflopRaise(handStrength: HandStrength, position: string, potSize: number): StrategyDecision {
        const potOdds = this.calculatePotOdds(this.getLastRaiseSize());
        
        // Drawing hands with good odds
        if (handStrength.type.includes('draw') && handStrength.odds && potOdds <= handStrength.odds) {
            return {
                action: "call",
                betSize: this.getLastRaiseSize(),
                reasoning: `Drawing hand (${handStrength.description}) with good pot odds (${potOdds}:1 vs ${handStrength.odds}:1)`,
                confidence: 0.8
            };
        }
        
        // Strong made hands
        if (handStrength.strength >= 7) {
            return {
                action: "raise",
                betSize: Math.min(potSize * 0.75, 10),
                reasoning: `Strong hand (${handStrength.description}) - raising for value`,
                confidence: 0.9
            };
        }
        
        // Medium strength hands
        if (handStrength.strength >= 5) {
            if (this.isLatePosition(position)) {
                return {
                    action: "call",
                    betSize: this.getLastRaiseSize(),
                    reasoning: `Medium hand (${handStrength.description}) in late position - calling`,
                    confidence: 0.7
                };
            } else {
                return {
                    action: "fold",
                    reasoning: `Medium hand (${handStrength.description}) in early position - folding`,
                    confidence: 0.8
                };
            }
        }
        
        // Weak hands
        return {
            action: "fold",
            reasoning: `Weak hand (${handStrength.description}) - folding`,
            confidence: 0.9
        };
    }

    private handlePostflopNoRaise(handStrength: HandStrength, position: string, potSize: number): StrategyDecision {
        // Strong hands - bet for value
        if (handStrength.strength >= 7) {
            return {
                action: "bet",
                betSize: potSize * 0.75,
                reasoning: `Strong hand (${handStrength.description}) - betting for value`,
                confidence: 0.9
            };
        }
        
        // Drawing hands - bet for protection and value
        if (handStrength.type.includes('draw') && handStrength.outs && handStrength.outs >= 8) {
            return {
                action: "bet",
                betSize: potSize * 0.5,
                reasoning: `Drawing hand (${handStrength.description}) with ${handStrength.outs} outs - betting`,
                confidence: 0.75
            };
        }
        
        // Medium hands - check-call or bet depending on position
        if (handStrength.strength >= 4) {
            if (this.isLatePosition(position)) {
                return {
                    action: "bet",
                    betSize: potSize * 0.5,
                    reasoning: `Medium hand (${handStrength.description}) in late position - betting`,
                    confidence: 0.6
                };
            } else {
                return {
                    action: "check",
                    reasoning: `Medium hand (${handStrength.description}) in early position - checking`,
                    confidence: 0.7
                };
            }
        }
        
        // Weak hands - check-fold
        return {
            action: "check",
            reasoning: `Weak hand (${handStrength.description}) - checking`,
            confidence: 0.8
        };
    }

    // Helper methods
    private getHandNotation(cards: string[]): string {
        if (cards.length !== 2) return "XX";
        
        const card1 = cards[0];
        const card2 = cards[1];
        
        const rank1 = card1.charAt(0);
        const rank2 = card2.charAt(0);
        const suit1 = card1.charAt(1);
        const suit2 = card2.charAt(1);
        
        const isSuited = suit1 === suit2;
        const suffix = isSuited ? "s" : "o";
        
        // Sort ranks (A > K > Q > J > T > 9 > ...)
        const rankOrder = { 'A': 14, 'K': 13, 'Q': 12, 'J': 11, 'T': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2 };
        const rank1Value = rankOrder[rank1 as keyof typeof rankOrder] || parseInt(rank1);
        const rank2Value = rankOrder[rank2 as keyof typeof rankOrder] || parseInt(rank2);
        
        const higherRank = rank1Value > rank2Value ? rank1 : rank2;
        const lowerRank = rank1Value > rank2Value ? rank2 : rank1;
        
        return higherRank + lowerRank + suffix;
    }

    private parseCommunityCards(communityCards: string): string[] {
        if (!communityCards) return [];
        return communityCards.split(' ').filter(card => card.length === 2);
    }

    private rankHand(cards: string[]): number {
        // Simplified hand ranking - in a real implementation, you'd use a proper poker hand evaluator
        // This is a placeholder that returns basic rankings
        const ranks = cards.map(card => card.charAt(0));
        const suits = cards.map(card => card.charAt(1));
        
        // Check for flush
        const flush = suits.every(suit => suit === suits[0]);
        
        // Check for straight (simplified)
        const uniqueRanks = [...new Set(ranks)];
        const straight = uniqueRanks.length >= 5;
        
        if (flush && straight) return 0; // Straight flush
        if (this.hasFourOfAKind(ranks)) return 1; // Four of a kind
        if (this.hasFullHouse(ranks)) return 2; // Full house
        if (flush) return 3; // Flush
        if (straight) return 4; // Straight
        if (this.hasThreeOfAKind(ranks)) return 5; // Three of a kind
        if (this.hasTwoPair(ranks)) return 6; // Two pair
        if (this.hasOnePair(ranks)) return 7; // One pair
        return 8; // High card
    }

    private hasFourOfAKind(ranks: string[]): boolean {
        const rankCounts = this.getRankCounts(ranks);
        return Object.values(rankCounts).some(count => count >= 4);
    }

    private hasFullHouse(ranks: string[]): boolean {
        const rankCounts = this.getRankCounts(ranks);
        const counts = Object.values(rankCounts);
        return counts.includes(3) && counts.includes(2);
    }

    private hasThreeOfAKind(ranks: string[]): boolean {
        const rankCounts = this.getRankCounts(ranks);
        return Object.values(rankCounts).some(count => count >= 3);
    }

    private hasTwoPair(ranks: string[]): boolean {
        const rankCounts = this.getRankCounts(ranks);
        const pairs = Object.values(rankCounts).filter(count => count >= 2);
        return pairs.length >= 2;
    }

    private hasOnePair(ranks: string[]): boolean {
        const rankCounts = this.getRankCounts(ranks);
        return Object.values(rankCounts).some(count => count >= 2);
    }

    private getRankCounts(ranks: string[]): { [key: string]: number } {
        const counts: { [key: string]: number } = {};
        ranks.forEach(rank => {
            counts[rank] = (counts[rank] || 0) + 1;
        });
        return counts;
    }

    private calculateOuts(heroCards: string[], communityCards: string): { flushOuts: number, straightOuts: number, gutshotOuts: number } {
        // Simplified outs calculation
        const allCards = [...heroCards, ...this.parseCommunityCards(communityCards)];
        const suits = allCards.map(card => card.charAt(1));
        const ranks = allCards.map(card => card.charAt(0));
        
        // Flush outs
        const suitCounts = this.getRankCounts(suits);
        const flushOuts = Math.max(...Object.values(suitCounts)) >= 4 ? 9 : 0;
        
        // Straight outs (simplified)
        const straightOuts = 8; // Placeholder
        
        // Gutshot outs (simplified)
        const gutshotOuts = 4; // Placeholder
        
        return { flushOuts, straightOuts, gutshotOuts };
    }

    private hasFlushDraw(heroCards: string[], communityCards: string): boolean {
        const allCards = [...heroCards, ...this.parseCommunityCards(communityCards)];
        const suits = allCards.map(card => card.charAt(1));
        const suitCounts = this.getRankCounts(suits);
        return Math.max(...Object.values(suitCounts)) >= 4;
    }

    private hasStraightDraw(heroCards: string[], communityCards: string): boolean {
        // Simplified straight draw detection
        return true; // Placeholder
    }

    private hasGutshotDraw(heroCards: string[], communityCards: string): boolean {
        // Simplified gutshot draw detection
        return true; // Placeholder
    }

    private isLatePosition(position: string): boolean {
        const latePositions = ['button', 'cutoff', 'hijack', 'blinds'];
        return latePositions.includes(position.toLowerCase());
    }

    private getPositionRaiseSize(position: string): number {
        // Optimized for 5/10 and 10/20 blind structures
        // With 50-100BB stacks, standard sizing works well
        if (position === 'early') return 3;
        if (position === 'middle') return 2.5;
        return 2.5; // late position
    }

    private calculatePotOdds(betSize: number): number {
        const potSize = this.table.getPot();
        return potSize / betSize;
    }

    private getLastRaiseSize(): number {
        const actions = this.table.getPlayerActions();
        for (let i = actions.length - 1; i >= 0; i--) {
            const action = actions[i];
                    if (action.getAction() === 'raise' || action.getAction() === 'bet') {
            return action.getBetAmount() || 0;
        }
        }
        return 0;
    }

    private getDefaultDecision(): StrategyDecision {
        return {
            action: "fold",
            reasoning: "No hero information available - defaulting to fold",
            confidence: 0.5
        };
    }
}
