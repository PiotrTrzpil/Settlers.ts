import { ref, shallowRef, triggerRef, computed, watch, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { MapLoader } from '@/resources/map/map-loader';
import { Game } from '@/game/game';
import { createTestMapLoader } from '@/game/test-map-factory';
import { Entity, TileCoord, UnitType } from '@/game/entity';
import { FileManager, IFileSource } from '@/utilities/file-manager';
import { LogHandler } from '@/utilities/log-handler';

const log = new LogHandler('MapView');

export function useMapView(getFileManager: () => FileManager) {
    const route = useRoute();
    const isTestMap = route.query.testMap === 'true';

    const fileName = ref<string | null>(null);
    const mapInfo = ref('');
    const game = shallowRef<Game | null>(null);
    const showDebug = ref(false);
    const showTerritoryBorders = ref(true);
    const activeTab = ref<'buildings' | 'units'>('buildings');
    const hoveredTile = ref<TileCoord | null>(null);

    const selectedEntity = computed<Entity | undefined>(() => {
        if (!game.value || game.value.state.selectedEntityId === null) return undefined;
        return game.value.state.getEntity(game.value.state.selectedEntityId);
    });

    const selectionCount = computed<number>(() => {
        if (!game.value) return 0;
        return game.value.state.selectedEntityIds.size;
    });

    const isPaused = computed<boolean>(() => {
        if (!game.value) return false;
        return !game.value.gameLoop.isRunning;
    });

    function loadTestMap(): void {
        if (game.value) return;
        const fm = getFileManager();
        if (!fm) return;
        const mapContent = createTestMapLoader();
        mapInfo.value = 'Test map (synthetic 256x256)';
        const g = new Game(fm, mapContent);
        g.useProceduralTextures = true;
        game.value = g;
    }

    function autoLoadFirstMap(): void {
        const fm = getFileManager();
        if (game.value || !fm) return;
        const maps = fm.filter('.map');
        if (maps.length > 0) {
            onFileSelect(maps[0]);
        }
    }

    onMounted(() => {
        if (isTestMap) {
            loadTestMap();
        } else {
            autoLoadFirstMap();
        }
    });

    watch(getFileManager, () => {
        if (isTestMap) {
            loadTestMap();
        } else {
            autoLoadFirstMap();
        }
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
        triggerRef(game);
    }

    function setSelectMode() {
        if (!game.value) return;
        game.value.mode = 'select';
        triggerRef(game);
    }

    function removeSelected(): void {
        if (!game.value || game.value.state.selectedEntityId === null) return;
        game.value.execute({
            type: 'remove_entity',
            entityId: game.value.state.selectedEntityId
        });
        triggerRef(game);
    }

    function togglePause(): void {
        if (!game.value) return;
        if (game.value.gameLoop.isRunning) {
            game.value.stop();
        } else {
            game.value.start();
        }
    }

    function spawnUnit(unitType: number) {
        if (!game.value) return;

        let spawnX = -1;
        let spawnY = -1;

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

        if (spawnX < 0) {
            const land = game.value.findLandTile();
            if (land) {
                spawnX = land.x;
                spawnY = land.y;
            }
        }

        if (spawnX < 0) return;

        game.value.execute({
            type: 'spawn_unit',
            unitType: unitType as UnitType,
            x: spawnX,
            y: spawnY,
            player: game.value.currentPlayer
        });
        triggerRef(game);
    }

    async function load(file: IFileSource) {
        const fm = getFileManager();
        if (!fm) return;

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
            game.value = new Game(fm, mapContent);
        } catch (e) {
            log.error('Failed to load map: ' + file.name, e instanceof Error ? e : new Error(String(e)));
        }
    }

    return {
        fileName,
        mapInfo,
        game,
        showDebug,
        showTerritoryBorders,
        activeTab,
        hoveredTile,
        selectedEntity,
        selectionCount,
        isPaused,
        onFileSelect,
        onTileClick,
        setPlaceMode,
        setSelectMode,
        removeSelected,
        togglePause,
        spawnUnit
    };
}
