/**
 * UnitTransformer — owns the carrier-to-specialist transform state, keyed by carrier.
 *
 * Lifecycle of one transform (every path — owned RecruitSegments jobs and the TRANSITIONAL legacy
 * dispatch — goes through the same three calls):
 *
 *   reserveTransform(carrier, …)     before the job is assigned: reserves the source (tool pile /
 *                                    building materials, keyed by the carrier) + pending record
 *   recruitment:completed            TRANSFORM_* executor consumed the source → type mutation,
 *                                    pending dropped, unit:recruited
 *   abortTransform(carrier)          TRANSFORM_* node `onAbort` hook (job failed / preempted /
 *                                    cancelled / unit removed before the transform) or
 *                                    recruitment:failed (pile empty on arrival) → source released
 *
 * After a load, the node `onRestore` hook calls reserveTransform again (reservations and pending
 * records are not persisted — they are derived from the restored job).
 */

import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import { EventSubscriptionManager } from '../../event-bus';
import { EntityType, EXTENDED_OFFSETS } from '../../entity';

import { UnitType } from '../../core/unit-types';
import { EMaterialType } from '../../economy/material-type';
import type { CarrierRegistry } from '../carriers';
import type { UnitReservationRegistry } from '../../systems/unit-reservation';
import { createLogger } from '@/utilities/logger';
import type { InventorySide, MaterialCost, ToolSourceResolver } from './tool-source-resolver';
import { SPECIALIST_TOOL_MAP } from './specialist-tool-map';

const log = createLogger('UnitTransformer');

/** A transform source resolved to what gets reserved. */
export type TransformSource =
    | { readonly kind: 'pile'; readonly pileEntityId: number }
    | {
          readonly kind: 'building';
          readonly buildingId: number;
          readonly costs: readonly MaterialCost[];
          readonly side: InventorySide;
      }
    | { readonly kind: 'direct' };

export interface UnitTransformerConfig {
    gameState: GameState;
    eventBus: EventBus;
    carrierRegistry: CarrierRegistry;
    toolSourceResolver: ToolSourceResolver;
    /** TRANSITIONAL (deleted in Cleanup): reserves legacy-dispatched carriers against player moves. */
    unitReservation: UnitReservationRegistry;
}

interface PendingTransform {
    readonly targetUnitType: UnitType;
    readonly source: TransformSource['kind'];
    /** TRANSITIONAL: the carrier runs a legacy job and holds a legacy unit reservation. */
    readonly legacyReserved: boolean;
}

export class UnitTransformer {
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly carrierRegistry: CarrierRegistry;
    private readonly toolSourceResolver: ToolSourceResolver;
    private readonly unitReservation: UnitReservationRegistry;
    private readonly subscriptions = new EventSubscriptionManager();

    /** Carriers on their way to transform, keyed by carrier id. */
    private readonly pending = new Map<number, PendingTransform>();

    constructor(config: UnitTransformerConfig) {
        this.gameState = config.gameState;
        this.eventBus = config.eventBus;
        this.carrierRegistry = config.carrierRegistry;
        this.toolSourceResolver = config.toolSourceResolver;
        this.unitReservation = config.unitReservation;
    }

    // =========================================================================
    // Transform lifecycle
    // =========================================================================

    /**
     * Reserve `source` for `carrierId`'s transform into `targetUnitType` and record it as pending.
     * False (nothing reserved) when the source is gone or already taken.
     * `legacyReserved` (TRANSITIONAL): also hold a legacy unit reservation for a legacy job.
     */
    reserveTransform(
        carrierId: number,
        targetUnitType: UnitType,
        source: TransformSource,
        legacyReserved = false
    ): boolean {
        if (this.pending.has(carrierId)) {
            throw new Error(`Carrier ${carrierId} already has a pending transform`);
        }
        if (!this.reserveSource(carrierId, targetUnitType, source)) {
            return false;
        }
        this.pending.set(carrierId, { targetUnitType, source: source.kind, legacyReserved });
        if (legacyReserved) {
            this.unitReservation.reserve(carrierId, { purpose: 'unit-transform' });
        }
        log.debug(`Pending transform: carrier ${carrierId} → ${targetUnitType} (${source.kind})`);
        return true;
    }

    /** The transform will not happen: release the carrier's source reservation and pending record. */
    abortTransform(carrierId: number): void {
        const p = this.takePending(carrierId);
        if (p.source === 'pile') {
            this.toolSourceResolver.releasePile(carrierId);
        } else if (p.source === 'building') {
            this.toolSourceResolver.releaseBuildingReservation(carrierId);
        }
        log.debug(`Transform aborted for carrier ${carrierId}`);
    }

    private reserveSource(carrierId: number, targetUnitType: UnitType, source: TransformSource): boolean {
        switch (source.kind) {
            case 'pile': {
                const carrier = this.gameState.getEntityOrThrow(carrierId, 'carrier reserving a tool pile');
                const material = SPECIALIST_TOOL_MAP[targetUnitType]!;
                if (!this.toolSourceResolver.validatePile(source.pileEntityId, material, carrier.player)) {
                    return false;
                }
                this.toolSourceResolver.reservePile(carrierId, source.pileEntityId);
                return true;
            }
            case 'building':
                return this.toolSourceResolver.reserveBuildingMaterials(
                    carrierId,
                    source.buildingId,
                    source.costs,
                    source.side
                );
            case 'direct':
                return true;
        }
    }

    /** Remove and return the carrier's pending record (and its legacy unit reservation). */
    private takePending(carrierId: number): PendingTransform {
        const p = this.pending.get(carrierId);
        if (!p) {
            throw new Error(`Carrier ${carrierId} has no pending transform`);
        }
        this.pending.delete(carrierId);
        if (p.legacyReserved) {
            this.unitReservation.release(carrierId);
        }
        return p;
    }

    isPending(carrierId: number): boolean {
        return this.pending.has(carrierId);
    }

    getPendingCountByType(unitType: UnitType): number {
        let count = 0;
        for (const p of this.pending.values()) {
            if (p.targetUnitType === unitType) {
                count++;
            }
        }
        return count;
    }

    /**
     * Dismiss a live specialist — convert them back to a carrier and drop their tool on the ground.
     * Returns false if no live specialist of the given type exists for the player.
     */
    dismissSpecialist(unitType: UnitType, toolMaterial: EMaterialType | null, player: number): boolean {
        const target = this.gameState.entityIndex.query(EntityType.Unit, player, unitType).first();
        if (!target) {
            return false;
        }

        const fromType = target.subType as UnitType;
        const { id, x, y } = target;
        this.gameState.changeEntitySubType(id, UnitType.Carrier);
        this.carrierRegistry.register(id);
        this.eventBus.emit('unit:dismissed', { unitId: id, fromType, toType: UnitType.Carrier, level: 'info' });
        log.debug(`Dismissed ${fromType} (entity ${id}), returned to carrier pool`);

        if (toolMaterial !== null) {
            this.dropTool(toolMaterial, x, y);
        }
        return true;
    }

    private dropTool(toolMaterial: EMaterialType, nearX: number, nearY: number): void {
        for (const [dx, dy] of EXTENDED_OFFSETS) {
            const tx = nearX + dx;
            const ty = nearY + dy;
            if (this.gameState.getEntityAt({ x: tx, y: ty })) {
                continue;
            }
            const pile = this.gameState.addEntity(EntityType.StackedPile, toolMaterial, { x: tx, y: ty }, 0);
            this.eventBus.emit('pile:freePilePlaced', { entityId: pile.id, materialType: toolMaterial, quantity: 1 });
            log.debug(`Dropped ${toolMaterial} at (${tx}, ${ty})`);
            return;
        }
        log.warn(`Could not find free tile to drop ${toolMaterial} near (${nearX}, ${nearY})`);
    }

    // =========================================================================
    // Event registration
    // =========================================================================

    registerEvents(): void {
        this.subscriptions.subscribe(
            this.eventBus,
            'recruitment:completed',
            ({ unitId: carrierId, targetUnitType }) => {
                this.handleCompleted(carrierId, targetUnitType);
            }
        );

        this.subscriptions.subscribe(this.eventBus, 'recruitment:failed', ({ unitId: carrierId }) => {
            this.abortTransform(carrierId);
        });
    }

    unregisterEvents(): void {
        this.subscriptions.unsubscribeAll();
    }

    // =========================================================================
    // Event handlers
    // =========================================================================

    /** The TRANSFORM_* executor consumed the source: finish the pile reservation, mutate the unit. */
    private handleCompleted(carrierId: number, targetUnitType: UnitType): void {
        const p = this.takePending(carrierId);
        if (p.source === 'pile') {
            this.toolSourceResolver.releasePile(carrierId);
        }

        const entity = this.gameState.getEntityOrThrow(carrierId, 'UnitTransformer.handleCompleted');
        const fromType = entity.subType as UnitType;
        this.gameState.changeEntitySubType(carrierId, targetUnitType);
        this.carrierRegistry.remove(carrierId);
        entity.carrying = undefined;

        this.eventBus.emit('unit:recruited', { unitId: carrierId, fromType, toType: targetUnitType, level: 'info' });
        log.debug(`Carrier ${carrierId} transformed from ${fromType} to ${targetUnitType}`);
    }
}
