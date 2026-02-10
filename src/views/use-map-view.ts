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

/** Check if Lua scripting is enabled in localStorage */
function isLuaEnabled(): boolean {
    try {
        return localStorage.getItem('settlers_luaEnabled') === 'true';
    } catch {
        return false;
    }
}

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
    { type: BuildingType.StorageArea, id: 'warehouse', name: 'Warehouse', icon: '📦' },

    // --- Residential ---
    { type: BuildingType.ResidenceSmall, id: 'smallhouse', name: 'Small House', icon: '🏠' },
    { type: BuildingType.ResidenceMedium, id: 'mediumhouse', name: 'Medium House', icon: '🏡' },
    { type: BuildingType.ResidenceBig, id: 'largehouse', name: 'Large House', icon: '🏘️' },
    { type: BuildingType.LivingHouse, id: 'livinghouse', name: 'Living House', icon: '🛖' },

    // --- Wood & Stone ---
    { type: BuildingType.WoodcutterHut, id: 'woodcutter', name: 'Woodcutter Hut', icon: '🪓' },
    { type: BuildingType.ForesterHut, id: 'forester', name: 'Forester', icon: '🌲' },
    { type: BuildingType.Sawmill, id: 'sawmill', name: 'Sawmill', icon: '🪚' },
    { type: BuildingType.StonecutterHut, id: 'stonecutter', name: 'Stonecutter', icon: '🪨' },
    { type: BuildingType.StoneMine, id: 'stonemine', name: 'Stone Mine', icon: '⛰️' },

    // --- Food Production ---
    { type: BuildingType.GrainFarm, id: 'farm', name: 'Farm', icon: '🌾' },
    { type: BuildingType.Mill, id: 'windmill', name: 'Windmill', icon: '🌀' },
    { type: BuildingType.Bakery, id: 'bakery', name: 'Bakery', icon: '🍞' },
    { type: BuildingType.FisherHut, id: 'fishery', name: 'Fishery', icon: '🐟' },
    { type: BuildingType.HunterHut, id: 'hunter', name: 'Hunter', icon: '🏹' },
    { type: BuildingType.AnimalRanch, id: 'pigfarm', name: 'Pig Farm', icon: '🐷' },
    { type: BuildingType.Slaughterhouse, id: 'slaughterhouse', name: 'Slaughter', icon: '🥩' },
    { type: BuildingType.WaterworkHut, id: 'waterworks', name: 'Waterworks', icon: '💧' },
    { type: BuildingType.WinePress, id: 'winepress', name: 'Wine Press', icon: '🍷' },
    { type: BuildingType.DonkeyRanch, id: 'donkeyfarm', name: 'Donkey Farm', icon: '🫏' },

    // --- Mining & Smelting ---
    { type: BuildingType.CoalMine, id: 'coalmine', name: 'Coal Mine', icon: '⛏️' },
    { type: BuildingType.IronMine, id: 'ironmine', name: 'Iron Mine', icon: '🔩' },
    { type: BuildingType.GoldMine, id: 'goldmine', name: 'Gold Mine', icon: '🪙' },
    { type: BuildingType.SulfurMine, id: 'sulfurmine', name: 'Sulfur Mine', icon: '💛' },
    { type: BuildingType.IronSmelter, id: 'ironsmelter', name: 'Iron Smelter', icon: '🔥' },
    { type: BuildingType.SmeltGold, id: 'goldsmelter', name: 'Gold Smelter', icon: '✨' },

    // --- Crafting ---
    { type: BuildingType.WeaponSmith, id: 'weaponsmith', name: 'Weaponsmith', icon: '⚔️' },
    { type: BuildingType.ToolSmith, id: 'toolsmith', name: 'Toolsmith', icon: '🔧' },
    { type: BuildingType.AmmunitionMaker, id: 'ammomaker', name: 'Ammo Maker', icon: '🎯' },

    // --- Military ---
    { type: BuildingType.Barrack, id: 'barrack', name: 'Barrack', icon: '🛡️' },
    { type: BuildingType.GuardTowerSmall, id: 'tower', name: 'Tower', icon: '🗼' },
    { type: BuildingType.GuardTowerBig, id: 'largetower', name: 'Large Tower', icon: '🏰' },
    { type: BuildingType.LookoutTower, id: 'scouttower', name: 'Scout Tower', icon: '👁️' },
    { type: BuildingType.Castle, id: 'castle', name: 'Castle', icon: '🏯' },
    { type: BuildingType.SiegeWorkshop, id: 'siegeworkshop', name: 'Siege Works', icon: '⚙️' },

    // --- Special ---
    { type: BuildingType.HealerHut, id: 'healer', name: 'Healer', icon: '💊' },
    { type: BuildingType.SmallTemple, id: 'smalltemple', name: 'Small Temple', icon: '⛩️' },
    { type: BuildingType.LargeTemple, id: 'largetemple', name: 'Large Temple', icon: '🕌' },
    { type: BuildingType.Shipyard, id: 'shipyard', name: 'Shipyard', icon: '⛵' },
    { type: BuildingType.Decoration, id: 'decoration', name: 'Decoration', icon: '🌸' },
    { type: BuildingType.LargeDecoration, id: 'largedeco', name: 'Large Deco', icon: '🌳' },
];

/** Units available in the UI */
const availableUnits = [
    { type: UnitType.Carrier, id: 'carrier', name: 'Carrier', icon: '🧑' },
    { type: UnitType.Builder, id: 'builder', name: 'Builder', icon: '👷' },
    { type: UnitType.Woodcutter, id: 'woodcutter', name: 'Woodcutter', icon: '🪓' },
    { type: UnitType.Miner, id: 'miner', name: 'Miner', icon: '⛏️' },
    { type: UnitType.Forester, id: 'forester', name: 'Forester', icon: '🌲' },
    { type: UnitType.Farmer, id: 'farmer', name: 'Farmer', icon: '🌾' },
    { type: UnitType.Smith, id: 'smith', name: 'Smith', icon: '🔨' },
    { type: UnitType.Digger, id: 'digger', name: 'Digger', icon: '🕳️' },
    { type: UnitType.Swordsman, id: 'swordsman', name: 'Swordsman', icon: '⚔️' },
    { type: UnitType.Bowman, id: 'bowman', name: 'Bowman', icon: '🏹' },
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
    if (!manager.spriteAtlas) return;

    let changed = false;
    for (const r of availableResources) {
        if (resourceIcons.value[r.type]) continue;
        const entry = manager.getResource(r.type, 0);
        if (!entry) continue;

        const imageData = manager.extractSpriteAsImageData(entry.atlasRegion);
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

    // =========================================================================
    // Map Loading State
    // =========================================================================

    const fileName = ref<string | null>(null);
    const mapInfo = ref('');
    const game = shallowRef<Game | null>(null);

    /** Tracks map loading state to prevent race conditions */
    const mapLoadState = reactive({
        isLoading: false,
        currentFile: null as string | null,
        initialized: false,
    });

    /**
     * Central map loading function. All map loads go through here.
     * Handles guards, cleanup, and state management in one place.
     */
    async function loadMap(file: IFileSource | null, options: { isTestMap?: boolean } = {}): Promise<boolean> {
        const fm = getFileManager();
        if (!fm) {
            log.debug('Cannot load map: FileManager not available');
            return false;
        }

        // Guard: prevent concurrent loads
        if (mapLoadState.isLoading) {
            log.debug(`Skipping map load${file ? ` for ${file.name}` : ''} - already loading`);
            return false;
        }

        // Guard: don't reload same file
        if (file && mapLoadState.currentFile === file.name) {
            log.debug(`Skipping map load for ${file.name} - already loaded`);
            return false;
        }

        mapLoadState.isLoading = true;

        try {
            // Destroy old game first to prevent multiple game loops
            if (game.value) {
                game.value.destroy();
                game.value = null;
            }

            if (options.isTestMap) {
                // Load synthetic test map
                mapInfo.value = 'Test map (synthetic 256x256)';
                fileName.value = null;
                mapLoadState.currentFile = '__test_map__';
                game.value = createTestGame(fm);
                return true;
            }

            if (!file) {
                log.debug('No map file provided');
                return false;
            }

            // Load real map file
            const result = await loadMapFile(file, fm);
            if (!result.game) {
                log.error(`Failed to load map: ${file.name}`);
                return false;
            }

            fileName.value = file.name;
            mapLoadState.currentFile = file.name;
            mapInfo.value = result.mapInfo;
            game.value = result.game;

            // Load mission script (non-blocking, only if Lua enabled)
            if (isLuaEnabled()) {
                result.game.loadScript(file.name).then(scriptResult => {
                    if (scriptResult.success) {
                        log.info(`Script loaded: ${scriptResult.scriptPath}`);
                    }
                });
            }

            return true;
        } finally {
            mapLoadState.isLoading = false;
        }
    }

    /**
     * Initialize map on first load. Called once from onMounted.
     * Subsequent file selections go through onFileSelect.
     */
    function initializeMap(): void {
        // Only initialize once
        if (mapLoadState.initialized) return;
        mapLoadState.initialized = true;

        if (isTestMap.value) {
            void loadMap(null, { isTestMap: true });
        } else {
            // Auto-load first available map
            const fm = getFileManager();
            if (!fm) return;
            const maps = fm.filter('.map');
            if (maps.length > 0) {
                void loadMap(maps[0]);
            }
        }
    }

    /**
     * Handle user file selection from file browser.
     */
    function onFileSelect(file: IFileSource): void {
        // In test map mode, ignore file browser selections
        if (isTestMap.value) return;

        void loadMap(file);
    }

    // =========================================================================
    // UI State
    // =========================================================================

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

    // =========================================================================
    // Computed State
    // =========================================================================

    const selectedEntity = computed<Entity | undefined>(() =>
        game.value?.state.selectedEntityId != null
            ? game.value.state.getEntity(game.value.state.selectedEntityId)
            : undefined
    );
    const selectionCount = computed(() => game.value?.state.selectedEntityIds.size ?? 0);
    const isPaused = computed(() => game.value ? !game.value.gameLoop.isRunning : false);

    // Mode state - use debugStats as the single source of truth
    const currentMode = computed(() => debugStats.state.mode);
    const placeBuildingType = computed(() => debugStats.state.placeBuildingType);
    const placeResourceType = computed(() => debugStats.state.placeResourceType);
    const placeUnitType = computed(() => debugStats.state.placeUnitType);

    // Entity counts from debugStats
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

    // =========================================================================
    // Lifecycle
    // =========================================================================

    onMounted(() => {
        initializeMap();
        iconUpdateInterval = window.setInterval(updateResourceIcons, 1000);
    });

    onUnmounted(() => {
        if (iconUpdateInterval) clearInterval(iconUpdateInterval);
    });

    // Re-initialize if FileManager changes (e.g., user selects new game directory)
    watch(getFileManager, () => {
        // Reset initialization flag to allow re-init with new FileManager
        mapLoadState.initialized = false;
        mapLoadState.currentFile = null;
        initializeMap();
    });

    // Update resource placement mode when amount changes
    watch(resourceAmount, () => {
        if (debugStats.state.mode === 'place_resource' && debugStats.state.placeResourceType) {
            const inputManager = getInputManager?.();
            if (inputManager) {
                inputManager.switchMode('place_resource', {
                    resourceType: debugStats.state.placeResourceType,
                    amount: resourceAmount.value
                });
            }
        }
    });

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
