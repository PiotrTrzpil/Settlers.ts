<template>
    <div class="specialists-panel">
        <div v-for="entry in specialists" :key="entry.id" class="specialist-row">
            <span class="specialist-icon">
                <img
                    v-if="specialistIcons[entry.id]"
                    :src="specialistIcons[entry.id]!.url"
                    :alt="entry.name"
                    class="specialist-icon-img"
                    :style="{
                        width: specialistIcons[entry.id]!.size + 'px',
                        height: specialistIcons[entry.id]!.size + 'px',
                    }"
                />
                <span v-else>{{ entry.icon }}</span>
            </span>
            <div class="specialist-body">
                <span class="specialist-name">{{ entry.name }}</span>
                <div class="specialist-bottom">
                    <span class="specialist-counts">
                        <span class="specialist-live">{{ entry.liveCount }}</span>
                        <span
                            v-if="entry.queuedCount + entry.pendingCount > 0"
                            class="specialist-pending"
                            :title="`Q: ${entry.queuedCount} queued, P: ${entry.pendingCount} in transit`"
                            >(+{{ entry.queuedCount + entry.pendingCount }})</span
                        >
                    </span>
                    <div class="specialist-buttons">
                        <button
                            class="sp-btn sp-btn-minus"
                            :disabled="entry.queuedCount + entry.liveCount === 0"
                            @click="recruit(entry.type, -5)"
                        >
                            -5
                        </button>
                        <button
                            class="sp-btn sp-btn-minus"
                            :disabled="entry.queuedCount + entry.liveCount === 0"
                            @click="recruit(entry.type, -1)"
                        >
                            -1
                        </button>
                        <button class="sp-btn sp-btn-plus" @click="recruit(entry.type, 1)">+1</button>
                        <button class="sp-btn sp-btn-plus" @click="recruit(entry.type, 5)">+5</button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Game } from '@/game/game';
import type { UnitType } from '@/game/entity';
import { Race } from '@/game/core/race';
import type { IconEntry } from '@/views/sprite-icon-loader';
import { useSpecialists } from '@/composables/use-specialists';

const props = defineProps<{
    game: Game | null;
    race: Race;
    specialistIcons: Record<string, IconEntry>;
    getCameraCenter: () => { x: number; y: number } | null;
}>();

const gameRef = computed(() => props.game);
const raceRef = computed(() => props.race);
const tick = computed(() => props.game?.viewState.state.tick ?? 0);

const specialists = useSpecialists(gameRef, tick, raceRef);

function recruit(unitType: UnitType, count: number): void {
    const g = props.game;
    if (!g) return;
    const cam = count > 0 ? props.getCameraCenter() : null;
    g.execute({
        type: 'recruit_specialist',
        unitType,
        count,
        player: g.currentPlayer,
        race: props.race,
        nearX: cam?.x,
        nearY: cam?.y,
    });
}
</script>

<style scoped>
.specialists-panel {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px 2px;
}

.specialist-row {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 12px 4px;
    background: #2c1e0e;
    border: 1px solid #4a3218;
    border-radius: 3px;
}

.specialist-icon {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font-size: 16px;
}

.specialist-icon-img {
    object-fit: contain;
}

.specialist-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
}

.specialist-name {
    font-size: 11px;
    color: #c8a96e;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.specialist-bottom {
    display: flex;
    align-items: center;
    gap: 4px;
}

.specialist-counts {
    display: flex;
    align-items: center;
    gap: 2px;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
}

.specialist-live {
    color: #e8c87e;
    min-width: 12px;
    text-align: right;
}

.specialist-pending {
    color: #a0c090;
    font-size: 10px;
    cursor: help;
}

.specialist-buttons {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
    margin-left: auto;
}

.sp-btn {
    padding: 1px 4px;
    font-size: 10px;
    font-weight: bold;
    border-radius: 2px;
    border: 1px solid #4a3218;
    cursor: pointer;
    background: #1a1209;
    color: #c8a96e;
    transition:
        background 0.1s,
        border-color 0.1s;
}

.sp-btn:hover:not(:disabled) {
    background: #3a2810;
    border-color: #6a4a20;
}

.sp-btn:disabled {
    opacity: 0.35;
    cursor: default;
}

.sp-btn-plus {
    color: #80c080;
    border-color: #2a4a2a;
    background: #1a2a1a;
}

.sp-btn-plus:hover:not(:disabled) {
    background: #1f3a1f;
    border-color: #3a6a3a;
}
</style>
