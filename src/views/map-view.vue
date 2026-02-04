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
        <span v-if="selectionCount > 1"> (+{{ selectionCount - 1 }} more)</span>
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
        <button
          data-testid="btn-remove-entity"
          :disabled="!selectedEntity"
          @click="removeSelected()"
        >Delete Selected</button>
        <button
          data-testid="btn-pause"
          :class="{ active: isPaused }"
          @click="togglePause()"
        >{{ isPaused ? 'Resume' : 'Pause' }}</button>
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

<script src="./map-view.ts"></script>

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

.game-controls button:disabled {
    opacity: 0.4;
    cursor: default;
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
