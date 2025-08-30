// @ts-ignore
import { rankBoard } from "phe";
import { Game } from "../models/game.ts";
import { PlayerAction } from "../models/player-action.ts";
import { Table } from "../models/table.ts";

export function constructQuery(game: Game): string{
    const table = game.getTable();

    const street = table.getStreet();
    const runout = table.getRunout();

    const hero_id = game.getHero()!.getPlayerId();
    const hero_name = table.getNameFromId(hero_id);
    const hero_stack = game.getHero()!.getStackSize();
    const hero_position = table.getPlayerPositionFromId(hero_id);
    const hero_cards = game.getHero()!.getHand();

    const players_in_pot = table.getPlayersInPot();
    const player_stacks = table.getPlayerInitialStacks();
    const pot_size = table.getPot();
    const player_actions = table.getPlayerActions();
    const player_positions = table.getPlayerPositions();

    let query = "";

    query = query.concat(defineObjective(hero_position, hero_stack), '\n');
    query = query.concat(defineGameState(street, players_in_pot), '\n');
    query = query.concat(defineCommunityCards(street, runout), '\n')
    query = query.concat(defineHand(hero_cards), '\n');
    const rank_query = defineRank(street, runout, hero_cards);
    query = query.concat(rank_query ? rank_query + '\n' : '');
    query = query.concat(defineStacks(player_stacks, player_positions, hero_id), '\n');
    query = query.concat(definePotSize(pot_size), `\n`);
    query = query.concat(defineActions(player_actions, table), '\n');
    query = query.concat(defineStats(player_positions, table, hero_name), '\n');
    query = query.concat(defineHandHistory(table), '\n');
    query = query.concat(defineBettingPatterns(table), '\n');
    query = query.concat(defineOutput());

    return query;
}

function defineObjective(position: string, stack_size: number): string {
    return `NL Hold'em. ${position} position, ${stack_size}BB stack.`;
}

function defineGameState(street: string, players_in_pot: number): string {
    return `${players_in_pot}-handed, ${street ? street : "preflop"}.`
}

function defineCommunityCards(street: string, runout: string): string {
    if (street && runout) {
        return `Board: ${runout}`;
    } else {
        return "Board: None";
    }
}

function defineHand(hero_cards: string[]): string {
    return `Hand: ${hero_cards.join(" ")}`;
}

export function defineRank(street: string, runout: string, hero_cards: string[]): string {
    if (!street) {
        return '';
    }
    let query = "The combination of the community cards and hand is: ";
    const cards = replaceTenWithLetter(hero_cards.concat(convertRunoutToCards(runout)));
    const rank_num = rankBoard(cards.join(" "));
    switch (rank_num) {
        case 0:
            query = query.concat("STRAIGHT_FLUSH");
            break;
        case 1:
            query = query.concat("FOUR_OF_A_KIND");
            break;
        case 2:
            query = query.concat("FULL_HOUSE");
            break;
        case 3:
            query = query.concat("FLUSH");
            break;
        case 4:
            query = query.concat("STRAIGHT");
            break;
        case 5:
            query = query.concat("THREE_OF_A_KIND");
            break;
        case 6:
            query = query.concat("TWO_PAIR");
            break;
        case 7:
            query = query.concat("ONE_PAIR");
            break;
        case 8:
            query = query.concat("HIGH_CARD");
            break;
    }
    return query;
}

function convertRunoutToCards(runout: string): string[] {
    const re = RegExp(/([JQKA]|10|[1-9])([shdc])/, 'g');
    const res = new Array<string>;
    const matches = [...runout.matchAll(re)];
    matches.forEach((element) => {
        const value = element[1];
        const suit = element[2];
        res.push(value + suit);
    });
    return res;
}

function replaceTenWithLetter(cards: string[]): string[] {
    return cards.map((card) => {
        if (card.length === 3) {
            return 'T' + card[2];
        }
        return card;
    });
}

function defineStacks(player_stacks: Map<string, number>, player_positions: Map<string, string>, hero_id: string): string {
    const player_ids = Array.from(player_positions.keys());
    const stacks = [];
    
    for (var i = 0; i < player_ids.length; i++)  {
        const player_id = player_ids[i]
        if (player_id === hero_id) {
            continue;
        }
        const player_pos = player_positions.get(player_id);
        const stack_size = player_stacks.get(player_id);
        stacks.push(`${player_pos}: ${stack_size}BB`);
    }
    
    return stacks.length > 0 ? `Stacks: ${stacks.join(", ")}` : "Stacks: No other players";
}

function definePotSize(pot_size_in_BBs: number): string {
    return `Pot: ${pot_size_in_BBs}BB`;
}

function defineActions(player_actions: Array<PlayerAction>, table: Table): string {
    if (player_actions.length === 0) {
        return "No actions have been taken on this street yet.";
    }
    
    let query = "CURRENT STREET ACTIONS (in order):\n";
    for (var i = 0; i < player_actions.length; i++)  {
        let player_pos = table.getPlayerPositionFromId(player_actions[i].getPlayerId());
        let player_action_string = player_actions[i].toString();
        let curr = `${i + 1}. ${player_pos}: ${player_action_string}`;
        query = query.concat(curr);
        if (i != player_actions.length - 1) {
            query = query.concat("\n");
        }
    }
    return query;
}

function defineStats(player_positions: Map<string, string>, table: Table, hero_name: string): string {
    const player_ids = Array.from(player_positions.keys());
    const stats = [];

    for (var i = 0; i < player_ids.length; i++)  {
        const player_id = player_ids[i];
        const player_name = table.getNameFromId(player_id);
        if (player_name === hero_name) {
            continue;
        }
        const player_stats = table.getPlayerStatsFromName(player_name);
        const player_pos = table.getPlayerPositionFromId(player_id);
        const vpip = player_stats.computeVPIPStat().toFixed(1);
        const pfr = player_stats.computePFRStat().toFixed(1);
        const hands = player_stats.getTotalHands();
        
        if (hands > 0) {
            stats.push(`${player_pos}: ${hands}h VPIP${vpip}% PFR${pfr}%`);
        }
    }
    
    return stats.length > 0 ? `Stats: ${stats.join(", ")}` : "Stats: No data";
}

function defineOutput(): string {
    return "Decide your action. Consider hand strength, position, pot odds, opponent tendencies. If weak or no odds, fold. Only bet/raise with strong hands or good draws. Respond: {action, bet_size_in_BBs BB}";
}

function defineHandHistory(table: Table): string {
    const handHistory = table.getHandHistory();
    const potHistory = table.getPotHistory();
    const streetOrder = table.getStreetOrder();
    const currentStreet = table.getStreet();
    
    if (handHistory.size === 0) {
        return "History: First action";
    }
    
    const history = [];
    for (const street of streetOrder) {
        if (street === currentStreet) continue; // Skip current street
        
        const actions = handHistory.get(street);
        const potSize = potHistory.get(street);
        
        if (actions && actions.length > 0) {
            const actionSummary = actions.map(action => action.toString()).join(", ");
            history.push(`${street}: ${potSize}BB - ${actionSummary}`);
        }
    }
    
    return history.length > 0 ? `History: ${history.join(" | ")}` : "History: None";
}

function defineBettingPatterns(table: Table): string {
    const patterns = table.getBettingPatterns();
    if (!patterns || patterns.trim() === "") {
        return "Patterns: None";
    }
    return `Patterns: ${patterns}`;
}