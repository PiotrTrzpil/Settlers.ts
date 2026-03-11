<template>
    <OverlayPanel v-model:open="open" label="Logistics" title="Logistics Debug Panel">
        <!-- Player sub-tabs -->
        <div v-if="playerIds.length > 1" class="player-tabs">
            <button
                v-for="pid in playerIds"
                :key="pid"
                class="player-tab"
                :class="{ active: selectedPlayer === pid }"
                @click="selectedPlayer = pid"
            >
                P{{ pid }}
            </button>
        </div>

        <!-- Overview (always open) -->
        <CollapseSection title="Overview">
            <StatRow label="Demands (pending)" :value="stats.demandCount" />
            <StatRow label="Active Jobs" :value="stats.activeJobCount" />
            <StatRow v-if="stats.stalledCount > 0" label="Jobs (stalled)">
                <span class="value-stalled">{{ stats.stalledCount }}</span>
            </StatRow>
            <StatRow label="Carriers" :value="stats.carrierCount" />
            <StatRow v-if="stats.unregisteredCarriers > 0" label="Unregistered">
                <span class="value-warning">{{ stats.unregisteredCarriers }}</span>
            </StatRow>
        </CollapseSection>

        <!-- Demands -->
        <CollapseSection :title="`Demands (${stats.demandCount})`">
            <div v-if="state.demands.length === 0" class="empty-state">No active demands</div>
            <div v-for="req in displayedDemands" :key="req.id" class="request-row">
                <span class="req-material">{{ req.material }}</span>
                <span class="req-priority" :class="'priority-' + req.priority.toLowerCase()">
                    {{ req.priority[0] }}
                </span>
                <span class="req-target">→ #{{ req.buildingId }}</span>
                <span class="req-age">{{ req.age }}s</span>
                <span class="req-status pending">⏳</span>
                <span v-if="req.reason" class="req-reason">{{ req.reason }}</span>
            </div>
            <div v-if="hasMoreDemands" class="more-indicator">+{{ stats.demandCount - 15 }} more</div>
        </CollapseSection>

        <!-- Carriers -->
        <CollapseSection :title="`Carriers (${stats.carrierCount})`" :default-open="false">
            <div class="carrier-breakdown">
                <span class="breakdown-item">
                    <span class="breakdown-label">Idle:</span>
                    <span class="breakdown-value">{{ stats.idleCarriers }}</span>
                </span>
                <span class="breakdown-item">
                    <span class="breakdown-label">Busy:</span>
                    <span class="breakdown-value">{{ stats.busyCarriers }}</span>
                </span>
            </div>
            <div v-if="state.carriers.length === 0" class="empty-state">No carriers</div>
            <div v-for="carrier in state.carriers" :key="carrier.entityId" class="carrier-row">
                <span class="carrier-id">#{{ carrier.entityId }}</span>
                <span class="carrier-status" :class="'status-' + carrier.status.toLowerCase()">
                    {{ carrier.status }}
                </span>
                <span v-if="carrier.carryingMaterial" class="carrier-carrying">
                    {{ carrier.carryingMaterial }}
                </span>
            </div>
        </CollapseSection>

        <!-- Active Jobs -->
        <CollapseSection :title="`Active Jobs (${activeJobCount})`" :default-open="false">
            <div v-if="carriersWithJobs.length === 0" class="empty-state">No active jobs</div>
            <div v-for="carrier in carriersWithJobs" :key="carrier.entityId" class="job-row">
                <span class="job-carrier">#{{ carrier.entityId }}</span>
                <span class="job-type">{{ carrier.jobType }}</span>
                <span v-if="carrier.carryingMaterial" class="job-material">
                    {{ carrier.carryingMaterial }} ×{{ carrier.carryingAmount }}
                </span>
            </div>
        </CollapseSection>
    </OverlayPanel>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { debugStats } from '@/game/debug/debug-stats';
import { useLogisticsDebug } from '@/composables/useLogisticsDebug';
import type { Game } from '@/game/game';
import CollapseSection from './CollapseSection.vue';
import StatRow from './StatRow.vue';
import OverlayPanel from './OverlayPanel.vue';

const props = defineProps<{
    game: Game | null;
}>();

// Player tabs — derive available players from game.playerRaces
const playerIds = computed(() => {
    if (!props.game) return [0];
    return [...props.game.playerRaces.keys()].sort((a, b) => a - b);
});

const selectedPlayer = ref(0);

// Sync selectedPlayer when game loads or player list changes
watch(
    playerIds,
    ids => {
        if (ids.length > 0 && !ids.includes(selectedPlayer.value)) {
            selectedPlayer.value = ids[0]!;
        }
    },
    { immediate: true }
);

const { state } = useLogisticsDebug(
    () => props.game,
    () => selectedPlayer.value
);

const stats = computed(() => state.value.stats);

// Use persisted open state from debug stats
const open = computed({
    get: () => debugStats.state.logisticsPanelOpen,
    set: (value: boolean) => {
        debugStats.state.logisticsPanelOpen = value;
    },
});

// Display up to 15 demands sorted by priority then age
const displayedDemands = computed(() => {
    const priorityOrder: Record<string, number> = { High: 0, Normal: 1, Low: 2 };
    return [...state.value.demands]
        .sort((a, b) => {
            const pDiff = (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1);
            if (pDiff !== 0) return pDiff;
            return b.age - a.age;
        })
        .slice(0, 15);
});

const hasMoreDemands = computed(() => stats.value.demandCount > 15);

const carriersWithJobs = computed(() => state.value.carriers.filter(c => c.hasJob));
const activeJobCount = computed(() => carriersWithJobs.value.length);
</script>

<style scoped>
/* Player sub-tabs */
.player-tabs {
    display: flex;
    border-bottom: 1px solid var(--border-faint);
    background: rgba(30, 20, 10, 0.5);
}
.player-tab {
    flex: 1;
    padding: 4px 6px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-muted);
    font-size: 10px;
    font-family: monospace;
    font-weight: bold;
    cursor: pointer;
}
.player-tab:hover {
    color: var(--text-bright);
    background: var(--bg-raised);
}
.player-tab.active {
    color: var(--text-bright);
    border-bottom-color: var(--text-accent, #d4a030);
}

/* Inline value variants for StatRow slot */
.value-stalled {
    color: var(--status-bad);
    font-weight: bold;
    text-align: right;
}

.value-warning {
    color: var(--status-alert);
    text-align: right;
}

.empty-state {
    color: var(--text-ghost);
    font-style: italic;
    text-align: center;
    padding: 4px 0;
}

/* Requests */
.request-row {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 0;
    font-size: 10px;
}

.req-material {
    flex: 1;
    color: var(--text-bright);
}

.req-priority {
    width: 14px;
    height: 14px;
    border-radius: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    font-size: 9px;
}

.req-priority.priority-high {
    background: #5a2020;
    color: #ff8080;
}
.req-priority.priority-normal {
    background: #3a3a20;
    color: #c0c060;
}
.req-priority.priority-low {
    background: #203a20;
    color: var(--status-good);
}

.req-target {
    color: var(--text-muted);
    font-size: 9px;
}
.req-age {
    color: var(--text-faint);
    font-size: 9px;
    min-width: 24px;
    text-align: right;
}
.req-status {
    font-size: 10px;
}
.req-status.pending {
    color: #c0a040;
}
.req-reason {
    color: #a06030;
    font-size: 9px;
    font-style: italic;
    margin-left: auto;
    white-space: nowrap;
}

.more-indicator {
    color: var(--text-faint);
    font-style: italic;
    text-align: center;
    padding: 2px 0;
    font-size: 9px;
}

/* Carriers */
.carrier-breakdown {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 4px 0;
    border-bottom: 1px solid var(--border-faint);
    margin-bottom: 4px;
}

.breakdown-item {
    display: flex;
    gap: 2px;
}
.breakdown-label {
    color: var(--text-faint);
    font-size: 9px;
}
.breakdown-value {
    color: var(--text-muted);
    font-size: 9px;
}

.carrier-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
    font-size: 10px;
}

.carrier-id {
    color: var(--text-muted);
    min-width: 30px;
}
.carrier-status {
    min-width: 50px;
}

.carrier-status.status-idle {
    color: var(--status-good);
}
.carrier-status.status-walking {
    color: #80a0c0;
}
.carrier-status.status-pickingup {
    color: #c0a040;
}
.carrier-status.status-delivering {
    color: #a080c0;
}
.carrier-status.status-resting {
    color: #6090a0;
}

.carrier-carrying {
    color: var(--text-bright);
    font-size: 9px;
}

/* Jobs */
.job-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
    font-size: 10px;
}
.job-carrier {
    color: var(--text-muted);
    min-width: 30px;
}
.job-type {
    color: #a080c0;
    min-width: 50px;
}
.job-material {
    color: var(--text-bright);
}
</style>
