/**
 * Composable for debug panel map objects functionality.
 */
import { ref, onMounted, onUnmounted } from 'vue';
import type { Game } from '@/game/game';
import { MapObjectCategory } from '@/game/types/map-object-types';
import {
    populateMapObjectsFromEntityData,
    clearMapObjects,
    spawnTestObjects,
    countMapObjectsByCategory,
    TYPED_OBJECT_CATEGORIES,
} from '@/game/systems/map-objects';

export function useDebugMapObjects(getGame: () => Game | null) {
    const mapObjectCounts = ref({ trees: 0, goods: 0, crops: 0 });
    const hasObjectTypeData = ref(false);

    function updateMapObjectCounts() {
        const game = getGame();
        if (!game) return;

        // Check if map has entity data with objects (trees)
        hasObjectTypeData.value = (game.mapLoader.entityData?.objects.length ?? 0) > 0;
        const counts = countMapObjectsByCategory(game.state);
        mapObjectCounts.value = {
            trees: counts.get(MapObjectCategory.Trees) ?? 0,
            goods: counts.get(MapObjectCategory.Goods) ?? 0,
            crops: counts.get(MapObjectCategory.Crops) ?? 0,
        };
    }

    function spawnCategory(category: MapObjectCategory) {
        const game = getGame();
        if (!game) return;

        spawnTestObjects(game.state, game.terrain, category, 50);
        updateMapObjectCounts();
    }

    function spawnAllFromMap() {
        const game = getGame();
        if (!game) return;

        const entityObjects = game.mapLoader.entityData?.objects;
        if (entityObjects && entityObjects.length > 0) {
            populateMapObjectsFromEntityData(game.state, entityObjects, game.terrain);
        } else {
            for (const cat of TYPED_OBJECT_CATEGORIES) {
                spawnTestObjects(game.state, game.terrain, cat, 30);
            }
        }
        updateMapObjectCounts();
    }

    function clearAllMapObjects() {
        const game = getGame();
        if (!game) return;

        clearMapObjects(game.state);
        updateMapObjectCounts();
    }

    // Update counts periodically
    let countUpdateInterval: ReturnType<typeof setInterval> | null = null;
    onMounted(() => {
        updateMapObjectCounts();
        countUpdateInterval = setInterval(updateMapObjectCounts, 1000);
    });
    onUnmounted(() => {
        if (countUpdateInterval) clearInterval(countUpdateInterval);
    });

    return {
        mapObjectCounts,
        hasObjectTypeData,
        spawnCategory,
        spawnAllFromMap,
        clearAllMapObjects,
    };
}
