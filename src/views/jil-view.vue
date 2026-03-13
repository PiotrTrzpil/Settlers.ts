<template>
    <div class="file-viewer">
        <div class="controls">
            <span class="label">Jil File:</span>
            <file-browser
                :fileManager="fileManager"
                @select="onFileSelect"
                filter=".jil"
                storageKey="viewer_jil_file"
                class="browser"
            />
            <span class="info">{{ jilList.length }} jobs</span>
            <button :class="{ active: viewMode === 'single' }" @click="viewMode = 'single'">Single</button>
            <button :class="{ active: viewMode === 'grid' }" @click="switchToGrid(() => {})">Grid</button>
            <Checkbox v-model="doAnimation" label="Animate" />
            <template v-if="viewMode === 'grid'">
                <span class="label">Direction:</span>
                <select v-model="gridDirection" class="dir-select" @change="onGridDirectionChange">
                    <option value="all" :disabled="doAnimation">All</option>
                    <option v-for="d in 8" :key="d - 1" :value="d - 1">D{{ d - 1 }}</option>
                </select>
            </template>
        </div>

        <!-- Grid View: All job sprites in a virtualized grid with multiple directions -->
        <VirtualGrid
            ref="virtualGridRef"
            v-if="viewMode === 'grid'"
            :items="jilList"
            :min-column-width="gridColumnWidth"
            :row-height="gridRowHeight"
            :gap="8"
            :padding="10"
            @visible="onGridVisible"
        >
            <template #default="{ item }">
                <div
                    class="grid-item"
                    :class="{
                        selected: selectedJil?.index === item.index,
                        mapped: isJobMapped(item.index),
                        'single-dir': getDirectionCount(item.index) === 1,
                        'multi-dir': getDirectionCount(item.index) > 1,
                    }"
                    @click="selectJobFromGrid(item)"
                >
                    <!-- Single direction (animated or specific direction selected) -->
                    <div v-if="doAnimation || gridDirection !== 'all'" class="direction-grid dirs-1">
                        <div class="direction-cell">
                            <canvas
                                :ref="el => setCanvasRef(el as HTMLCanvasElement, `${item.index}-anim`)"
                                width="200"
                                height="200"
                                class="grid-canvas"
                            />
                            <span v-if="!doAnimation && gridDirection !== 'all'" class="dir-label"
                                >D{{ gridDirection }}</span
                            >
                        </div>
                    </div>
                    <!-- All directions: show frame 0 of each direction -->
                    <div v-else class="direction-grid" :class="'dirs-' + Math.min(getDirectionCount(item.index), 8)">
                        <div
                            v-for="dir in Math.min(getDirectionCount(item.index), 8)"
                            :key="dir"
                            class="direction-cell"
                        >
                            <canvas
                                :ref="el => setCanvasRef(el as HTMLCanvasElement, `${item.index}-${dir - 1}`)"
                                width="200"
                                height="200"
                                class="grid-canvas"
                            />
                            <span v-if="getDirectionCount(item.index) > 1" class="dir-label">D{{ dir - 1 }}</span>
                        </div>
                    </div>
                    <div class="grid-label">
                        <span class="job-index">Job #{{ item.index }}</span>
                        <span v-if="getBuildingForJob(item.index)" class="building-name">
                            {{ getBuildingForJob(item.index) }}
                        </span>
                        <template v-else>
                            <span v-if="getWorkerLabel(item.index)" class="worker-label">
                                {{ getWorkerLabel(item.index) }}
                            </span>
                            <span v-if="getCarrierMaterialLabel(item.index)" class="carrier-mapped">
                                {{ getCarrierMaterialLabel(item.index) }}
                            </span>
                            <span
                                v-if="
                                    isSettlerFile() &&
                                    !getWorkerLabel(item.index) &&
                                    !getCarrierMaterialLabel(item.index)
                                "
                                class="carrier-unmapped"
                            >
                                Not mapped
                            </span>
                        </template>
                    </div>
                </div>
            </template>
        </VirtualGrid>

        <!-- Single View: Detailed sprite browser -->
        <div v-if="viewMode === 'single'" class="single-view">
            <div class="selectors">
                <ItemSelector label="Job (JIL):">
                    <select v-model="selectedJil" @change="onSelectJil">
                        <option v-for="item of jilList" :key="item.index" :value="item">
                            #{{ pad(item.index, 3) }} {{ getJobLabel(item.index) }} - Size: {{ pad(item.length, 3) }}
                        </option>
                    </select>
                </ItemSelector>

                <ItemSelector label="Direction (DIL):">
                    <select v-model="selectedDil" @change="onSelectDil">
                        <option v-for="item of dilList" :key="item.index" :value="item">
                            #{{ pad(item.index, 3) }} - {{ item.length }} frames
                        </option>
                    </select>
                </ItemSelector>

                <ItemSelector label="Frame (GIL):">
                    <select v-model="selectedGil" @change="onSelectGil">
                        <option v-for="item of gilList" :key="item.index" :value="item">
                            #{{ pad(item.index, 3) }}
                        </option>
                    </select>
                </ItemSelector>
            </div>

            <div class="sprite-info" v-if="currentImageInfo">
                <span>Size: {{ currentImageInfo.width }}×{{ currentImageInfo.height }}</span>
                <span>Offset: ({{ currentImageInfo.left }}, {{ currentImageInfo.top }})</span>
            </div>

            <div class="canvas-wrapper">
                <canvas ref="ghCav" class="main-canvas"> Sorry! Your browser does not support HTML5 Canvas. </canvas>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted, useTemplateRef } from 'vue';
import { Path } from '@/utilities/path';
import { GfxFileReader } from '@/resources/gfx/gfx-file-reader';
import { GilFileReader } from '@/resources/gfx/gil-file-reader';
import { DilFileReader } from '@/resources/gfx/dil-file-reader';
import { LogHandler } from '@/utilities/log-handler';
import { FileManager, IFileSource } from '@/utilities/file-manager';
import { IndexFileItem } from '@/resources/gfx/index-file-item';
import { pad, loadGfxFileSet, parseGfxReaders, renderImageToCanvas } from '@/utilities/view-helpers';
import {
    BUILDING_JOB_INDICES,
    RESOURCE_JOB_INDICES,
    GFX_FILE_NUMBERS,
    CARRIER_MATERIAL_JOB_INDICES,
    SETTLER_JOB_INDICES,
    SETTLER_KEY_TO_UNIT_TYPE,
    SETTLER_FILE_NUMBERS,
} from '@/game/renderer/sprite-metadata';
import { BuildingType, UnitType } from '@/game/entity';
import { EMaterialType } from '@/game/economy';

// Settler files (20-24.jil) contain carrier sprites with materials
const SETTLER_FILE_IDS = new Set(Object.values(SETTLER_FILE_NUMBERS));
import { useCompositeGridView } from '@/composables/useGridView';

import FileBrowser from '@/components/file-browser.vue';
import Checkbox from '@/components/Checkbox.vue';
import ItemSelector from '@/components/ItemSelector.vue';
import VirtualGrid from '@/components/VirtualGrid.vue';

const log = new LogHandler('JilView');

const props = defineProps<{
    fileManager: FileManager;
}>();

const ghCav = useTemplateRef<HTMLCanvasElement>('ghCav');
const virtualGridRef = ref<{ getScrollOffset(): number; setScrollOffset(offset: number): void } | null>(null);

// Use composable for grid view functionality (composite keys: "jobIndex-dirIndex")
const { viewMode, setCanvasRef, clearRefs, canvasRefs, switchToGrid } = useCompositeGridView('grid');

const doAnimation = ref(true);
const gridDirection = ref<'all' | number>(0);
let animationTimer = 0;
let scrollSaveTimer = 0;
let pendingScrollRestore = false;

// ─── LocalStorage persistence ─────────────────────────────────────────────────
const STORAGE_KEY = 'jil_view_state';

interface SavedJilState {
    viewMode?: string;
    doAnimation?: boolean;
    gridDirection?: 'all' | number;
    scrollOffset?: number;
    jobIndex?: number;
    dirIndex?: number;
    frameIndex?: number;
}

function getSavedState(): SavedJilState | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function loadSavedState(): void {
    try {
        const saved = getSavedState();
        if (!saved) {
            return;
        }
        if (saved.viewMode === 'single' || saved.viewMode === 'grid') {
            viewMode.value = saved.viewMode;
        }
        if (typeof saved.doAnimation === 'boolean') {
            doAnimation.value = saved.doAnimation;
        }
        if (saved.gridDirection === 'all' || typeof saved.gridDirection === 'number') {
            gridDirection.value = saved.gridDirection;
        }
    } catch {
        /* ignore corrupt data */
    }
}

function saveState(): void {
    // Don't overwrite scroll offset while a restore is pending (data just loaded, scroll is 0)
    const prevScrollOffset = getSavedState()?.scrollOffset ?? 0;
    let scrollOffset: number;
    if (pendingScrollRestore) {
        scrollOffset = prevScrollOffset;
    } else if (virtualGridRef.value) {
        scrollOffset = virtualGridRef.value.getScrollOffset();
    } else {
        scrollOffset = prevScrollOffset;
    }
    const state: SavedJilState = {
        viewMode: viewMode.value,
        doAnimation: doAnimation.value,
        gridDirection: gridDirection.value,
        scrollOffset,
        jobIndex: selectedJil.value?.index,
        dirIndex: selectedDil.value ? dilList.value.indexOf(selectedDil.value) : undefined,
        frameIndex: selectedGil.value ? gilList.value.indexOf(selectedGil.value) : undefined,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function restoreScrollOffset(): void {
    const saved = getSavedState();
    if (saved && typeof saved.scrollOffset === 'number' && saved.scrollOffset > 0) {
        virtualGridRef.value?.setScrollOffset(saved.scrollOffset);
    }
}

loadSavedState();

const fileName = ref<string | null>(null);
const jilList = ref<IndexFileItem[]>([]);
const dilList = ref<IndexFileItem[]>([]);
const gilList = ref<IndexFileItem[]>([]);

const selectedJil = ref<IndexFileItem | null>(null);
const selectedDil = ref<IndexFileItem | null>(null);
const selectedGil = ref<IndexFileItem | null>(null);

// Save state whenever UI controls or selections change
watch([viewMode, doAnimation, gridDirection, selectedJil, selectedDil, selectedGil], () => saveState());

const gfxFileReader = ref<GfxFileReader | null>(null);
const dilFileReader = ref<DilFileReader | null>(null);
const gilFileReader = ref<GilFileReader | null>(null);

const currentImageInfo = ref<{ width: number; height: number; left: number; top: number } | null>(null);

// Max sprite dimensions across all jobs in the current file (for grid cell sizing)
const maxSpriteWidth = ref(60);
const maxSpriteHeight = ref(60);

// Grid cell sizing — adapts to single-direction vs all-directions mode
const CELL_PADDING = 24; // padding + label height
const gridColumnWidth = computed(() => {
    if (gridDirection.value !== 'all' || doAnimation.value) {
        // Single direction: one sprite per cell
        return Math.max(80, maxSpriteWidth.value + CELL_PADDING);
    }
    // All directions: need room for up to 4 columns of sprites
    return Math.max(200, maxSpriteWidth.value * 4 + CELL_PADDING * 2);
});
const gridRowHeight = computed(() => {
    if (gridDirection.value !== 'all' || doAnimation.value) {
        return Math.max(80, maxSpriteHeight.value + CELL_PADDING + 20);
    }
    return Math.max(200, maxSpriteHeight.value * 2 + CELL_PADDING * 2);
});

// Track direction counts per job for grid view
const directionCounts = ref<Map<number, number>>(new Map());

function getDirectionCount(jobIndex: number): number {
    return directionCounts.value.get(jobIndex) ?? 1;
}

// Build reverse lookup from job index to building name
const jobToBuildingName = new Map<number, string>();
for (const [typeStr, jobIndex] of Object.entries(BUILDING_JOB_INDICES)) {
    const buildingType = Number(typeStr) as BuildingType;
    jobToBuildingName.set(jobIndex, BuildingType[buildingType]);
}

// Build reverse lookup from job index to resource/material name
const jobToResourceName = new Map<number, string>();
for (const [typeStr, jobIndex] of Object.entries(RESOURCE_JOB_INDICES)) {
    const materialType = Number(typeStr) as EMaterialType;
    jobToResourceName.set(jobIndex, EMaterialType[materialType]);
}

// Build reverse lookup from job index to carrier material name (mapped materials)
const jobToCarrierMaterial = new Map<number, string>();
for (const [typeStr, jobIndex] of Object.entries(CARRIER_MATERIAL_JOB_INDICES)) {
    const materialType = Number(typeStr) as EMaterialType;
    jobToCarrierMaterial.set(jobIndex, EMaterialType[materialType]);
}

// Build reverse lookup from job index to worker state descriptions (settler files)
const jobToWorkerLabels = new Map<number, string[]>();

function formatWorkerName(key: string): string {
    const unitType = SETTLER_KEY_TO_UNIT_TYPE[key];
    if (unitType !== undefined) {
        const levelMatch = /^.+_(\d+)$/.exec(key);
        const name = UnitType[unitType];
        return levelMatch ? `${name} L${levelMatch[1]}` : name;
    }
    return key.charAt(0).toUpperCase() + key.slice(1);
}

function addWorkerLabel(jobIndex: number, workerName: string, state: string): void {
    if (jobIndex < 0) {
        return;
    }
    const label = `${workerName}: ${state}`;
    const existing = jobToWorkerLabels.get(jobIndex);
    if (existing) {
        existing.push(label);
    } else {
        jobToWorkerLabels.set(jobIndex, [label]);
    }
}

for (const [workerKey, workerData] of Object.entries(SETTLER_JOB_INDICES)) {
    const name = formatWorkerName(workerKey);
    for (const [field, value] of Object.entries(workerData as Record<string, number>)) {
        addWorkerLabel(value, name, field);
    }
}

// Building files are race-specific: 10=Roman, 11=Viking, 12=Mayan, 14=Trojan
// Dark Tribe (13) uses different mappings
const BUILDING_FILE_IDS = new Set([10, 11, 12, 14]);

function isSettlerFile(): boolean {
    const fileId = getCurrentFileId();
    return fileId !== null && SETTLER_FILE_IDS.has(fileId);
}

/** Get carrier material label for a job (e.g., "Carrier: AGAVE"). Only for settler files. */
function getCarrierMaterialLabel(jobIndex: number): string | null {
    if (!isSettlerFile()) {
        return null;
    }
    const material = jobToCarrierMaterial.get(jobIndex);
    return material ? `Carrier: ${material}` : null;
}

/** Get worker state labels for a job (e.g., "Woodcutter: work.0"). Only for settler files. */
function getWorkerLabel(jobIndex: number): string | null {
    if (!isSettlerFile()) {
        return null;
    }
    const labels = jobToWorkerLabels.get(jobIndex);
    return labels ? labels.join(', ') : null;
}

/** Check if a job index has any known mapping (building, resource, worker, or carrier). */
function isJobMapped(jobIndex: number): boolean {
    return (
        getBuildingForJob(jobIndex) !== null ||
        getWorkerLabel(jobIndex) !== null ||
        getCarrierMaterialLabel(jobIndex) !== null
    );
}

function getCurrentFileId(): number | null {
    if (!fileName.value) {
        return null;
    }
    // eslint-disable-next-line sonarjs/slow-regex -- simple filename pattern, not user-controlled
    const match = /(\d+)\.jil$/i.exec(fileName.value);
    return match ? parseInt(match[1]!, 10) : null;
}

function getNameForJob(jobIndex: number): string | null {
    const fileId = getCurrentFileId();
    if (fileId === null) {
        return null;
    }

    // Check if it's a building file
    if (BUILDING_FILE_IDS.has(fileId)) {
        return jobToBuildingName.get(jobIndex) ?? null;
    }

    // Check if it's the resource file (3.jil)
    if (fileId === GFX_FILE_NUMBERS.RESOURCES) {
        return jobToResourceName.get(jobIndex) ?? null;
    }

    return null;
}

// Keep for backwards compatibility
function getBuildingForJob(jobIndex: number): string | null {
    return getNameForJob(jobIndex);
}

// Get a combined label for dropdown display
function getJobLabel(jobIndex: number): string {
    const buildingName = getBuildingForJob(jobIndex);
    if (buildingName) {
        return buildingName;
    }

    const workerLabel = getWorkerLabel(jobIndex);
    const carrierLabel = getCarrierMaterialLabel(jobIndex);

    if (workerLabel && carrierLabel) {
        return `${workerLabel} | ${carrierLabel}`;
    }
    if (workerLabel) {
        return workerLabel;
    }
    if (carrierLabel) {
        return carrierLabel;
    }

    if (isSettlerFile()) {
        return '[?]';
    }
    return '';
}

function onFileSelect(file: IFileSource) {
    fileName.value = file.name;
    clearRefs();
    void load(file);
}

/** Compute direction counts and max sprite dimensions for all jobs. */
function computeJobMetrics(): void {
    const gfx = gfxFileReader.value!,
        dil = dilFileReader.value!,
        gil = gilFileReader.value!;
    directionCounts.value.clear();
    let mw = 0,
        mh = 0;
    for (const item of jilList.value) {
        const dirItems = dil.getItems(item.offset, item.length);
        directionCounts.value.set(item.index, dirItems.length);
        if (dirItems.length === 0) {
            continue;
        }
        const frameItems = gil.getItems(dirItems[0]!.offset, dirItems[0]!.length);
        if (frameItems.length === 0) {
            continue;
        }
        const offset = gil.getImageOffset(frameItems[0]!.index);
        const img = gfx.readImage(offset, item.index);
        if (img.width > mw) {
            mw = img.width;
        }
        if (img.height > mh) {
            mh = img.height;
        }
    }
    maxSpriteWidth.value = mw || 60;
    maxSpriteHeight.value = mh || 60;
}

// eslint-disable-next-line @typescript-eslint/require-await -- delegates to doLoad
async function load(file: IFileSource) {
    const fileId = Path.getFileNameWithoutExtension(file.name);
    void doLoad(fileId);
}

async function doLoad(fileId: string) {
    const fileSet = await loadGfxFileSet(props.fileManager, fileId);
    const readers = parseGfxReaders(fileSet);

    // Jil-view requires jil/dil files to function
    if (!readers.jilFileReader || !readers.dilFileReader) {
        log.error('No jil/dil files found for ' + fileId + ' - this view requires job index files');
        jilList.value = [];
        return;
    }

    dilFileReader.value = readers.dilFileReader;
    gilFileReader.value = readers.gilFileReader;
    jilList.value = readers.jilFileReader.getItems(0);

    gfxFileReader.value = new GfxFileReader(
        fileSet.gfx,
        readers.gilFileReader,
        readers.jilFileReader,
        readers.dilFileReader,
        readers.paletteCollection
    );

    log.debug('File: ' + fileId + ' with ' + jilList.value.length + ' jobs');

    computeJobMetrics();

    // Restore saved selection or default to first item
    const saved = getSavedState();
    const savedJob = saved?.jobIndex;
    const restoredJil = savedJob !== undefined ? jilList.value.find(item => item.index === savedJob) : undefined;
    selectedJil.value = restoredJil ?? jilList.value[0] ?? null;
    onSelectJil();

    // Restore direction/frame within the selected job
    if (restoredJil && saved) {
        if (typeof saved.dirIndex === 'number' && saved.dirIndex < dilList.value.length) {
            selectedDil.value = dilList.value[saved.dirIndex]!;
            onSelectDil();
        }
        if (typeof saved.frameIndex === 'number' && saved.frameIndex < gilList.value.length) {
            selectedGil.value = gilList.value[saved.frameIndex]!;
            onSelectGil();
        }
    }

    // Defer scroll restore until the grid actually renders (onGridVisible)
    pendingScrollRestore = true;
}

function onSelectJil() {
    if (!selectedJil.value || !dilFileReader.value) {
        return;
    }

    dilList.value = dilFileReader.value.getItems(selectedJil.value.offset, selectedJil.value.length);
    selectedDil.value = dilList.value[0] ?? null;
    onSelectDil();
}

function onSelectDil() {
    if (!selectedDil.value || !gilFileReader.value) {
        return;
    }

    gilList.value = gilFileReader.value.getItems(selectedDil.value.offset, selectedDil.value.length);
    selectedGil.value = gilList.value[0] ?? null;
    onSelectGil();
}

/** Render a specific GIL frame to the main canvas without touching select state. */
function renderFrame(gilItem: IndexFileItem): void {
    if (!gfxFileReader.value || !selectedJil.value || !gilFileReader.value) {
        return;
    }

    const offset = gilFileReader.value.getImageOffset(gilItem.index);
    const gfx = gfxFileReader.value.readImage(offset, selectedJil.value.index);
    currentImageInfo.value = {
        width: gfx.width,
        height: gfx.height,
        left: gfx.left,
        top: gfx.top,
    };

    const img = gfx.getImageData();
    const cavEl = ghCav.value;
    if (!cavEl) {
        return;
    }

    cavEl.width = img.width;
    cavEl.height = img.height;
    const context = cavEl.getContext('2d');
    if (!context) {
        return;
    }

    context.putImageData(img, 0, 0);
}

function onSelectGil() {
    if (!selectedGil.value) {
        return;
    }
    animFrameIndex = gilList.value.indexOf(selectedGil.value);
    renderFrame(selectedGil.value);
}

/** Current animation frame index — advances independently of the select model. */
let animFrameIndex = 0;

/** Global frame counter for grid animation. */
let gridAnimFrame = 0;

/** Visible range in the virtual grid (updated by @visible callback). */
let gridVisibleStart = 0;
let gridVisibleEnd = 0;

function onAnimate() {
    if (!doAnimation.value) {
        return;
    }

    if (viewMode.value === 'single') {
        if (!gilList.value.length) {
            return;
        }
        animFrameIndex = (animFrameIndex + 1) % gilList.value.length;
        renderFrame(gilList.value[animFrameIndex]!);
    } else {
        gridAnimFrame++;
        renderGridAnimFrame();
    }
}

/** Get the direction index to use for single-direction rendering. */
function getSelectedDirection(): number {
    return typeof gridDirection.value === 'number' ? gridDirection.value : 0;
}

/** Render current animation frame for all visible grid items. */
function renderGridAnimFrame(): void {
    if (!gfxFileReader.value || !dilFileReader.value || !gilFileReader.value) {
        return;
    }
    const dir = getSelectedDirection();

    for (let i = gridVisibleStart; i < gridVisibleEnd; i++) {
        const item = jilList.value[i];
        if (!item) {
            continue;
        }

        const canvas = canvasRefs.get(`${item.index}-anim`);
        if (!canvas) {
            continue;
        }

        const dirItems = dilFileReader.value.getItems(item.offset, item.length);
        if (dir >= dirItems.length) {
            continue;
        }

        const frameItems = gilFileReader.value.getItems(dirItems[dir]!.offset, dirItems[dir]!.length);
        if (frameItems.length === 0) {
            continue;
        }

        const frameIndex = gridAnimFrame % frameItems.length;
        const offset = gilFileReader.value.getImageOffset(frameItems[frameIndex]!.index);
        const gfx = gfxFileReader.value.readImage(offset, item.index);
        renderImageToCanvas(gfx, canvas);
    }
}

/** Render frame 0 of the selected direction for all visible grid items (static single-direction mode). */
function renderGridStaticDirection(): void {
    if (!gfxFileReader.value || !dilFileReader.value || !gilFileReader.value) {
        return;
    }
    const dir = getSelectedDirection();

    for (let i = gridVisibleStart; i < gridVisibleEnd; i++) {
        const item = jilList.value[i];
        if (!item) {
            continue;
        }

        const canvas = canvasRefs.get(`${item.index}-anim`);
        if (!canvas) {
            continue;
        }

        const dirItems = dilFileReader.value.getItems(item.offset, item.length);
        if (dir >= dirItems.length) {
            continue;
        }

        const frameItems = gilFileReader.value.getItems(dirItems[dir]!.offset, dirItems[dir]!.length);
        if (frameItems.length === 0) {
            continue;
        }

        const offset = gilFileReader.value.getImageOffset(frameItems[0]!.index);
        const gfx = gfxFileReader.value.readImage(offset, item.index);
        renderImageToCanvas(gfx, canvas);
    }
}

function renderJobSprite(item: IndexFileItem) {
    if (!gfxFileReader.value || !dilFileReader.value || !gilFileReader.value) {
        return;
    }

    const dirItems = dilFileReader.value.getItems(item.offset, item.length);
    if (dirItems.length === 0) {
        return;
    }

    const maxDirs = Math.min(8, dirItems.length);
    for (let dirIdx = 0; dirIdx < maxDirs; dirIdx++) {
        const canvas = canvasRefs.get(`${item.index}-${dirIdx}`);
        if (!canvas) {
            continue;
        }

        const frameItems = gilFileReader.value.getItems(dirItems[dirIdx]!.offset, dirItems[dirIdx]!.length);
        if (frameItems.length === 0) {
            continue;
        }

        const offset = gilFileReader.value.getImageOffset(frameItems[0]!.index);
        const gfx = gfxFileReader.value.readImage(offset, item.index);

        renderImageToCanvas(gfx, canvas);
    }
}

function onGridVisible(startIndex: number, endIndex: number) {
    // Restore saved scroll position on first render after file load
    if (pendingScrollRestore) {
        pendingScrollRestore = false;
        restoreScrollOffset();
        // Scroll change will trigger another onGridVisible — but still render this range
        // in case the saved offset is 0 or absent (no second call would happen)
    }

    gridVisibleStart = startIndex;
    gridVisibleEnd = endIndex;

    if (doAnimation.value) {
        renderGridAnimFrame();
    } else if (gridDirection.value !== 'all') {
        renderGridStaticDirection();
    } else {
        for (let i = startIndex; i < endIndex; i++) {
            const item = jilList.value[i];
            if (!item) {
                continue;
            }
            renderJobSprite(item);
        }
    }
}

function onGridDirectionChange(): void {
    // When switching to "all" while animating, force to D0 (all is static-only)
    if (gridDirection.value === 'all' && doAnimation.value) {
        gridDirection.value = 0;
    }
    void nextTick(() => {
        if (doAnimation.value) {
            renderGridAnimFrame();
        } else if (gridDirection.value !== 'all') {
            renderGridStaticDirection();
        } else {
            for (let i = gridVisibleStart; i < gridVisibleEnd; i++) {
                const item = jilList.value[i];
                if (item) {
                    renderJobSprite(item);
                }
            }
        }
    });
}

function selectJobFromGrid(item: IndexFileItem) {
    selectedJil.value = item;
    onSelectJil();
    viewMode.value = 'single';
}

watch(doAnimation, animating => {
    if (viewMode.value === 'single') {
        // Sync the frame select to show whichever frame we stopped on
        if (!animating && gilList.value.length > 0) {
            selectedGil.value = gilList.value[animFrameIndex] ?? gilList.value[0] ?? null;
        }
    } else {
        // When animation starts, force direction to a specific value (can't animate "all")
        if (animating && gridDirection.value === 'all') {
            gridDirection.value = 0;
        }
        // Template switches between anim/static canvases — re-render after DOM update
        void nextTick(() => {
            if (animating) {
                renderGridAnimFrame();
            } else if (gridDirection.value !== 'all') {
                renderGridStaticDirection();
            } else {
                for (let i = gridVisibleStart; i < gridVisibleEnd; i++) {
                    const item = jilList.value[i];
                    if (item) {
                        renderJobSprite(item);
                    }
                }
            }
        });
    }
});

onMounted(() => {
    animationTimer = window.setInterval(() => onAnimate(), 100);
    scrollSaveTimer = window.setInterval(() => saveState(), 500);
});

onUnmounted(() => {
    window.clearInterval(animationTimer);
    window.clearInterval(scrollSaveTimer);
    saveState();
});
</script>

<style src="@/styles/file-viewer.css"></style>

<style scoped>
.dir-select {
    width: 60px;
}

/* Job mapping labels */
.worker-label {
    color: #64b5f6;
    font-weight: bold;
    font-size: 0.85em;
}

.carrier-mapped {
    color: #4caf50;
    font-weight: bold;
    font-size: 0.85em;
}

.carrier-unmapped {
    color: #ff9800;
    font-size: 0.8em;
    opacity: 0.8;
}

.grid-item {
    padding: 8px 4px 4px 8px;
}

/* Direction grid fills available space */
.direction-grid {
    gap: 2px;
    padding: 2px;
    flex: 1;
    width: 100%;
}

.dir-label {
    margin-top: 0;
    font-size: 8px;
}

.grid-label {
    margin-top: 2px;
}

/* Keep canvases at their natural pixel size (no stretching or scaling) */
.direction-grid .grid-canvas {
    width: auto !important;
    height: auto !important;
    max-width: none !important;
    max-height: none !important;
}

/* Grid layouts - use fr units to fill space */
.direction-grid.dirs-1 {
    display: grid;
    grid-template-columns: 1fr;
    height: 100%;
    place-items: center;
}

.direction-grid.dirs-2 {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
}

.direction-grid.dirs-3,
.direction-grid.dirs-4 {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
}

.direction-grid.dirs-5,
.direction-grid.dirs-6 {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
}

.direction-grid.dirs-7,
.direction-grid.dirs-8 {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
}
</style>
