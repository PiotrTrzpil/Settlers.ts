/**
 * AiPlayerController — per-player AI state and throttled BT evaluation.
 *
 * Holds mutable state (ticksSinceEval) and references to the economy
 * and military planners. The `evaluate(dt)` method is called every tick
 * by AiPlayerSystemImpl; when enough ticks accumulate it ticks the
 * behavior tree once.
 */

import type { Race } from '@/game/core/race';
import type { GameState } from '@/game/game-state';
import type { TerrainData } from '@/game/terrain';
import type { Command, CommandResult } from '@/game/commands/command-types';
import type { PlacementFilter } from '@/game/systems/placement/types';
import type { Node } from '@/game/ai/behavior-tree';
import type { AiPlayerConfig, AiPlayerState } from '../types';
import { EconomyPlanner } from './economy-planner';
import { MilitaryPlanner } from './military-planner';
import { getBuildOrder } from './build-orders';
import { createAiDecisionTree } from './ai-decision-tree';

const DEFAULT_EVALUATION_INTERVAL = 30;

export class AiPlayerController {
    readonly player: number;
    readonly race: Race;

    private readonly economyPlanner: EconomyPlanner;
    private readonly militaryPlanner: MilitaryPlanner;
    private readonly decisionTree: Node<AiPlayerController>;
    private readonly evaluationInterval: number;
    private readonly checkGameOver: () => boolean;

    private ticksSinceEval = 0;

    constructor(deps: {
        config: AiPlayerConfig;
        race: Race;
        gameState: GameState;
        terrain: TerrainData;
        executeCommand: (cmd: Command) => CommandResult;
        getPlacementFilter: () => PlacementFilter | null;
        hasSite: (buildingId: number) => boolean;
        isGameOver: () => boolean;
    }) {
        this.player = deps.config.player;
        this.race = deps.race;
        this.evaluationInterval = deps.config.evaluationInterval ?? DEFAULT_EVALUATION_INTERVAL;
        this.checkGameOver = deps.isGameOver;

        const buildOrder = deps.config.buildOrder ?? getBuildOrder(deps.race);

        this.economyPlanner = new EconomyPlanner({
            gameState: deps.gameState,
            terrain: deps.terrain,
            executeCommand: deps.executeCommand,
            getPlacementFilter: deps.getPlacementFilter,
            buildOrder,
            player: this.player,
            race: deps.race,
        });

        this.militaryPlanner = new MilitaryPlanner({
            gameState: deps.gameState,
            hasSite: deps.hasSite,
            executeCommand: deps.executeCommand,
            player: this.player,
            race: deps.race,
        });

        this.decisionTree = createAiDecisionTree();
    }

    /**
     * Called every tick. Increments the throttle counter and ticks
     * the decision tree when the evaluation interval is reached.
     */
    evaluate(dt: number): void {
        this.ticksSinceEval++;
        if (this.ticksSinceEval < this.evaluationInterval) {
            return;
        }

        this.ticksSinceEval = 0;
        this.decisionTree.tick(this, dt);
    }

    // ── Decision tree callbacks ──────────────────────────────────

    isGameOver(): boolean {
        return this.checkGameOver();
    }

    canPlaceNextBuilding(): boolean {
        return this.economyPlanner.canPlaceNext();
    }

    placeBuilding(): void {
        this.economyPlanner.placeNext();
    }

    canTrainSoldier(): boolean {
        return this.militaryPlanner.canTrain();
    }

    trainSoldier(): void {
        this.militaryPlanner.trainSoldier();
    }

    shouldAttack(): boolean {
        return this.militaryPlanner.shouldAttack();
    }

    launchAttack(): void {
        this.militaryPlanner.launchAttack();
    }

    // ── State snapshot for diagnostics/tests ─────────────────────

    getState(): Readonly<AiPlayerState> {
        return {
            player: this.player,
            race: this.race,
            buildOrderIndex: this.economyPlanner.getBuildOrderIndex(),
            buildingsPlaced: this.economyPlanner.getBuildingsPlaced(),
            soldiersCount: this.militaryPlanner.getSoldiersCount(),
            attacksSent: this.militaryPlanner.getAttacksSent(),
            attackTarget: this.militaryPlanner.getAttackTarget(),
        };
    }
}
