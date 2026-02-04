<template>
  <div class="about">
    Map File:
    <file-browser
      :fileManager="fileManager"
      @select="onFileSelect"
      filter=".map"
      class="browser"
    />

    <pre class="fullsize">{{mapInfo}}</pre>
    <label>
      <input type="checkbox" v-model="showDebug" />
      Show debugging Grid
    </label>
  </div>

  <div v-if="game" class="game-ui" data-testid="game-ui">
    <div class="game-controls">
      <div class="mode-indicator" data-testid="mode-indicator">
        Mode: <strong>{{ game.mode }}</strong>
      </div>

      <div class="tile-info" data-testid="tile-info" v-if="hoveredTile">
        Tile: ({{ hoveredTile.x }}, {{ hoveredTile.y }})
      </div>

      <div class="entity-info" data-testid="entity-info" v-if="selectedEntity">
        Selected: {{ selectedEntity.type === 1 ? 'Unit' : 'Building' }}
        #{{ selectedEntity.id }}
        at ({{ selectedEntity.x }}, {{ selectedEntity.y }})
      </div>

      <div class="building-palette" data-testid="building-palette">
        <strong>Buildings:</strong>
        <button
          data-testid="btn-guardhouse"
          :class="{ active: game.mode === 'place_building' && game.placeBuildingType === 0 }"
          @click="setPlaceMode(0)"
        >Guardhouse</button>
        <button
          data-testid="btn-woodcutter"
          :class="{ active: game.mode === 'place_building' && game.placeBuildingType === 1 }"
          @click="setPlaceMode(1)"
        >Woodcutter</button>
        <button
          data-testid="btn-warehouse"
          :class="{ active: game.mode === 'place_building' && game.placeBuildingType === 2 }"
          @click="setPlaceMode(2)"
        >Warehouse</button>
      </div>

      <div class="unit-controls" data-testid="unit-controls">
        <button
          data-testid="btn-spawn-settler"
          @click="spawnUnit(0)"
        >Spawn Settler</button>
        <button
          data-testid="btn-spawn-soldier"
          @click="spawnUnit(1)"
        >Spawn Soldier</button>
      </div>

      <div class="mode-controls">
        <button
          data-testid="btn-select-mode"
          :class="{ active: game.mode === 'select' }"
          @click="setSelectMode()"
        >Select Mode</button>
      </div>

      <div class="entity-count" data-testid="entity-count">
        Entities: {{ game.state.entities.length }}
      </div>
    </div>
  </div>

  <renderer-viewer
    :game="game"
    :debugGrid="showDebug"
    @tileClick="onTileClick"
  />
</template>

<script setup lang="ts">
import { ref, shallowRef, computed } from 'vue';
import { MapLoader } from '@/resources/map/map-loader';
import { Game } from '@/game/game';
import { Entity, TileCoord, UnitType } from '@/game/entity';
import { FileManager, IFileSource } from '@/utilities/file-manager';
import { LogHandler } from '@/utilities/log-handler';

import FileBrowser from '@/components/file-browser.vue';
import RendererViewer from '@/components/renderer-viewer.vue';

const log = new LogHandler('MapView');

const props = defineProps<{
    fileManager: FileManager;
}>();

const fileName = ref<string | null>(null);
const mapInfo = ref('');
const game = shallowRef<Game | null>(null);
const showDebug = ref(false);
const hoveredTile = ref<TileCoord | null>(null);

const selectedEntity = computed<Entity | undefined>(() => {
    if (!game.value || game.value.state.selectedEntityId === null) return undefined;
    return game.value.state.getEntity(game.value.state.selectedEntityId);
});

function onFileSelect(file: IFileSource) {
    fileName.value = file.name;
    void load(file);
}

function onTileClick(tile: TileCoord) {
    hoveredTile.value = tile;
}

function setPlaceMode(buildingType: number) {
    if (!game.value) return;
    game.value.mode = 'place_building';
    game.value.placeBuildingType = buildingType;
}

function setSelectMode() {
    if (!game.value) return;
    game.value.mode = 'select';
}

function spawnUnit(unitType: number) {
    if (!game.value) return;

    let spawnX = 10;
    let spawnY = 10;

    if (game.value.state.selectedEntityId !== null) {
        const selected = game.value.state.getEntity(game.value.state.selectedEntityId);
        if (selected) {
            spawnX = selected.x;
            spawnY = selected.y;
        }
    } else if (hoveredTile.value) {
        spawnX = hoveredTile.value.x;
        spawnY = hoveredTile.value.y;
    }

    game.value.execute({
        type: 'spawn_unit',
        unitType: unitType as UnitType,
        x: spawnX,
        y: spawnY,
        player: game.value.currentPlayer
    });
}

async function load(file: IFileSource) {
    if (!props.fileManager) {
        return;
    }

    try {
        const fileData = await file.readBinary();
        if (!fileData) {
            log.error('Unable to load ' + file.name);
            return;
        }

        const mapContent = MapLoader.getLoader(fileData);
        if (!mapContent) {
            log.error('Unsupported map format: ' + file.name);
            return;
        }

        mapInfo.value = mapContent.toString();
        game.value = new Game(props.fileManager, mapContent);
    } catch (e) {
        log.error('Failed to load map: ' + file.name, e instanceof Error ? e : new Error(String(e)));
    }
}
</script>

<style scoped>
.mulit-row{
    font-family:"Courier New", Courier, monospace
}

.game-ui {
    margin: 8px 3px;
    padding: 8px;
    background: #f0f0f0;
    border: 1px solid #ccc;
    border-radius: 4px;
}

.game-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
}

.game-controls button {
    padding: 4px 12px;
    cursor: pointer;
    border: 1px solid #999;
    border-radius: 3px;
    background: #fff;
}

.game-controls button:hover {
    background: #e0e0e0;
}

.game-controls button.active {
    background: #4CAF50;
    color: white;
    border-color: #388E3C;
}

.mode-indicator {
    padding: 4px 8px;
    background: #e8e8e8;
    border-radius: 3px;
}

.tile-info, .entity-info {
    padding: 4px 8px;
    background: #d0e8ff;
    border-radius: 3px;
}

.entity-count {
    padding: 4px 8px;
    background: #ffe0d0;
    border-radius: 3px;
}
</style>
