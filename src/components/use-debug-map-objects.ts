/**
 * Composable for debug panel map objects functionality.
 */
import { ref, onMounted, onUnmounted } from 'vue';
import type { Game } from '@/game/game';
import {
    populateMapObjectsFromEntityData,
    clearMapObjects,
    spawnTestObjects,
    countMapObjectsByCategory,
    type ObjectCategory
} from '@/game/systems/map-objects';

export function useDebugMapObjects(getGame: () => Game | null) {
    const mapObjectCounts = ref({ trees: 0, stones: 0, resources: 0, plants: 0, other: 0 });
    const hasObjectTypeData = ref(false);

    function updateMapObjectCounts() {
        const game = getGame();
        if (!game) return;

        // Check if map has entity data with objects (trees)
        hasObjectTypeData.value = (game.mapLoader.entityData?.objects?.length ?? 0) > 0;
        const counts = countMapObjectsByCategory(game.state);
        mapObjectCounts.value = {
            trees: counts.get('trees') ?? 0,
            stones: counts.get('stones') ?? 0,
            resources: counts.get('resources') ?? 0,
            plants: counts.get('plants') ?? 0,
            other: counts.get('other') ?? 0,
        };
    }

    function spawnCategory(category: ObjectCategory) {
        const game = getGame();
        if (!game) return;

        // For now, only spawn test objects since category-based spawning from entity data
        // would require filtering. Trees are loaded automatically on game start.
        spawnTestObjects(game.state, game.groundType, game.mapSize, category, 50);
        updateMapObjectCounts();
    }

    function spawnAllFromMap() {
        const game = getGame();
        if (!game) return;

        const entityObjects = game.mapLoader.entityData?.objects;
        if (entityObjects && entityObjects.length > 0) {
            populateMapObjectsFromEntityData(game.state, entityObjects, game.groundType, game.mapSize);
        } else {
            for (const cat of ['trees', 'stones', 'resources', 'plants'] as ObjectCategory[]) {
                spawnTestObjects(game.state, game.groundType, game.mapSize, cat, 30);
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
