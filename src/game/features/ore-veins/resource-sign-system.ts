/**
 * Resource Sign System — places and expires ore resource sign entities.
 *
 * Public API:
 * - `placeSign(x, y)` — reads ore data at (x, y) and creates a sign entity with
 *   the appropriate MapObjectType and variation; tracks it for auto-expiry
 * - `tick(dt)` — removes signs whose lifetime has elapsed
 * - `onEntityRemoved(id)` — cleans up tracking if a sign is removed externally
 * - `setOreVeinData(data)` — called after terrain loads to inject ore data
 */

import type { TickSystem } from '../../core/tick-system';
import type { OreVeinData } from './ore-vein-data';
import { OreType } from './ore-type';
import { MapObjectType } from '@/game/types/map-object-types';
import { EntityType, type Entity } from '../../entity';
import { createLogger } from '@/utilities/logger';
import type { Command, CommandResult } from '../../commands';
import { sortedEntries } from '@/utilities/collections';

const log = createLogger('ResourceSignSystem');

/** Signs remain visible for 15 minutes of game time. */
const SIGN_LIFETIME = 900;

/** Quantize internal ore level (1-16) to visual richness tier (0=LOW, 1=MED, 2=RICH). */
function levelToVariation(level: number): number {
    if (level <= 5) {
        return 0;
    }
    if (level <= 10) {
        return 1;
    }
    return 2;
}

/** Maps OreType values to their corresponding resource sign MapObjectType. */
const ORE_TYPE_TO_MAP_OBJECT: Partial<Record<OreType, MapObjectType>> = {
    [OreType.Coal]: MapObjectType.ResCoal,
    [OreType.Iron]: MapObjectType.ResIron,
    [OreType.Gold]: MapObjectType.ResGold,
    [OreType.Sulfur]: MapObjectType.ResSulfur,
    [OreType.Stone]: MapObjectType.ResStone,
};

export interface ResourceSignSystemConfig {
    executeCommand: (cmd: Command) => CommandResult;
    getGroundEntityAt: (x: number, y: number) => Entity | undefined;
}

export class ResourceSignSystem implements TickSystem {
    /** Maps sign entity ID to its position and game-time expiry. */
    private readonly signs = new Map<number, { x: number; y: number; expiresAt: number }>();
    private elapsed = 0;
    private oreVeinData!: OreVeinData; // OK: genuinely deferred — set via setOreVeinData() after terrain loads
    private readonly executeCommand: (cmd: Command) => CommandResult;
    private readonly getGroundEntityAt: (x: number, y: number) => Entity | undefined;

    constructor(cfg: ResourceSignSystemConfig) {
        this.executeCommand = cfg.executeCommand;
        this.getGroundEntityAt = cfg.getGroundEntityAt;
    }

    /**
     * Inject the ore vein data after terrain has loaded.
     * Must be called before any `placeSign` invocations.
     */
    setOreVeinData(data: OreVeinData): void {
        this.oreVeinData = data;
    }

    /**
     * Place a resource sign at the given tile coordinates.
     *
     * Reads the ore type and level from `OreVeinData` at (x, y), selects the
     * correct `MapObjectType` and variation, creates a `MapObject` entity via
     * `GameState.addEntity`, and schedules it for removal after `SIGN_LIFETIME`.
     *
     * Internal ore levels (1-16) are quantized to 3 visual tiers for display:
     * 1-5 → variation 0 (LOW), 6-10 → variation 1 (MED), 11-16 → variation 2 (RICH).
     * For empty tiles (OreType.None or level 0) the sign type is `ResEmpty`.
     */
    placeSign(x: number, y: number): void {
        const oreType = this.oreVeinData.getOreType(x, y);
        const oreLevel = this.oreVeinData.getOreLevel(x, y);

        let signType: MapObjectType;
        let variation = 0;

        if (oreType === OreType.None || oreLevel === 0) {
            signType = MapObjectType.ResEmpty;
        } else {
            signType = ORE_TYPE_TO_MAP_OBJECT[oreType]!;
            variation = levelToVariation(oreLevel);
        }

        // Clear any existing map object at this position (trees, stones, expired signs)
        const existing = this.getGroundEntityAt(x, y);
        if (existing) {
            if (existing.type === EntityType.Building) {
                return; // never remove buildings
            }
            this.executeCommand({ type: 'remove_entity', entityId: existing.id });
        }

        const result = this.executeCommand({ type: 'spawn_map_object', objectType: signType, x, y, variation });
        const effect = result.effects?.[0];
        if (!effect || effect.type !== 'entity_created') {
            return;
        }
        this.signs.set(effect.entityId, { x, y, expiresAt: this.elapsed + SIGN_LIFETIME });
    }

    /**
     * Advance the sign expiry clock and remove any signs that have exceeded
     * their lifetime.
     */
    tick(dt: number): void {
        this.elapsed += dt;

        for (const [id, sign] of sortedEntries(this.signs)) {
            try {
                if (this.elapsed >= sign.expiresAt) {
                    this.executeCommand({ type: 'remove_entity', entityId: id });
                    this.signs.delete(id);
                }
            } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                log.error(`Unhandled error expiring sign ${id}`, err);
            }
        }
    }

    /**
     * Remove tracking state for a sign that was removed externally.
     * Called automatically by `EntityCleanupRegistry` via `OreSignFeature`.
     */
    onEntityRemoved(entityId: number): void {
        this.signs.delete(entityId);
    }
}
