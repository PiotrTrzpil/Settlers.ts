/**
 * UnitTransformer — orchestrates the full carrier-to-specialist transformation lifecycle.
 *
 * Handles everything from "this carrier should become a Builder" to the unit actually
 * changing type:
 *
 *   requestTransform()
 *     → find nearest available tool pile
 *     → reserve carrier (UnitReservationRegistry)
 *     → reserve tool pile (ToolSourceResolver)
 *     → assign recruitment choreography job
 *     → track as pending
 *
 *   recruitment:completed (from TRANSFORM_RECRUIT choreo node)
 *     → release carrier reservation
 *     → release tool pile reservation
 *     → mutate entity subType, remove from carrier registry
 *     → emit unit:transformed
 *
 *   recruitment:failed / settler:taskFailed(AUTO_RECRUIT)
 *     → release carrier + tool reservations
 *     → drop pending record (carrier returns to idle pool)
 *
 *   entity:removed while pending
 *     → UnitReservationRegistry.onForcedRelease → tool pile released, record dropped
 *
 * AutoRecruitSystem is a pure policy layer that calls requestTransform() and queries
 * getPendingCountByType() — it owns no pending state itself.
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
import type { Persistable } from '@/game/persistence';
import type { SerializedUnitTransformer } from '@/game/state/game-state-persistence';
import { createLogger } from '@/utilities/logger';
import { createRecruitmentJob, createDirectTransformJob } from './recruitment-job';
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

export class UnitTransformer implements Persistable<SerializedUnitTransformer> {
    readonly persistKey = 'unitTransformer' as const;

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
     * Attempt to initiate a carrier → specialist transformation.
     *
     * Finds the nearest unreserved tool pile for the given tool material near (nearX, nearY),
     * assigns the recruitment choreography job to the carrier, and reserves both
     * the carrier and the tool pile.
     *
     * Returns true if the transformation was successfully initiated.
     * Returns false if no tool pile was found or the job could not be assigned.
     */
    requestTransform(
        carrierId: number,
        targetUnitType: UnitType,
        toolMaterial: EMaterialType,
        nearX: number,
        nearY: number,
        player: number
    ): boolean {
        const toolSource = this.toolSourceResolver.findNearestToolPile(toolMaterial, nearX, nearY, player);
        if (!toolSource) return false;

        const job = createRecruitmentJob(toolSource.pileEntityId, toolSource.x, toolSource.y, targetUnitType);
        const assigned = this.assignJob(carrierId, job, { x: toolSource.x, y: toolSource.y });
        if (!assigned) return false;

        const record: PendingTransform = {
            carrierId,
            targetUnitType,
            toolMaterial,
            pileEntityId: toolSource.pileEntityId,
        };
        this.pending.set(carrierId, record);
        this.toolSourceResolver.reserve(toolSource.pileEntityId);
        this.unitReservation.reserve(carrierId, {
            purpose: 'unit-transform',
            onForcedRelease: unitId => {
                const p = this.pending.get(unitId);
                if (!p) return;
                this.toolSourceResolver.release(p.pileEntityId);
                this.pending.delete(unitId);
                log.debug(`Carrier ${unitId} removed during transform, reservation auto-released`);
            },
        });

        log.debug(
            `Carrier ${carrierId} dispatched to transform into ${UnitType[targetUnitType]} (pile ${toolSource.pileEntityId})`
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
        if (!assigned) return false;

        const record: PendingTransform = { carrierId, targetUnitType, toolMaterial: null, pileEntityId: -1 };
        this.pending.set(carrierId, record);
        this.unitReservation.reserve(carrierId, {
            purpose: 'unit-transform',
            onForcedRelease: unitId => {
                const p = this.pending.get(unitId);
                if (!p) return;
                if (p.pileEntityId !== -1) this.toolSourceResolver.release(p.pileEntityId);
                this.pending.delete(unitId);
                log.debug(`Carrier ${unitId} removed during direct transform, reservation auto-released`);
            },
        });

        log.debug(`Carrier ${carrierId} dispatched for direct transform into ${UnitType[targetUnitType]}`);
        return true;
    }

    isPending(carrierId: number): boolean {
        return this.pending.has(carrierId);
    }

    getPendingCountByType(unitType: UnitType): number {
        let count = 0;
        for (const p of this.pending.values()) {
            if (p.targetUnitType === unitType) count++;
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
        if (!target) return false;

        const fromType = target.subType as UnitType;
        const { id, x, y } = target;
        target.subType = UnitType.Carrier;
        this.carrierRegistry.register(id);
        this.eventBus.emit('unit:transformed', { entityId: id, fromType, toType: UnitType.Carrier });
        log.debug(`Dismissed ${UnitType[fromType]} (entity ${id}), returned to carrier pool`);

        if (toolMaterial !== null) {
            this.dropTool(toolMaterial, x, y);
        }
        return true;
    }

    private dropTool(toolMaterial: EMaterialType, nearX: number, nearY: number): void {
        for (const [dx, dy] of EXTENDED_OFFSETS) {
            const tx = nearX + dx;
            const ty = nearY + dy;
            if (this.gameState.getEntityAt(tx, ty)) continue;
            const pile = this.gameState.addEntity(EntityType.StackedPile, toolMaterial as number, tx, ty, 0);
            const pileState = this.gameState.piles.states.get(pile.id);
            if (pileState) pileState.quantity = 1;
            this.eventBus.emit('pile:freePilePlaced', { entityId: pile.id, materialType: toolMaterial, quantity: 1 });
            log.debug(`Dropped ${EMaterialType[toolMaterial]} at (${tx}, ${ty})`);
            return;
        }
        log.warn(`Could not find free tile to drop ${EMaterialType[toolMaterial]} near (${nearX}, ${nearY})`);
    }

    // =========================================================================
    // Event registration
    // =========================================================================

    registerEvents(): void {
        this.subscriptions.subscribe(this.eventBus, 'recruitment:completed', ({ carrierId, targetUnitType }) => {
            this.handleCompleted(carrierId, targetUnitType);
        });

        this.subscriptions.subscribe(this.eventBus, 'recruitment:failed', ({ carrierId }) => {
            this.handleFailed(carrierId);
        });

        this.subscriptions.subscribe(this.eventBus, 'settler:taskFailed', payload => {
            if (payload.jobId === 'AUTO_RECRUIT') {
                this.eventBus.emit('recruitment:failed', { carrierId: payload.unitId, reason: payload.failedStep });
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
        if (p.pileEntityId !== -1) this.toolSourceResolver.release(p.pileEntityId);
        this.pending.delete(carrierId);

        const entity = this.gameState.getEntityOrThrow(carrierId, 'UnitTransformer.handleCompleted');
        const fromType = entity.subType as UnitType;
        entity.subType = targetUnitType;
        this.carrierRegistry.remove(carrierId);
        entity.carrying = undefined;

        this.eventBus.emit('unit:transformed', { entityId: carrierId, fromType, toType: targetUnitType });
        log.debug(`Carrier ${carrierId} transformed from ${UnitType[fromType]} to ${UnitType[targetUnitType]}`);
    }

    private handleFailed(carrierId: number): void {
        const p = this.pending.get(carrierId);
        if (!p) return;

        this.unitReservation.release(carrierId);
        if (p.pileEntityId !== -1) this.toolSourceResolver.release(p.pileEntityId);
        this.pending.delete(carrierId);

        log.debug(`Transform failed for carrier ${carrierId}`);
    }

    // =========================================================================
    // Persistable
    // =========================================================================

    serialize(): SerializedUnitTransformer {
        const pendingTransforms: SerializedUnitTransformer['pendingTransforms'] = [];
        for (const p of this.pending.values()) {
            pendingTransforms.push({
                carrierId: p.carrierId,
                targetUnitType: p.targetUnitType as number,
                toolMaterial: p.toolMaterial !== null ? (p.toolMaterial as number) : -1,
                pileEntityId: p.pileEntityId,
            });
        }
        return { pendingTransforms };
    }

    deserialize(data: SerializedUnitTransformer): void {
        this.pending.clear();
        for (const entry of data.pendingTransforms) {
            const carrierId = entry.carrierId;
            const record: PendingTransform = {
                carrierId,
                targetUnitType: entry.targetUnitType as UnitType,
                toolMaterial: entry.toolMaterial === -1 ? null : (entry.toolMaterial as EMaterialType),
                pileEntityId: entry.pileEntityId,
            };
            this.pending.set(carrierId, record);
            // Restore tool pile reservation (skip for direct transforms where pileEntityId === -1)
            if (entry.pileEntityId !== -1) this.toolSourceResolver.reserve(entry.pileEntityId);
            // Restore carrier reservation so it cannot be interrupted after load
            this.unitReservation.reserve(carrierId, {
                purpose: 'unit-transform',
                onForcedRelease: unitId => {
                    const p = this.pending.get(unitId);
                    if (!p) return;
                    if (p.pileEntityId !== -1) this.toolSourceResolver.release(p.pileEntityId);
                    this.pending.delete(unitId);
                },
            });
        }
    }
}
