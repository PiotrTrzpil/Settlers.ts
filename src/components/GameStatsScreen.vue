<template>
    <div class="gss-backdrop">
        <div class="gss-dialog">
            <h2 class="gss-title" :class="titleClass">
                {{ titleText }}
            </h2>

            <div class="gss-section">
                <div class="gss-row">
                    <span class="gss-label">Duration</span>
                    <span class="gss-value">{{ formattedDuration }}</span>
                </div>
            </div>

            <div class="gss-section">
                <div class="gss-section-title">Players</div>
                <table class="gss-table">
                    <thead>
                        <tr>
                            <th>Player</th>
                            <th>Race</th>
                            <th>Buildings</th>
                            <th>Units</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="p in playerStats" :key="p.index" :class="{ 'gss-local': p.index === localPlayer }">
                            <td>P{{ p.index + 1 }}</td>
                            <td>{{ p.race }}</td>
                            <td>{{ p.buildings }}</td>
                            <td>{{ p.units }}</td>
                            <td>
                                <span class="gss-status" :class="'gss-status--' + p.status">{{ p.statusLabel }}</span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <!-- Charts -->
            <div class="gss-charts">
                <stats-chart title="Soldiers over time" :series="soldierSeries" />
                <stats-chart title="Settlers over time" :series="settlerSeries" />
            </div>

            <div class="gss-actions">
                <button class="gss-btn gss-btn--quit" @click="$emit('quit')">Quit to Menu</button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Game } from '@/game/game';
import { EntityType } from '@/game/entity';
import { formatRace } from '@/game/core/race';
import { TICK_RATE } from '@/game/core/tick-rate';
import { PlayerStatus } from '@/game/features/victory-conditions/victory-conditions-system';
import type { GameModeStatsTracker } from '@/game/state/game-mode-stats-tracker';
import StatsChart from './StatsChart.vue';

const props = defineProps<{
    game: Game;
    won: boolean | null;
    statsTracker: GameModeStatsTracker;
}>();

defineEmits<{
    (e: 'quit'): void;
}>();

const localPlayer = props.game.currentPlayer;

const titleText = computed(() => {
    if (props.won === true) {
        return 'Victory!';
    }
    if (props.won === false) {
        return 'Defeat';
    }
    return 'Game Stats';
});

const titleClass = computed(() => {
    if (props.won === true) {
        return 'gss-title--won';
    }
    if (props.won === false) {
        return 'gss-title--lost';
    }
    return 'gss-title--neutral';
});

const soldierSeries = computed(() => props.statsTracker.getSoldierSeries());
const settlerSeries = computed(() => props.statsTracker.getSettlerSeries());

// Snapshot tick count at mount time — game.currentTick is not reactive
const snapshotTick = props.game.currentTick;

const formattedDuration = computed(() => {
    const totalSeconds = Math.floor(snapshotTick / TICK_RATE);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    if (hours > 0) {
        return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
    }
    return `${minutes}m ${pad(seconds)}s`;
});

interface PlayerStat {
    index: number;
    race: string;
    buildings: number;
    units: number;
    status: string;
    statusLabel: string;
}

const playerStats = computed<PlayerStat[]>(() => {
    const result: PlayerStat[] = [];
    const state = props.game.state;
    const victorySystem = props.game.services.victorySystem;

    for (const [idx, race] of props.game.playerRaces) {
        const buildings = state.entityIndex.idsOfTypeAndPlayer(EntityType.Building, idx).size;
        const units = state.entityIndex.idsOfTypeAndPlayer(EntityType.Unit, idx).size;
        const pStatus = victorySystem.getPlayerStatus(idx);
        const isWinner = props.won && idx === localPlayer;

        let statusLabel: string;
        let status: string;
        if (isWinner) {
            statusLabel = 'Winner';
            status = 'winner';
        } else if (pStatus === PlayerStatus.Eliminated) {
            statusLabel = 'Eliminated';
            status = 'eliminated';
        } else {
            statusLabel = 'Active';
            status = 'active';
        }

        result.push({ index: idx, race: formatRace(race), buildings, units, status, statusLabel });
    }

    result.sort((a, b) => a.index - b.index);
    return result;
});
</script>

<style scoped>
.gss-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.75);
    z-index: 350;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow-y: auto;
    padding: 20px;
}

.gss-dialog {
    background: #1a1209;
    border: 2px solid #5c3d1a;
    border-radius: 8px;
    padding: 28px 36px;
    min-width: 480px;
    max-width: 540px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
}

.gss-title {
    text-align: center;
    font-size: 28px;
    font-weight: 700;
    margin: 0 0 20px;
}

.gss-title--won {
    color: #f0c040;
}

.gss-title--lost {
    color: #c84040;
}

.gss-title--neutral {
    color: #e8c87e;
}

.gss-section {
    margin-bottom: 16px;
}

.gss-section-title {
    font-size: 11px;
    font-weight: 600;
    color: #8a7040;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    margin-bottom: 8px;
    border-bottom: 1px solid #3a2810;
    padding-bottom: 4px;
}

.gss-row {
    display: flex;
    justify-content: space-between;
    padding: 6px 0;
}

.gss-label {
    color: #8a7040;
    font-size: 13px;
}

.gss-value {
    color: #e8c87e;
    font-size: 13px;
    font-weight: 600;
}

/* Player stats table */
.gss-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
}

.gss-table th {
    text-align: left;
    color: #6a5030;
    font-weight: 600;
    padding: 4px 8px;
    border-bottom: 1px solid #3a2810;
}

.gss-table td {
    padding: 6px 8px;
    color: #c8a96e;
    border-bottom: 1px solid #2a1e0e;
}

.gss-local td {
    color: #e8c87e;
    font-weight: 600;
}

.gss-status {
    font-size: 10px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 2px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
}

.gss-status--winner {
    background: #2a3a1a;
    color: #80c040;
}

.gss-status--eliminated {
    background: #3a1a1a;
    color: #c06060;
}

.gss-status--active {
    background: #2a2a3a;
    color: #6a8aca;
}

/* Charts section */
.gss-charts {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 16px;
}

.gss-actions {
    display: flex;
    justify-content: center;
    margin-top: 20px;
}

.gss-btn {
    padding: 10px 32px;
    border-radius: 4px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid transparent;
    transition: background 0.15s;
}

.gss-btn--quit {
    background: #c84040;
    color: #fff;
    border-color: #e05050;
}

.gss-btn--quit:hover {
    background: #e04848;
}
</style>
