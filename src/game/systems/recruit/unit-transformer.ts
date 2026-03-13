/**
 * UnitTransformer — orchestrates the full carrier-to-specialist transformation lifecycle.
 *
 * Two usage modes:
 *
 * 1. assignAndRegisterTransform() — caller provides the pre-built choreo job and the
 *    tool pile. This method assigns the job, reserves carrier + pile, and registers
 *    the pending state. Used by RecruitSystem (player-queued).
 *
 * 2. registerTransform() + caller-assigned job — caller builds their own combined
 *    choreo (e.g. RECRUIT_DIGGER = walk-to-pile → TRANSFORM_RECRUIT → walk-to-site → DIG),
 *    assigns it, then calls registerTransform() to register the pending state.
 *    Used by ConstructionSiteDemandSystem and BuildingDemandSystem.
 *
 * Both paths converge on the same completion flow:
 *
 *   recruitment:completed (from TRANSFORM_RECRUIT choreo node)
 *     → release carrier reservation + tool pile reservation
 *     → mutate entity subType, remove from carrier registry
 *     → emit unit:transformed
 *     → choreo continues with remaining nodes (caller's continuation)
 *
 *   recruitment:failed / settler:taskFailed (any job with pending carrier)
 *     → release carrier + tool reservations
 *     → drop pending record (carrier returns to idle pool)
 *
 *   entity:removed while pending
 *     → UnitReservationRegistry.onForcedRelease → tool pile released, record dropped
 */

import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import { EventSubscriptionManager } from '../../event-bus';
import type { ChoreoJobState } from '../choreo';
import { EntityType, EXTENDED_OFFSETS } from '../../entity';

import { UnitType } from '../../core/unit-types';
import { EMaterialType } from '../../economy/material-type';
import type { CarrierRegistry } from '../carrier-registry';
import type { UnitReservationRegistry } from '../unit-reservation';
import { createLogger } from '@/utilities/logger';
import { createDirectTransformJob } from './recruitment-job';
import { ToolSourceResolver } from './tool-source-resolver';

const log = createLogger('UnitTransformer');

export interface UnitTransformerConfig {
    gameState: GameState;
    eventBus: EventBus;
    carrierRegistry: CarrierRegistry;
    toolSourceResolver: ToolSourceResolver;
    assignJob: (unitId: number, job: ChoreoJobState, moveTo?: { x: number; y: number }) => boolean;
    unitReservation: UnitReservationRegistry;
}

interface PendingTransform {
    carrierId: number;
    targetUnitType: UnitType;
    toolMaterial: EMaterialType | null;
    pileEntityId: number;
}

export class UnitTransformer {
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly carrierRegistry: CarrierRegistry;
    private readonly toolSourceResolver: ToolSourceResolver;
    private readonly assignJob: (unitId: number, job: ChoreoJobState, moveTo?: { x: number; y: number }) => boolean;
    private readonly unitReservation: UnitReservationRegistry;
    private readonly subscriptions = new EventSubscriptionManager();

    /** Carriers currently walking to a tool pile to transform. carrierId → record. */
    private readonly pending = new Map<number, PendingTransform>();

    constructor(config: UnitTransformerConfig) {
        this.gameState = config.gameState;
        this.eventBus = config.eventBus;
        this.carrierRegistry = config.carrierRegistry;
        this.toolSourceResolver = config.toolSourceResolver;
        this.assignJob = config.assignJob;
        this.unitReservation = config.unitReservation;
    }

    // =========================================================================
    // Public API
    // =========================================================================

    /**
     * Assign a pre-built recruitment job and register the pending transform.
     *
     * The caller has already found the best (carrier, toolPile) pair and built
     * the choreo job. This method assigns the job to the carrier, reserves both
     * the carrier and the tool pile, and registers the pending state.
     *
     * Returns true if the job was successfully assigned.
     */
    assignAndRegisterTransform(
        carrierId: number,
        job: ChoreoJobState,
        targetUnitType: UnitType,
        toolMaterial: EMaterialType,
        toolPile: { pileEntityId: number; x: number; y: number }
    ): boolean {
        const assigned = this.assignJob(carrierId, job, { x: toolPile.x, y: toolPile.y });
        if (!assigned) {
            return false;
        }

        this.registerTransform(carrierId, targetUnitType, toolMaterial, toolPile.pileEntityId);

        log.debug(
            `Carrier ${carrierId} dispatched to transform into ${targetUnitType} (pile ${toolPile.pileEntityId})`
        );
        return true;
    }

    /**
     * Attempt to initiate a carrier → specialist transformation without requiring a tool pile.
     *
     * Assigns a TRANSFORM_DIRECT choreography job to the carrier and reserves it.
     * Used when the specialist type requires no tool (e.g. promoted via UI).
     *
     * Returns true if the transformation was successfully initiated.
     * Returns false if the job could not be assigned.
     */
    requestDirectTransform(carrierId: number, targetUnitType: UnitType, _player: number): boolean {
        const job = createDirectTransformJob(targetUnitType);
        // No moveTo — carrier transforms in place; passing own position causes moveUnit to fail
        const assigned = this.assignJob(carrierId, job);
        if (!assigned) {
            return false;
        }

        const record: PendingTransform = {
            carrierId,
            targetUnitType,
            toolMaterial: null,
            pileEntityId: -1,
        };
        this.pending.set(carrierId, record);
        this.unitReservation.reserve(carrierId, {
            purpose: 'unit-transform',
            onForcedRelease: unitId => {
                const p = this.pending.get(unitId);
                if (!p) {
                    return;
                }
                if (p.pileEntityId !== -1) {
                    this.toolSourceResolver.release(p.pileEntityId);
                }
                this.pending.delete(unitId);
                log.debug(`Carrier ${unitId} removed during direct transform, reservation auto-released`);
            },
        });

        log.debug(`Carrier ${carrierId} dispatched for direct transform into ${targetUnitType}`);
        return true;
    }

    /**
     * Register a pending carrier → specialist transformation without building or assigning
     * a choreo job. The caller is responsible for building the combined choreo job (which
     * must include a TRANSFORM_RECRUIT node) and assigning it before calling this method.
     *
     * Reserves the carrier and tool pile so they can't be grabbed by other systems.
     * When the TRANSFORM_RECRUIT node fires `recruitment:completed`, this class handles
     * the type mutation as usual.
     */
    registerTransform(
        carrierId: number,
        targetUnitType: UnitType,
        toolMaterial: EMaterialType,
        pileEntityId: number
    ): void {
        const record: PendingTransform = {
            carrierId,
            targetUnitType,
            toolMaterial,
            pileEntityId,
        };
        this.pending.set(carrierId, record);
        this.toolSourceResolver.reserve(pileEntityId);
        this.unitReservation.reserve(carrierId, {
            purpose: 'unit-transform',
            onForcedRelease: unitId => {
                const p = this.pending.get(unitId);
                if (!p) {
                    return;
                }
                this.toolSourceResolver.release(p.pileEntityId);
                this.pending.delete(unitId);
                log.debug(`Carrier ${unitId} removed during transform, reservation auto-released`);
            },
        });

        log.debug(`Registered pending transform: carrier ${carrierId} → ${targetUnitType} (pile ${pileEntityId})`);
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
        let target = null;
        for (const entity of this.gameState.entities) {
            if (entity.type === EntityType.Unit && entity.subType === unitType && entity.player === player) {
                target = entity;
                break;
            }
        }
        if (!target) {
            return false;
        }

        const fromType = target.subType as UnitType;
        const { id, x, y } = target;
        target.subType = UnitType.Carrier;
        this.carrierRegistry.register(id);
        this.eventBus.emit('unit:transformed', { unitId: id, fromType, toType: UnitType.Carrier, level: 'info' });
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
            if (this.gameState.getEntityAt(tx, ty)) {
                continue;
            }
            const pile = this.gameState.addEntity(EntityType.StackedPile, toolMaterial, tx, ty, 0);
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
            this.handleFailed(carrierId);
        });

        this.subscriptions.subscribe(this.eventBus, 'settler:taskFailed', payload => {
            if (this.pending.has(payload.unitId)) {
                this.eventBus.emit('recruitment:failed', {
                    unitId: payload.unitId,
                    reason: payload.failedStep,
                    level: 'warn',
                });
            }
        });
    }

    unregisterEvents(): void {
        this.subscriptions.unsubscribeAll();
    }

    // =========================================================================
    // Event handlers
    // =========================================================================

    private handleCompleted(carrierId: number, targetUnitType: UnitType): void {
        const p = this.pending.get(carrierId);
        if (!p) {
            log.warn(`recruitment:completed for unknown carrier ${carrierId}`);
            return;
        }

        this.unitReservation.release(carrierId);
        if (p.pileEntityId !== -1) {
            this.toolSourceResolver.release(p.pileEntityId);
        }
        this.pending.delete(carrierId);

        const entity = this.gameState.getEntityOrThrow(carrierId, 'UnitTransformer.handleCompleted');
        const fromType = entity.subType as UnitType;
        entity.subType = targetUnitType;
        this.carrierRegistry.remove(carrierId);
        entity.carrying = undefined;

        this.eventBus.emit('unit:transformed', { unitId: carrierId, fromType, toType: targetUnitType, level: 'info' });
        log.debug(`Carrier ${carrierId} transformed from ${fromType} to ${targetUnitType}`);
    }

    private handleFailed(carrierId: number): void {
        const p = this.pending.get(carrierId);
        if (!p) {
            return;
        }

        this.unitReservation.release(carrierId);
        if (p.pileEntityId !== -1) {
            this.toolSourceResolver.release(p.pileEntityId);
        }
        this.pending.delete(carrierId);

        log.debug(`Transform failed for carrier ${carrierId}`);
    }
}
