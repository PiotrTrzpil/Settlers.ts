// ─── src/game/features/ai-player/types.ts ────────────────────────

import type { BuildingType } from '@/game/buildings/building-type';
import type { Race } from '@/game/core/race';
import type { TickSystem } from '@/game/core/tick-system';
import type { Tile } from '@/game/core/coordinates';

/** A single step in the AI's build order. */
export interface BuildStep {
    readonly buildingType: BuildingType;
    /** How many of this building to place before moving to next step. */
    readonly count: number;
}

/** Configuration for an AI player instance. */
export interface AiPlayerConfig {
    /** Player index (0-based). */
    readonly player: number;
    /** Ticks between AI evaluations (throttle). Default: 30 (~1 second). */
    readonly evaluationInterval?: number;
    /** Override build order. Uses race-appropriate default if not provided. */
    readonly buildOrder?: readonly BuildStep[];
}

/** Read-only snapshot of AI state for diagnostics/testing. */
export interface AiPlayerState {
    readonly player: number;
    readonly race: Race;
    readonly buildOrderIndex: number;
    readonly buildingsPlaced: number;
    readonly soldiersCount: number;
    readonly attacksSent: number;
    readonly attackTarget: Tile | null;
}

// ─── Feature exports (accessed via ctx.getFeature('ai-player')) ──

export interface AiPlayerExports {
    readonly aiSystem: AiPlayerSystem;
}

// ─── System interface ────────────────────────────────────────────

export interface AiPlayerSystem extends TickSystem {
    /** Add an AI controller for a player. Call after map is loaded. */
    addPlayer(config: AiPlayerConfig): void;
    /** Remove an AI controller. */
    removePlayer(player: number): void;
    /** Get current state of an AI player (for diagnostics/tests). */
    getState(player: number): Readonly<AiPlayerState>;
    /** Get all active AI player indices. */
    getActivePlayers(): readonly number[];
}

// ─── Build order data ────────────────────────────────────────────

/** Get the default build order for a race. */
export type BuildOrderFactory = (race: Race) => readonly BuildStep[];
