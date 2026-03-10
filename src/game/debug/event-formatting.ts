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

import { BuildingType } from '../buildings/building-type';
import { UnitType } from '../core/unit-types';
import { EntityType } from '../entity';
import { EMaterialType } from '../economy/material-type';
import type { GameEvents } from '../event-bus';

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

    'movement:step': (e: GameEvents['movement:step']) => `(${e.x},${e.y}) [${e.pathIdx}/${e.pathLen}]`,

    'movement:bumpAttempt': (e: GameEvents['movement:bumpAttempt']) =>
        parts(`→#${e.occupantId}`, e.hasController ? `state=${e.occupantState}` : 'NO_CTRL', e.occupantBusy && 'busy'),

    'movement:bumpFailed': (e: GameEvents['movement:bumpFailed']) =>
        parts(
            `→#${e.occupantId}`,
            e.reason,
            e.occupantState && `state=${e.occupantState}`,
            e.occupantBusy && 'busy',
            e.occupantPos && `at (${e.occupantPos})`
        ),

    'movement:bump': (e: GameEvents['movement:bump']) =>
        `#${e.bumperId} pushed #${e.occupantId} (${e.fromX},${e.fromY})→(${e.toX},${e.toY})`,

    // Entity lifecycle
    'entity:created': (e: GameEvents['entity:created']) => {
        let typeName = `sub=${e.subType}`;
        if (e.type === EntityType.Building) typeName = BuildingType[e.subType]!;
        else if (e.type === EntityType.Unit) typeName = UnitType[e.subType]!;
        return `${EntityType[e.type]} ${typeName} at (${e.x},${e.y})`;
    },

    'entity:removed': (e: GameEvents['entity:removed']) => `#${e.entityId}`,

    // Verbose choreography
    'choreo:nodeStarted': (e: GameEvents['choreo:nodeStarted']) =>
        parts(
            `${e.task}[${e.nodeIndex}/${e.nodeCount}]`,
            e.jobPart && `anim=${e.jobPart}`,
            e.duration > 0 && `dur=${e.duration}`
        ),

    'choreo:nodeCompleted': (e: GameEvents['choreo:nodeCompleted']) => `${e.task}[${e.nodeIndex}]`,

    'choreo:animationApplied': (e: GameEvents['choreo:animationApplied']) =>
        parts(e.jobPart, `→${e.sequenceKey}`, e.loop && 'loop'),

    'choreo:waitingAtHome': (e: GameEvents['choreo:waitingAtHome']) => `home=#${e.homeBuilding} ${e.reason}`,

    'choreo:idleSkipped': (e: GameEvents['choreo:idleSkipped']) =>
        parts(e.reason, e.homeBuilding !== null && `home=#${e.homeBuilding}`),

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

    'carrier:removed': (e: GameEvents['carrier:removed']) => `#${e.entityId}`,

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
    'storage:directionChanged': (e: GameEvents['storage:directionChanged']) =>
        `#${e.buildingId} ${EMaterialType[e.materialType]}`,

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

    'construction:workerNeeded': (e: GameEvents['construction:workerNeeded']) =>
        `${e.role} @ (${e.tileX},${e.tileY}) player=${e.player}`,

    'construction:materialDelivered': (e: GameEvents['construction:materialDelivered']) => EMaterialType[e.material],

    'construction:materialOverflowed': (e: GameEvents['construction:materialOverflowed']) =>
        `${EMaterialType[e.material]} x${e.amount}`,

    'construction:buildingStarted': () => '',
    'construction:progressComplete': () => '',

    'combat:unitAttacked': (e: GameEvents['combat:unitAttacked']) =>
        `target=#${e.targetId} dmg=${e.damage} hp=${e.remainingHealth}`,

    'combat:unitDefeated': (e: GameEvents['combat:unitDefeated']) => `by #${e.defeatedBy}`,

    'barracks:trainingStarted': (e: GameEvents['barracks:trainingStarted']) => `carrier=#${e.carrierId}`,

    'barracks:trainingCompleted': (e: GameEvents['barracks:trainingCompleted']) =>
        `${UnitType[e.unitType]} L${e.level} → #${e.soldierId}`,

    'barracks:trainingInterrupted': (e: GameEvents['barracks:trainingInterrupted']) => e.reason,

    'carrier:transportCancelled': (e: GameEvents['carrier:transportCancelled']) => `req=${e.requestId} ${e.reason}`,

    'logistics:requestRemoved': (e: GameEvents['logistics:requestRemoved']) => `req=${e.requestId}`,

    'logistics:requestAssigned': (e: GameEvents['logistics:requestAssigned']) =>
        `req=${e.requestId} carrier=#${e.carrierId} src=#${e.sourceBuilding}`,

    'logistics:requestFulfilled': (e: GameEvents['logistics:requestFulfilled']) =>
        `${EMaterialType[e.materialType]} req=${e.requestId}`,

    'logistics:requestReset': (e: GameEvents['logistics:requestReset']) =>
        `${EMaterialType[e.materialType]} req=${e.requestId} ${e.reason}`,

    'pile:freePilePlaced': (e: GameEvents['pile:freePilePlaced']) =>
        `#${e.entityId} ${EMaterialType[e.materialType]} ×${e.quantity}`,

    'pile:buildingPilesConverted': (e: GameEvents['pile:buildingPilesConverted']) =>
        `building=#${e.buildingId} ${e.piles.size} piles`,

    'recruitment:started': (e: GameEvents['recruitment:started']) =>
        `carrier=#${e.carrierId} → ${UnitType[e.targetUnitType]} pile=#${e.pileEntityId} site=#${e.siteId}`,

    'recruitment:completed': (e: GameEvents['recruitment:completed']) =>
        `carrier=#${e.carrierId} → ${UnitType[e.targetUnitType]}`,

    'recruitment:failed': (e: GameEvents['recruitment:failed']) => `carrier=#${e.carrierId} ${e.reason}`,

    'unit:transformed': (e: GameEvents['unit:transformed']) =>
        `#${e.entityId} ${UnitType[e.fromType]} → ${UnitType[e.toType]}`,

    'garrison:unitEntered': (e: GameEvents['garrison:unitEntered']) =>
        `unit=#${e.unitId} entered tower=#${e.buildingId}`,
    'garrison:unitExited': (e: GameEvents['garrison:unitExited']) => `unit=#${e.unitId} exited tower=#${e.buildingId}`,
    'garrison:bowmanFired': (e: GameEvents['garrison:bowmanFired']) =>
        `bowman=#${e.bowmanId} in tower=#${e.buildingId} fired at #${e.targetId} for ${e.damage} dmg`,
    'settler-location:approachInterrupted': (e: GameEvents['settler-location:approachInterrupted']) =>
        `settler=#${e.settlerId} approach interrupted by building=#${e.buildingId} removal`,
    'settler-location:entered': (e: GameEvents['settler-location:entered']) =>
        `settler=#${e.settlerId} entered building=#${e.buildingId}`,

    'siege:started': (e: GameEvents['siege:started']) => `building=#${e.buildingId} attacker=player${e.attackerPlayer}`,
    'siege:defenderEjected': (e: GameEvents['siege:defenderEjected']) =>
        `defender=#${e.defenderId} from building=#${e.buildingId}`,
    'siege:buildingCaptured': (e: GameEvents['siege:buildingCaptured']) =>
        `building=#${e.buildingId} player${e.oldPlayer}→player${e.newPlayer}`,
    'building:ownerChanged': (e: GameEvents['building:ownerChanged']) =>
        `#${e.entityId} ${BuildingType[e.buildingType]} player${e.oldPlayer}→player${e.newPlayer}`,

    'building:workerSpawned': (e: GameEvents['building:workerSpawned']) =>
        `building=${e.buildingId} settler=${e.settlerId}`,
    'building:workerLost': (e: GameEvents['building:workerLost']) =>
        `building=${e.buildingId} settler=${e.settlerId} player=${e.player}`,
    'game:playerEliminated': (e: GameEvents['game:playerEliminated']) => `player ${e.player} eliminated`,
    'game:ended': (e: GameEvents['game:ended']) => `winner=${e.winner ?? 'none'} reason=${e.reason}`,
} satisfies { [K in keyof GameEvents]: (e: GameEvents[K]) => string };
