<template>
  <div class="map-file-view">
    <!-- Header with file selector -->
    <header class="view-header">
      <h1>Map File Analyzer</h1>
      <file-browser
        :fileManager="fileManager"
        @select="onFileSelect"
        filter=".exe|.map|.edm"
        storageKey="viewer_mapfile_file"
        class="file-selector"
      />
    </header>

    <!-- Loading / Error states -->
    <div v-if="isLoading" class="loading-state">
      <div class="spinner"></div>
      <span>Loading map file...</span>
    </div>

    <div v-else-if="error" class="error-state">
      <span class="error-icon">!</span>
      <span>{{ error }}</span>
    </div>

    <!-- Main content -->
    <div v-else-if="mapLoader" class="content-grid">
      <!-- Left column: Map info and chunks -->
      <aside class="sidebar">
        <!-- Map metadata card -->
        <section class="card metadata-card">
          <h2>Map Information</h2>
          <div v-if="metadata" class="metadata-grid">
            <div class="metadata-item">
              <span class="label">Type</span>
              <span class="value type-badge" :class="metadata.sourceType">
                {{ metadata.sourceType === 'savegame' ? 'Save Game' : 'Map File' }}
              </span>
            </div>
            <div v-if="metadata.mapSize" class="metadata-item">
              <span class="label">Size</span>
              <span class="value">{{ metadata.mapSize.width }} x {{ metadata.mapSize.height }}</span>
            </div>
            <div class="metadata-item">
              <span class="label">Chunks</span>
              <span class="value">{{ metadata.chunkCount }}</span>
            </div>
          </div>
        </section>

        <!-- Chunk list -->
        <section class="card chunks-card">
          <h2>Data Chunks</h2>
          <div class="chunk-list">
            <template v-for="(categoryChunks, category) in groupedChunks" :key="category">
              <div v-if="categoryChunks.length > 0" class="chunk-category">
                <h3 class="category-header">
                  <span class="category-icon">{{ getCategoryIcon(category) }}</span>
                  {{ formatCategory(category) }}
                  <span class="category-count">{{ categoryChunks.length }}</span>
                </h3>
                <button
                  v-for="chunk in categoryChunks"
                  :key="chunk.chunk.offset"
                  class="chunk-item"
                  :class="{ selected: selectedChunk === chunk }"
                  @click="selectChunk(chunk)"
                >
                  <span class="chunk-name">{{ chunk.typeName }}</span>
                  <span class="chunk-size">{{ formatSize(chunk.chunk.unpackedLength) }}</span>
                </button>
              </div>
            </template>
          </div>
        </section>
      </aside>

      <!-- Main content area -->
      <main class="main-content">
        <!-- Map preview if available -->
        <section v-if="mapLoader" class="card preview-card">
          <h2>Map Preview</h2>
          <map-preview :mapLoader="mapLoader" />
        </section>

        <!-- Resource Summary -->
        <section v-if="stats && stats.totalResources > 0" class="card resources-summary-card">
          <h2>Resource Summary</h2>
          <div class="resource-summary">
            <div v-if="stats.resourceSummary.fish > 0" class="resource-item fish">
              <span class="resource-icon">🐟</span>
              <span class="resource-name">Fish</span>
              <span class="resource-count">{{ stats.resourceSummary.fish.toLocaleString() }}</span>
            </div>
            <div v-if="stats.resourceSummary.coal > 0" class="resource-item coal">
              <span class="resource-icon">⚫</span>
              <span class="resource-name">Coal</span>
              <span class="resource-count">{{ stats.resourceSummary.coal.toLocaleString() }}</span>
            </div>
            <div v-if="stats.resourceSummary.iron > 0" class="resource-item iron">
              <span class="resource-icon">🔩</span>
              <span class="resource-name">Iron</span>
              <span class="resource-count">{{ stats.resourceSummary.iron.toLocaleString() }}</span>
            </div>
            <div v-if="stats.resourceSummary.gold > 0" class="resource-item gold">
              <span class="resource-icon">🪙</span>
              <span class="resource-name">Gold</span>
              <span class="resource-count">{{ stats.resourceSummary.gold.toLocaleString() }}</span>
            </div>
            <div v-if="stats.resourceSummary.sulphur > 0" class="resource-item sulphur">
              <span class="resource-icon">💛</span>
              <span class="resource-name">Sulphur</span>
              <span class="resource-count">{{ stats.resourceSummary.sulphur.toLocaleString() }}</span>
            </div>
            <div v-if="stats.resourceSummary.stonemine > 0" class="resource-item stonemine">
              <span class="resource-icon">⛰️</span>
              <span class="resource-name">Stone Mine</span>
              <span class="resource-count">{{ stats.resourceSummary.stonemine.toLocaleString() }}</span>
            </div>
            <div v-if="stats.resourceSummary.stone > 0" class="resource-item stone">
              <span class="resource-icon">🪨</span>
              <span class="resource-name">Stone</span>
              <span class="resource-count">{{ stats.resourceSummary.stone.toLocaleString() }}</span>
            </div>
            <div v-if="stats.resourceSummary.wood > 0" class="resource-item wood">
              <span class="resource-icon">🌲</span>
              <span class="resource-name">Wood</span>
              <span class="resource-count">{{ stats.resourceSummary.wood.toLocaleString() }}</span>
            </div>
          </div>
        </section>

        <!-- Entity Data (from chunk parsers) -->
        <section v-if="entitySummary" class="card entity-data-card">
          <h2>Entity Data</h2>

          <!-- Players -->
          <div v-if="entitySummary.players.length > 0" class="entity-section">
            <h3>Players <span class="entity-count">({{ entitySummary.totals.players }})</span></h3>
            <div class="entity-list players-list">
              <div v-for="p in entitySummary.players" :key="p.index" class="entity-row player-row">
                <span class="player-index">P{{ p.index }}</span>
                <span class="player-tribe">{{ p.tribe }}</span>
                <span v-if="p.startX && p.startY" class="player-pos">({{ p.startX }}, {{ p.startY }})</span>
              </div>
            </div>
          </div>

          <!-- Buildings -->
          <div v-if="entitySummary.buildings.length > 0" class="entity-section">
            <h3>Buildings <span class="entity-count">({{ entitySummary.totals.buildings }})</span></h3>
            <div class="entity-list">
              <div v-for="(b, idx) in entitySummary.buildings.slice(0, 10)" :key="'bld-' + idx" class="entity-row">
                <span class="entity-type">{{ b.type }}</span>
                <span class="entity-player">P{{ b.player }}</span>
                <span class="entity-amount">×{{ b.count }}</span>
              </div>
              <div v-if="entitySummary.buildings.length > 10" class="entity-more">
                +{{ entitySummary.buildings.length - 10 }} more types...
              </div>
            </div>
          </div>

          <!-- Settlers -->
          <div v-if="entitySummary.settlers.length > 0" class="entity-section">
            <h3>Settlers <span class="entity-count">({{ entitySummary.totals.settlers }})</span></h3>
            <div class="entity-list">
              <div v-for="(s, idx) in entitySummary.settlers.slice(0, 10)" :key="'stl-' + idx" class="entity-row">
                <span class="entity-type">{{ s.type }}</span>
                <span class="entity-player">P{{ s.player }}</span>
                <span class="entity-amount">×{{ s.count }}</span>
              </div>
              <div v-if="entitySummary.settlers.length > 10" class="entity-more">
                +{{ entitySummary.settlers.length - 10 }} more types...
              </div>
            </div>
          </div>

          <!-- Stacks -->
          <div v-if="entitySummary.stacks.length > 0" class="entity-section">
            <h3>Material Stacks <span class="entity-count">({{ entitySummary.totals.stacks }})</span></h3>
            <div class="entity-list">
              <div v-for="(st, idx) in entitySummary.stacks.slice(0, 10)" :key="'stk-' + idx" class="entity-row">
                <span class="entity-type">{{ st.type }}</span>
                <span class="entity-amount">{{ st.totalAmount }} total</span>
              </div>
              <div v-if="entitySummary.stacks.length > 10" class="entity-more">
                +{{ entitySummary.stacks.length - 10 }} more types...
              </div>
            </div>
          </div>

          <!-- Empty state -->
          <div
            v-if="entitySummary.totals.players === 0
              && entitySummary.totals.buildings === 0
              && entitySummary.totals.settlers === 0
              && entitySummary.totals.stacks === 0"
            class="entity-empty"
          >
            No entity data found in map chunks
          </div>
        </section>

        <!-- Terrain Statistics -->
        <section v-if="stats && stats.terrain.length > 0" class="card stats-card">
          <h2>Terrain Types <span class="stat-total">({{ stats.totalTerrain.toLocaleString() }} tiles)</span></h2>
          <div class="stat-bars terrain-stats">
            <div
              v-for="entry in stats.terrain.slice(0, 12)"
              :key="'terrain-' + entry.value"
              class="stat-bar"
            >
              <span class="stat-label" :title="'Value: ' + entry.value">{{ entry.name }}</span>
              <div class="bar-container">
                <div
                  class="bar-fill terrain"
                  :style="{ width: getBarWidth(entry.count, stats.totalTerrain) }"
                ></div>
              </div>
              <span class="stat-count">{{ entry.count.toLocaleString() }}</span>
            </div>
          </div>
        </section>

        <!-- Resource Details -->
        <section v-if="stats && stats.resources.length > 0" class="card stats-card">
          <h2>Resource Details <span class="stat-total">({{ stats.totalResources.toLocaleString() }})</span></h2>
          <div class="stat-bars">
            <div
              v-for="entry in stats.resources.slice(0, 15)"
              :key="'res-' + entry.value"
              class="stat-bar"
            >
              <span class="stat-label" :title="'Value: ' + entry.value">{{ entry.name }}</span>
              <div class="bar-container">
                <div
                  class="bar-fill resource"
                  :style="{ width: getBarWidth(entry.count, stats.totalResources) }"
                ></div>
              </div>
              <span class="stat-count">{{ entry.count.toLocaleString() }}</span>
            </div>
          </div>
        </section>

        <!-- Selected chunk details -->
        <section v-if="selectedChunk" class="card chunk-details-card">
          <h2>
            {{ selectedChunk.icon }} {{ selectedChunk.typeName }}
            <span class="chunk-offset">@ offset {{ selectedChunk.chunk.offset }}</span>
          </h2>
          <div class="chunk-meta">
            <span>Packed: {{ formatSize(selectedChunk.chunk.length) }}</span>
            <span>Unpacked: {{ formatSize(selectedChunk.chunk.unpackedLength) }}</span>
            <span>Checksum: 0x{{ selectedChunk.chunk.checksum.toString(16).toUpperCase() }}</span>
          </div>
          <hex-viewer
            :value="selectedChunk.chunk.getReader()"
            :width="mapLoader?.mapSize?.width ?? 256"
            :height="mapLoader?.mapSize?.height ?? 256"
          />
        </section>

        <!-- Raw map info -->
        <section class="card info-card">
          <h2>Raw File Info</h2>
          <pre class="raw-info">{{ mapInfo }}</pre>
        </section>
      </main>
    </div>

    <!-- Empty state -->
    <div v-else class="empty-state">
      <div class="empty-icon">🗺️</div>
      <h2>Select a Map File</h2>
      <p>Choose a .map, .edm, or save game (.exe) file to analyze its structure</p>
    </div>
  </div>
</template>

<script setup lang="ts">
/* eslint-disable max-lines */
import { FileManager } from '@/utilities/file-manager';
import { useMapFileView, formatSize, type ChunkInfo } from './use-map-file-view';

import FileBrowser from '@/components/file-browser.vue';
import HexViewer from '@/components/hex-viewer.vue';
import MapPreview from '@/components/map-preview.vue';

const props = defineProps<{
    fileManager: FileManager;
}>();

const {
    mapInfo,
    mapLoader,
    selectedChunk,
    stats,
    entitySummary,
    metadata,
    isLoading,
    error,
    groupedChunks,
    onFileSelect,
    selectChunk,
} = useMapFileView(() => props.fileManager);

function getCategoryIcon(category: ChunkInfo['category']): string {
    const icons: Record<ChunkInfo['category'], string> = {
        general: '📋',
        landscape: '🗺️',
        entities: '🏠',
        player: '👤',
        savegame: '💾',
        unknown: '❓',
    };
    return icons[category];
}

function formatCategory(category: string): string {
    return category.charAt(0).toUpperCase() + category.slice(1);
}

function getBarWidth(count: number, total: number): string {
    if (total === 0) return '0%';
    // Scale so max is around 80% for visual clarity
    const maxPercent = 80;
    return Math.min(maxPercent, (count / total) * 100 * 2).toFixed(1) + '%';
}
</script>

<style scoped>
.map-file-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #0d0a05;
  color: #c8a96e;
}

/* Header */
.view-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  background: #1a1209;
  border-bottom: 1px solid #3a2810;
}

.view-header h1 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #e8c87e;
}

.file-selector {
  flex: 1;
  max-width: 400px;
}

/* Loading & Error states */
.loading-state,
.error-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 12px;
  color: #8a7040;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #3a2810;
  border-top-color: #d4a030;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-state {
  color: #c85050;
}

.error-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #3a1515;
  border: 2px solid #c85050;
  border-radius: 50%;
  font-weight: bold;
}

.empty-state {
  text-align: center;
}

.empty-icon {
  font-size: 48px;
  opacity: 0.5;
}

.empty-state h2 {
  margin: 0;
  color: #c8a96e;
}

.empty-state p {
  margin: 4px 0 0;
  font-size: 14px;
}

/* Content grid */
.content-grid {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 16px;
  padding: 16px;
  flex: 1;
  overflow: hidden;
}

/* Sidebar */
.sidebar {
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
}

/* Main content */
.main-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
}

/* Cards */
.card {
  background: #1a1209;
  border: 1px solid #3a2810;
  border-radius: 6px;
  padding: 12px;
}

.card h2 {
  margin: 0 0 12px;
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #8a7040;
  border-bottom: 1px solid #2a1a0a;
  padding-bottom: 8px;
}

/* Metadata card */
.metadata-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.metadata-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.metadata-item .label {
  font-size: 12px;
  color: #8a7040;
}

.metadata-item .value {
  font-size: 13px;
  font-weight: 500;
}

.type-badge {
  padding: 2px 8px;
  border-radius: 3px;
  font-size: 11px;
  text-transform: uppercase;
}

.type-badge.savegame {
  background: #2a3a1a;
  color: #8ac040;
}

.type-badge.map {
  background: #1a2a3a;
  color: #40a0c8;
}

/* Chunk list */
.chunks-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.chunk-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.chunk-category {
  display: flex;
  flex-direction: column;
}

.category-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: #6a5030;
  margin: 0 0 4px;
  padding: 4px 0;
}

.category-icon {
  font-size: 12px;
}

.category-count {
  margin-left: auto;
  background: #2a1a0a;
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 10px;
}

.chunk-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 8px;
  background: #0d0a05;
  border: 1px solid #2a1a0a;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
  font-size: 12px;
  color: #c8a96e;
  text-align: left;
}

.chunk-item:hover {
  background: #1a1209;
  border-color: #4a3218;
}

.chunk-item.selected {
  background: #2a1a0a;
  border-color: #d4a030;
}

.chunk-name {
  font-weight: 500;
}

.chunk-size {
  font-size: 11px;
  color: #6a5030;
}

/* Preview card */
.preview-card {
  max-height: 350px;
}

/* Resource Summary */
.resources-summary-card {
  background: linear-gradient(135deg, #1a1209, #2a1a0a);
}

.resource-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.resource-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #0d0a05;
  border: 1px solid #3a2810;
  border-radius: 6px;
  min-width: 120px;
}

.resource-icon {
  font-size: 18px;
}

.resource-name {
  font-size: 12px;
  color: #8a7040;
}

.resource-count {
  margin-left: auto;
  font-size: 14px;
  font-weight: 600;
  color: #e8c87e;
}

.resource-item.fish { border-left: 3px solid #40a0c8; }
.resource-item.coal { border-left: 3px solid #404040; }
.resource-item.iron { border-left: 3px solid #8a8a8a; }
.resource-item.gold { border-left: 3px solid #d4a030; }
.resource-item.sulphur { border-left: 3px solid #c8c040; }
.resource-item.stonemine { border-left: 3px solid #6a6a70; }
.resource-item.stone { border-left: 3px solid #a0a0a0; }
.resource-item.wood { border-left: 3px solid #4a8040; }

/* Stats card */
.stat-total {
  font-weight: 400;
  color: #6a5030;
  font-size: 12px;
}

.stat-bars {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 250px;
  overflow-y: auto;
}

.terrain-stats {
  max-height: 180px;
}

.stat-bar {
  display: grid;
  grid-template-columns: 100px 1fr 60px;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}

.stat-label {
  color: #8a7040;
}

.bar-container {
  height: 12px;
  background: #0d0a05;
  border-radius: 2px;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #d4a030, #e8c87e);
  border-radius: 2px;
}

.bar-fill.resource {
  background: linear-gradient(90deg, #40a0c8, #80c0e8);
}

.bar-fill.terrain {
  background: linear-gradient(90deg, #4a8040, #80c060);
}

.stat-count {
  text-align: right;
  color: #6a5030;
}

/* Chunk details card */
.chunk-details-card h2 {
  display: flex;
  align-items: center;
  gap: 8px;
}

.chunk-offset {
  margin-left: auto;
  font-size: 11px;
  font-weight: 400;
  color: #6a5030;
}

.chunk-meta {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
  padding: 8px;
  background: #0d0a05;
  border-radius: 4px;
  font-size: 12px;
  color: #8a7040;
}

/* Raw info */
.raw-info {
  margin: 0;
  padding: 8px;
  background: #0d0a05;
  border-radius: 4px;
  font-family: 'Courier New', monospace;
  font-size: 11px;
  color: #8a7040;
  white-space: pre-wrap;
  overflow-x: auto;
  max-height: 200px;
  overflow-y: auto;
}

/* Entity Data card */
.entity-data-card {
  background: linear-gradient(135deg, #1a1209, #1a1a12);
}

.entity-section {
  margin-bottom: 16px;
}

.entity-section:last-child {
  margin-bottom: 0;
}

.entity-section h3 {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: #c8a96e;
}

.entity-count {
  font-weight: 400;
  color: #6a5030;
}

.entity-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 150px;
  overflow-y: auto;
}

.entity-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  background: #0d0a05;
  border-radius: 3px;
  font-size: 11px;
}

.players-list .entity-row {
  background: #1a1a0a;
  border-left: 2px solid #d4a030;
}

.entity-type {
  flex: 1;
  color: #c8a96e;
}

.entity-player {
  padding: 1px 6px;
  background: #2a2a1a;
  border-radius: 3px;
  color: #8a8040;
  font-size: 10px;
}

.entity-amount {
  color: #6a5030;
  min-width: 50px;
  text-align: right;
}

.player-index {
  padding: 2px 6px;
  background: #d4a030;
  color: #1a1209;
  border-radius: 3px;
  font-weight: 600;
  font-size: 10px;
}

.player-tribe {
  flex: 1;
  color: #c8a96e;
}

.player-pos {
  color: #6a5030;
  font-size: 10px;
}

.entity-more {
  padding: 4px 8px;
  color: #6a5030;
  font-size: 11px;
  font-style: italic;
}

.entity-empty {
  padding: 12px;
  color: #6a5030;
  font-size: 12px;
  text-align: center;
  font-style: italic;
}

/* Scrollbar styling */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: #0d0a05; }
::-webkit-scrollbar-thumb { background: #3a2810; border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: #4a3820; }
</style>
