<template>
    <OverlayPanel v-model:open="open" label="Logistics" title="Logistics Debug Panel">
        <!-- Settings (always visible, no toggle) -->
        <section class="settings-section">
            <Checkbox v-model="selectAllUnits" label="All units selectable" />
        </section>

        <!-- Overview (always open) -->
        <CollapseSection title="Overview">
            <StatRow label="Requests (pending)" :value="stats.pendingCount" />
            <StatRow label="Requests (in progress)" :value="stats.inProgressCount" />
            <StatRow v-if="stats.stalledCount > 0" label="Requests (stalled)">
                <span class="value-stalled">{{ stats.stalledCount }}</span>
            </StatRow>
            <StatRow label="Carriers" :value="stats.carrierCount" />
            <StatRow v-if="stats.unregisteredCarriers > 0" label="Unregistered">
                <span class="value-warning">{{ stats.unregisteredCarriers }}</span>
            </StatRow>
            <StatRow label="Hubs" :value="`${stats.hubCount} (${stats.totalHubCapacity} cap)`" />
            <StatRow v-if="stats.hubsAtCapacity > 0" label="Hubs at capacity">
                <span class="value-warning">{{ stats.hubsAtCapacity }}</span>
            </StatRow>
            <StatRow label="Reservations" :value="stats.reservationCount" />
        </CollapseSection>

        <!-- Requests -->
        <CollapseSection :title="`Requests (${stats.pendingCount + stats.inProgressCount})`">
            <div v-if="state.pendingRequests.length === 0 && state.inProgressRequests.length === 0" class="empty-state">
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
        </CollapseSection>

        <!-- Carriers -->
        <CollapseSection :title="`Carriers (${stats.carrierCount})`" :default-open="false">
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

        <!-- Reservations -->
        <CollapseSection :title="`Reservations (${stats.reservationCount})`" :default-open="false">
            <div v-if="state.reservations.length === 0" class="empty-state">No reservations</div>
            <div v-for="res in state.reservations" :key="res.id" class="reservation-row">
                <span class="res-building">#{{ res.buildingId }}</span>
                <span class="res-material">{{ res.material }}</span>
                <span class="res-amount">×{{ res.amount }}</span>
                <span class="res-request">→ req#{{ res.requestId }}</span>
            </div>
        </CollapseSection>

        <!-- Hubs -->
        <CollapseSection :title="`Hubs (${stats.hubCount})`" :default-open="false">
            <div v-if="state.hubs.length === 0" class="empty-state">No hubs</div>
            <div v-for="hub in state.hubs" :key="hub.buildingId" class="hub-row">
                <span class="hub-id">#{{ hub.buildingId }}</span>
                <span class="hub-capacity" :class="{ 'hub-full': hub.isFull }">
                    {{ hub.carrierCount }}/{{ hub.capacity }}
                </span>
                <Badge v-if="hub.isFull" color="alert">FULL</Badge>
            </div>
        </CollapseSection>
    </OverlayPanel>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { debugStats } from '@/game/debug-stats';
import { useLogisticsDebug } from '@/composables/useLogisticsDebug';
import type { Game } from '@/game/game';
import { EntityType } from '@/game/entity';
import { isUnitTypeSelectable, UnitType } from '@/game/unit-types';
import Checkbox from './Checkbox.vue';
import CollapseSection from './CollapseSection.vue';
import StatRow from './StatRow.vue';
import OverlayPanel from './OverlayPanel.vue';
import Badge from './Badge.vue';

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
/* Settings section (no header, always visible) */
.settings-section {
    padding: 4px 10px;
    border-bottom: 1px solid var(--border-faint);
    background: rgba(30, 20, 10, 0.5);
}

/* Style Checkbox component to match the debug panel context */
.settings-section :deep(.control-row) {
    color: var(--text);
    padding: 2px 0;
}

.settings-section :deep(.control-row:hover) {
    color: var(--text-emphasis);
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
.req-status.in-progress {
    color: var(--status-good);
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

.fatigue-breakdown {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 2px 0 4px;
    border-bottom: 1px solid var(--border-faint);
    margin-bottom: 4px;
    font-size: 9px;
}

.fatigue-item.fresh {
    color: var(--status-good);
}
.fatigue-item.tired {
    color: var(--status-warn);
}
.fatigue-item.exhausted {
    color: var(--status-alert);
}
.fatigue-item.collapsed {
    color: var(--status-bad);
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

.carrier-fatigue {
    min-width: 28px;
    text-align: right;
}
.carrier-fatigue.fatigue-fresh {
    color: var(--status-good);
}
.carrier-fatigue.fatigue-tired {
    color: var(--status-warn);
}
.carrier-fatigue.fatigue-exhausted {
    color: var(--status-alert);
}
.carrier-fatigue.fatigue-collapsed {
    color: var(--status-bad);
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

/* Reservations */
.reservation-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
    font-size: 10px;
}
.res-building {
    color: var(--text-muted);
    min-width: 30px;
}
.res-material {
    color: var(--text-bright);
    flex: 1;
}
.res-amount {
    color: var(--text-muted);
}
.res-request {
    color: var(--text-faint);
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
    color: var(--text-muted);
    min-width: 30px;
}
.hub-capacity {
    color: var(--status-good);
    min-width: 40px;
}
.hub-capacity.hub-full {
    color: var(--status-alert);
}
</style>
