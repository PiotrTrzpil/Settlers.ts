<template>
    <canvas
      height="800"
      width="800"
      ref="cav"
      class="cav"
    />
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, useTemplateRef } from 'vue';
import { Game } from '@/game/game';
import { LandscapeRenderer } from '@/game/renderer/landscape/landscape-renderer';
import { EntityRenderer } from '@/game/renderer/entity-renderer';
import { Renderer } from '@/game/renderer/renderer';
import { TilePicker } from '@/game/input/tile-picker';
import { EntityType, BuildingType } from '@/game/entity';

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

    const r = renderer;
    props.game.gameLoop.setRenderCallback(() => {
        if (entityRenderer && props.game) {
            entityRenderer.entities = props.game.state.entities;
            entityRenderer.selectedEntityId = props.game.state.selectedEntityId;
        }
        r.drawOnce();
    });
    props.game.start();
}

const handleClick = (e: MouseEvent) => {
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

    if (props.game.state.selectedEntityId !== null) {
        const entity = props.game.state.getEntity(props.game.state.selectedEntityId);
        if (entity && entity.type === EntityType.Unit) {
            props.game.execute({
                type: 'move_unit',
                entityId: entity.id,
                targetX: tile.x,
                targetY: tile.y
            });
        }
    }
};

onMounted(() => {
    const cavEl = cav.value!;
    renderer = new Renderer(cavEl);
    tilePicker = new TilePicker(cavEl);

    initRenderer();

    cavEl.addEventListener('click', handleClick);
    cavEl.addEventListener('contextmenu', handleRightClick);
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
        cavEl.removeEventListener('click', handleClick);
        cavEl.removeEventListener('contextmenu', handleRightClick);
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
