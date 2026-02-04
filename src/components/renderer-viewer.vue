<template>
    <canvas
      height="800"
      width="800"
      ref="cav"
      class="cav"
    />
</template>

<script setup lang="ts">
import { watch, onMounted, onUnmounted, useTemplateRef } from 'vue';
import { Game } from '@/game/game';
import { LandscapeRenderer } from '@/game/renderer/landscape/landscape-renderer';
import { EntityRenderer } from '@/game/renderer/entity-renderer';
import { Renderer } from '@/game/renderer/renderer';
import { TilePicker } from '@/game/input/tile-picker';
import { EntityType, BuildingType } from '@/game/entity';
import { canPlaceBuildingWithTerritory } from '@/game/systems/placement';

const DRAG_THRESHOLD = 5; // pixels before drag-box activates

/** Formation offsets for group move: center, then ring 1, then ring 2 */
const FORMATION_OFFSETS: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [1, 0], [0, 1], [-1, 0], [0, -1],
    [1, 1], [-1, 1], [1, -1], [-1, -1],
    [2, 0], [0, 2], [-2, 0], [0, -2],
    [2, 1], [1, 2], [-1, 2], [-2, 1],
    [-2, -1], [-1, -2], [1, -2], [2, -1],
    [2, 2], [-2, 2], [2, -2], [-2, -2]
];

const props = defineProps<{
    game: Game | null;
    debugGrid: boolean;
}>();

const emit = defineEmits<{
    (e: 'tileClick', tile: { x: number; y: number }): void;
}>();

const cav = useTemplateRef<HTMLCanvasElement>('cav');

let renderer: Renderer | null = null;
let tilePicker: TilePicker | null = null;
let entityRenderer: EntityRenderer | null = null;

// Drag-box selection state
let dragStart: { x: number; y: number } | null = null;
let isDragging = false;

function initRenderer() {
    if ((props.game == null) || (renderer == null)) {
        return;
    }

    renderer.add(
        new LandscapeRenderer(
            props.game.fileManager,
            renderer.textureManager,
            props.game.mapSize,
            props.game.groundType,
            props.game.groundHeight,
            props.debugGrid
        )
    );

    entityRenderer = new EntityRenderer(
        props.game.mapSize,
        props.game.groundHeight
    );
    renderer.add(entityRenderer);

    void renderer.init();

    // Center camera on the first land tile
    const landTile = props.game.findLandTile();
    if (landTile) {
        renderer.viewPoint.setPosition(landTile.x, landTile.y);
    }

    // Start game loop with render callback
    const r = renderer;
    props.game.gameLoop.setRenderCallback(() => {
        if (entityRenderer && props.game) {
            entityRenderer.entities = props.game.state.entities;
            entityRenderer.selectedEntityId = props.game.state.selectedEntityId;
            entityRenderer.selectedEntityIds = props.game.state.selectedEntityIds;
            entityRenderer.unitStates = props.game.state.unitStates;
            entityRenderer.territoryMap = props.game.territory;
            entityRenderer.territoryVersion = props.game.territoryVersion;
        }
        r.drawOnce();
    });
    props.game.start();
}

const handleMouseDown = (e: PointerEvent) => {
    if (e.button !== 0) return; // left button only
    dragStart = { x: e.offsetX, y: e.offsetY };
    isDragging = false;
};

const handleMouseUp = (e: PointerEvent) => {
    if (e.button !== 0 || !dragStart) return;

    const dx = e.offsetX - dragStart.x;
    const dy = e.offsetY - dragStart.y;
    const wasDrag = Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD;

    if (wasDrag && props.game?.mode === 'select') {
        handleDragSelect(dragStart.x, dragStart.y, e.offsetX, e.offsetY);
    } else {
        handleClick(e);
    }

    dragStart = null;
    isDragging = false;
};

function handleDragSelect(x1: number, y1: number, x2: number, y2: number): void {
    if (!props.game || !tilePicker || !renderer) return;

    const tile1 = tilePicker.screenToTile(
        x1, y1,
        renderer.viewPoint,
        props.game.mapSize,
        props.game.groundHeight
    );
    const tile2 = tilePicker.screenToTile(
        x2, y2,
        renderer.viewPoint,
        props.game.mapSize,
        props.game.groundHeight
    );

    if (!tile1 || !tile2) return;

    props.game.execute({
        type: 'select_area',
        x1: tile1.x,
        y1: tile1.y,
        x2: tile2.x,
        y2: tile2.y
    });
}

const handleClick = (e: PointerEvent) => {
    if (!props.game || !tilePicker || !renderer) return;

    const tile = tilePicker.screenToTile(
        e.offsetX, e.offsetY,
        renderer.viewPoint,
        props.game.mapSize,
        props.game.groundHeight
    );

    if (!tile) return;

    emit('tileClick', tile);

    if (props.game.mode === 'place_building') {
        props.game.execute({
            type: 'place_building',
            buildingType: props.game.placeBuildingType as BuildingType,
            x: tile.x,
            y: tile.y,
            player: props.game.currentPlayer
        });
    } else if (props.game.mode === 'select') {
        const entity = props.game.state.getEntityAt(tile.x, tile.y);
        props.game.execute({
            type: 'select',
            entityId: entity ? entity.id : null
        });
    }
};

const handleRightClick = (e: MouseEvent) => {
    e.preventDefault();
    if (!props.game || !tilePicker || !renderer) return;

    const tile = tilePicker.screenToTile(
        e.offsetX, e.offsetY,
        renderer.viewPoint,
        props.game.mapSize,
        props.game.groundHeight
    );

    if (!tile) return;

    // Collect all selected units
    const units: number[] = [];
    for (const entityId of props.game.state.selectedEntityIds) {
        const entity = props.game.state.getEntity(entityId);
        if (entity && entity.type === EntityType.Unit) {
            units.push(entity.id);
        }
    }

    // Spread units around the target in a formation
    for (let i = 0; i < units.length; i++) {
        const offset = FORMATION_OFFSETS[Math.min(i, FORMATION_OFFSETS.length - 1)];
        props.game.execute({
            type: 'move_unit',
            entityId: units[i],
            targetX: tile.x + offset[0],
            targetY: tile.y + offset[1]
        });
    }
};

/** Show placement preview ghost building as the mouse moves */
const handleMouseMove = (e: PointerEvent) => {
    if (!props.game || !tilePicker || !renderer || !entityRenderer) return;

    // Track dragging state
    if (dragStart) {
        const dx = e.offsetX - dragStart.x;
        const dy = e.offsetY - dragStart.y;
        if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
            isDragging = true;
        }
    }

    // Only show placement preview in place_building mode
    if (props.game.mode !== 'place_building') {
        entityRenderer.previewTile = null;
        return;
    }

    const tile = tilePicker.screenToTile(
        e.offsetX, e.offsetY,
        renderer.viewPoint,
        props.game.mapSize,
        props.game.groundHeight
    );

    if (!tile) {
        entityRenderer.previewTile = null;
        return;
    }

    entityRenderer.previewTile = tile;
    const hasBuildings = props.game.state.entities.some(
        ent => ent.type === EntityType.Building && ent.player === props.game!.currentPlayer
    );
    entityRenderer.previewValid = canPlaceBuildingWithTerritory(
        props.game.groundType,
        props.game.groundHeight,
        props.game.mapSize,
        props.game.state.tileOccupancy,
        props.game.territory,
        tile.x,
        tile.y,
        props.game.currentPlayer,
        hasBuildings
    );
};

onMounted(() => {
    const cavEl = cav.value!;
    renderer = new Renderer(cavEl);
    tilePicker = new TilePicker(cavEl);

    initRenderer();

    // Use pointer events (not mouse events) because ViewPoint's
    // pointerdown handler calls preventDefault(), which suppresses
    // compatibility mouse events per the Pointer Events spec.
    cavEl.addEventListener('pointerdown', handleMouseDown);
    cavEl.addEventListener('pointerup', handleMouseUp);
    cavEl.addEventListener('contextmenu', handleRightClick);
    cavEl.addEventListener('pointermove', handleMouseMove);
});

watch(() => props.game, () => {
    initRenderer();
});

onUnmounted(() => {
    if (props.game) {
        props.game.stop();
    }

    if (renderer) {
        const cavEl = renderer.canvas;
        cavEl.removeEventListener('pointerdown', handleMouseDown);
        cavEl.removeEventListener('pointerup', handleMouseUp);
        cavEl.removeEventListener('contextmenu', handleRightClick);
        cavEl.removeEventListener('pointermove', handleMouseMove);
        renderer.destroy();
    }
});
</script>

<style scoped>
.cav {
  margin: 3px;
  border: 1px solid blue;
}
</style>
