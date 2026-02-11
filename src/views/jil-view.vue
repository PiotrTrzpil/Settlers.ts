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
      <button :class="{ active: viewMode === 'grid' }" @click="switchToGrid(renderAllGridSprites)">Grid</button>
      <SettingsCheckbox v-if="viewMode === 'single'" v-model="doAnimation" label="Animate" />
    </div>

    <!-- Grid View: All job sprites in a grid with multiple directions -->
    <div v-if="viewMode === 'grid'" class="grid-container">
      <div
        v-for="item in jilList"
        :key="item.index"
        class="grid-item"
        :class="{
          selected: selectedJil?.index === item.index,
          mapped: getBuildingForJob(item.index) !== null || getCarrierJobInfo(item.index)?.isMapped,
          'single-dir': getDirectionCount(item.index) === 1,
          'multi-dir': getDirectionCount(item.index) > 1
        }"
        @click="selectJobFromGrid(item)"
      >
        <div class="direction-grid" :class="'dirs-' + Math.min(getDirectionCount(item.index), 8)">
          <div v-for="dir in Math.min(getDirectionCount(item.index), 8)" :key="dir" class="direction-cell">
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
          <span v-else-if="getCarrierJobInfo(item.index)"
                :class="getCarrierJobInfo(item.index)?.isMapped ? 'carrier-mapped' : 'carrier-unmapped'">
            {{ getCarrierJobInfo(item.index)?.material }}
          </span>
        </div>
      </div>
    </div>

    <!-- Single View: Detailed sprite browser -->
    <div v-if="viewMode === 'single'" class="single-view">
      <div class="selectors">
        <div class="selector-group">
          <label>Job (JIL):</label>
          <select v-model="selectedJil" @change="onSelectJil">
            <option v-for="item of jilList" :key="item.index" :value="item">
              #{{ pad(item.index, 3) }} {{ getJobLabel(item.index) }} - Size: {{ pad(item.length, 3) }}
            </option>
          </select>
        </div>

        <div class="selector-group">
          <label>Direction (DIL):</label>
          <select v-model="selectedDil" @change="onSelectDil">
            <option v-for="item of dilList" :key="item.index" :value="item">
              #{{ pad(item.index, 3) }} - {{ item.length }} frames
            </option>
          </select>
        </div>

        <div class="selector-group">
          <label>Frame (GIL):</label>
          <select v-model="selectedGil" @change="onSelectGil">
            <option v-for="item of gilList" :key="item.index" :value="item">
              #{{ pad(item.index, 3) }}
            </option>
          </select>
        </div>
      </div>

      <div class="sprite-info" v-if="currentImageInfo">
        <span>Size: {{ currentImageInfo.width }}×{{ currentImageInfo.height }}</span>
        <span>Offset: ({{ currentImageInfo.left }}, {{ currentImageInfo.top }})</span>
      </div>

      <div class="canvas-wrapper">
        <canvas ref="ghCav" class="main-canvas">
          Sorry! Your browser does not support HTML5 Canvas.
        </canvas>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, useTemplateRef, nextTick } from 'vue';
import { Path } from '@/utilities/path';
import { GfxFileReader } from '@/resources/gfx/gfx-file-reader';
import { GilFileReader } from '@/resources/gfx/gil-file-reader';
import { DilFileReader } from '@/resources/gfx/dil-file-reader';
import { LogHandler } from '@/utilities/log-handler';
import { FileManager, IFileSource } from '@/utilities/file-manager';
import { IndexFileItem } from '@/resources/gfx/index-file-item';
import { pad, loadGfxFileSet, parseGfxReaders, renderImageToCanvas } from '@/utilities/view-helpers';
import { BUILDING_JOB_INDICES, RESOURCE_JOB_INDICES, GFX_FILE_NUMBERS, CARRIER_MATERIAL_JOB_INDICES, SETTLER_FILE_NUMBERS } from '@/game/renderer/sprite-metadata';
import { BuildingType } from '@/game/entity';
import { EMaterialType } from '@/game/economy';

// Settler files (20-24.jil) contain carrier sprites with materials
const SETTLER_FILE_IDS = new Set(Object.values(SETTLER_FILE_NUMBERS));
import { useCompositeGridView } from '@/composables/useGridView';

import FileBrowser from '@/components/file-browser.vue';
import SettingsCheckbox from '@/components/settings/SettingsCheckbox.vue';

const log = new LogHandler('JilView');

const props = defineProps<{
    fileManager: FileManager;
}>();

const ghCav = useTemplateRef<HTMLCanvasElement>('ghCav');

// Use composable for grid view functionality (composite keys: "jobIndex-dirIndex")
const { viewMode, setCanvasRef, clearRefs, canvasRefs, switchToGrid, watchGridMode } = useCompositeGridView('grid');

const doAnimation = ref(true);
let animationTimer = 0;

const fileName = ref<string | null>(null);
const jilList = ref<IndexFileItem[]>([]);
const dilList = ref<IndexFileItem[]>([]);
const gilList = ref<IndexFileItem[]>([]);

const selectedJil = ref<IndexFileItem | null>(null);
const selectedDil = ref<IndexFileItem | null>(null);
const selectedGil = ref<IndexFileItem | null>(null);

const gfxFileReader = ref<GfxFileReader | null>(null);
const dilFileReader = ref<DilFileReader | null>(null);
const gilFileReader = ref<GilFileReader | null>(null);

const currentImageInfo = ref<{ width: number; height: number; left: number; top: number } | null>(null);

// Track direction counts per job for grid view
const directionCounts = ref<Map<number, number>>(new Map());

function getDirectionCount(jobIndex: number): number {
    return directionCounts.value.get(jobIndex) ?? 1;
}

// Build reverse lookup from job index to building name
const jobToBuildingName = new Map<number, string>();
for (const [typeStr, jobIndex] of Object.entries(BUILDING_JOB_INDICES)) {
    if (jobIndex !== undefined) {
        const buildingType = Number(typeStr) as BuildingType;
        jobToBuildingName.set(jobIndex, BuildingType[buildingType]);
    }
}

// Build reverse lookup from job index to resource/material name
const jobToResourceName = new Map<number, string>();
for (const [typeStr, jobIndex] of Object.entries(RESOURCE_JOB_INDICES)) {
    if (jobIndex !== undefined) {
        const materialType = Number(typeStr) as EMaterialType;
        jobToResourceName.set(jobIndex, EMaterialType[materialType]);
    }
}

// Build reverse lookup from job index to carrier material name (mapped materials)
const jobToCarrierMaterial = new Map<number, string>();
for (const [typeStr, jobIndex] of Object.entries(CARRIER_MATERIAL_JOB_INDICES)) {
    if (jobIndex !== undefined) {
        const materialType = Number(typeStr) as EMaterialType;
        jobToCarrierMaterial.set(jobIndex, EMaterialType[materialType]);
    }
}

// Building files are race-specific: 10=Roman, 11=Viking, 12=Mayan, 14=Trojan
// Dark Tribe (13) uses different mappings
const BUILDING_FILE_IDS = new Set([10, 11, 12, 14]);

// Info about carrier job mapping status
interface CarrierJobInfo {
    material: string;
    isMapped: boolean;
}

function getCarrierJobInfo(jobIndex: number): CarrierJobInfo | null {
    const fileId = getCurrentFileId();
    if (fileId === null || !SETTLER_FILE_IDS.has(fileId)) return null;

    // Job 1 is empty carrier (already in UNIT_JOB_INDICES as Carrier)
    if (jobIndex === 1) {
        return { material: 'Empty Carrier', isMapped: true };
    }

    // Check if this job index is mapped to a material in CARRIER_MATERIAL_JOB_INDICES
    const material = jobToCarrierMaterial.get(jobIndex);
    if (material) {
        return { material: `Carrier: ${material}`, isMapped: true };
    }

    // For settler files, show "Not mapped" for unmapped jobs so user can identify
    // which carrier sprites still need to be added to CARRIER_MATERIAL_JOB_INDICES
    return { material: 'Not mapped', isMapped: false };
}

function getCurrentFileId(): number | null {
    if (!fileName.value) return null;
    const match = fileName.value.match(/(\d+)\.jil$/i);
    return match ? parseInt(match[1], 10) : null;
}

function getNameForJob(jobIndex: number): string | null {
    const fileId = getCurrentFileId();
    if (fileId === null) return null;

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
    if (buildingName) return buildingName;

    const carrierInfo = getCarrierJobInfo(jobIndex);
    if (carrierInfo) {
        return carrierInfo.isMapped ? carrierInfo.material : '[?]';
    }

    return '';
}

function onFileSelect(file: IFileSource) {
    fileName.value = file.name;
    clearRefs();
    void load(file);
}

// eslint-disable-next-line @typescript-eslint/require-await -- delegates to doLoad
async function load(file: IFileSource) {
    if (!props.fileManager) return;
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

    // Compute direction counts for each job
    directionCounts.value.clear();
    for (const item of jilList.value) {
        const dirItems = dilFileReader.value!.getItems(item.offset, item.length);
        directionCounts.value.set(item.index, dirItems.length);
    }

    // Auto-select first item
    if (jilList.value.length > 0) {
        selectedJil.value = jilList.value[0];
        onSelectJil();
    }

    // Render grid if in grid mode
    if (viewMode.value === 'grid') {
        await nextTick();
        renderAllGridSprites();
    }
}

function onSelectJil() {
    if (!selectedJil.value || !dilFileReader.value) return;

    dilList.value = dilFileReader.value.getItems(selectedJil.value.offset, selectedJil.value.length);
    selectedDil.value = dilList.value[0];
    onSelectDil();
}

function onSelectDil() {
    if (!selectedDil.value || !gilFileReader.value) return;

    gilList.value = gilFileReader.value.getItems(selectedDil.value.offset, selectedDil.value.length);
    selectedGil.value = gilList.value[0];
    onSelectGil();
}

function onSelectGil() {
    if (!selectedGil.value || !gfxFileReader.value || !selectedJil.value || !gilFileReader.value) return;

    const offset = gilFileReader.value.getImageOffset(selectedGil.value.index);
    const gfx = gfxFileReader.value.readImage(offset, selectedJil.value.index);
    if (!gfx) return;

    currentImageInfo.value = {
        width: gfx.width,
        height: gfx.height,
        left: gfx.left,
        top: gfx.top,
    };

    const img = gfx.getImageData();
    const cavEl = ghCav.value;
    if (!cavEl?.getContext) return;

    cavEl.width = img.width;
    cavEl.height = img.height;
    const context = cavEl.getContext('2d');
    if (!context) return;

    context.putImageData(img, 0, 0);
}

function onAnimate() {
    if (!gilList.value?.length || !doAnimation.value) return;

    const nextFrameIndex = (gilList.value.findIndex(f => f === selectedGil.value) + 1) % gilList.value.length;
    selectedGil.value = gilList.value[nextFrameIndex];
    onSelectGil();
}

function renderAllGridSprites() {
    if (!gfxFileReader.value || !dilFileReader.value || !gilFileReader.value) return;

    for (const item of jilList.value) {
        const dirItems = dilFileReader.value.getItems(item.offset, item.length);
        if (dirItems.length === 0) continue;

        // Render only existing directions (up to 8)
        const maxDirs = Math.min(8, dirItems.length);
        for (let dirIdx = 0; dirIdx < maxDirs; dirIdx++) {
            const canvas = canvasRefs.get(`${item.index}-${dirIdx}`);
            if (!canvas) continue;

            const frameItems = gilFileReader.value.getItems(dirItems[dirIdx].offset, dirItems[dirIdx].length);
            if (frameItems.length === 0) continue;

            const offset = gilFileReader.value.getImageOffset(frameItems[0].index);
            const gfx = gfxFileReader.value.readImage(offset, item.index);
            if (!gfx) continue;

            renderImageToCanvas(gfx, canvas);
        }
    }
}

function selectJobFromGrid(item: IndexFileItem) {
    selectedJil.value = item;
    onSelectJil();
    viewMode.value = 'single';
}

onMounted(() => {
    animationTimer = window.setInterval(() => onAnimate(), 100);
});

onUnmounted(() => {
    window.clearInterval(animationTimer);
});

// Re-render grid when switching to grid mode
watchGridMode(renderAllGridSprites, () => jilList.value.length > 0);
</script>

<style src="@/styles/file-viewer.css"></style>

<style scoped>
/* Carrier job status labels */
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

/* JIL-specific overrides for sprites with multiple directions */
.grid-container {
  grid-template-columns: repeat(auto-fill, minmax(500px, 1fr));
  gap: 8px;
  padding: 10px;
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

/* Override ALL base canvas sizes - scale to fill cell */
.direction-grid .grid-canvas,
.direction-grid.dirs-1 .grid-canvas,
.direction-grid.dirs-2 .grid-canvas,
.direction-grid.dirs-3 .grid-canvas,
.direction-grid.dirs-4 .grid-canvas,
.direction-grid.dirs-5 .grid-canvas,
.direction-grid.dirs-6 .grid-canvas,
.direction-grid.dirs-7 .grid-canvas,
.direction-grid.dirs-8 .grid-canvas {
  width: 100% !important;
  height: auto !important;
  max-width: none !important;
  max-height: none !important;
}

/* Grid layouts - use fr units to fill space */
.direction-grid.dirs-1 {
  display: grid;
  grid-template-columns: 1fr;
  max-width: 200px;
  margin: 0 auto;
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
