/**
 * Military Planner — soldier training and attack coordination for AI players.
 *
 * Responsibilities:
 * - Train swordsmen when a barracks exists and weapons are available
 * - Track idle military units
 * - Launch attack waves when enough soldiers have accumulated
 * - Select nearest enemy castle as attack target
 */

import { BuildingType, UnitType } from '@/game/entity';
import type { Entity } from '@/game/entity';
import type { GameState } from '@/game/game-state';
import type { Race } from '@/game/core/race';
import type { Command } from '@/game/commands/command-types';
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
    private readonly player: number;
    private readonly race: Race;

    private attacksSent = 0;
    private lastAttackTarget: { x: number; y: number } | null = null;

    constructor(deps: {
        gameState: GameState;
        hasSite: (buildingId: number) => boolean;
        executeCommand: (cmd: Command) => void;
        player: number;
        race: Race;
    }) {
        this.gameState = deps.gameState;
        this.hasSite = deps.hasSite;
        this.executeCommand = deps.executeCommand;
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
    getAttackTarget(): { x: number; y: number } | null {
        return this.lastAttackTarget;
    }

    /**
     * Get idle military units — soldiers not currently moving.
     * A unit is idle when it has no active path in the movement system.
     */
    private getIdleMilitaryUnits(): readonly Entity[] {
        const allMilitary = getPlayerMilitaryUnits(this.gameState, this.player);
        const idle: Entity[] = [];
        for (const unit of allMilitary) {
            const unitState = this.gameState.unitStates.get(unit.id);
            // No movement state or empty path means the unit is idle
            if (!unitState || unitState.path.length === 0) {
                idle.push(unit);
            }
        }
        return idle;
    }
}
