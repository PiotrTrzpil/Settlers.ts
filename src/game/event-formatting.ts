/**
 * Human-readable formatting for game event payloads.
 *
 * Used by the timeline recorder in integration tests and the debug panel.
 * Single import: `import { EventFmt } from '@/game/event-formatting'`
 *
 * Format conventions:
 *   - Entity references:  #42
 *   - Positions:          (12,8)
 *   - Material flow:      LOG ×3 #5→#8
 *   - Flags:              workStarted, wasCarrying
 */

import { BuildingType } from './buildings/building-type';
import { UnitType } from './unit-types';
import { EntityType } from './entity';
import { EMaterialType } from './economy/material-type';
import { CarrierStatus } from './features/carriers/carrier-state';
import type { GameEvents } from './event-bus';

/** Join non-empty parts with spaces. */
function parts(...items: (string | false | null | undefined)[]): string {
    return items.filter(Boolean).join(' ');
}

/**
 * Event formatters keyed by event name.
 * Each method takes the typed event payload and returns a compact one-line summary.
 */
export const EventFmt = {
    'building:placed': (e: GameEvents['building:placed']) =>
        `${BuildingType[e.buildingType]} at (${e.x},${e.y}) player=${e.player}`,

    'building:completed': (e: GameEvents['building:completed']) => BuildingType[e.buildingType],

    'building:removed': (e: GameEvents['building:removed']) => BuildingType[e.buildingType],

    'terrain:modified': () => '',

    'unit:spawned': (e: GameEvents['unit:spawned']) => `${UnitType[e.unitType]} at (${e.x},${e.y})`,

    'unit:movementStopped': (e: GameEvents['unit:movementStopped']) => `dir=${e.direction}`,

    // Verbose movement
    'movement:pathFound': (e: GameEvents['movement:pathFound']) =>
        `(${e.fromX},${e.fromY})→(${e.toX},${e.toY}) len=${e.pathLength}${e.redirect ? ' redirect' : ''}`,

    'movement:pathFailed': (e: GameEvents['movement:pathFailed']) =>
        `(${e.fromX},${e.fromY})→(${e.toX},${e.toY}) NO PATH`,

    'movement:blocked': (e: GameEvents['movement:blocked']) =>
        `at (${e.x},${e.y}) by #${e.blockerId}${e.isBuilding ? ' (building)' : ''}`,

    'movement:escalation': (e: GameEvents['movement:escalation']) => e.result,

    'movement:collisionResolved': (e: GameEvents['movement:collisionResolved']) =>
        parts(
            e.strategy,
            e.success ? 'OK' : 'FAIL',
            `at (${e.x},${e.y})`,
            e.toX !== undefined && `→(${e.toX},${e.toY})`,
            e.targetId !== undefined && `target=#${e.targetId}`
        ),

    // Entity lifecycle
    'entity:created': (e: GameEvents['entity:created']) => {
        let typeName = `sub=${e.subType}`;
        if (e.type === EntityType.Building) typeName = BuildingType[e.subType]!;
        else if (e.type === EntityType.Unit) typeName = UnitType[e.subType]!;
        return `${EntityType[e.type]} ${typeName} at (${e.x},${e.y})`;
    },

    'entity:removed': (e: GameEvents['entity:removed']) => `#${e.entityId}`,

    'settler:taskStarted': (e: GameEvents['settler:taskStarted']) =>
        parts(
            e.jobId,
            e.targetId !== null && `target=#${e.targetId}`,
            e.targetPos && `pos=(${e.targetPos.x},${e.targetPos.y})`,
            e.homeBuilding !== null && `home=#${e.homeBuilding}`
        ),

    'settler:taskCompleted': (e: GameEvents['settler:taskCompleted']) => e.jobId,

    'settler:taskFailed': (e: GameEvents['settler:taskFailed']) =>
        parts(
            e.jobId,
            `step=${e.failedStep}[${e.nodeIndex}]`,
            e.targetId !== null && `target=#${e.targetId}`,
            e.workStarted && 'workStarted',
            e.wasCarrying && 'wasCarrying'
        ),

    'carrier:created': (e: GameEvents['carrier:created']) => `#${e.entityId}`,

    'carrier:removed': (e: GameEvents['carrier:removed']) => parts(`#${e.entityId}`, e.hadActiveJob && 'hadJob'),

    'carrier:statusChanged': (e: GameEvents['carrier:statusChanged']) =>
        `${CarrierStatus[e.previousStatus]}→${CarrierStatus[e.newStatus]}`,

    'carrier:arrivedForPickup': (e: GameEvents['carrier:arrivedForPickup']) => `at #${e.buildingId}`,

    'carrier:arrivedForDelivery': (e: GameEvents['carrier:arrivedForDelivery']) => `at #${e.buildingId}`,

    'carrier:assigned': (e: GameEvents['carrier:assigned']) =>
        `${EMaterialType[e.material]} #${e.sourceBuilding}→#${e.destBuilding}`,

    'carrier:pickupComplete': (e: GameEvents['carrier:pickupComplete']) =>
        `${EMaterialType[e.material]} ×${e.amount} from #${e.fromBuilding}`,

    'carrier:deliveryComplete': (e: GameEvents['carrier:deliveryComplete']) =>
        `${EMaterialType[e.material]} ×${e.amount} to #${e.toBuilding}`,

    'carrier:assignmentFailed': (e: GameEvents['carrier:assignmentFailed']) =>
        parts(
            `${e.reason}:`,
            `${EMaterialType[e.material]} #${e.sourceBuilding}→#${e.destBuilding}`,
            e.carrierId !== undefined && `carrier=#${e.carrierId}`
        ),

    'carrier:pickupFailed': (e: GameEvents['carrier:pickupFailed']) =>
        `${EMaterialType[e.material]} from #${e.fromBuilding}`,

    'inventory:changed': (e: GameEvents['inventory:changed']) =>
        `${EMaterialType[e.materialType]} ${e.previousAmount}→${e.newAmount}`,

    'logistics:noMatch': (e: GameEvents['logistics:noMatch']) => `${EMaterialType[e.materialType]} req=${e.requestId}`,

    'logistics:noCarrier': (e: GameEvents['logistics:noCarrier']) =>
        `${EMaterialType[e.materialType]} #${e.sourceBuilding}→#${e.buildingId}`,

    'logistics:buildingCleanedUp': (e: GameEvents['logistics:buildingCleanedUp']) =>
        `reqs=${e.requestsCancelled} jobs=${e.jobsCancelled}`,

    'logistics:requestCreated': (e: GameEvents['logistics:requestCreated']) =>
        `${EMaterialType[e.materialType]} ×${e.amount} pri=${e.priority}`,

    'production:modeChanged': (e: GameEvents['production:modeChanged']) => `${e.mode}`,

    'tree:planted': (e: GameEvents['tree:planted']) => `at (${e.x},${e.y})`,

    'tree:matured': () => '',
    'tree:cut': () => '',

    'crop:planted': (e: GameEvents['crop:planted']) => `at (${e.x},${e.y})`,

    'crop:matured': () => '',
    'crop:harvested': () => '',

    'construction:diggingStarted': () => '',
    'construction:tileCompleted': (e: GameEvents['construction:tileCompleted']) =>
        `(${e.tileX},${e.tileY}) h=${e.targetHeight}${e.isFootprint ? ' fp' : ' nb'}`,
    'construction:levelingComplete': () => '',

    'construction:workerAssigned': (e: GameEvents['construction:workerAssigned']) => `${e.role} #${e.workerId}`,

    'construction:workerReleased': (e: GameEvents['construction:workerReleased']) => `${e.role} #${e.workerId}`,

    'construction:materialDelivered': (e: GameEvents['construction:materialDelivered']) => EMaterialType[e.material],

    'construction:buildingStarted': () => '',
    'construction:progressComplete': () => '',

    'combat:unitAttacked': (e: GameEvents['combat:unitAttacked']) =>
        `target=#${e.targetId} dmg=${e.damage} hp=${e.remainingHealth}`,

    'combat:unitDefeated': (e: GameEvents['combat:unitDefeated']) => `by #${e.defeatedBy}`,

    'barracks:trainingStarted': (e: GameEvents['barracks:trainingStarted']) => `carrier=#${e.carrierId}`,

    'barracks:trainingCompleted': (e: GameEvents['barracks:trainingCompleted']) =>
        `${UnitType[e.unitType]} L${e.level} → #${e.soldierId}`,

    'barracks:trainingInterrupted': (e: GameEvents['barracks:trainingInterrupted']) => e.reason,
} satisfies { [K in keyof GameEvents]?: (e: GameEvents[K]) => string };
