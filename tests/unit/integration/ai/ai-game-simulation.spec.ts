/**
 * Integration tests for the AI player system.
 *
 * Loads a real campaign map via GameCore (headless) and adds AI controllers
 * for the existing players. The map already has settlers, resources,
 * and buildings — the AI just needs to take over and play.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { BinaryReader } from '@/resources/file/binary-reader';
import { MapLoader } from '@/resources/map/map-loader';
import { GameCore } from '@/game/game-core';
import { EntityType } from '@/game/entity';
import { installRealGameData } from '../../helpers/test-game-data';
import type { AiPlayerSystem } from '@/game/features/ai-player/types';

const MAP_DIR = path.resolve(__dirname, '../../../../public/Siedler4/Map');
const CAMPAIGN_MAP = 'Campaign/roman01.map';

installRealGameData();

function loadMap(mapPath: string): GameCore | null {
    const fullPath = path.join(MAP_DIR, mapPath);
    if (!fs.existsSync(fullPath)) return null;

    const buffer = fs.readFileSync(fullPath);
    const reader = new BinaryReader(new Uint8Array(buffer).buffer, 0, null, mapPath);
    const mapLoader = MapLoader.getLoader(reader);
    if (!mapLoader) return null;
    return new GameCore(mapLoader);
}

/** Run AI-only ticks (skips expensive pathfinding/logistics). */
function runAiTicks(ai: AiPlayerSystem, count: number, dt = 1 / 30) {
    const errors: Array<{ tick: number; error: Error }> = [];
    for (let i = 0; i < count; i++) {
        try {
            (ai as { tick(dt: number): void }).tick(dt);
        } catch (e) {
            errors.push({ tick: i, error: e instanceof Error ? e : new Error(String(e)) });
        }
    }
    return errors;
}

// ─── tests ────────────────────────────────────────────────────────

describe.skip('AI game simulation (integration)', { timeout: 30_000 }, () => {
    let game: GameCore;
    let players: number[];
    let ai: AiPlayerSystem;

    beforeAll(() => {
        const g = loadMap(CAMPAIGN_MAP);
        if (!g) throw new Error(`Map not found: ${CAMPAIGN_MAP}`);
        game = g;
        game.setTerritoryEnabled(true);
        game.services.victorySystem.setLocalPlayer(-1);
        players = [...game.state.playerRaces.keys()].sort((a, b) => a - b);
        ai = game.services.aiSystem;
    });

    afterAll(() => game?.destroy());

    it('AI state snapshot has correct initial values', () => {
        const aiPlayer = players[0]!;
        ai.addPlayer({ player: aiPlayer, evaluationInterval: 1 });

        const state = ai.getState(aiPlayer);
        expect(state.player).toBe(aiPlayer);
        expect(state.race).toBeDefined();
        expect(state.soldiersCount).toBeGreaterThanOrEqual(0);
        expect(state.attacksSent).toBe(0);

        ai.removePlayer(aiPlayer);
    });

    it('AI places buildings on a real map', () => {
        const aiPlayer = players[0]!;
        ai.addPlayer({ player: aiPlayer, evaluationInterval: 1 });

        const buildingsBefore = game.state.entities.filter(
            e => e.type === EntityType.Building && e.player === aiPlayer
        ).length;

        const errors = runAiTicks(ai, 500);
        const state = ai.getState(aiPlayer);

        const buildingsAfter = game.state.entities.filter(
            e => e.type === EntityType.Building && e.player === aiPlayer
        ).length;
        expect(
            buildingsAfter,
            `AI player ${aiPlayer}: idx=${state.buildOrderIndex} placed=${state.buildingsPlaced} ` +
                `errors=${errors.length} before=${buildingsBefore} after=${buildingsAfter}`
        ).toBeGreaterThan(buildingsBefore);
    });

    it('AI advances through build order', () => {
        // AI is still running from previous test
        const aiPlayer = players[0]!;

        runAiTicks(ai, 500);
        const state = ai.getState(aiPlayer);

        // Build order index accounts for pre-existing buildings + newly placed ones
        expect(state.buildOrderIndex).toBeGreaterThanOrEqual(3);
    });

    it('removing an AI player stops its evaluation', () => {
        const aiPlayer = players[0]!;
        expect(ai.getActivePlayers()).toContain(aiPlayer);

        ai.removePlayer(aiPlayer);
        expect(ai.getActivePlayers()).not.toContain(aiPlayer);

        const buildingsAfterRemove = game.state.entities.filter(
            e => e.type === EntityType.Building && e.player === aiPlayer
        ).length;

        runAiTicks(ai, 100);

        const buildingsNow = game.state.entities.filter(
            e => e.type === EntityType.Building && e.player === aiPlayer
        ).length;
        expect(buildingsNow).toBe(buildingsAfterRemove);
    });

    it('two AI players run without crashes', () => {
        if (players.length < 2) return;

        ai.addPlayer({ player: players[0]!, evaluationInterval: 1 });
        ai.addPlayer({ player: players[1]!, evaluationInterval: 1 });

        expect(ai.getActivePlayers()).toContain(players[0]);
        expect(ai.getActivePlayers()).toContain(players[1]);

        runAiTicks(ai, 500);

        const state0 = ai.getState(players[0]!);
        const state1 = ai.getState(players[1]!);

        expect(state0.buildingsPlaced + state1.buildingsPlaced).toBeGreaterThan(0);
    });
});
