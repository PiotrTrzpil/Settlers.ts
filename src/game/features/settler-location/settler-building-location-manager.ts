/**
 * SettlerBuildingLocationManager
 *
 * Single source of truth for which settlers are committed to buildings, covering:
 * - "Approaching": settler is walking toward a building with intent to enter (visible)
 * - "Inside": settler is confirmed inside the building (entity.hidden = true)
 *
 * Owns all entity.hidden transitions for entry/exit. Features (tower-garrison,
 * settler-tasks) call this manager rather than setting entity.hidden directly.
 *
 * On building removal:
 * - Inside settlers: entity.hidden = false, removed from map
 * - Approaching settlers: removed from map, settler-location:approachInterrupted emitted
 *
 * On entity removal: silently removed from map (no unhide needed — entity is gone).
 */

import type { FeatureContext } from '../feature';
import type { Persistable } from '@/game/persistence';
import { EntityType, getUnitTypeSpeed, type UnitType } from '@/game/entity';
import { CLEANUP_PRIORITY } from '@/game/systems/entity-cleanup-registry';
import { createLogger } from '@/utilities/logger';
import {
    SettlerBuildingStatus,
    type ISettlerBuildingLocationManager,
    type SettlerBuildingLocation,
    type SerializedSettlerLocations,
} from './types';

const log = createLogger('SettlerBuildingLocationManager');

export class SettlerBuildingLocationManager
implements ISettlerBuildingLocationManager, Persistable<SerializedSettlerLocations>
{
    readonly persistKey = 'settler-building-locations' as const;

    /** Maps settlerId → { buildingId, status } for both approaching and inside states. */
    private readonly locationMap = new Map<number, SettlerBuildingLocation>();

    private readonly ctx: FeatureContext;

    constructor(ctx: FeatureContext) {
        this.ctx = ctx;

        ctx.cleanupRegistry.onEntityRemoved(entityId => this.onEntityRemoved(entityId), CLEANUP_PRIORITY.DEFAULT);

        ctx.on('building:removed', ({ buildingId }) => this.onBuildingRemoved(buildingId));
    }

    // =========================================================================
    // ISettlerBuildingLocationManager — Public API
    // =========================================================================

    /**
     * Register settler as walking toward a building with intent to enter.
     * Settler remains visible. Throws if settler is already tracked.
     */
    markApproaching(settlerId: number, buildingId: number): void {
        if (this.locationMap.has(settlerId)) {
            const existing = this.locationMap.get(settlerId)!;
            throw new Error(
                `SettlerBuildingLocationManager.markApproaching: settler ${settlerId} is already tracked ` +
                    `(buildingId=${existing.buildingId}, status=${existing.status})`
            );
        }
        this.locationMap.set(settlerId, { buildingId, status: SettlerBuildingStatus.Approaching });
        log.debug(`Settler ${settlerId} marked approaching building ${buildingId}`);
    }

    /**
     * Cancel an approaching registration (e.g., settler was redirected).
     * No-op if settler is not tracked as approaching.
     * Throws if settler is Inside (cannot cancel Inside; must call exitBuilding).
     */
    cancelApproach(settlerId: number): void {
        const location = this.locationMap.get(settlerId);
        if (!location) return; // no-op — idempotent
        if (location.status === SettlerBuildingStatus.Inside) {
            throw new Error(
                `SettlerBuildingLocationManager.cancelApproach: settler ${settlerId} is Inside building ` +
                    `${location.buildingId} — call exitBuilding() instead`
            );
        }
        this.locationMap.delete(settlerId);
        log.debug(`Settler ${settlerId} approach to building ${location.buildingId} cancelled`);
    }

    /**
     * Confirm settler is now inside the building. Sets entity.hidden = true.
     * If settler was registered as Approaching this building, transitions to Inside.
     * Also accepts direct entry (no prior markApproaching).
     * Throws if settler is already Inside, or if Approaching a different building.
     */
    enterBuilding(settlerId: number, buildingId: number): void {
        const existing = this.locationMap.get(settlerId);
        if (existing) {
            if (existing.status === SettlerBuildingStatus.Inside) {
                throw new Error(
                    `SettlerBuildingLocationManager.enterBuilding: settler ${settlerId} is already Inside ` +
                        `building ${existing.buildingId}`
                );
            }
            // Status is Approaching — if targeting a different building, cancel stale approach and proceed.
            // This can happen after restore: approaching state is transient and the settler's choreo
            // may have been redirected to a different building.
            if (existing.buildingId !== buildingId) {
                log.debug(
                    `Settler ${settlerId} was Approaching building ${existing.buildingId} ` +
                        `but entering ${buildingId} — cancelling stale approach`
                );
                this.locationMap.delete(settlerId);
            }
            // Transition Approaching → Inside
        }

        this.locationMap.set(settlerId, { buildingId, status: SettlerBuildingStatus.Inside });

        const entity = this.ctx.gameState.getEntityOrThrow(settlerId, 'SettlerBuildingLocationManager.enterBuilding');
        entity.hidden = true;

        // Remove movement controller and unitOccupancy so the hidden unit
        // doesn't ghost-block the tile for other units trying to reach the building.
        this.ctx.gameState.movement.removeController(settlerId);
        this.ctx.gameState.clearTileOccupancy(settlerId);

        this.ctx.eventBus.emit('settler-location:entered', {
            unitId: settlerId,
            unitType: entity.subType as UnitType,
            buildingId,
        });
        log.debug(`Settler ${settlerId} entered building ${buildingId}`);
    }

    /**
     * Mark settler as exiting the building. Sets entity.hidden = false.
     * Throws if settler is not tracked as Inside.
     */
    exitBuilding(settlerId: number): void {
        const location = this.locationMap.get(settlerId);
        if (!location || location.status !== SettlerBuildingStatus.Inside) {
            throw new Error(
                `SettlerBuildingLocationManager.exitBuilding: settler ${settlerId} is not Inside any building ` +
                    `(status=${location?.status ?? 'not-tracked'})`
            );
        }

        const buildingId = location.buildingId;
        this.locationMap.delete(settlerId);

        const entity = this.ctx.gameState.getEntityOrThrow(settlerId, 'SettlerBuildingLocationManager.exitBuilding');
        entity.hidden = false;

        // Restore movement controller and unitOccupancy (removed on enterBuilding)
        if (entity.type === EntityType.Unit) {
            const speed = getUnitTypeSpeed(entity.subType as UnitType);
            this.ctx.gameState.movement.createController(settlerId, entity.x, entity.y, speed);
            this.ctx.gameState.restoreTileOccupancy(settlerId);
        }

        log.debug(`Settler ${settlerId} exited building ${buildingId}`);
    }

    /** Returns current location (approaching or inside), or null if settler is not tracked. */
    getLocation(settlerId: number): SettlerBuildingLocation | null {
        return this.locationMap.get(settlerId) ?? null;
    }

    /** Returns true if settler is confirmed inside a building (hidden). If buildingId is given, also checks it matches. */
    isInside(settlerId: number, buildingId?: number): boolean {
        const location = this.locationMap.get(settlerId);
        if (location?.status !== SettlerBuildingStatus.Inside) return false;
        return buildingId === undefined || location.buildingId === buildingId;
    }

    /** Returns true if settler is tracked (approaching or inside). */
    isCommitted(settlerId: number): boolean {
        return this.locationMap.has(settlerId);
    }

    /** Returns all settler IDs currently inside the given building. */
    getOccupants(buildingId: number): readonly number[] {
        const result: number[] = [];
        for (const [settlerId, location] of this.locationMap) {
            if (location.buildingId === buildingId && location.status === SettlerBuildingStatus.Inside) {
                result.push(settlerId);
            }
        }
        return result;
    }

    /** Returns all settler IDs approaching the given building. */
    getApproaching(buildingId: number): readonly number[] {
        const result: number[] = [];
        for (const [settlerId, location] of this.locationMap) {
            if (location.buildingId === buildingId && location.status === SettlerBuildingStatus.Approaching) {
                result.push(settlerId);
            }
        }
        return result;
    }

    // =========================================================================
    // Persistable
    // =========================================================================

    serialize(): SerializedSettlerLocations {
        const entries: SerializedSettlerLocations['entries'] = [];
        for (const [settlerId, location] of this.locationMap) {
            // Only persist "Inside" entries — "Approaching" is transient movement state
            // that cannot be reliably reconstructed (the settler's choreo may target a
            // different building after restore).
            if (location.status === SettlerBuildingStatus.Inside) {
                entries.push({ settlerId, buildingId: location.buildingId, status: location.status });
            }
        }
        return { entries };
    }

    deserialize(data: SerializedSettlerLocations): void {
        this.locationMap.clear();
        let skipped = 0;
        for (const entry of data.entries) {
            // Validate both settler and building still exist — stale data from
            // version mismatches or partial saves must not crash.
            const settler = this.ctx.gameState.getEntity(entry.settlerId);
            const building = this.ctx.gameState.getEntity(entry.buildingId);
            if (!settler || !building) {
                log.debug(
                    `Skipping stale location entry: settler ${entry.settlerId} ` +
                        `(exists=${!!settler}), building ${entry.buildingId} (exists=${!!building})`
                );
                skipped++;
                continue;
            }

            this.locationMap.set(entry.settlerId, {
                buildingId: entry.buildingId,
                status: entry.status,
            });
            if (entry.status === SettlerBuildingStatus.Inside) {
                settler.hidden = true;
                // Remove controller + unitOccupancy (entity:created may have added them)
                this.ctx.gameState.movement.removeController(entry.settlerId);
                this.ctx.gameState.clearTileOccupancy(entry.settlerId);
            }
            // Approaching: entity stays visible; feature will re-issue movement on its own onTerrainReady
        }
        if (skipped > 0) log.debug(`Skipped ${skipped} stale settler location entries`);
        log.debug(`Deserialized: ${this.locationMap.size} settler location entries`);
    }

    // =========================================================================
    // Private — event handlers
    // =========================================================================

    private onBuildingRemoved(buildingId: number): void {
        const insideSettlers: number[] = [];
        const approachingSettlers: number[] = [];

        for (const [settlerId, location] of this.locationMap) {
            if (location.buildingId !== buildingId) continue;
            if (location.status === SettlerBuildingStatus.Inside) {
                insideSettlers.push(settlerId);
            } else {
                approachingSettlers.push(settlerId);
            }
        }

        // Unhide Inside settlers first, before emitting approachInterrupted,
        // so subscribers see a consistent state.
        for (const settlerId of insideSettlers) {
            this.locationMap.delete(settlerId);
            const entity = this.ctx.gameState.getEntity(settlerId);
            if (entity) {
                entity.hidden = false;
                // Restore movement controller + unitOccupancy (removed on enterBuilding)
                if (entity.type === EntityType.Unit) {
                    const speed = getUnitTypeSpeed(entity.subType as UnitType);
                    this.ctx.gameState.movement.createController(settlerId, entity.x, entity.y, speed);
                    this.ctx.gameState.restoreTileOccupancy(settlerId);
                }
            }
            log.debug(`Settler ${settlerId} unhidden — building ${buildingId} removed`);
        }

        // Emit approachInterrupted for approaching settlers
        for (const settlerId of approachingSettlers) {
            this.locationMap.delete(settlerId);
            this.ctx.eventBus.emit('settler-location:approachInterrupted', { unitId: settlerId, buildingId });
            log.debug(`Settler ${settlerId} approach interrupted — building ${buildingId} removed`);
        }
    }

    private onEntityRemoved(entityId: number): void {
        // Entity is being removed — no unhide needed, just clean up map entry
        if (this.locationMap.delete(entityId)) {
            log.debug(`Settler ${entityId} removed from location map (entity removed)`);
        }
    }
}
