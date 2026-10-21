/**
 * Military Planner — soldier training and attack coordination for AI players.
 *
 * Responsibilities:
 * - Train swordsmen when a barracks exists and weapons are available
 * - Track idle military units
 * - Launch attack waves when enough soldiers have accumulated
 * - Select nearest enemy castle as attack target
 */

import { BuildingType, UnitType, Tile } from '@/game/entity';
import type { Entity } from '@/game/entity';
import type { GameState } from '@/game/game-state';
import type { Race } from '@/game/core/race';
import type { Command } from '@/game/commands/command-types';
import type { UnitCommitmentQuery } from '@/game/systems/unit-commitment';
import {
    getPlayerBuildings,
    getPlayerMilitaryUnits,
    getPlayerBasePosition,
    findNearestEnemyBase,
} from './ai-world-queries';

/** Minimum idle soldiers required before launching an attack wave. */
const ATTACK_THRESHOLD = 5;

export class MilitaryPlanner {
    private readonly gameState: GameState;
    private readonly hasSite: (buildingId: number) => boolean;
    private readonly executeCommand: (cmd: Command) => void;
    private readonly unitCommitments: UnitCommitmentQuery;
    private readonly player: number;
    private readonly race: Race;

    private attacksSent = 0;
    private lastAttackTarget: Tile | null = null;

    constructor(deps: {
        gameState: GameState;
        hasSite: (buildingId: number) => boolean;
        executeCommand: (cmd: Command) => void;
        unitCommitments: UnitCommitmentQuery;
        player: number;
        race: Race;
    }) {
        this.gameState = deps.gameState;
        this.hasSite = deps.hasSite;
        this.executeCommand = deps.executeCommand;
        this.unitCommitments = deps.unitCommitments;
        this.player = deps.player;
        this.race = deps.race;
    }

    /**
     * Whether the AI can train a soldier: needs an operational barracks.
     * The barracks handles weapon/material checks internally via the recruit command.
     */
    canTrain(): boolean {
        const barracks = getPlayerBuildings(this.gameState, this.player, BuildingType.Barrack);
        return barracks.some(b => !this.hasSite(b.id));
    }

    /** Issue a recruit_specialist command for one swordsman. */
    trainSoldier(): void {
        const castlePos = getPlayerBasePosition(this.gameState, this.player);
        this.executeCommand({
            type: 'recruit_specialist',
            unitType: UnitType.Swordsman1,
            count: 1,
            player: this.player,
            race: this.race,
            nearX: castlePos.x,
            nearY: castlePos.y,
        });
    }

    /** Whether the AI has accumulated enough idle soldiers to launch an attack. */
    shouldAttack(): boolean {
        return this.getIdleMilitaryUnits().length >= ATTACK_THRESHOLD;
    }

    /**
     * Send all idle soldiers toward the nearest enemy castle.
     * Combat system handles engagement automatically when units arrive.
     */
    launchAttack(): void {
        const castlePos = getPlayerBasePosition(this.gameState, this.player);
        const target = findNearestEnemyBase(this.gameState, this.player, castlePos.x, castlePos.y);
        if (!target) {
            return;
        }

        const idleSoldiers = this.getIdleMilitaryUnits();
        for (const soldier of idleSoldiers) {
            this.executeCommand({
                type: 'move_unit',
                entityId: soldier.id,
                targetX: target.x,
                targetY: target.y,
            });
        }

        this.lastAttackTarget = { x: target.x, y: target.y };
        this.attacksSent++;
    }

    /** Total number of military units owned by this player. */
    getSoldiersCount(): number {
        return getPlayerMilitaryUnits(this.gameState, this.player).length;
    }

    /** Number of attack waves sent so far. */
    getAttacksSent(): number {
        return this.attacksSent;
    }

    /** Last attack target position, or null if no attacks have been sent. */
    getAttackTarget(): Tile | null {
        return this.lastAttackTarget;
    }

    /**
     * Get idle military units — soldiers with no commitment (not walking under a move command,
     * not garrisoned, not held by a siege) and not hidden inside a building.
     */
    private getIdleMilitaryUnits(): readonly Entity[] {
        return getPlayerMilitaryUnits(this.gameState, this.player).filter(
            unit => this.unitCommitments.isIdle(unit.id) && !unit.hidden
        );
    }
}
