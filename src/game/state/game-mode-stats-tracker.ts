/**
 * Tracks per-player unit counts over time for post-game stats graphs.
 * Samples every SAMPLE_INTERVAL ticks (≈ once per 10 game-seconds).
 */

import type { GameCore } from '../game-core';
import { EntityType, type UnitType } from '../entity';
import { getUnitCategory, UnitCategory } from '../core/unit-types';
import { TICK_RATE } from '../core/tick-rate';

/** One data point in a time series. */
export interface StatsDataPoint {
    /** Game tick at which this sample was taken. */
    tick: number;
    /** Count per player index. */
    values: Map<number, number>;
}

export interface PlayerTimeSeries {
    player: number;
    data: { tick: number; count: number }[];
}

/** How often to sample (every 10 game-seconds). */
const SAMPLE_INTERVAL = TICK_RATE * 10;

export class GameModeStatsTracker {
    private game: GameCore | null = null;
    private intervalId: ReturnType<typeof setInterval> | null = null;
    readonly soldiers: StatsDataPoint[] = [];
    readonly settlers: StatsDataPoint[] = [];

    start(game: GameCore): void {
        this.game = game;
        this.stop();
        // Sample immediately, then every second of real time.
        // We check if enough game-ticks have passed since the last sample.
        this.sample();
        this.intervalId = setInterval(() => this.sampleIfReady(), 1000);
    }

    stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    /** Get soldier time series per player. */
    getSoldierSeries(): PlayerTimeSeries[] {
        return this.toPerPlayer(this.soldiers);
    }

    /** Get settler (worker) time series per player. */
    getSettlerSeries(): PlayerTimeSeries[] {
        return this.toPerPlayer(this.settlers);
    }

    private sampleIfReady(): void {
        if (!this.game) {
            return;
        }
        const lastTick = this.soldiers.length > 0 ? this.soldiers[this.soldiers.length - 1]!.tick : -SAMPLE_INTERVAL;
        if (this.game.currentTick - lastTick >= SAMPLE_INTERVAL) {
            this.sample();
        }
    }

    private sample(): void {
        if (!this.game) {
            return;
        }
        const tick = this.game.currentTick;
        const soldierCounts = new Map<number, number>();
        const settlerCounts = new Map<number, number>();

        for (const [playerIdx] of this.game.state.playerRaces) {
            let soldiers = 0;
            let settlers = 0;
            const unitIds = this.game.state.entityIndex.idsOfTypeAndPlayer(EntityType.Unit, playerIdx);
            for (const id of unitIds) {
                const entity = this.game.state.getEntity(id);
                if (!entity) {
                    continue;
                }
                const category = getUnitCategory(entity.subType as UnitType);
                if (category === UnitCategory.Military || category === UnitCategory.Religious) {
                    soldiers++;
                } else {
                    settlers++;
                }
            }
            soldierCounts.set(playerIdx, soldiers);
            settlerCounts.set(playerIdx, settlers);
        }

        this.soldiers.push({ tick, values: soldierCounts });
        this.settlers.push({ tick, values: settlerCounts });
    }

    private toPerPlayer(dataPoints: StatsDataPoint[]): PlayerTimeSeries[] {
        if (dataPoints.length === 0) {
            return [];
        }
        const players = new Set<number>();
        for (const dp of dataPoints) {
            for (const p of dp.values.keys()) {
                players.add(p);
            }
        }

        const result: PlayerTimeSeries[] = [];
        for (const player of players) {
            const data = dataPoints.map(dp => ({
                tick: dp.tick,
                count: dp.values.get(player)!,
            }));
            result.push({ player, data });
        }
        result.sort((a, b) => a.player - b.player);
        return result;
    }
}
