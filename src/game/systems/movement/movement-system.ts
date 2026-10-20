import { tileKey, type Tile } from '../../core/coordinates';
import { MovementController, MovementState } from './movement-controller';
import { findPathAStar, type PathfindingFailureInfo, type PathFindResult } from '../pathfinding';
import type { TickSystem } from '../../core/tick-system';
import type { EventBus } from '../../event-bus';
import { type ComponentStore, mapStore } from '../../ecs';
import { LogHandler } from '@/utilities/log-handler';
import type { SeededRng } from '../../core/rng';
import { BumpResolver, type BumpResolverDeps } from './bump-resolver';
import { runCrowdDispersal, clearDispersalCooldown } from './crowd-dispersal';
import { occupantAt, relocateOccupant } from './occupancy';

const log = new LogHandler('MovementSystem');

/** After waiting this long, repath around the blocker. */
const REPATH_WAIT_TIMEOUT = 0.5;
/** After this long, clear the path and let the task system reassign. */
const GIVEUP_WAIT_TIMEOUT = 2.0;

export type UpdatePositionFn = (entityId: number, newPos: Tile) => boolean;

export interface MovementSystemConfig {
    eventBus: EventBus;
    updatePosition: UpdatePositionFn;
    unitOccupancy: Map<string, number>;
    buildingOccupancy: Set<string>;
    rng: SeededRng;
}

/**
 * Coordinates per-unit controllers, bump resolution, and pathfinding.
 */
export class MovementSystem implements TickSystem {
    private readonly controllers: Map<number, MovementController> = new Map();
    readonly store: ComponentStore<MovementController> = mapStore(this.controllers);

    private readonly unitOccupancy: Map<string, number>;
    private readonly buildingOccupancy: Set<string>;
    private readonly eventBus: EventBus;
    private readonly updatePositionFn: UpdatePositionFn;
    private readonly rng: SeededRng;
    private readonly prevStates: Map<number, MovementState> = new Map();

    private readonly shared: BumpResolverDeps;
    private readonly bumpResolver: BumpResolver;

    constructor(config: MovementSystemConfig) {
        this.eventBus = config.eventBus;
        this.updatePositionFn = config.updatePosition;
        this.unitOccupancy = config.unitOccupancy;
        this.buildingOccupancy = config.buildingOccupancy;
        this.rng = config.rng;

        this.shared = {
            controllers: this.controllers,
            unitOccupancy: config.unitOccupancy,
            buildingOccupancy: config.buildingOccupancy,
            eventBus: config.eventBus,
            updatePositionFn: config.updatePosition,
            terrain: undefined,
            verbose: false,
        };
        this.bumpResolver = new BumpResolver(this.shared);
    }

    get verbose(): boolean {
        return this.shared.verbose;
    }

    set verbose(value: boolean) {
        this.shared.verbose = value;
    }

    setTerrainData(groundType: Uint8Array, mapWidth: number, mapHeight: number): void {
        this.shared.terrain = { groundType, mapWidth, mapHeight };
    }

    createController(entityId: number, tile: Tile, speed: number): MovementController {
        const controller = new MovementController(entityId, tile, speed);
        this.controllers.set(entityId, controller);
        const existing = this.unitOccupancy.get(tileKey(tile));
        if (existing !== undefined && existing !== entityId) {
            log.warn(
                `createController: unit ${entityId} overwrites occupancy of unit ${existing} at (${tile.x},${tile.y})`
            );
        }
        this.unitOccupancy.set(tileKey(tile), entityId);
        return controller;
    }

    getController(entityId: number): MovementController | undefined {
        return this.controllers.get(entityId);
    }

    removeController(entityId: number): void {
        const ctrl = this.controllers.get(entityId);
        if (ctrl) {
            const key = tileKey({ x: ctrl.tileX, y: ctrl.tileY });
            if (this.unitOccupancy.get(key) === entityId) {
                this.unitOccupancy.delete(key);
            }
        }
        this.controllers.delete(entityId);
        this.prevStates.delete(entityId);
        clearDispersalCooldown(entityId);
    }

    hasController(entityId: number): boolean {
        return this.controllers.has(entityId);
    }

    getAllControllers(): IterableIterator<MovementController> {
        return this.controllers.values();
    }

    /**
     * Repath moving units whose remaining path crosses any of `blockedKeys`.
     * Used when a building footprint becomes blocked mid-game.
     */
    repathUnitsThrough(blockedKeys: Set<string>, excludeIds?: Set<number>): void {
        for (const ctrl of this.controllers.values()) {
            if (excludeIds?.has(ctrl.entityId) || ctrl.state !== 'moving' || !ctrl.hasPath) {
                continue;
            }
            const remaining = ctrl.path.slice(ctrl.pathIndex);
            if (!remaining.some(wp => blockedKeys.has(tileKey(wp)))) {
                continue;
            }
            const goal = ctrl.goal;
            if (!goal) {
                continue;
            }
            const result = this.findPath({ x: ctrl.tileX, y: ctrl.tileY }, goal, ctrl.entityId);
            if (result.ok && result.path.length > 0) {
                ctrl.setPath(result.path, true);
            } else {
                ctrl.clearPath();
            }
        }
    }

    /**
     * Issue a move command. Returns true if a path was found (including already-at-goal).
     */
    moveUnit(entityId: number, target: Tile): boolean {
        const controller = this.controllers.get(entityId);
        if (!controller) {
            return false;
        }

        const from: Tile = { x: controller.tileX, y: controller.tileY };
        const result = this.findPath(from, target, entityId);
        if (!result.ok) {
            this.emitPathFailed(entityId, from, target, result.failure);
            return false;
        }
        if (result.path.length === 0) {
            return true;
        }

        controller.setPath(result.path);
        this.eventBus.emit('unit:movementStarted', { unitId: entityId });

        if (this.verbose) {
            this.eventBus.emit('movement:pathFound', {
                unitId: entityId,
                fromX: from.x,
                fromY: from.y,
                toX: target.x,
                toY: target.y,
                pathLength: result.path.length,
                redirect: controller.isInTransit,
            });
        }

        return true;
    }

    private emitPathFailed(unitId: number, from: Tile, to: Tile, failure: PathfindingFailureInfo): void {
        this.eventBus.emit('movement:pathFailed', {
            unitId,
            fromX: from.x,
            fromY: from.y,
            toX: to.x,
            toY: to.y,
            x: from.x,
            y: from.y,
            level: 'warn',
            ...failure,
        });
    }

    /** Push any unit standing at `tile` to a free neighbor. */
    pushUnitAt(tile: Tile): boolean {
        return this.bumpResolver.pushUnitAt(tile);
    }

    tick(dt: number): void {
        this.update(dt);
    }

    update(deltaSec: number): void {
        const sortedIds = [...this.controllers.keys()].sort((a, b) => a - b);
        for (const entityId of sortedIds) {
            const controller = this.controllers.get(entityId);
            if (controller) {
                try {
                    this.updateController(controller, deltaSec);
                } catch (e) {
                    const err = e instanceof Error ? e : new Error(String(e));
                    log.error(`Unhandled error in movement tick for entity ${entityId}`, err);
                }
            }
        }

        runCrowdDispersal(
            this,
            this.controllers.values(),
            this.unitOccupancy,
            this.buildingOccupancy,
            this.shared.terrain,
            this.rng,
            deltaSec
        );
    }

    private updateController(controller: MovementController, deltaSec: number): void {
        const prevState = this.prevStates.get(controller.entityId) ?? controller.state;

        controller.advanceProgress(deltaSec);

        while (controller.canMove()) {
            const wp = controller.nextWaypoint;
            if (!wp) {
                break;
            }

            const wpKey = tileKey(wp);
            if (this.buildingOccupancy.has(wpKey)) {
                const currentKey = tileKey({ x: controller.tileX, y: controller.tileY });
                if (!this.buildingOccupancy.has(currentKey)) {
                    this.repathFromCurrent(controller);
                    break;
                }
            }

            const occupantId = occupantAt(this.unitOccupancy, wpKey, controller.entityId);
            if (occupantId === undefined) {
                this.stepForward(controller);
            } else if (!this.resolveCollision(controller, occupantId, deltaSec)) {
                break;
            }
        }

        controller.finalizeTick();
        this.detectTeleport(controller, prevState);
        controller.updateLastVisualPosition();
        this.emitMovementStopped(controller, prevState);
        this.prevStates.set(controller.entityId, controller.state);
    }

    private stepForward(controller: MovementController): void {
        const from: Tile = { x: controller.tileX, y: controller.tileY };
        const newPos = controller.executeMove();
        if (newPos) {
            relocateOccupant(this.unitOccupancy, controller.entityId, from, newPos);
            this.updatePositionFn(controller.entityId, newPos);
            if (this.verbose) {
                this.eventBus.emit('movement:step', {
                    unitId: controller.entityId,
                    x: newPos.x,
                    y: newPos.y,
                    pathIdx: controller.pathIndex,
                    pathLen: controller.path.length,
                });
            }
        }
        controller.resetWaitTime();
    }

    private resolveCollision(controller: MovementController, occupantId: number, deltaSec: number): boolean {
        controller.addWaitTime(deltaSec);

        if (this.bumpResolver.tryBump(controller, occupantId)) {
            this.stepForward(controller);
            return true;
        }

        if (controller.cumulativeWaitTime > GIVEUP_WAIT_TIMEOUT) {
            if (this.verbose) {
                this.eventBus.emit('movement:escalation', { unitId: controller.entityId, result: 'gave_up' });
            }
            controller.clearPath();
            return false;
        }

        if (controller.waitTime > REPATH_WAIT_TIMEOUT) {
            if (this.verbose) {
                this.eventBus.emit('movement:escalation', { unitId: controller.entityId, result: 'repath' });
            }
            this.repathFromCurrent(controller);
            return false;
        }

        if (this.verbose) {
            const wp = controller.nextWaypoint!;
            this.eventBus.emit('movement:blocked', {
                unitId: controller.entityId,
                x: wp.x,
                y: wp.y,
                blockerId: occupantId,
                isBuilding: false,
            });
        }
        controller.haltProgress();
        return false;
    }

    private findPath(from: Tile, to: Tile, entityId: number): PathFindResult {
        const terrain = this.shared.terrain;
        if (!terrain) {
            throw new Error('MovementSystem.findPath: terrain data not set');
        }
        return findPathAStar(from, to, terrain, this.buildingOccupancy, entityId);
    }

    private repathFromCurrent(controller: MovementController): void {
        const goal = controller.goal;
        if (goal) {
            const result = this.findPath({ x: controller.tileX, y: controller.tileY }, goal, controller.entityId);
            if (result.ok && result.path.length > 0) {
                controller.setPath(result.path, true);
            }
        }
        controller.resetWaitTime();
    }

    private detectTeleport(controller: MovementController, prevState: MovementState): void {
        const teleportDist = controller.detectTeleport();
        const steps = Math.max(1, controller.stepsTakenThisTick);
        const threshold = 1.5 * Math.SQRT2 * steps + 0.01;
        if (teleportDist > threshold) {
            console.warn(
                `[MovementSystem] TELEPORT DETECTED! Entity ${controller.entityId} jumped ${teleportDist.toFixed(2)} tiles` +
                    ` | state=${controller.state} prevState=${prevState}` +
                    ` | tile=(${controller.tileX},${controller.tileY}) prev=(${controller.prevTileX},${controller.prevTileY})` +
                    ` | progress=${controller.progress.toFixed(2)} inTransit=${controller.isInTransit}` +
                    ` | pathLen=${controller.path.length} pathIdx=${controller.pathIndex}` +
                    ` | steps=${steps}`
            );
            this.eventBus.emit('movement:teleport', {
                unitId: controller.entityId,
                distance: teleportDist,
                state: controller.state,
                prevState,
                x: controller.tileX,
                y: controller.tileY,
                level: 'warn',
            });
        }
    }

    private emitMovementStopped(controller: MovementController, prevState: MovementState): void {
        if (controller.state !== prevState && controller.state === 'idle' && prevState !== 'idle') {
            this.eventBus.emit('unit:movementStopped', {
                unitId: controller.entityId,
                direction: controller.direction,
            });
        }
    }
}
