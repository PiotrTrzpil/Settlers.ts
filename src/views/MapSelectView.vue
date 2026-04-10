<template>
    <div class="map-select">
        <div class="map-select-card">
            <div class="map-select-header">
                <h1 class="map-select-title">Select Map</h1>
                <p class="map-select-subtitle">Choose a map to play</p>
            </div>

            <div class="map-select-body">
                <div class="map-list-area">
                    <!-- Group list -->
                    <div v-if="!activeGroup" class="map-list">
                        <button
                            v-for="g in mapGroups"
                            :key="g.name"
                            class="map-item map-group-item"
                            @click="openGroup(g.name)"
                        >
                            <span class="map-group-icon">&#128193;</span>
                            {{ g.label }}
                            <span class="map-group-count">{{ g.files.length }}</span>
                        </button>
                    </div>
                    <!-- Maps in active group -->
                    <div v-else class="map-list">
                        <button class="map-item map-back-item" @click="goBackToGroups()">
                            &#8592; {{ activeGroupLabel }}
                        </button>
                        <button
                            v-for="file in activeGroupFiles"
                            :key="file.path"
                            class="map-item"
                            :class="{ selected: selectedFile?.path === file.path }"
                            :title="file.name"
                            @click="selectMap(file)"
                        >
                            {{ file.name }}
                        </button>
                    </div>
                </div>

                <div v-if="selectedFile" class="map-preview-area">
                    <div class="map-preview-top">
                        <div class="map-preview-left">
                            <map-preview :mapLoader="previewLoader" :maxSize="280" />
                            <div v-if="mapSize" class="map-details">
                                <span class="map-detail">{{ mapSize.width }} x {{ mapSize.height }}</span>
                                <span v-if="mapInfo.playerCount" class="map-detail">
                                    {{ mapInfo.playerCount }} players
                                </span>
                            </div>
                            <div v-if="mapInfo.players.length > 0" class="map-players">
                                <div v-for="p in mapInfo.players" :key="p.index" class="map-player-row">
                                    <span class="map-player-dot" :style="{ background: p.color }" />
                                    <span class="map-player-label">P{{ p.index }}</span>
                                    <span class="map-player-race">{{ p.race }}</span>
                                </div>
                            </div>
                            <div class="map-setting" :class="{ disabled: !mapSupportsStartResources }">
                                <label class="map-setting-label">Start Resources</label>
                                <div class="map-setting-options">
                                    <button
                                        v-for="opt in startResourceOptions"
                                        :key="opt.value"
                                        class="setting-option"
                                        :class="{ active: selectedStartResources === opt.value }"
                                        :disabled="!mapSupportsStartResources"
                                        @click="setStartResources(opt.value)"
                                    >
                                        {{ opt.label
                                        }}<span v-if="mapDefaultResources === opt.value" class="default-tag"
                                            >default</span
                                        >
                                    </button>
                                </div>
                                <span v-if="!mapSupportsStartResources" class="setting-hint"
                                    >Campaign map — resources built in</span
                                >
                            </div>
                        </div>
                        <div class="map-info-right">
                            <div
                                v-if="mapInfo.description"
                                class="map-description"
                                v-html="formatDescription(mapInfo.description)"
                            />
                            <div v-else-if="selectedFile" class="map-description map-description--empty">
                                No description
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="map-select-actions">
                <button class="back-btn" @click="$router.push('/')">Back</button>
                <button class="play-btn" :disabled="!selectedFile" @click="startGame">&#9654; Play</button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { FileManager, IFileSource } from '@/utilities/file-manager';
import { MapLoader } from '@/resources/map/map-loader';
import type { IMapLoader } from '@/resources/map/imap-loader';
import { S4Tribe } from '@/resources/map/s4-types';
import { MapStartResources } from '@/resources/map/map-start-resources';
import { readStartResources, saveStartResources, mapNeedsStartResources } from '@/game/state/game-mode-settings';
import MapPreview from '@/components/map-preview.vue';

const PLAYER_COLORS = [
    'rgb(200,50,50)',
    'rgb(50,80,200)',
    'rgb(50,180,50)',
    'rgb(220,200,50)',
    'rgb(160,60,180)',
    'rgb(220,140,40)',
    'rgb(50,190,200)',
    'rgb(210,210,210)',
];

const TRIBE_NAMES: Record<number, string> = {
    [S4Tribe.ROMAN]: 'Roman',
    [S4Tribe.VIKING]: 'Viking',
    [S4Tribe.MAYA]: 'Mayan',
    [S4Tribe.DARK]: 'Dark Tribe',
    [S4Tribe.TROJAN]: 'Trojan',
};

interface MapInfoState {
    playerCount: number;
    players: { index: number; race: string; color: string }[];
    description: string;
}

const props = defineProps<{
    fileManager: FileManager;
}>();

const router = useRouter();

const mapFiles = ref<IFileSource[]>([]);
const selectedFile = ref<IFileSource | null>(null);
const previewLoader = ref<IMapLoader | null>(null);
const mapSize = ref<{ width: number; height: number } | null>(null);
const mapInfo = reactive<MapInfoState>({ playerCount: 0, players: [], description: '' });

const startResourceOptions = [
    { value: MapStartResources.low, label: 'Few' },
    { value: MapStartResources.medium, label: 'Medium' },
    { value: MapStartResources.high, label: 'Many' },
];

const selectedStartResources = ref<MapStartResources>(readStartResources());
const mapDefaultResources = ref<MapStartResources | null>(null);
const mapSupportsStartResources = ref(true);

function setStartResources(value: MapStartResources): void {
    selectedStartResources.value = value;
    saveStartResources(value);
}

interface MapGroup {
    name: string;
    label: string;
    files: IFileSource[];
}

const mapGroups = ref<MapGroup[]>([]);
const activeGroup = ref<string | null>(null);

// eslint-disable-next-line no-restricted-syntax -- activeGroup may not match any group (returns empty fallback)
const activeGroupFiles = computed(() => mapGroups.value.find(g => g.name === activeGroup.value)?.files ?? []);
// eslint-disable-next-line no-restricted-syntax -- activeGroup may not match any group (returns empty fallback)
const activeGroupLabel = computed(() => mapGroups.value.find(g => g.name === activeGroup.value)?.label ?? '');

const GROUP_LABELS: Record<string, string> = {
    AO_: 'Add-On Campaign',
    dark: 'Dark Campaign',
    roman: 'Roman Campaign',
    maya: 'Maya Campaign',
    viking: 'Viking Campaign',
    MCD2_: 'Mission CD 2',
    MD_: 'Mission Disc',
    XMD3_: 'Mission CD 3',
    CM_: 'Community Maps',
    Tutorial: 'Tutorials',
};

function naturalSort(a: IFileSource, b: IFileSource): number {
    return a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' });
}

function buildGroups(files: IFileSource[]): MapGroup[] {
    const prefixes = Object.keys(GROUP_LABELS);
    const groups = new Map<string, IFileSource[]>();
    const ungrouped: IFileSource[] = [];

    for (const file of files) {
        const prefix = prefixes.find(p => file.name.startsWith(p));
        if (prefix) {
            let list = groups.get(prefix);
            if (!list) {
                list = [];
                groups.set(prefix, list);
            }
            list.push(file);
        } else {
            ungrouped.push(file);
        }
    }

    const result: MapGroup[] = [];
    for (const [prefix, groupFiles] of groups) {
        result.push({ name: prefix, label: GROUP_LABELS[prefix]!, files: groupFiles });
    }
    if (ungrouped.length > 0) {
        result.push({ name: '_other', label: 'Multiplayer Maps', files: ungrouped });
    }
    return result;
}

function openGroup(name: string): void {
    activeGroup.value = name;
    const group = mapGroups.value.find(g => g.name === name);
    if (group && group.files.length > 0) {
        selectMap(group.files[0]!);
    }
}

function goBackToGroups(): void {
    activeGroup.value = null;
    selectedFile.value = null;
    previewLoader.value = null;
    mapSize.value = null;
    clearMapInfo();
}

function onKeyDown(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement) {
        return;
    }
    if (e.code !== 'KeyW' && e.code !== 'KeyS') {
        return;
    }
    if (!activeGroup.value) {
        return;
    }
    e.preventDefault();
    const files = activeGroupFiles.value;
    if (files.length === 0) {
        return;
    }
    const currentIdx = selectedFile.value ? files.findIndex(f => f.path === selectedFile.value!.path) : -1;
    const nextIdx = e.code === 'KeyW' ? Math.max(0, currentIdx - 1) : Math.min(files.length - 1, currentIdx + 1);
    selectMap(files[nextIdx]!);
}

onMounted(() => {
    mapFiles.value = props.fileManager.filter('.map').sort(naturalSort);
    mapGroups.value = buildGroups(mapFiles.value);

    window.addEventListener('keydown', onKeyDown);
});

onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeyDown);
});

async function selectMap(file: IFileSource): Promise<void> {
    selectedFile.value = file;
    localStorage.setItem('game_mode_map', file.path);

    try {
        const fileData = await file.readBinary();
        const loader = MapLoader.getLoader(fileData);
        previewLoader.value = loader;
        if (loader) {
            mapSize.value = { width: loader.mapSize.width, height: loader.mapSize.height };
            extractMapInfo(loader);
        } else {
            mapSize.value = null;
            clearMapInfo();
        }
    } catch {
        previewLoader.value = null;
        mapSize.value = null;
        clearMapInfo();
    }
}

function extractMapInfo(loader: IMapLoader): void {
    mapInfo.playerCount = loader.general.playerCount;

    // eslint-disable-next-line no-restricted-syntax -- entityData is optional on IMapLoader (map file may lack entity chunks)
    const players = loader.entityData?.players ?? [];
    mapInfo.players = players.map(p => ({
        index: p.playerIndex,
        race: TRIBE_NAMES[p.tribe]!,
        color: PLAYER_COLORS[(p.playerIndex - 1) % PLAYER_COLORS.length]!,
    }));

    // eslint-disable-next-line no-restricted-syntax -- quest data is optional in map files
    mapInfo.description = loader.entityData?.quest.questText ?? '';

    // Track the map's default start resources and whether the selector applies
    const sr = loader.general.startResources;
    mapDefaultResources.value = sr >= MapStartResources.low && sr <= MapStartResources.high ? sr : null;
    mapSupportsStartResources.value = mapNeedsStartResources(loader);
}

function clearMapInfo(): void {
    mapInfo.playerCount = 0;
    mapInfo.players = [];
    mapInfo.description = '';
    mapDefaultResources.value = null;
    mapSupportsStartResources.value = true;
}

function formatDescription(text: string): string {
    // Escape HTML, then bold known section labels like "Name:", "Story:", "Briefing:", etc.
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return escaped
        .replace(/^(\d+\..+)$/m, '<b>$1</b>')
        .replace(/((?:Name|Story|Briefing|Victory condition|Hint|Tip|Goal|Mission|Objective)\s*:)/gi, '<b>$1</b>');
}

function startGame(): void {
    if (!selectedFile.value) {
        return;
    }
    router.push('/game');
}
</script>

<style scoped>
.map-select {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    padding: 24px;
    background: var(--bg-darkest);
}

.map-select-card {
    width: 100%;
    max-width: 1200px;
    background: var(--bg-dark);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    overflow: hidden;
}

.map-select-header {
    padding: 20px 28px 16px;
    border-bottom: 1px solid var(--border);
    text-align: center;
}

.map-select-title {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-emphasis);
    letter-spacing: 1px;
    text-transform: uppercase;
}

.map-select-subtitle {
    margin: 4px 0 0;
    font-size: 0.85rem;
    color: var(--text-secondary);
}

.map-select-body {
    display: flex;
    gap: 24px;
    padding: 24px 32px;
    min-height: 360px;
    overflow: hidden;
}

.map-list-area {
    width: 280px;
    flex-shrink: 0;
    overflow: hidden;
}

.map-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 420px;
    overflow-y: auto;
    padding-right: 4px;
}

.map-item {
    display: block;
    width: 100%;
    padding: 8px 12px;
    background: var(--bg-darkest);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85rem;
    text-align: left;
    transition:
        background 0.12s,
        border-color 0.12s;
    word-break: break-word;
}

.map-item:hover {
    background: var(--bg-mid);
    border-color: var(--border-hover);
}

.map-item.selected {
    background: var(--bg-raised);
    border-color: var(--border-active);
    color: var(--text-emphasis);
}

.no-maps {
    color: var(--text-dim);
    font-size: 0.85rem;
    text-align: center;
    padding: 40px 0;
}

.map-preview-area {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow: hidden;
}

.map-preview-top {
    display: flex;
    gap: 16px;
    align-items: flex-start;
    flex: 1;
    min-height: 0;
}

.map-preview-left {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.map-info-right {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.map-details {
    display: flex;
    justify-content: center;
    gap: 6px;
    font-size: 0.8rem;
    color: var(--text-secondary);
}

.map-detail {
    padding: 2px 8px;
    background: var(--bg-darkest);
    border: 1px solid var(--border);
    border-radius: 3px;
}

.map-players {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 0.78rem;
}

.map-player-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 4px;
}

.map-player-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
}

.map-player-label {
    color: var(--text-secondary);
    font-weight: 600;
    min-width: 22px;
}

.map-player-race {
    color: var(--text);
}

.map-setting {
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.map-setting-label {
    font-size: 0.75rem;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
}

.map-setting-options {
    display: flex;
    gap: 4px;
}

.setting-option {
    flex: 1;
    padding: 5px 8px;
    font-size: 0.78rem;
    cursor: pointer;
    background: var(--bg-darkest);
    color: var(--text-secondary);
    border: 1px solid var(--border);
    border-radius: 3px;
    transition:
        background 0.12s,
        border-color 0.12s,
        color 0.12s;
}

.setting-option:hover {
    background: var(--bg-mid);
    border-color: var(--border-hover);
}

.setting-option.active {
    background: #3a5e2a;
    border-color: #4a8e34;
    color: var(--text-emphasis);
}

.default-tag {
    display: inline-block;
    margin-left: 4px;
    font-size: 0.65rem;
    color: var(--text-dim);
    font-style: italic;
}

.map-setting.disabled {
    opacity: 0.4;
    pointer-events: none;
}

.setting-hint {
    font-size: 0.7rem;
    color: var(--text-dim);
    font-style: italic;
}

.map-description {
    margin: 0;
    font-size: 0.82rem;
    color: var(--text-secondary);
    line-height: 1.5;
    flex: 1;
    overflow-y: auto;
    white-space: pre-line;
}

.map-description--empty {
    color: var(--text-dim);
    font-style: italic;
}

/* Group / folder items */
.map-group-item {
    display: flex;
    align-items: center;
    gap: 6px;
}

.map-group-icon {
    font-size: 0.9rem;
}

.map-group-count {
    margin-left: auto;
    color: var(--text-dim);
    font-size: 0.75rem;
}

.map-back-item {
    color: var(--text-secondary);
    font-weight: 600;
    border-color: transparent;
    background: transparent;
}

.map-select-actions {
    display: flex;
    gap: 12px;
    padding: 16px 28px;
    border-top: 1px solid var(--border);
    justify-content: flex-end;
}

.play-btn {
    font-size: 1rem;
    font-weight: 600;
    padding: 10px 40px;
    cursor: pointer;
    background: #3a6e28;
    color: #e8f4e0;
    border: 1px solid #4a8e34;
    border-radius: 6px;
    letter-spacing: 1px;
    transition:
        background 0.15s,
        border-color 0.15s;
}

.play-btn:hover:not(:disabled) {
    background: #4a8e34;
    border-color: #5aae44;
}

.play-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

.back-btn {
    font-size: 0.9rem;
    padding: 10px 24px;
    cursor: pointer;
    background: var(--bg-mid);
    color: var(--text);
    border: 1px solid var(--border-mid);
    border-radius: 6px;
    transition:
        background 0.15s,
        border-color 0.15s;
}

.back-btn:hover {
    background: var(--bg-raised);
    border-color: var(--border-hover);
}

/* Scrollbar */
.map-list::-webkit-scrollbar {
    width: 6px;
}

.map-list::-webkit-scrollbar-track {
    background: var(--bg-darkest);
}

.map-list::-webkit-scrollbar-thumb {
    background: var(--border-mid);
    border-radius: 3px;
}

.map-list::-webkit-scrollbar-thumb:hover {
    background: var(--border-strong);
}
</style>
