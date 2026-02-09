import { ref, shallowRef, triggerRef, computed, watch, onMounted, onUnmounted, reactive, type Ref, type ShallowRef } from 'vue';
import { useRoute } from 'vue-router';
import { MapLoader } from '@/resources/map/map-loader';
import { Game } from '@/game/game';
import { createTestMapLoader } from '@/game/test-map-factory';
import { Entity, TileCoord, UnitType, BuildingType } from '@/game/entity';
import { EMaterialType, DROPPABLE_MATERIALS } from '@/game/economy';
import { FileManager, IFileSource } from '@/utilities/file-manager';
import { LogHandler } from '@/utilities/log-handler';
import {
    LayerVisibility,
    loadLayerVisibility,
    saveLayerVisibility,
} from '@/game/renderer/layer-visibility';
import { debugStats } from '@/game/debug-stats';
import { gameSettings } from '@/game/game-settings';
import type { InputManager } from '@/game/input';
import { EntityRenderer } from '@/game/renderer/entity-renderer';

/** Entity counts per layer for display in the layer panel */
export interface LayerCounts {
    buildings: number;
    units: number;
    resources: number;
    environment: number;
    trees: number;
    stones: number;
    plants: number;
    other: number;
}

const log = new LogHandler('MapView');

/** Create a test map Game instance */
function createTestGame(fileManager: FileManager): Game {
    const mapContent = createTestMapLoader();
    const g = new Game(fileManager, mapContent);
    g.useProceduralTextures = true;
    return g;
}

/** Load a map file and create a Game instance */
async function loadMapFile(
    file: IFileSource,
    fileManager: FileManager
): Promise<{ game: Game | null; mapInfo: string }> {
    try {
        const fileData = await file.readBinary();
        if (!fileData) {
            log.error('Unable to load ' + file.name);
            return { game: null, mapInfo: '' };
        }

        const mapContent = MapLoader.getLoader(fileData);
        if (!mapContent) {
            log.error('Unsupported map format: ' + file.name);
            return { game: null, mapInfo: '' };
        }

        return { game: new Game(fileManager, mapContent), mapInfo: mapContent.toString() };
    } catch (e) {
        log.error('Failed to load map: ' + file.name, e instanceof Error ? e : new Error(String(e)));
        return { game: null, mapInfo: '' };
    }
}


/** Buildings available in the UI - organized by category */
const availableBuildings = [
    // --- Storage ---
    { type: BuildingType.Warehouse, id: 'warehouse', name: 'Warehouse', icon: '📦' },

    // --- Residential ---
    { type: BuildingType.SmallHouse, id: 'smallhouse', name: 'Small House', icon: '🏠' },
    { type: BuildingType.MediumHouse, id: 'mediumhouse', name: 'Medium House', icon: '🏡' },
    { type: BuildingType.LargeHouse, id: 'largehouse', name: 'Large House', icon: '🏘️' },
    { type: BuildingType.LivingHouse, id: 'livinghouse', name: 'Living House', icon: '🛖' },

    // --- Wood & Stone ---
    { type: BuildingType.Lumberjack, id: 'lumberjack', name: 'Lumberjack', icon: '🪓' },
    { type: BuildingType.Forester, id: 'forester', name: 'Forester', icon: '🌲' },
    { type: BuildingType.Sawmill, id: 'sawmill', name: 'Sawmill', icon: '🪚' },
    { type: BuildingType.Stonecutter, id: 'stonecutter', name: 'Stonecutter', icon: '🪨' },
    { type: BuildingType.StoneMine, id: 'stonemine', name: 'Stone Mine', icon: '⛰️' },

    // --- Food Production ---
    { type: BuildingType.Farm, id: 'farm', name: 'Farm', icon: '🌾' },
    { type: BuildingType.Windmill, id: 'windmill', name: 'Windmill', icon: '🌀' },
    { type: BuildingType.Bakery, id: 'bakery', name: 'Bakery', icon: '🍞' },
    { type: BuildingType.Fishery, id: 'fishery', name: 'Fishery', icon: '🐟' },
    { type: BuildingType.Hunter, id: 'hunter', name: 'Hunter', icon: '🏹' },
    { type: BuildingType.PigFarm, id: 'pigfarm', name: 'Pig Farm', icon: '🐷' },
    { type: BuildingType.Slaughterhouse, id: 'slaughterhouse', name: 'Slaughter', icon: '🥩' },
    { type: BuildingType.Waterworks, id: 'waterworks', name: 'Waterworks', icon: '💧' },
    { type: BuildingType.WinePress, id: 'winepress', name: 'Wine Press', icon: '🍷' },
    { type: BuildingType.DonkeyFarm, id: 'donkeyfarm', name: 'Donkey Farm', icon: '🫏' },

    // --- Mining & Smelting ---
    { type: BuildingType.CoalMine, id: 'coalmine', name: 'Coal Mine', icon: '⛏️' },
    { type: BuildingType.IronMine, id: 'ironmine', name: 'Iron Mine', icon: '🔩' },
    { type: BuildingType.GoldMine, id: 'goldmine', name: 'Gold Mine', icon: '🪙' },
    { type: BuildingType.SulfurMine, id: 'sulfurmine', name: 'Sulfur Mine', icon: '💛' },
    { type: BuildingType.IronSmelter, id: 'ironsmelter', name: 'Iron Smelter', icon: '🔥' },
    { type: BuildingType.GoldSmelter, id: 'goldsmelter', name: 'Gold Smelter', icon: '✨' },

    // --- Crafting ---
    { type: BuildingType.WeaponSmith, id: 'weaponsmith', name: 'Weaponsmith', icon: '⚔️' },
    { type: BuildingType.ToolSmith, id: 'toolsmith', name: 'Toolsmith', icon: '🔧' },
    { type: BuildingType.AmmunitionMaker, id: 'ammomaker', name: 'Ammo Maker', icon: '🎯' },

    // --- Military ---
    { type: BuildingType.Barrack, id: 'barrack', name: 'Barrack', icon: '🛡️' },
    { type: BuildingType.Tower, id: 'tower', name: 'Tower', icon: '🗼' },
    { type: BuildingType.LargeTower, id: 'largetower', name: 'Large Tower', icon: '🏰' },
    { type: BuildingType.ScoutTower, id: 'scouttower', name: 'Scout Tower', icon: '👁️' },
    { type: BuildingType.Castle, id: 'castle', name: 'Castle', icon: '🏯' },
    { type: BuildingType.SiegeWorkshop, id: 'siegeworkshop', name: 'Siege Works', icon: '⚙️' },

    // --- Special ---
    { type: BuildingType.Healer, id: 'healer', name: 'Healer', icon: '💊' },
    { type: BuildingType.SmallTemple, id: 'smalltemple', name: 'Small Temple', icon: '⛩️' },
    { type: BuildingType.LargeTemple, id: 'largetemple', name: 'Large Temple', icon: '🕌' },
    { type: BuildingType.Shipyard, id: 'shipyard', name: 'Shipyard', icon: '⛵' },
    { type: BuildingType.Decoration, id: 'decoration', name: 'Decoration', icon: '🌸' },
    { type: BuildingType.LargeDecoration, id: 'largedeco', name: 'Large Deco', icon: '🌳' },
];

/** Units available in the UI */
const availableUnits = [
    { type: UnitType.Bearer, id: 'bearer', name: 'Bearer', icon: '🧑' },
    { type: UnitType.Lumberjack, id: 'lumberjack', name: 'Lumberjack', icon: '🪓' },
    { type: UnitType.Builder, id: 'builder', name: 'Builder', icon: '👷' },
    { type: UnitType.Swordsman, id: 'swordsman', name: 'Swordsman', icon: '⚔️' },
    { type: UnitType.Bowman, id: 'bowman', name: 'Bowman', icon: '🏹' },
    { type: UnitType.Pikeman, id: 'pikeman', name: 'Pikeman', icon: '🔱' },
    { type: UnitType.Priest, id: 'priest', name: 'Priest', icon: '🙏' },
    { type: UnitType.Pioneer, id: 'pioneer', name: 'Pioneer', icon: '🚩' },
    { type: UnitType.Thief, id: 'thief', name: 'Thief', icon: '🥷' },
    { type: UnitType.Geologist, id: 'geologist', name: 'Geologist', icon: '🔍' },
];

/** Resources available in the UI (derived from droppable materials) */
const availableResources = DROPPABLE_MATERIALS.map(type => {
    const name = EMaterialType[type].charAt(0) + EMaterialType[type].slice(1).toLowerCase().replace('_', ' ');
    return {
        type,
        id: EMaterialType[type].toLowerCase(),
        name,
        icon: '📦' // Placeholder, will be replaced by texture
    };
});

/** Update resource icons from the sprite manager */
function updateResourceIconsFromManager(
    game: Game | null,
    resourceIcons: Ref<Record<number, string>>
): void {
    const g = game as any;
    if (!g?.renderer) return;

    const renderer = g.renderer as unknown as EntityRenderer;
    if (!renderer.spriteManager?.hasSprites) return;

    const manager = renderer.spriteManager;
    const atlas = manager.spriteAtlas;
    if (!atlas) return;

    let changed = false;
    for (const r of availableResources) {
        if (resourceIcons.value[r.type]) continue;
        const entry = manager.getResource(r.type, 0);
        if (!entry) continue;

        const imageData = atlas.extractRegion(entry.atlasRegion);
        if (!imageData) continue;

        const canvas = document.createElement('canvas');
        canvas.width = imageData.width;
        canvas.height = imageData.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.putImageData(imageData, 0, 0);
            resourceIcons.value[r.type] = canvas.toDataURL();
            changed = true;
        }
    }
    if (changed) triggerRef(resourceIcons);
}

/** Create mode toggle handler */
function createModeToggler(
    getGame: () => Game | null,
    getInputManager: () => InputManager | null
) {
    return {
        setPlaceMode(buildingType: number): void {
            const game = getGame();
            const inputManager = getInputManager();
            if (!game || !inputManager) return;

            if (debugStats.state.mode === 'place_building' &&
                debugStats.state.placeBuildingType === buildingType) {
                inputManager.switchMode('select');
            } else {
                inputManager.switchMode('place_building', {
                    buildingType,
                    player: game.currentPlayer,
                });
            }
        },

        setPlaceResourceMode(resourceType: EMaterialType, amount: number): void {
            const inputManager = getInputManager();
            if (!getGame() || !inputManager) return;

            if (debugStats.state.mode === 'place_resource' &&
                debugStats.state.placeResourceType === resourceType) {
                inputManager.switchMode('select');
            } else {
                inputManager.switchMode('place_resource', { resourceType, amount });
            }
        },

        setPlaceUnitMode(unitType: UnitType): void {
            const game = getGame();
            const inputManager = getInputManager();
            if (!game || !inputManager) return;

            if (debugStats.state.mode === 'place_unit' &&
                debugStats.state.placeUnitType === unitType) {
                inputManager.switchMode('select');
            } else {
                inputManager.switchMode('place_unit', { unitType });
            }
        },

        setSelectMode(): void {
            getInputManager()?.switchMode('select');
        }
    };
}

/** Create game action handlers */
function createGameActions(getGame: () => Game | null, game: ShallowRef<Game | null>) {
    return {
        removeSelected(): void {
            const g = getGame();
            if (!g || g.state.selectedEntityId === null) return;
            g.execute({ type: 'remove_entity', entityId: g.state.selectedEntityId });
            triggerRef(game);
        },

        togglePause(): void {
            const g = getGame();
            if (!g) return;
            if (g.gameLoop.isRunning) g.stop();
            else g.start();
        },
    };
}

export function useMapView(
    getFileManager: () => FileManager,
    getInputManager?: () => InputManager | null
) {
    const route = useRoute();
    // Check if testMap query param is present - use computed for reactivity
    // in case the route isn't fully resolved when the composable first runs
    const isTestMap = computed(() => {
        const param = route.query.testMap;
        return param === 'true' || param === '';
    });

    const fileName = ref<string | null>(null);
    const mapInfo = ref('');
    const game = shallowRef<Game | null>(null);

    // Use game settings for persisted display settings
    const showDebug = computed({
        get: () => gameSettings.state.showDebugGrid,
        set: (value: boolean) => { gameSettings.state.showDebugGrid = value }
    });

    const activeTab = ref<'buildings' | 'units' | 'resources'>('buildings');
    const resourceAmount = ref(1);
    const hoveredTile = ref<TileCoord | null>(null);
    const resourceIcons = ref<Record<number, string>>({});
    let iconUpdateInterval: number | null = null;

    // Layer visibility state (loaded from localStorage)
    const layerVisibility = reactive<LayerVisibility>(loadLayerVisibility());

    function updateLayerVisibility(newVisibility: LayerVisibility): void {
        Object.assign(layerVisibility, newVisibility);
        saveLayerVisibility(layerVisibility);
    }

    const selectedEntity = computed<Entity | undefined>(() =>
        game.value?.state.selectedEntityId != null
            ? game.value.state.getEntity(game.value.state.selectedEntityId)
            : undefined
    );
    const selectionCount = computed(() => game.value?.state.selectedEntityIds.size ?? 0);
    const isPaused = computed(() => game.value ? !game.value.gameLoop.isRunning : false);

    // Mode state - use debugStats as the single source of truth (reactive and instant)
    const currentMode = computed(() => debugStats.state.mode);
    const placeBuildingType = computed(() => debugStats.state.placeBuildingType);
    const placeResourceType = computed(() => debugStats.state.placeResourceType);
    const placeUnitType = computed(() => debugStats.state.placeUnitType);

    // Use debugStats as single source of truth for entity counts (reactive and updated each frame)
    const layerCounts = computed<LayerCounts>(() => ({
        buildings: debugStats.state.buildingCount,
        units: debugStats.state.unitCount,
        resources: debugStats.state.resourceCount,
        environment: debugStats.state.environmentCount,
        trees: debugStats.state.treeCount,
        stones: debugStats.state.stoneCount,
        plants: debugStats.state.plantCount,
        other: debugStats.state.otherCount,
    }));

    function loadTestMap(): void {
        if (game.value) return;
        const fm = getFileManager();
        if (!fm) return;
        mapInfo.value = 'Test map (synthetic 256x256)';
        game.value = createTestGame(fm);
    }

    function autoLoadFirstMap(): void {
        const fm = getFileManager();
        if (game.value || !fm) return;
        const maps = fm.filter('.map');
        if (maps.length > 0) {
            onFileSelect(maps[0]);
        }
    }

    const initializeMap = () => isTestMap.value ? loadTestMap() : autoLoadFirstMap();

    onMounted(() => {
        initializeMap();
        iconUpdateInterval = window.setInterval(updateResourceIcons, 1000);
    });
    // Cleanup interval
    // Cleanup interval
    onUnmounted(() => {
        if (iconUpdateInterval) clearInterval(iconUpdateInterval);
    });
    watch(getFileManager, initializeMap);

    // Update resource placement mode when amount changes
    watch(resourceAmount, () => {
        if (debugStats.state.mode === 'place_resource' && debugStats.state.placeResourceType) {
            const inputManager = getInputManager?.();
            if (inputManager) {
                // Re-enter mode with new amount
                inputManager.switchMode('place_resource', {
                    resourceType: debugStats.state.placeResourceType,
                    amount: resourceAmount.value
                });
            }
        }
    });

    function onFileSelect(file: IFileSource) {
        // Don't process file selection in test map mode - prevents file-browser
        // auto-select from triggering map loading that overwrites the test map
        if (isTestMap.value) return;

        fileName.value = file.name;
        void load(file);
    }

    function onTileClick(tile: TileCoord) {
        hoveredTile.value = tile;
    }

    // Create mode and action handlers
    const modeToggler = createModeToggler(() => game.value, () => getInputManager?.() ?? null);
    const gameActions = createGameActions(() => game.value, game);

    const setPlaceMode = modeToggler.setPlaceMode;
    const setPlaceResourceMode = (rt: EMaterialType) => modeToggler.setPlaceResourceMode(rt, resourceAmount.value);
    const setPlaceUnitMode = (ut: UnitType) => modeToggler.setPlaceUnitMode(ut);
    const setSelectMode = modeToggler.setSelectMode;
    const removeSelected = gameActions.removeSelected;
    const togglePause = gameActions.togglePause;

    async function load(file: IFileSource) {
        // Don't load map files if we're in test map mode - the test map is
        // already loaded synchronously and we don't want async file loading
        // to overwrite it (race condition from file-browser auto-select)
        if (isTestMap.value) return;

        const fm = getFileManager();
        if (!fm) return;
        const result = await loadMapFile(file, fm);
        if (result.game) {
            game.value = result.game;
            mapInfo.value = result.mapInfo;
        }
    }

    function updateResourceIcons() {
        updateResourceIconsFromManager(game.value, resourceIcons);
    }

    return {
        fileName,
        mapInfo,
        game,
        showDebug,
        activeTab,
        resourceAmount,
        resourceIcons,
        hoveredTile,
        selectedEntity,
        selectionCount,
        isPaused,
        currentMode,
        placeBuildingType,
        placeResourceType,
        placeUnitType,
        availableBuildings,
        availableUnits,
        availableResources,
        layerVisibility,
        layerCounts,
        onFileSelect,
        onTileClick,
        setPlaceMode,
        setPlaceResourceMode,
        setPlaceUnitMode,
        setSelectMode,
        removeSelected,
        togglePause,
        updateLayerVisibility
    };
}
