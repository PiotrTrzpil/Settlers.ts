<template>
    <div class="sld-backdrop" @click.self="$emit('close')">
        <div class="sld-dialog">
            <div class="sld-header">
                <h2 class="sld-title">Save / Load</h2>
                <button class="sld-close" @click="$emit('close')">&#10005;</button>
            </div>

            <div class="sld-body">
                <!-- Manual save action -->
                <div class="sld-save-row">
                    <button class="sld-save-btn" :disabled="isSaving" @click="doManualSave">
                        {{ isSaving ? 'Saving...' : 'Save Game' }}
                    </button>
                    <span v-if="saveMessage" class="sld-save-msg">{{ saveMessage }}</span>
                </div>

                <!-- Save list -->
                <div class="sld-list-header">Saved Games</div>
                <div v-if="isLoading" class="sld-empty">Loading saves...</div>
                <div v-else-if="saves.length === 0" class="sld-empty">No saves found for this map</div>
                <div v-else class="sld-list">
                    <div v-for="save in saves" :key="save.id" class="sld-entry">
                        <div class="sld-entry-info">
                            <span class="sld-badge" :class="'sld-badge--' + save.type">
                                {{ save.type === 'auto' ? 'AUTO' : 'MANUAL' }}
                            </span>
                            <span class="sld-label">{{ save.label }}</span>
                            <span class="sld-time">{{ formatTime(save.timestamp) }}</span>
                        </div>
                        <div class="sld-entry-actions">
                            <button class="sld-action-btn sld-action-btn--load" @click="confirmingLoad = save">
                                Load
                            </button>
                            <button class="sld-action-btn sld-action-btn--delete" @click="doDelete(save)">
                                &#10005;
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Load confirmation -->
            <div v-if="confirmingLoad" class="sld-confirm">
                <p class="sld-confirm-msg">Load this save? Unsaved progress will be lost.</p>
                <div class="sld-confirm-actions">
                    <button class="sld-action-btn" @click="confirmingLoad = null">Cancel</button>
                    <button class="sld-action-btn sld-action-btn--load" @click="doLoad(confirmingLoad!)">Load</button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { GameModeSaveManager, type SaveEntry } from '@/game/state/game-mode-saves';
import { getCurrentMapId } from '@/game/state/game-state-persistence';

const props = defineProps<{
    saveManager: GameModeSaveManager;
}>();

const emit = defineEmits<{
    (e: 'close' | 'loaded'): void;
}>();

const saves = ref<SaveEntry[]>([]);
const isLoading = ref(true);
const isSaving = ref(false);
const saveMessage = ref('');
const confirmingLoad = ref<SaveEntry | null>(null);

function formatTime(ts: number): string {
    const ago = Date.now() - ts;
    if (ago < 60_000) {
        return 'just now';
    }
    if (ago < 3_600_000) {
        return `${Math.floor(ago / 60_000)}m ago`;
    }
    if (ago < 86_400_000) {
        return `${Math.floor(ago / 3_600_000)}h ago`;
    }
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function refreshList(): Promise<void> {
    isLoading.value = true;
    saves.value = await props.saveManager.listSaves(getCurrentMapId());
    isLoading.value = false;
}

async function doManualSave(): Promise<void> {
    isSaving.value = true;
    saveMessage.value = '';
    const entry = await props.saveManager.manualSave();
    isSaving.value = false;
    if (entry) {
        saveMessage.value = 'Saved!';
        await refreshList();
        setTimeout(() => {
            saveMessage.value = '';
        }, 2000);
    } else {
        saveMessage.value = 'Save failed';
    }
}

async function doLoad(save: SaveEntry): Promise<void> {
    confirmingLoad.value = null;
    const ok = await props.saveManager.loadSave(save.id);
    if (ok) {
        emit('loaded');
        emit('close');
    }
}

async function doDelete(save: SaveEntry): Promise<void> {
    await props.saveManager.deleteSave(save.id);
    await refreshList();
}

onMounted(() => {
    void refreshList();
});
</script>

<style scoped>
.sld-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 400;
    display: flex;
    align-items: center;
    justify-content: center;
}

.sld-dialog {
    background: #1a1209;
    border: 2px solid #5c3d1a;
    border-radius: 8px;
    width: 420px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
}

.sld-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
    border-bottom: 1px solid #3a2810;
}

.sld-title {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
    color: #e8c87e;
    letter-spacing: 1px;
    text-transform: uppercase;
}

.sld-close {
    background: none;
    border: none;
    color: #8a7040;
    font-size: 16px;
    cursor: pointer;
    padding: 2px 6px;
}

.sld-close:hover {
    color: #e8c87e;
}

.sld-body {
    padding: 16px 20px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

/* Save action row */
.sld-save-row {
    display: flex;
    align-items: center;
    gap: 12px;
}

.sld-save-btn {
    padding: 8px 24px;
    background: #3a6e28;
    color: #e8f4e0;
    border: 1px solid #4a8e34;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    transition: background 0.15s;
}

.sld-save-btn:hover:not(:disabled) {
    background: #4a8e34;
}

.sld-save-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.sld-save-msg {
    font-size: 12px;
    color: #80c080;
}

/* List */
.sld-list-header {
    font-size: 11px;
    font-weight: 600;
    color: #8a7040;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    border-bottom: 1px solid #3a2810;
    padding-bottom: 6px;
}

.sld-empty {
    font-size: 12px;
    color: #6a5030;
    text-align: center;
    padding: 20px 0;
}

.sld-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 300px;
    overflow-y: auto;
}

.sld-entry {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    background: #2c1e0e;
    border: 1px solid #3a2810;
    border-radius: 4px;
    transition: border-color 0.12s;
}

.sld-entry:hover {
    border-color: #5c3d1a;
}

.sld-entry-info {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1;
}

.sld-badge {
    font-size: 9px;
    font-weight: 700;
    padding: 2px 5px;
    border-radius: 2px;
    letter-spacing: 0.5px;
    flex-shrink: 0;
}

.sld-badge--auto {
    background: #2a3a4a;
    color: #6a9aca;
}

.sld-badge--manual {
    background: #3a3a20;
    color: #c8c060;
}

.sld-label {
    font-size: 12px;
    color: #c8a96e;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.sld-time {
    font-size: 11px;
    color: #6a5030;
    flex-shrink: 0;
}

.sld-entry-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
    margin-left: 8px;
}

.sld-action-btn {
    padding: 4px 10px;
    border-radius: 3px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid transparent;
    transition: background 0.12s;
}

.sld-action-btn--load {
    background: #3a6e28;
    color: #e8f4e0;
    border-color: #4a8e34;
}

.sld-action-btn--load:hover {
    background: #4a8e34;
}

.sld-action-btn--delete {
    background: transparent;
    color: #8a5030;
    border-color: #4a3218;
    padding: 4px 6px;
}

.sld-action-btn--delete:hover {
    background: #4a2020;
    color: #d06060;
    border-color: #8a3030;
}

/* Load confirmation */
.sld-confirm {
    margin-top: 4px;
    padding: 12px;
    background: #2c1e0e;
    border: 1px solid #5c3d1a;
    border-radius: 4px;
    text-align: center;
}

.sld-confirm-msg {
    margin: 0 0 10px;
    font-size: 13px;
    color: #d4c4a0;
}

.sld-confirm-actions {
    display: flex;
    justify-content: center;
    gap: 10px;
}

/* Scrollbar */
.sld-list::-webkit-scrollbar {
    width: 5px;
}

.sld-list::-webkit-scrollbar-track {
    background: #1a1209;
}

.sld-list::-webkit-scrollbar-thumb {
    background: #4a3218;
    border-radius: 3px;
}
</style>
