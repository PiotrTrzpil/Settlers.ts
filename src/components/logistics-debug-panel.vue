<template>
    <div class="logistics-panel" :class="{ collapsed: !open }">
        <button class="panel-toggle-btn" @click="open = !open" title="Logistics Debug Panel">
            <span class="toggle-icon">{{ open ? '&#x25BC;' : '&#x25B6;' }}</span>
            <span class="toggle-label">Logistics</span>
        </button>

        <div v-if="open" class="panel-sections">
            <!-- Settings -->
            <section class="panel-section settings-section">
                <div class="section-body">
                    <label class="setting-row">
                        <input type="checkbox" v-model="selectAllUnits" />
                        <span class="setting-label">All units selectable</span>
                    </label>
                </div>
            </section>

            <!-- Overview (always visible when expanded) -->
            <section class="panel-section">
                <h3 class="section-header">
                    <span class="caret">&#x25BC;</span>
                    Overview
                </h3>
                <div class="section-body">
                    <div class="stat-row">
                        <span class="stat-label">Requests (pending)</span>
                        <span class="stat-value">{{ stats.pendingCount }}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Requests (in progress)</span>
                        <span class="stat-value">{{ stats.inProgressCount }}</span>
                    </div>
                    <div class="stat-row" v-if="stats.stalledCount > 0">
                        <span class="stat-label">Requests (stalled)</span>
                        <span class="stat-value stalled">{{ stats.stalledCount }}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Carriers</span>
                        <span class="stat-value">{{ stats.carrierCount }}</span>
                    </div>
                    <div class="stat-row" v-if="stats.unregisteredCarriers > 0">
                        <span class="stat-label">Unregistered</span>
                        <span class="stat-value warning">{{ stats.unregisteredCarriers }}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Hubs</span>
                        <span class="stat-value">{{ stats.hubCount }} ({{ stats.totalHubCapacity }} cap)</span>
                    </div>
                    <div class="stat-row" v-if="stats.hubsAtCapacity > 0">
                        <span class="stat-label">Hubs at capacity</span>
                        <span class="stat-value warning">{{ stats.hubsAtCapacity }}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Reservations</span>
                        <span class="stat-value">{{ stats.reservationCount }}</span>
                    </div>
                </div>
            </section>

            <!-- Requests -->
            <section class="panel-section">
                <h3 class="section-header" @click="sections.requests = !sections.requests">
                    <span class="caret">{{ sections.requests ? '&#x25BC;' : '&#x25B6;' }}</span>
                    Requests ({{ stats.pendingCount + stats.inProgressCount }})
                </h3>
                <div v-if="sections.requests" class="section-body">
                    <div
                        v-if="state.pendingRequests.length === 0 && state.inProgressRequests.length === 0"
                        class="empty-state"
                    >
                        No active requests
                    </div>
                    <div v-for="req in allRequests" :key="req.id" class="request-row">
                        <span class="req-material">{{ req.material }}</span>
                        <span class="req-priority" :class="'priority-' + req.priority.toLowerCase()">
                            {{ req.priority[0] }}
                        </span>
                        <span class="req-target">→ #{{ req.buildingId }}</span>
                        <span class="req-age">{{ req.age }}s</span>
                        <span v-if="req.inProgress" class="req-status in-progress">⚙</span>
                        <span v-else class="req-status pending">⏳</span>
                        <span v-if="req.reason" class="req-reason">{{ req.reason }}</span>
                    </div>
                    <div v-if="hasMoreRequests" class="more-indicator">+{{ totalRequests - 15 }} more</div>
                </div>
            </section>

            <!-- Carriers -->
            <section class="panel-section">
                <h3 class="section-header" @click="sections.carriers = !sections.carriers">
                    <span class="caret">{{ sections.carriers ? '&#x25BC;' : '&#x25B6;' }}</span>
                    Carriers ({{ stats.carrierCount }})
                </h3>
                <div v-if="sections.carriers" class="section-body">
                    <div class="carrier-breakdown">
                        <span class="breakdown-item">
                            <span class="breakdown-label">Idle:</span>
                            <span class="breakdown-value">{{ stats.idleCarriers }}</span>
                        </span>
                        <span class="breakdown-item">
                            <span class="breakdown-label">Walk:</span>
                            <span class="breakdown-value">{{ stats.walkingCarriers }}</span>
                        </span>
                        <span class="breakdown-item">
                            <span class="breakdown-label">Pickup:</span>
                            <span class="breakdown-value">{{ stats.pickingUpCarriers }}</span>
                        </span>
                        <span class="breakdown-item">
                            <span class="breakdown-label">Deliver:</span>
                            <span class="breakdown-value">{{ stats.deliveringCarriers }}</span>
                        </span>
                        <span class="breakdown-item">
                            <span class="breakdown-label">Rest:</span>
                            <span class="breakdown-value">{{ stats.restingCarriers }}</span>
                        </span>
                    </div>
                    <div class="fatigue-breakdown">
                        <span class="fatigue-item fresh">Fresh: {{ stats.freshCarriers }}</span>
                        <span class="fatigue-item tired">Tired: {{ stats.tiredCarriers }}</span>
                        <span class="fatigue-item exhausted">Exhausted: {{ stats.exhaustedCarriers }}</span>
                        <span class="fatigue-item collapsed" v-if="stats.collapsedCarriers > 0">
                            Collapsed: {{ stats.collapsedCarriers }}
                        </span>
                    </div>
                    <div v-if="state.carriers.length === 0" class="empty-state">No carriers</div>
                    <div v-for="carrier in state.carriers" :key="carrier.entityId" class="carrier-row">
                        <span class="carrier-id">#{{ carrier.entityId }}</span>
                        <span class="carrier-status" :class="'status-' + carrier.status.toLowerCase()">
                            {{ carrier.status }}
                        </span>
                        <span class="carrier-fatigue" :class="'fatigue-' + carrier.fatigueLevel.toLowerCase()">
                            {{ carrier.fatigue }}%
                        </span>
                        <span v-if="carrier.carryingMaterial" class="carrier-carrying">
                            {{ carrier.carryingMaterial }}
                        </span>
                    </div>
                </div>
            </section>

            <!-- Active Jobs -->
            <section class="panel-section">
                <h3 class="section-header" @click="sections.jobs = !sections.jobs">
                    <span class="caret">{{ sections.jobs ? '&#x25BC;' : '&#x25B6;' }}</span>
                    Active Jobs ({{ activeJobCount }})
                </h3>
                <div v-if="sections.jobs" class="section-body">
                    <div v-if="carriersWithJobs.length === 0" class="empty-state">No active jobs</div>
                    <div v-for="carrier in carriersWithJobs" :key="carrier.entityId" class="job-row">
                        <span class="job-carrier">#{{ carrier.entityId }}</span>
                        <span class="job-type">{{ carrier.jobType }}</span>
                        <span v-if="carrier.carryingMaterial" class="job-material">
                            {{ carrier.carryingMaterial }} ×{{ carrier.carryingAmount }}
                        </span>
                    </div>
                </div>
            </section>

            <!-- Reservations -->
            <section class="panel-section">
                <h3 class="section-header" @click="sections.reservations = !sections.reservations">
                    <span class="caret">{{ sections.reservations ? '&#x25BC;' : '&#x25B6;' }}</span>
                    Reservations ({{ stats.reservationCount }})
                </h3>
                <div v-if="sections.reservations" class="section-body">
                    <div v-if="state.reservations.length === 0" class="empty-state">No reservations</div>
                    <div v-for="res in state.reservations" :key="res.id" class="reservation-row">
                        <span class="res-building">#{{ res.buildingId }}</span>
                        <span class="res-material">{{ res.material }}</span>
                        <span class="res-amount">×{{ res.amount }}</span>
                        <span class="res-request">→ req#{{ res.requestId }}</span>
                    </div>
                </div>
            </section>

            <!-- Hubs -->
            <section class="panel-section">
                <h3 class="section-header" @click="sections.hubs = !sections.hubs">
                    <span class="caret">{{ sections.hubs ? '&#x25BC;' : '&#x25B6;' }}</span>
                    Hubs ({{ stats.hubCount }})
                </h3>
                <div v-if="sections.hubs" class="section-body">
                    <div v-if="state.hubs.length === 0" class="empty-state">No hubs</div>
                    <div v-for="hub in state.hubs" :key="hub.buildingId" class="hub-row">
                        <span class="hub-id">#{{ hub.buildingId }}</span>
                        <span class="hub-capacity" :class="{ 'hub-full': hub.isFull }">
                            {{ hub.carrierCount }}/{{ hub.capacity }}
                        </span>
                        <span v-if="hub.isFull" class="hub-status full">FULL</span>
                    </div>
                </div>
            </section>
        </div>
    </div>
</template>

<script setup lang="ts">
import { reactive, computed, watch } from 'vue';
import { debugStats } from '@/game/debug-stats';
import { useLogisticsDebug } from '@/composables/useLogisticsDebug';
import type { Game } from '@/game/game';
import { EntityType } from '@/game/entity';
import { isUnitTypeSelectable, UnitType } from '@/game/unit-types';

const props = defineProps<{
    game: Game | null;
}>();

const { state } = useLogisticsDebug(() => props.game);

const stats = computed(() => state.value.stats);

// Use persisted open state from debug stats
const open = computed({
    get: () => debugStats.state.logisticsPanelOpen,
    set: (value: boolean) => {
        debugStats.state.logisticsPanelOpen = value;
    },
});

// Debug setting: allow selecting all units (including workers)
const selectAllUnits = computed({
    get: () => debugStats.state.selectAllUnits,
    set: (value: boolean) => {
        debugStats.state.selectAllUnits = value;
    },
});

// When "select all units" is turned off, deselect any non-selectable units
watch(
    () => debugStats.state.selectAllUnits,
    newValue => {
        if (newValue || !props.game) return;
        props.game.state.selection.deselectWhere(
            e => e.type === EntityType.Unit && !isUnitTypeSelectable(e.subType as UnitType)
        );
    }
);

const sections = reactive({
    requests: true,
    carriers: false,
    jobs: false,
    reservations: false,
    hubs: false,
});

// Combine pending and in-progress requests for display
const allRequests = computed(() => {
    return [...state.value.pendingRequests, ...state.value.inProgressRequests]
        .sort((a, b) => {
            // In-progress first, then by priority, then by age
            if (a.inProgress !== b.inProgress) return a.inProgress ? -1 : 1;
            const priorityOrder = { High: 0, Normal: 1, Low: 2 };
            const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
            if (pDiff !== 0) return pDiff;
            return b.age - a.age;
        })
        .slice(0, 15);
});

const totalRequests = computed(() => stats.value.pendingCount + stats.value.inProgressCount);
const hasMoreRequests = computed(() => totalRequests.value > 15);

const carriersWithJobs = computed(() => state.value.carriers.filter(c => c.hasJob));
const activeJobCount = computed(() => carriersWithJobs.value.length);
</script>

<style scoped>
.logistics-panel {
    background: rgba(13, 10, 5, 0.92);
    border: 1px solid #5c3d1a;
    border-radius: 4px;
    color: #c8a96e;
    font-size: 11px;
    font-family: monospace;
    min-width: 200px;
    max-height: 100%;
    overflow-y: auto;
    pointer-events: auto;
}

.logistics-panel.collapsed {
    min-width: 0;
}

.panel-toggle-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 10px;
    background: #2c1e0e;
    color: #d4b27a;
    border: none;
    border-bottom: 1px solid #3a2a10;
    cursor: pointer;
    font-size: 11px;
    font-family: monospace;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.panel-toggle-btn:hover {
    background: #3a2810;
}

.toggle-icon {
    font-size: 8px;
    width: 10px;
}

.panel-sections {
    padding: 2px 0;
}

.panel-section {
    border-bottom: 1px solid #2a1e0e;
}

.panel-section:last-child {
    border-bottom: none;
}

.section-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    margin: 0;
    font-size: 10px;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #8a7040;
    cursor: pointer;
    user-select: none;
}

.section-header:hover {
    color: #c8a96e;
    background: rgba(60, 40, 16, 0.3);
}

.caret {
    font-size: 7px;
    width: 10px;
}

.section-body {
    padding: 2px 10px 6px;
}

/* Settings section */
.settings-section {
    background: rgba(30, 20, 10, 0.5);
}

.setting-row {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    padding: 2px 0;
}

.setting-row:hover {
    color: #e8c87e;
}

.setting-row input[type='checkbox'] {
    width: 12px;
    height: 12px;
    cursor: pointer;
    accent-color: #8a7040;
}

.setting-label {
    font-size: 10px;
    color: #c8a96e;
}

.stat-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 1px 0;
    gap: 12px;
}

.stat-label {
    color: #7a6a4a;
}

.stat-value {
    color: #d4b27a;
    text-align: right;
}

.stat-value.stalled {
    color: #d04040;
    font-weight: bold;
}

.stat-value.warning {
    color: #e0a040;
}

.empty-state {
    color: #4a3a2a;
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
    color: #d4b27a;
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
    color: #80c080;
}

.req-target {
    color: #7a6a4a;
    font-size: 9px;
}

.req-age {
    color: #5a4a3a;
    font-size: 9px;
    min-width: 24px;
    text-align: right;
}

.req-status {
    font-size: 10px;
}

.req-status.in-progress {
    color: #80c080;
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
    color: #5a4a3a;
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
    border-bottom: 1px solid #2a1e0e;
    margin-bottom: 4px;
}

.breakdown-item {
    display: flex;
    gap: 2px;
}

.breakdown-label {
    color: #5a4a3a;
    font-size: 9px;
}

.breakdown-value {
    color: #a08050;
    font-size: 9px;
}

.fatigue-breakdown {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 2px 0 4px;
    border-bottom: 1px solid #2a1e0e;
    margin-bottom: 4px;
    font-size: 9px;
}

.fatigue-item.fresh {
    color: #80c080;
}

.fatigue-item.tired {
    color: #e0c060;
}

.fatigue-item.exhausted {
    color: #e08040;
}

.fatigue-item.collapsed {
    color: #d04040;
}

.carrier-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
    font-size: 10px;
}

.carrier-id {
    color: #7a6a4a;
    min-width: 30px;
}

.carrier-status {
    min-width: 50px;
}

.carrier-status.status-idle {
    color: #80c080;
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

.carrier-fatigue {
    min-width: 28px;
    text-align: right;
}

.carrier-fatigue.fatigue-fresh {
    color: #80c080;
}

.carrier-fatigue.fatigue-tired {
    color: #e0c060;
}

.carrier-fatigue.fatigue-exhausted {
    color: #e08040;
}

.carrier-fatigue.fatigue-collapsed {
    color: #d04040;
}

.carrier-carrying {
    color: #d4b27a;
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
    color: #7a6a4a;
    min-width: 30px;
}

.job-type {
    color: #a080c0;
    min-width: 50px;
}

.job-material {
    color: #d4b27a;
}

/* Reservations */
.reservation-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
    font-size: 10px;
}

.res-building {
    color: #7a6a4a;
    min-width: 30px;
}

.res-material {
    color: #d4b27a;
    flex: 1;
}

.res-amount {
    color: #a08050;
}

.res-request {
    color: #5a4a3a;
    font-size: 9px;
}

/* Hubs */
.hub-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
    font-size: 10px;
}

.hub-id {
    color: #7a6a4a;
    min-width: 30px;
}

.hub-capacity {
    color: #80c080;
    min-width: 40px;
}

.hub-capacity.hub-full {
    color: #e0a040;
}

.hub-status {
    font-size: 9px;
    padding: 1px 4px;
    border-radius: 2px;
    font-weight: bold;
}

.hub-status.full {
    background: #5a3020;
    color: #e0a040;
}

/* Scrollbar */
.logistics-panel::-webkit-scrollbar {
    width: 4px;
}

.logistics-panel::-webkit-scrollbar-track {
    background: #0d0a05;
}

.logistics-panel::-webkit-scrollbar-thumb {
    background: #4a3218;
    border-radius: 2px;
}
</style>
