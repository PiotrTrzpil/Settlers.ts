/**
 * Bottleneck detection — identifies economy bottlenecks and returns actionable diagnostics.
 *
 * Extracted from logistics-snapshot.ts to keep that module under the line limit.
 */

import type { GameState } from '../../game-state';
import type { BuildingInventoryManager } from '../../systems/inventory/building-inventory';
import type { SettlerTaskSystem } from '../settler-tasks/settler-task-system';
import type { SnapshotConfig } from './logistics-snapshot';
import { EntityType } from '../../entity';
import { UnitType, UNIT_TYPE_CONFIG, isUnitTypeMilitary } from '../../core/unit-types';
import { BuildingType } from '../../buildings/building-type';
import { SlotKind } from '../../core/pile-kind';
import { EMaterialType } from '../../economy/material-type';
import { SettlerState } from '../settler-tasks/types';
import { query } from '../../ecs';

export interface BottleneckDiag {
    severity: 'critical' | 'warning' | 'info';
    message: string;
    relatedEntities: number[];
}

function buildingTypeNameSafe(subType: number): string {
    return BuildingType[subType as BuildingType] || `#${subType}`;
}

function unitTypeNameSafe(subType: number): string {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- subType is arbitrary number, not necessarily a valid UnitType
    return UNIT_TYPE_CONFIG[subType as UnitType]?.name ?? `#${subType}`;
}

function entityLabel(gameState: GameState, id: number, nameOf: (sub: number) => string): string {
    const e = gameState.getEntity(id);
    return e ? `${nameOf(e.subType)}#${id}` : `#${id}`;
}

function isNonCarrierWorker(subType: number): boolean {
    return subType !== UnitType.Carrier && !isUnitTypeMilitary(subType as UnitType);
}

function scanBuildings(gameState: GameState, inventoryManager: BuildingInventoryManager, player: number) {
    const fullOutputBuildings: number[] = [];

    for (const entity of gameState.entityIndex.ofTypeAndPlayer(EntityType.Building, player)) {
        if (!inventoryManager.hasSlots(entity.id)) {
            continue;
        }
        const outputs = inventoryManager
            .getSlots(entity.id)
            .filter(
                s =>
                    (s.kind === SlotKind.Output || s.kind === SlotKind.Storage) &&
                    s.materialType !== EMaterialType.NO_MATERIAL
            );
        if (outputs.length > 0 && outputs.every(s => s.currentAmount >= s.maxCapacity)) {
            fullOutputBuildings.push(entity.id);
        }
    }
    return { fullOutputBuildings };
}

function countCarrierStatus(config: SnapshotConfig, player: number) {
    let total = 0;
    let idle = 0;
    for (const [id, , entity] of query(config.carrierRegistry.store, config.gameState.store)) {
        if (entity.player !== player) {
            continue;
        }
        total++;
        if (config.settlerTaskSystem.getActiveJobId(id) === null) {
            idle++;
        }
    }
    return { total, idle };
}

function findIdleWorkers(gameState: GameState, settlerTaskSystem: SettlerTaskSystem, player: number): number[] {
    const idleWorkers: number[] = [];
    for (const entity of gameState.entityIndex.ofTypeAndPlayer(EntityType.Unit, player)) {
        if (!isNonCarrierWorker(entity.subType)) {
            continue;
        }
        if (settlerTaskSystem.getSettlerState(entity.id) === SettlerState.IDLE) {
            idleWorkers.push(entity.id);
        }
    }
    return idleWorkers;
}

/**
 * Detect economy bottlenecks and return actionable diagnostics.
 */
export function detectBottlenecks(config: SnapshotConfig, player: number): BottleneckDiag[] {
    const { gameState, inventoryManager, settlerTaskSystem } = config;
    const diags: BottleneckDiag[] = [];

    const { fullOutputBuildings } = scanBuildings(gameState, inventoryManager, player);
    const carriers = countCarrierStatus(config, player);
    const demandCount = config.demandQueue.size;
    const idleWorkers = findIdleWorkers(gameState, settlerTaskSystem, player);

    emitBottleneckDiags(diags, gameState, fullOutputBuildings, carriers, demandCount, idleWorkers);
    return diags;
}

function emitBottleneckDiags(
    diags: BottleneckDiag[],
    gameState: GameState,
    fullOutputBuildings: number[],
    carriers: { total: number; idle: number },
    demandCount: number,
    idleWorkers: number[]
): void {
    if (fullOutputBuildings.length > 0) {
        const names = fullOutputBuildings.map(id => entityLabel(gameState, id, buildingTypeNameSafe)).join(', ');
        diags.push({
            severity: 'warning',
            message: `${fullOutputBuildings.length} building(s) with full output: ${names}`,
            relatedEntities: fullOutputBuildings,
        });
    }

    if (carriers.total === 0) {
        diags.push({
            severity: 'critical',
            message: 'No carriers registered — logistics cannot operate',
            relatedEntities: [],
        });
    } else if (carriers.idle > 0 && demandCount > 0) {
        diags.push({
            severity: 'warning',
            message: `${carriers.idle} idle carrier(s) but ${demandCount} pending demand(s) — check supply/territory`,
            relatedEntities: [],
        });
    }

    if (idleWorkers.length > 0) {
        const names = idleWorkers
            .slice(0, 5)
            .map(id => entityLabel(gameState, id, unitTypeNameSafe))
            .join(', ');
        const suffix = idleWorkers.length > 5 ? ` (+${idleWorkers.length - 5} more)` : '';
        diags.push({
            severity: 'warning',
            message: `${idleWorkers.length} idle worker(s): ${names}${suffix}`,
            relatedEntities: idleWorkers,
        });
    }

    if (diags.length === 0) {
        diags.push({ severity: 'info', message: 'No bottlenecks detected', relatedEntities: [] });
    }
}
