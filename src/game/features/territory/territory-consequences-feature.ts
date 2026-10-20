/**
 * Territory Consequences Feature — reacts to territory ownership changes.
 *
 * When territory changes after a tower capture, buildings of the losing player
 * on lost territory are destroyed, and free civilian units (not assigned to
 * a building) are displaced to the nearest friendly territory tile.
 *
 * Separate from TerritoryFeature because it needs settler-tasks (worker
 * assignments), while settler-tasks itself depends on territory.
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import type { BuildingType } from '../../buildings/types';
import { EntityType } from '../../entity';
import type { Tile } from '../../core/coordinates';
import { bfsFind } from '../../core/tile-search';
import { isUnitTypeMilitary, UnitCategory, getUnitCategory, type UnitType } from '../../core/unit-types';
import type { SettlerTaskExports } from '../settler-tasks';
import type { TerritoryManager, TerritoryChange } from './territory-manager';
import type { TerritoryExports } from './territory-feature';
import { TERRITORY_BUILDINGS } from './territory-types';
import { createLogger } from '@/utilities/logger';

const log = createLogger('TerritoryConsequences');

/**
 * BFS tile limit for the survival check. Workers with no friendly territory
 * within this range die immediately after a territory change.
 */
const SURVIVAL_SEARCH_RADIUS = 1000;

export const TerritoryConsequencesFeature: FeatureDefinition = {
    id: 'territory-consequences',
    dependencies: ['territory', 'settler-tasks'],

    create(ctx: FeatureContext) {
        const { territoryManager } = ctx.getFeature<TerritoryExports>('territory');

        // Deferred to next tick: recompute fires lazily inside other systems'
        // queries, so destroying buildings mid-query causes re-entrancy bugs.
        territoryManager.onTerritoryChanged = (changes: TerritoryChange[]) => {
            ctx.tickScheduler.deferNextTick(() => {
                handleTerritoryChanges(ctx, territoryManager, changes);
            });
        };

        return { persistence: 'none' };
    },
};

/**
 * Handle territory tile ownership changes after recomputation.
 * Finds buildings and units on tiles that changed from one player to another
 * and destroys/displaces them.
 */
function handleTerritoryChanges(
    ctx: FeatureContext,
    territoryManager: TerritoryManager,
    changes: TerritoryChange[]
): void {
    // Build a set of (oldOwner → newOwner) player pairs that actually changed
    // to quickly skip irrelevant entities
    const affectedPlayers = new Set<number>();
    for (const change of changes) {
        if (change.oldOwner >= 0) {
            affectedPlayers.add(change.oldOwner);
        }
    }
    if (affectedPlayers.size === 0) {
        return;
    }

    destroyBuildingsOnLostTerritory(ctx, territoryManager, affectedPlayers);
    displaceOrKillUnitsOnLostTerritory(ctx, territoryManager, affectedPlayers);
}

/** Check if a non-territory building should be destroyed due to lost territory. */
function isBuildingOnLostTerritory(ctx: FeatureContext, tm: TerritoryManager, id: number, player: number): boolean {
    const entity = ctx.gameState.getEntity(id);
    if (!entity) {
        return false;
    }
    if (TERRITORY_BUILDINGS.has(entity.subType as BuildingType)) {
        return false;
    }
    return !tm.isInTerritory(entity, player);
}

/**
 * Destroy non-territory buildings belonging to players who lost territory,
 * if those buildings no longer sit on their player's territory.
 */
function destroyBuildingsOnLostTerritory(
    ctx: FeatureContext,
    tm: TerritoryManager,
    affectedPlayers: ReadonlySet<number>
): void {
    const toRemove: number[] = [];

    for (const player of affectedPlayers) {
        const buildingIds = ctx.gameState.entityIndex.idsOfTypeAndPlayer(EntityType.Building, player);
        for (const id of buildingIds) {
            if (isBuildingOnLostTerritory(ctx, tm, id, player)) {
                toRemove.push(id);
            }
        }
    }

    for (const id of toRemove) {
        log.info(`Destroying building ${id} — on lost territory`);
        ctx.executeCommand({ type: 'remove_entity', entityId: id });
    }
}

/** Check if a non-military unit is on lost territory. */
function isUnitOnLostTerritory(ctx: FeatureContext, tm: TerritoryManager, id: number, player: number): boolean {
    const entity = ctx.gameState.getEntity(id);
    if (!entity || entity.hidden) {
        return false;
    }
    if (isUnitTypeMilitary(entity.subType as UnitType)) {
        return false;
    }
    return !tm.isInTerritory(entity, player);
}

/**
 * Handle non-military units on lost territory:
 * - Free civilians (no building assignment) are displaced to the nearest friendly tile.
 * - If no friendly territory exists within BFS range, the unit dies immediately
 *   (workers AND specialists — only military survives total territory loss).
 */
function displaceOrKillUnitsOnLostTerritory(
    ctx: FeatureContext,
    tm: TerritoryManager,
    affectedPlayers: ReadonlySet<number>
): void {
    const { settlerTaskSystem } = ctx.getFeature<SettlerTaskExports>('settler-tasks');
    const getAssigned = settlerTaskSystem.getAssignedBuilding.bind(settlerTaskSystem);
    const toKill: number[] = [];

    for (const player of affectedPlayers) {
        const unitIds = ctx.gameState.entityIndex.idsOfTypeAndPlayer(EntityType.Unit, player);
        for (const id of unitIds) {
            if (!isUnitOnLostTerritory(ctx, tm, id, player)) {
                continue;
            }
            const action = resolveUnitFate(ctx, tm, id, player, getAssigned);
            if (action === 'kill') {
                toKill.push(id);
            }
        }
    }

    for (const id of toKill) {
        log.info(`Killing unit ${id} — no friendly territory reachable`);
        ctx.eventBus.emit('combat:unitDefeated', { unitId: id, defeatedBy: -1, level: 'info' });
        ctx.executeCommand({ type: 'remove_entity', entityId: id });
    }
}

/** Decide what happens to a non-military unit on lost territory. */
function resolveUnitFate(
    ctx: FeatureContext,
    tm: TerritoryManager,
    id: number,
    player: number,
    getAssigned: (unitId: number) => number | null
): 'kill' | 'displace' | 'none' {
    const entity = ctx.gameState.getEntity(id)!;
    const nearby = findNearestFriendlyTile(tm, entity.x, entity.y, player, SURVIVAL_SEARCH_RADIUS);

    if (!nearby && getUnitCategory(entity.subType as UnitType) === UnitCategory.Worker) {
        return 'kill';
    }

    // Free civilian with reachable territory — displace
    if (nearby && getAssigned(id) === null) {
        const target = findNearestFriendlyTile(tm, entity.x, entity.y, player);
        if (target) {
            ctx.executeCommand({ type: 'move_unit', entityId: id, targetX: target.x, targetY: target.y });
            return 'displace';
        }
    }

    // Building-assigned workers with reachable territory: handled by their building
    return 'none';
}

/** BFS search for the nearest tile owned by the given player. */
function findNearestFriendlyTile(
    tm: TerritoryManager,
    startX: number,
    startY: number,
    player: number,
    maxSearch = 2000
): Tile | null {
    return bfsFind({ x: startX, y: startY }, tile => tm.isInTerritory(tile, player), maxSearch);
}
