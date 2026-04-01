<template>
    <template v-if="garrison">
        <div class="info-section garrison-section">
            <div class="section-label">Garrison</div>

            <!-- Swordsman row -->
            <div class="garrison-row">
                <span class="garrison-row-label">⚔️</span>
                <div class="garrison-slots">
                    <button
                        v-for="unit in swordsmanSlots"
                        :key="unit.unitId ?? 'sw-empty-' + unit.slotIndex"
                        class="garrison-slot"
                        :class="{
                            'garrison-slot-filled': unit.unitId !== null,
                            'garrison-slot-empty': unit.unitId === null,
                            'garrison-slot-disabled': unit.unitId !== null && !garrison.canEject(unit.unitId!),
                        }"
                        :title="slotTitle(unit.unitId)"
                        :disabled="unit.unitId === null || !garrison.canEject(unit.unitId!)"
                        @click="unit.unitId !== null ? ungarrison(unit.unitId) : undefined"
                    >
                        <template v-if="unit.unitId !== null">
                            <img
                                v-if="unit.iconKey && unitIcons[unit.iconKey]"
                                :src="unitIcons[unit.iconKey]!.url"
                                class="garrison-unit-sprite"
                                :style="{
                                    width: unitIcons[unit.iconKey]!.size + 'px',
                                    height: unitIcons[unit.iconKey]!.size + 'px',
                                }"
                            />
                            <span v-else class="garrison-unit-icon">⚔️</span>
                        </template>
                    </button>
                </div>
                <span class="garrison-slots-count"
                    >{{ garrison.swordsmanSlots.units.length }}/{{ garrison.swordsmanSlots.max }}</span
                >
            </div>

            <!-- Bowman row -->
            <div class="garrison-row">
                <span class="garrison-row-label">🏹</span>
                <div class="garrison-slots">
                    <button
                        v-for="unit in bowmanSlots"
                        :key="unit.unitId ?? 'bw-empty-' + unit.slotIndex"
                        class="garrison-slot"
                        :class="{
                            'garrison-slot-filled': unit.unitId !== null,
                            'garrison-slot-empty': unit.unitId === null,
                            'garrison-slot-disabled': unit.unitId !== null && !garrison.canEject(unit.unitId!),
                        }"
                        :title="slotTitle(unit.unitId)"
                        :disabled="unit.unitId === null || !garrison.canEject(unit.unitId!)"
                        @click="unit.unitId !== null ? ungarrison(unit.unitId) : undefined"
                    >
                        <template v-if="unit.unitId !== null">
                            <img
                                v-if="unit.iconKey && unitIcons[unit.iconKey]"
                                :src="unitIcons[unit.iconKey]!.url"
                                class="garrison-unit-sprite"
                                :style="{
                                    width: unitIcons[unit.iconKey]!.size + 'px',
                                    height: unitIcons[unit.iconKey]!.size + 'px',
                                }"
                            />
                            <span v-else class="garrison-unit-icon">🏹</span>
                        </template>
                    </button>
                </div>
                <span class="garrison-slots-count"
                    >{{ garrison.bowmanSlots.units.length }}/{{ garrison.bowmanSlots.max }}</span
                >
            </div>
        </div>
    </template>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Game } from '@/game/game';
import { useGarrison } from '@/composables/use-garrison';
import { UnitType } from '@/game/core/unit-types';
import { ALL_UNITS } from '@/views/palette-data';
import type { IconEntry } from '@/views/sprite-icon-loader';

const props = defineProps<{
    buildingId: number;
    game: Game;
    unitIcons: Record<string, IconEntry>;
}>();

const gameRef = computed(() => props.game);
const buildingIdRef = computed(() => props.buildingId);
const tick = computed(() => props.game.viewState.state.tick);

const garrison = useGarrison(gameRef, buildingIdRef, tick);

/** Map UnitType → palette id for icon lookup */
const unitTypeToIconKey = new Map<UnitType, string>(ALL_UNITS.map(u => [u.type, u.id]));

interface GarrisonSlotDisplay {
    slotIndex: number;
    unitId: number | null;
    level: number;
    iconKey: string | null;
}

const swordsmanSlots = computed<GarrisonSlotDisplay[]>(() => {
    const g = garrison.value;
    if (!g) {
        return [];
    }
    return Array.from({ length: g.swordsmanSlots.max }, (_, i) => ({
        slotIndex: i,
        // eslint-disable-next-line no-restricted-syntax -- units[i] is absent for empty slots; null is correct for empty slot
        unitId: g.swordsmanSlots.units[i]?.unitId ?? null,
        // eslint-disable-next-line no-restricted-syntax -- units[i] is absent for empty slots; 0 is correct default level
        level: g.swordsmanSlots.units[i]?.level ?? 0,
        iconKey: g.swordsmanSlots.units[i] ? (unitTypeToIconKey.get(g.swordsmanSlots.units[i].unitType) ?? null) : null,
    }));
});

const bowmanSlots = computed<GarrisonSlotDisplay[]>(() => {
    const g = garrison.value;
    if (!g) {
        return [];
    }
    return Array.from({ length: g.bowmanSlots.max }, (_, i) => ({
        slotIndex: i,
        // eslint-disable-next-line no-restricted-syntax -- units[i] is absent for empty slots; null is correct for empty slot
        unitId: g.bowmanSlots.units[i]?.unitId ?? null,
        // eslint-disable-next-line no-restricted-syntax -- units[i] is absent for empty slots; 0 is correct default level
        level: g.bowmanSlots.units[i]?.level ?? 0,
        iconKey: g.bowmanSlots.units[i] ? (unitTypeToIconKey.get(g.bowmanSlots.units[i].unitType) ?? null) : null,
    }));
});

function slotTitle(unitId: number | null): string {
    if (unitId === null) {
        return '';
    }
    return garrison.value!.canEject(unitId) ? 'Click to release' : 'Last soldier — cannot release';
}

function ungarrison(unitId: number): void {
    props.game.execute({ type: 'ungarrison_unit', buildingId: props.buildingId, unitId });
}
</script>

<style scoped>
.garrison-section {
    border-top-color: var(--border-soft);
}

.garrison-row {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 3px;
}

.garrison-row-label {
    font-size: 10px;
    width: 14px;
    text-align: center;
    flex-shrink: 0;
}

.garrison-slots {
    display: flex;
    gap: 2px;
    flex: 1;
}

.garrison-slots-count {
    font-size: 9px;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
}

.garrison-slot {
    width: 29px;
    height: 29px;
    border-radius: 3px;
    border: 1px solid rgba(180, 140, 80, 0.3);
    background: rgba(30, 25, 15, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    position: relative;
    padding: 0;
    font-size: 9px;
    flex-direction: column;
    transition:
        background 0.15s,
        border-color 0.15s;
}

.garrison-slot-empty {
    cursor: default;
    opacity: 0.35;
}

.garrison-slot-filled {
    border-color: rgba(200, 160, 80, 0.7);
    background: rgba(60, 45, 20, 0.45);
}

.garrison-slot-filled:hover {
    background: rgba(100, 70, 25, 0.6);
    border-color: rgba(220, 170, 80, 0.85);
}

.garrison-slot-disabled {
    border-color: transparent;
    cursor: not-allowed;
}

.garrison-slot-disabled:hover {
    background: rgba(60, 45, 20, 0.45);
    border-color: transparent;
}

.garrison-unit-sprite {
    max-width: 27px;
    max-height: 27px;
    object-fit: contain;
    image-rendering: pixelated;
    pointer-events: none;
}

.garrison-unit-icon {
    font-size: 9px;
    line-height: 1;
}

.garrison-unit-level {
    font-size: 7px;
    line-height: 1;
    color: var(--text-dim);
}
</style>
