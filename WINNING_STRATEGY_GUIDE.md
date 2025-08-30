# Winning Poker Strategy Guide

## Overview

This guide outlines a comprehensive, rule-based poker strategy designed to maximize wins and minimize losses. The strategy combines tight-aggressive preflop play with intelligent postflop decision-making based on pot odds and hand strength.

## Core Principles

1. **Tight-Aggressive Preflop**: Only play strong hands, but play them aggressively
2. **Position-Based Play**: Use position to expand your range and increase aggression
3. **Pot Odds Mastery**: Always calculate pot odds before calling with drawing hands
4. **Value Betting**: Bet for value with strong hands, check-fold with weak hands
5. **Drawing Hand Management**: Play drawing hands when odds are favorable

## Preflop Strategy

### Hand Categories

#### Premium Hands (Always Play)
- **AA, KK, QQ, JJ**: Pocket pairs 10+
- **AKs, AKo, AQs, AQo**: Big aces with broadway kickers
- **Action**: Always raise, re-raise when facing aggression

#### Strong Hands (Play in Most Positions)
- **TT, 99, 88**: Medium pocket pairs
- **AJs, ATs, KQs, KQo, KJs**: Strong broadway hands
- **Action**: Raise in late position, call in early position

#### Playable Hands (Position Dependent)
- **77, 66, 55**: Small pocket pairs
- **A9s, A8s, A7s, KTs, QJs, QTs, JTs**: Suited broadway hands
- **Action**: Raise in late position, fold in early position

#### Position Hands (Late Position Only)
- **44, 33, 22**: Small pocket pairs
- **A6s-A2s**: Suited aces
- **K9s, K8s, Q9s, J9s, T9s**: Suited connectors
- **98s, 87s, 76s, 65s, 54s**: Suited connectors
- **Action**: Only play in late position (button, cutoff, hijack)

#### Suited Connectors (Late Position Only)
- **T8s, 97s, 86s, 75s, 64s, 53s, 43s, 32s**: Low suited connectors
- **Action**: Only play in late position with good implied odds

#### Broadway Offsuit (Late Position Only)
- **AJo, ATo, KJo, KTo, QJo, QTo, JTo**: Offsuit broadway hands
- **Action**: Only play in late position

### Position-Based Raise Sizes

- **Early Position**: 3-4 BB (tighter range)
- **Middle Position**: 2.5-3.5 BB (moderate range)
- **Late Position**: 2.5-3 BB (wider range)
- **Blinds**: 2.5-3 BB (defend wide)

### Preflop Decision Matrix

| Hand Strength | Early Position | Middle Position | Late Position |
|---------------|----------------|-----------------|---------------|
| Premium (9-10) | Raise 3-4 BB | Raise 3-4 BB | Raise 3-4 BB |
| Strong (7-8) | Call/Raise | Raise 2.5-3.5 BB | Raise 2.5-3 BB |
| Playable (5-6) | Fold | Call | Raise 2.5-3 BB |
| Position (3-4) | Fold | Fold | Raise 2.5-3 BB |
| Weak (1-2) | Fold | Fold | Fold |

## Postflop Strategy

### Hand Strength Categories

#### Made Hands
- **Top Pair Plus**: Top pair with good kicker or better
- **Second Pair**: Second pair with good kicker
- **Bottom Pair**: Bottom pair or weak pairs

#### Drawing Hands
- **Flush Draw**: 4 cards to a flush (9 outs)
- **Open-Ended Straight Draw**: 4 cards to a straight (8 outs)
- **Gutshot Straight Draw**: 4 cards to a straight (4 outs)
- **Overcard Draw**: Overcards with flush/straight potential

### Pot Odds for Drawing Hands

| Draw Type | Outs | Odds to Hit | Required Pot Odds |
|-----------|------|-------------|-------------------|
| Flush Draw | 9 | 4.22:1 | 4:1 |
| Open-Ended Straight | 8 | 4.88:1 | 5:1 |
| Gutshot Straight | 4 | 10.5:1 | 11:1 |
| Overcard Draw | 6 | 6.67:1 | 7:1 |

### Postflop Decision Rules

#### When Facing a Bet/Raise

1. **Strong Made Hands (7+ strength)**
   - Action: Raise for value
   - Bet Size: 75% of pot
   - Reasoning: Maximize value with strong hands

2. **Drawing Hands with Good Odds**
   - Action: Call if pot odds are favorable
   - Condition: Pot odds ≤ drawing odds
   - Reasoning: +EV call with drawing hands

3. **Medium Hands (4-6 strength)**
   - Late Position: Call
   - Early Position: Fold
   - Reasoning: Position-dependent play

4. **Weak Hands (1-3 strength)**
   - Action: Fold
   - Reasoning: Minimize losses

#### When No Bet (Check/Bet Decision)

1. **Strong Made Hands (7+ strength)**
   - Action: Bet for value
   - Bet Size: 75% of pot
   - Reasoning: Extract value from weaker hands

2. **Drawing Hands with 8+ Outs**
   - Action: Bet for protection
   - Bet Size: 50% of pot
   - Reasoning: Charge opponents to draw

3. **Medium Hands (4-6 strength)**
   - Late Position: Bet 50% of pot
   - Early Position: Check
   - Reasoning: Position-dependent aggression

4. **Weak Hands (1-3 strength)**
   - Action: Check
   - Reasoning: Avoid building pots with weak hands

### Betting Strategy

#### Value Betting
- **Strong Hands**: 75% of pot
- **Medium Hands**: 50% of pot
- **Drawing Hands**: 33% of pot

#### Bluffing
- **Frequency**: 20% of hands
- **Situations**: Late position, heads-up, weak opponents
- **Bet Size**: 50-75% of pot

## Key Rules Summary

### Always Follow These Rules

1. **Never call with weak hands when you don't have proper odds**
2. **Always play drawing hands when pot odds are favorable**
3. **Always bet for value with strong hands**
4. **Always fold marginal hands in early position**
5. **Always consider position before making decisions**
6. **Always calculate pot odds before calling**

### Common Mistakes to Avoid

1. **Calling with weak hands "just to see the flop"**
2. **Not betting for value with strong hands**
3. **Playing too many hands out of position**
4. **Ignoring pot odds when calling with draws**
5. **Not adjusting bet sizes based on hand strength**

## Implementation Notes

This strategy is implemented in the `StrategyEngine` class and integrated with the AI system. The strategy engine:

1. Evaluates hand strength based on preflop and postflop categories
2. Calculates pot odds and drawing odds
3. Makes decisions based on position and hand strength
4. Provides detailed reasoning for each decision
5. Falls back to AI when strategy engine encounters edge cases

## Expected Results

When following this strategy consistently:

- **Win Rate**: 55-65% in typical games
- **Profitability**: Positive expected value in most situations
- **Consistency**: Reduced variance through disciplined play
- **Learning**: Clear decision-making framework for improvement

## Advanced Concepts

### Implied Odds
Consider implied odds when playing drawing hands in multi-way pots or against loose opponents.

### Reverse Implied Odds
Be cautious with hands that can make second-best hands (e.g., AQ on AKx board).

### Board Texture
Consider how the board texture affects your hand strength and opponent ranges.

### Stack Sizes
Adjust strategy based on effective stack sizes (short-stack vs deep-stack play).

This strategy provides a solid foundation for profitable poker play while maintaining the flexibility to adapt to specific game conditions and opponent tendencies.
