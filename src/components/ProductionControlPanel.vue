<template>
    <div class="info-section production-section">
        <div class="section-label">{{ sectionLabel }}</div>

        <!-- Mode selector -->
        <div class="production-mode">
            <button
                v-for="m in [ProductionMode.Even, ProductionMode.Proportional, ProductionMode.Manual]"
                :key="m"
                class="mode-btn"
                :class="{ active: state.mode === m }"
                @click="emit('setMode', m)"
            >
                {{ m }}
            </button>
        </div>

        <!-- Even mode: recipe list only (no controls) -->
        <template v-if="state.mode === ProductionMode.Even">
            <div class="recipe-grid">
                <div v-for="recipe in state.recipes" :key="recipe.index" class="recipe-item">
                    <span class="recipe-name">{{ recipe.outputName }}</span>
                </div>
            </div>
        </template>

        <!-- Proportional mode: sliders for recipe weights -->
        <template v-else-if="state.mode === ProductionMode.Proportional">
            <div class="recipe-grid">
                <div v-for="recipe in state.recipes" :key="recipe.index" class="recipe-item">
                    <span class="recipe-name">{{ recipe.outputName }}</span>
                    <div class="recipe-slider">
                        <input
                            type="range"
                            class="proportion-slider"
                            :value="recipe.weight"
                            min="0"
                            max="10"
                            step="1"
                            @input="
                                emit('setProportion', recipe.index, Number(($event.target as HTMLInputElement).value))
                            "
                        />
                        <span class="recipe-weight">{{ recipe.weight }}</span>
                    </div>
                </div>
            </div>
        </template>

        <!-- Manual mode: queue display + add/remove buttons -->
        <template v-else>
            <div v-if="state.queue.length > 0" class="queue-display">
                {{ state.queue.join(' �� ') }}
            </div>
            <div v-else class="queue-empty">Queue empty (idle)</div>
            <div class="recipe-grid">
                <div v-for="recipe in state.recipes" :key="recipe.index" class="recipe-item">
                    <span class="recipe-name">{{ recipe.outputName }}</span>
                    <div class="recipe-controls">
                        <button class="recipe-btn" @click="emit('addToQueue', recipe.index)">+1</button>
                        <button class="recipe-btn" @click="emit('removeFromQueue', recipe.index)">-1</button>
                    </div>
                </div>
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import { ProductionMode } from '@/game/features/production-control';
import type { ProductionControlState } from '@/composables/useProductionControl';

defineProps<{
    state: ProductionControlState;
    sectionLabel: string;
}>();

const emit = defineEmits<{
    setMode: [mode: ProductionMode];
    setProportion: [recipeIndex: number, weight: number];
    addToQueue: [recipeIndex: number];
    removeFromQueue: [recipeIndex: number];
}>();
</script>

<style scoped>
.info-section {
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px solid var(--border-faint);
}

.section-label {
    font-size: 9px;
    text-transform: uppercase;
    color: var(--text-dim);
    margin-bottom: 4px;
    letter-spacing: 0.5px;
}

.production-section {
    border-top-color: var(--border-soft);
}

.production-mode {
    display: flex;
    gap: 2px;
    margin-bottom: 6px;
}

.mode-btn {
    flex: 1;
    padding: 2px 4px;
    font-size: 9px;
    text-transform: capitalize;
    border: 1px solid rgba(180, 140, 80, 0.3);
    border-radius: 2px;
    background: rgba(40, 30, 15, 0.4);
    color: var(--text-secondary);
    cursor: pointer;
    transition:
        background 0.15s,
        color 0.15s;
}

.mode-btn:hover {
    background: rgba(60, 45, 20, 0.5);
    color: var(--text);
}

.mode-btn.active {
    background: rgba(180, 140, 60, 0.3);
    border-color: rgba(200, 160, 60, 0.5);
    color: var(--text-bright);
}

.recipe-grid {
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.recipe-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 4px;
    font-size: 10px;
}

.recipe-name {
    color: var(--text-secondary);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.recipe-controls {
    display: flex;
    align-items: center;
    gap: 2px;
}

.recipe-btn {
    width: 18px;
    height: 16px;
    font-size: 10px;
    line-height: 1;
    border: 1px solid rgba(180, 140, 80, 0.3);
    border-radius: 2px;
    background: rgba(40, 30, 15, 0.4);
    color: var(--text-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
}

.recipe-btn:hover {
    background: rgba(80, 60, 25, 0.5);
    color: var(--text);
}

.recipe-weight {
    min-width: 14px;
    text-align: center;
    font-size: 10px;
    color: var(--text-emphasis);
    font-variant-numeric: tabular-nums;
}

.recipe-slider {
    display: flex;
    align-items: center;
    gap: 4px;
}

.proportion-slider {
    width: 60px;
    height: 10px;
    appearance: none;
    background: rgba(40, 30, 15, 0.5);
    border-radius: 3px;
    outline: none;
    cursor: pointer;
}

.proportion-slider::-webkit-slider-thumb {
    appearance: none;
    width: 10px;
    height: 14px;
    border-radius: 2px;
    background: rgba(180, 140, 60, 0.8);
    border: 1px solid rgba(220, 170, 60, 0.6);
    cursor: pointer;
}

.proportion-slider::-moz-range-thumb {
    width: 10px;
    height: 14px;
    border-radius: 2px;
    background: rgba(180, 140, 60, 0.8);
    border: 1px solid rgba(220, 170, 60, 0.6);
    cursor: pointer;
}

.queue-display {
    font-size: 9px;
    color: var(--text-secondary);
    padding: 3px 4px;
    margin-bottom: 4px;
    background: rgba(30, 25, 15, 0.4);
    border-radius: 2px;
    overflow-x: auto;
    white-space: nowrap;
}

.queue-empty {
    font-size: 9px;
    color: var(--text-dim);
    font-style: italic;
    padding: 3px 4px;
    margin-bottom: 4px;
}
</style>
