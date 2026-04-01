<template>
    <div v-if="isStorageArea" class="info-section storage-section">
        <div class="section-label">Storage</div>
        <div class="storage-filter-list">
            <div
                v-for="item in storageFilter"
                :key="item.material"
                class="storage-filter-item"
                :class="{ active: item.direction !== null }"
            >
                <span class="sf-name" @click="cycleDirection(item.material)">{{ item.name }}</span>
                <div class="sf-buttons">
                    <button
                        class="sf-btn"
                        :class="{ on: isImport(item) }"
                        title="Import"
                        @click="toggleImport(item.material, item.direction)"
                    >
                        IN
                    </button>
                    <button
                        class="sf-btn"
                        :class="{ on: isExport(item) }"
                        title="Export"
                        @click="toggleExport(item.material, item.direction)"
                    >
                        OUT
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Game } from '@/game/game';
import { useSelectionPanel } from '@/composables/useSelectionPanel';
import { useStorageFilter, StorageDirection } from '@/composables/useStorageFilter';
import type { EMaterialType } from '@/game/economy/material-type';

const props = defineProps<{ game: Game }>();

const gameRef = computed(() => props.game);
const { selectedEntity, tick } = useSelectionPanel(gameRef);
const { isStorageArea, storageFilter, cycleDirection, setDirection } = useStorageFilter(gameRef, selectedEntity, tick);

function isImport(item: { direction: StorageDirection | null }): boolean {
    return item.direction === StorageDirection.Import || item.direction === StorageDirection.Both;
}

function isExport(item: { direction: StorageDirection | null }): boolean {
    return item.direction === StorageDirection.Export || item.direction === StorageDirection.Both;
}

function toggleImport(material: EMaterialType, current: StorageDirection | null): void {
    const wasImport = current === StorageDirection.Import || current === StorageDirection.Both;
    if (wasImport) {
        setDirection(material, current === StorageDirection.Both ? StorageDirection.Export : null);
    } else {
        setDirection(material, current === StorageDirection.Export ? StorageDirection.Both : StorageDirection.Import);
    }
}

function toggleExport(material: EMaterialType, current: StorageDirection | null): void {
    const wasExport = current === StorageDirection.Export || current === StorageDirection.Both;
    if (wasExport) {
        setDirection(material, current === StorageDirection.Both ? StorageDirection.Import : null);
    } else {
        setDirection(material, current === StorageDirection.Import ? StorageDirection.Both : StorageDirection.Export);
    }
}
</script>

<style scoped>
.storage-section {
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px solid var(--border-faint);
    border-top-color: var(--border-soft);
}

.section-label {
    font-size: 9px;
    text-transform: uppercase;
    color: var(--text-dim);
    margin-bottom: 4px;
    letter-spacing: 0.5px;
}

.storage-filter-list {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px 6px;
    padding: 4px 0;
}

.storage-filter-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1px 2px;
    font-size: 10px;
    color: var(--text-dim);
}

.storage-filter-item.active {
    color: var(--text);
}

.sf-name {
    cursor: pointer;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.sf-name:hover {
    color: var(--text-bright);
}

.sf-buttons {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
}

.sf-btn {
    padding: 1px 4px;
    font-size: 8px;
    font-weight: bold;
    letter-spacing: 0.3px;
    border: 1px solid rgba(120, 100, 60, 0.3);
    border-radius: 2px;
    background: rgba(30, 25, 15, 0.4);
    color: var(--text-dim);
    cursor: pointer;
    line-height: 1.2;
    transition:
        background 0.12s,
        color 0.12s,
        border-color 0.12s;
}

.sf-btn:hover {
    background: rgba(60, 45, 20, 0.5);
    color: var(--text-secondary);
}

.sf-btn.on {
    background: rgba(100, 160, 60, 0.3);
    border-color: rgba(120, 180, 80, 0.5);
    color: #c8ff90;
}
</style>
