import type { TickSystem } from '../../tick-system';
import type { CoreDeps } from '../feature';
import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import { EventSubscriptionManager } from '../../event-bus';
import { EntityType } from '../../entity';
import { UnitType } from '../../unit-types';
import { EMaterialType } from '../../economy/material-type';
import type { CarrierRegistry } from '../carriers';
import type { SettlerTaskSystem } from '../settler-tasks';
import type { ConstructionSiteManager } from '../building-construction/construction-site-manager';
import type { ToolSourceResolver } from './tool-source-resolver';
import type { UnitTransformer } from './unit-transformer';
import { createRecruitmentJob } from './recruitment-job';
import { createLogger } from '@/utilities/logger';
import { query } from '@/game/ecs';
import type { Persistable } from '@/game/persistence';
import type { SerializedAutoRecruit } from '@/game/game-state-persistence';

const log = createLogger('AutoRecruit');

const MAX_AUTO_RECRUITED_DIGGERS = 4;
const MAX_AUTO_RECRUITED_BUILDERS = 4;
const RECRUIT_CHECK_INTERVAL = 1.0; // seconds

interface RecruitmentRecord {
    carrierId: number;
    targetUnitType: UnitType;
    toolMaterial: EMaterialType;
    pileEntityId: number;
    siteId: number;
}

interface PlayerRecruitState {
    pendingRecruitments: Map<number, RecruitmentRecord>; // carrierId -> record
    pendingDiggers: number;
    pendingBuilders: number;
}

export interface AutoRecruitSystemConfig extends CoreDeps {
    carrierRegistry: CarrierRegistry;
    getSettlerTaskSystem: () => SettlerTaskSystem | null;
    constructionSiteManager: ConstructionSiteManager;
    toolSourceResolver: ToolSourceResolver;
    unitTransformer: UnitTransformer;
    isCarrierBusy: (carrierId: number) => boolean;
}

export class AutoRecruitSystem implements TickSystem, Persistable<SerializedAutoRecruit> {
    readonly persistKey = 'autoRecruit' as const;
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly carrierRegistry: CarrierRegistry;
    private readonly getSettlerTaskSystem: () => SettlerTaskSystem | null;
    private readonly constructionSiteManager: ConstructionSiteManager;
    private readonly toolSourceResolver: ToolSourceResolver;
    private readonly unitTransformer: UnitTransformer;
    private readonly isCarrierBusy: (carrierId: number) => boolean;
    private readonly subscriptions = new EventSubscriptionManager();

    private readonly playerStates = new Map<number, PlayerRecruitState>();
    private accumulatedTime = 0;

    constructor(config: AutoRecruitSystemConfig) {
        this.gameState = config.gameState;
        this.eventBus = config.eventBus;
        this.carrierRegistry = config.carrierRegistry;
        this.getSettlerTaskSystem = config.getSettlerTaskSystem;
        this.constructionSiteManager = config.constructionSiteManager;
        this.toolSourceResolver = config.toolSourceResolver;
        this.unitTransformer = config.unitTransformer;
        this.isCarrierBusy = config.isCarrierBusy;
    }

    // =========================================================================
    // TickSystem
    // =========================================================================

    tick(dt: number): void {
        this.accumulatedTime += dt;
        if (this.accumulatedTime < RECRUIT_CHECK_INTERVAL) return;
        this.accumulatedTime -= RECRUIT_CHECK_INTERVAL;

        try {
            this.runRecruitmentCheck();
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            log.error('Failed recruitment check', err);
        }
    }

    cancelRecruitment(entityId: number): void {
        for (const [player, state] of this.playerStates) {
            const record = state.pendingRecruitments.get(entityId);
            if (record) {
                this.toolSourceResolver.release(record.pileEntityId);
                this.removeRecord(player, entityId);
            }
        }
    }

    destroy(): void {
        this.subscriptions.unsubscribeAll();
    }

    // =========================================================================
    // Event handling
    // =========================================================================

    unregisterEvents(): void {
        this.subscriptions.unsubscribeAll();
    }

    registerEvents(): void {
        this.subscriptions.subscribe(this.eventBus, 'recruitment:completed', payload => {
            this.handleRecruitmentCompleted(payload.carrierId, payload.targetUnitType);
        });

        this.subscriptions.subscribe(this.eventBus, 'recruitment:failed', payload => {
            this.handleRecruitmentFailed(payload.carrierId);
        });

        this.subscriptions.subscribe(this.eventBus, 'settler:taskFailed', payload => {
            if (payload.jobId === 'AUTO_RECRUIT') {
                this.eventBus.emit('recruitment:failed', {
                    carrierId: payload.unitId,
                    reason: payload.failedStep,
                });
            }
        });
    }

    private handleRecruitmentCompleted(carrierId: number, targetUnitType: UnitType): void {
        const record = this.findRecordByCarrier(carrierId);
        if (!record) {
            log.warn(`recruitment:completed for unknown carrier ${carrierId}`);
            return;
        }

        this.unitTransformer.transform(carrierId, targetUnitType);
        this.toolSourceResolver.release(record.pileEntityId);
        this.removeRecordByCarrier(carrierId);

        log.debug(`Carrier ${carrierId} recruited as ${UnitType[targetUnitType]}`);
    }

    private handleRecruitmentFailed(carrierId: number): void {
        const record = this.findRecordByCarrier(carrierId);
        if (!record) return;

        this.toolSourceResolver.release(record.pileEntityId);
        this.removeRecordByCarrier(carrierId);

        log.debug(`Recruitment failed for carrier ${carrierId}`);
    }

    // =========================================================================
    // Core recruitment logic
    // =========================================================================

    private runRecruitmentCheck(): void {
        const players = this.collectActivePlayers();

        for (const player of players) {
            try {
                const state = this.getOrCreatePlayerState(player);
                this.recruitForRole(player, state, UnitType.Digger, EMaterialType.SHOVEL, MAX_AUTO_RECRUITED_DIGGERS);
                this.recruitForRole(player, state, UnitType.Builder, EMaterialType.HAMMER, MAX_AUTO_RECRUITED_BUILDERS);
            } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                log.error(`Recruitment check failed for player ${player}`, err);
            }
        }
    }

    private recruitForRole(
        player: number,
        state: PlayerRecruitState,
        unitType: UnitType,
        toolMaterial: EMaterialType,
        maxCount: number
    ): void {
        const existing = this.countWorkers(player, unitType);
        const pending = unitType === UnitType.Digger ? state.pendingDiggers : state.pendingBuilders;
        const slotsAvailable = maxCount - existing - pending;
        if (slotsAvailable <= 0) return;

        for (let i = 0; i < slotsAvailable; i++) {
            const recruited = this.tryRecruitOne(player, state, unitType, toolMaterial);
            if (!recruited) break;
        }
    }

    private tryRecruitOne(
        player: number,
        state: PlayerRecruitState,
        unitType: UnitType,
        toolMaterial: EMaterialType
    ): boolean {
        const siteId = this.findSiteForRole(unitType, player);
        if (siteId === undefined) return false;

        const site = this.constructionSiteManager.getSite(siteId);
        if (!site) return false;

        const toolSource = this.toolSourceResolver.findNearestToolPile(toolMaterial, site.tileX, site.tileY, player);
        if (!toolSource) return false;

        const carrierId = this.findIdleCarrier(player, toolSource.x, toolSource.y);
        if (carrierId === null) return false;

        const job = createRecruitmentJob(toolSource.pileEntityId, toolSource.x, toolSource.y, unitType);
        const sts = this.getSettlerTaskSystem();
        if (!sts) return false;

        const assigned = sts.assignJob(carrierId, job, { x: toolSource.x, y: toolSource.y });
        if (!assigned) return false;

        this.toolSourceResolver.reserve(toolSource.pileEntityId);

        const record: RecruitmentRecord = {
            carrierId,
            targetUnitType: unitType,
            toolMaterial,
            pileEntityId: toolSource.pileEntityId,
            siteId,
        };
        state.pendingRecruitments.set(carrierId, record);
        if (unitType === UnitType.Digger) {
            state.pendingDiggers++;
        } else {
            state.pendingBuilders++;
        }

        this.eventBus.emit('recruitment:started', {
            carrierId,
            targetUnitType: unitType,
            pileEntityId: toolSource.pileEntityId,
            siteId,
        });

        log.debug(
            `Dispatched carrier ${carrierId} to recruit as ${UnitType[unitType]} ` +
                `(pile ${toolSource.pileEntityId}, site ${siteId})`
        );

        return true;
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    private findSiteForRole(unitType: UnitType, player: number): number | undefined {
        if (unitType === UnitType.Digger) {
            return this.constructionSiteManager.findSiteNeedingDiggers(0, 0, player);
        }
        return this.constructionSiteManager.findSiteNeedingBuilders(0, 0, player);
    }

    private findIdleCarrier(player: number, nearX: number, nearY: number): number | null {
        let bestId: number | null = null;
        let bestDistSq = Infinity;

        for (const [id, , entity] of query(this.carrierRegistry.store, this.gameState.store)) {
            if (this.isCarrierBusy(id)) continue;
            if (this.findRecordByCarrier(id)) continue;
            if (entity.player !== player) continue;

            const dx = entity.x - nearX;
            const dy = entity.y - nearY;
            const distSq = dx * dx + dy * dy;

            if (distSq < bestDistSq) {
                bestDistSq = distSq;
                bestId = id;
            }
        }

        return bestId;
    }

    private countWorkers(player: number, unitType: UnitType): number {
        let count = 0;
        for (const entity of this.gameState.entities) {
            if (entity.type === EntityType.Unit && entity.subType === unitType && entity.player === player) {
                count++;
            }
        }
        return count;
    }

    private collectActivePlayers(): Set<number> {
        const players = new Set<number>();
        for (const site of this.constructionSiteManager.getAllActiveSites()) {
            players.add(site.player);
        }
        return players;
    }

    private getOrCreatePlayerState(player: number): PlayerRecruitState {
        let state = this.playerStates.get(player);
        if (!state) {
            state = {
                pendingRecruitments: new Map(),
                pendingDiggers: 0,
                pendingBuilders: 0,
            };
            this.playerStates.set(player, state);
        }
        return state;
    }

    private findRecordByCarrier(carrierId: number): RecruitmentRecord | undefined {
        for (const state of this.playerStates.values()) {
            const record = state.pendingRecruitments.get(carrierId);
            if (record) return record;
        }
        return undefined;
    }

    private removeRecordByCarrier(carrierId: number): void {
        for (const [player, state] of this.playerStates) {
            if (state.pendingRecruitments.has(carrierId)) {
                this.removeRecord(player, carrierId);
                return;
            }
        }
    }

    private removeRecord(player: number, carrierId: number): void {
        const state = this.playerStates.get(player);
        if (!state) return;

        const record = state.pendingRecruitments.get(carrierId);
        if (!record) return;

        state.pendingRecruitments.delete(carrierId);
        if (record.targetUnitType === UnitType.Digger) {
            state.pendingDiggers--;
        } else {
            state.pendingBuilders--;
        }
    }

    // =========================================================================
    // Persistable
    // =========================================================================

    serialize(): SerializedAutoRecruit {
        const playerStates: SerializedAutoRecruit['playerStates'] = [];
        for (const [player, state] of this.playerStates) {
            const recruitments: SerializedAutoRecruit['playerStates'][number]['recruitments'] = [];
            for (const [, record] of state.pendingRecruitments) {
                recruitments.push({
                    carrierId: record.carrierId,
                    targetUnitType: record.targetUnitType as number,
                    toolMaterial: record.toolMaterial as number,
                    pileEntityId: record.pileEntityId,
                    siteId: record.siteId,
                });
            }
            playerStates.push({
                player,
                pendingDiggers: state.pendingDiggers,
                pendingBuilders: state.pendingBuilders,
                recruitments,
            });
        }
        return { accumulatedTime: this.accumulatedTime, playerStates };
    }

    deserialize(data: SerializedAutoRecruit): void {
        this.accumulatedTime = data.accumulatedTime;
        this.playerStates.clear();
        for (const entry of data.playerStates) {
            const pendingRecruitments = new Map<number, RecruitmentRecord>();
            for (const r of entry.recruitments) {
                pendingRecruitments.set(r.carrierId, {
                    carrierId: r.carrierId,
                    targetUnitType: r.targetUnitType as UnitType,
                    toolMaterial: r.toolMaterial as EMaterialType,
                    pileEntityId: r.pileEntityId,
                    siteId: r.siteId,
                });
            }
            this.playerStates.set(entry.player, {
                pendingRecruitments,
                pendingDiggers: entry.pendingDiggers,
                pendingBuilders: entry.pendingBuilders,
            });
        }
    }
}
