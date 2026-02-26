import { ref, shallowRef, triggerRef, computed, watch, onMounted, reactive, type Ref, type ShallowRef } from 'vue';
import { useRoute } from 'vue-router';
import { MapLoader } from '@/resources/map/map-loader';
import { Game } from '@/game/game';
import { createTestMapLoader } from '@/game/test-map-factory';
import { Entity, TileCoord, UnitType, BuildingType } from '@/game/entity';
import { isUnitAvailableForRace, isBuildingAvailableForRace } from '@/game/race-availability';
import { Race } from '@/game/race';
import { EMaterialType, DROPPABLE_MATERIALS } from '@/game/economy';
import { FileManager, IFileSource } from '@/utilities/file-manager';
import { LogHandler } from '@/utilities/log-handler';
import { LayerVisibility, loadLayerVisibility, saveLayerVisibility } from '@/game/renderer/layer-visibility';
import type { InputManager } from '@/game/input';
import { loadBuildingIcons, loadResourceIcons, type IconEntry } from './sprite-icon-loader';
import { debugStats } from '@/game/debug-stats';
import { prefetchSpriteCache } from '@/game/renderer/sprite-render-manager';
import {
    gameStatePersistence,
    loadSnapshot,
    restoreFromSnapshot,
    clearSavedGameState,
    setCurrentMapId,
    saveInitialState,
} from '@/game/game-state-persistence';

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
        const mlt = debugStats.state.mapLoadTimings;

        const t0 = performance.now();
        const fileData = await file.readBinary();
        mlt.fileRead = Math.round(performance.now() - t0);

        const t1 = performance.now();
        const mapContent = MapLoader.getLoader(fileData);
        mlt.mapParse = Math.round(performance.now() - t1);

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

/** All building definitions for the UI — filtered by race at runtime */
const ALL_BUILDINGS = [
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
    { type: BuildingType.Vinyard, id: 'vinyard', name: 'Vineyard', icon: '🍇' },
    { type: BuildingType.BeekeeperHut, id: 'beekeeper', name: 'Beekeeper', icon: '🐝' },
    { type: BuildingType.MeadMakerHut, id: 'meadmaker', name: 'Mead Maker', icon: '🍯' },
    { type: BuildingType.AgaveFarmerHut, id: 'agavefarmer', name: 'Agave Farm', icon: '🌵' },
    { type: BuildingType.TequilaMakerHut, id: 'tequilamaker', name: 'Tequila Maker', icon: '🥃' },
    { type: BuildingType.SunflowerFarmerHut, id: 'sunflowerfarmer', name: 'Sunflower Farm', icon: '🌻' },
    { type: BuildingType.SunflowerOilMakerHut, id: 'sunfloweroilmaker', name: 'Oil Press', icon: '🫒' },
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
    { type: BuildingType.Eyecatcher01, id: 'eyecatcher01', name: 'Eyecatcher 1', icon: '🕯️' },
    { type: BuildingType.Eyecatcher02, id: 'eyecatcher02', name: 'Eyecatcher 2', icon: '🏛️' },

    // --- Dark Tribe ---
    { type: BuildingType.MushroomFarm, id: 'mushroomfarm', name: 'Mushroom Farm', icon: '🍄' },
    { type: BuildingType.DarkTemple, id: 'darktemple', name: 'Dark Temple', icon: '🏚️' },
    { type: BuildingType.Fortress, id: 'fortress', name: 'Fortress', icon: '🏰' },
    { type: BuildingType.ManaCopterHall, id: 'manacopter', name: 'Mana Copter Hall', icon: '👼' },
];

/** All unit definitions for the UI */
const ALL_UNITS: { type: UnitType; id: string; name: string; icon: string }[] = [
    { type: UnitType.Carrier, id: 'carrier', name: 'Carrier', icon: '🧑' },
    { type: UnitType.Builder, id: 'builder', name: 'Builder', icon: '👷' },
    { type: UnitType.Woodcutter, id: 'woodcutter', name: 'Woodcutter', icon: '🪓' },
    { type: UnitType.Miner, id: 'miner', name: 'Miner', icon: '⛏️' },
    { type: UnitType.Forester, id: 'forester', name: 'Forester', icon: '🌲' },
    { type: UnitType.Farmer, id: 'farmer', name: 'Farmer', icon: '🌾' },
    { type: UnitType.Smith, id: 'smith', name: 'Smith', icon: '🔨' },
    { type: UnitType.Digger, id: 'digger', name: 'Digger', icon: '🕳️' },
    { type: UnitType.SawmillWorker, id: 'sawmillworker', name: 'Sawmill Worker', icon: '🪚' },
    { type: UnitType.Swordsman, id: 'swordsman', name: 'Swordsman', icon: '⚔️' },
    { type: UnitType.Bowman, id: 'bowman', name: 'Bowman', icon: '🏹' },
    { type: UnitType.Priest, id: 'priest', name: 'Priest', icon: '🙏' },
    { type: UnitType.Pioneer, id: 'pioneer', name: 'Pioneer', icon: '🚩' },
    { type: UnitType.Thief, id: 'thief', name: 'Thief', icon: '🥷' },
    { type: UnitType.Geologist, id: 'geologist', name: 'Geologist', icon: '🔍' },
    { type: UnitType.Miller, id: 'miller', name: 'Miller', icon: '🌀' },
    { type: UnitType.Butcher, id: 'butcher', name: 'Butcher', icon: '🥩' },
    { type: UnitType.Stonecutter, id: 'stonecutter', name: 'Stonecutter', icon: '🪨' },
    { type: UnitType.SquadLeader, id: 'squadleader', name: 'Squad Leader', icon: '🎖️' },
    { type: UnitType.DarkGardener, id: 'darkgardener', name: 'Dark Gardener', icon: '🍄' },
    { type: UnitType.Shaman, id: 'shaman', name: 'Shaman', icon: '🪄' },
    { type: UnitType.Medic, id: 'medic', name: 'Medic', icon: '🩺' },
    { type: UnitType.Hunter, id: 'hunter', name: 'Hunter', icon: '🏹' },
    { type: UnitType.Healer, id: 'healer', name: 'Healer', icon: '💊' },
    { type: UnitType.Smelter, id: 'smelter', name: 'Smelter', icon: '🔥' },
    { type: UnitType.Donkey, id: 'donkey', name: 'Donkey', icon: '🫏' },
    { type: UnitType.MushroomFarmer, id: 'mushroomfarmer', name: 'Mushroom Farmer', icon: '🍄' },
    { type: UnitType.Angel, id: 'angel', name: 'Angel', icon: '👼' },
];

// Runtime check in development: ensure all UnitType values are in ALL_UNITS
if (import.meta.env.DEV) {
    const unitTypesInArray = new Set(ALL_UNITS.map(u => u.type));
    const allUnitTypes = Object.values(UnitType).filter((v): v is UnitType => typeof v === 'number');
    const missing = allUnitTypes.filter(t => !unitTypesInArray.has(t));
    if (missing.length > 0) {
        console.error(
            'ALL_UNITS is missing UnitTypes:',
            missing.map(t => UnitType[t])
        );
    }
}

/** Resources available in the UI (derived from droppable materials) */
const availableResources = DROPPABLE_MATERIALS.map(type => {
    const name = EMaterialType[type].charAt(0) + EMaterialType[type].slice(1).toLowerCase().replace('_', ' ');
    return {
        type,
        id: EMaterialType[type].toLowerCase(),
        name,
        icon: '📦', // Placeholder, will be replaced by texture
    };
});

/** Try to restore saved game state, recording timing in mapLoadTimings. */
function tryRestoreGameState(game: Game): void {
    const snapshot = loadSnapshot();
    if (!snapshot) return;
    const t0 = performance.now();
    log.info('Restoring saved game state...');
    restoreFromSnapshot(game, snapshot);
    game.services.inventoryVisualizer.rebuildFromExistingEntities();
    debugStats.state.mapLoadTimings.stateRestore = Math.round(performance.now() - t0);
}

/** Create mode toggle handler */
function createModeToggler(getGame: () => Game | null, getInputManager: () => InputManager | null) {
    return {
        setPlaceMode(buildingType: number, race: number): void {
            const game = getGame();
            const inputManager = getInputManager();
            if (!game || !inputManager) return;

            if (
                game.viewState.state.mode === 'place_building' &&
                game.viewState.state.placeBuildingType === buildingType
            ) {
                inputManager.switchMode('select');
            } else {
                inputManager.switchMode('place_building', {
                    buildingType,
                    player: game.currentPlayer,
                    race,
                });
            }
        },

        setPlaceResourceMode(resourceType: EMaterialType, amount: number): void {
            const game = getGame();
            const inputManager = getInputManager();
            if (!game || !inputManager) return;

            if (
                game.viewState.state.mode === 'place_resource' &&
                game.viewState.state.placeResourceType === resourceType
            ) {
                inputManager.switchMode('select');
            } else {
                inputManager.switchMode('place_resource', { resourceType, amount });
            }
        },

        setPlaceUnitMode(unitType: UnitType): void {
            const game = getGame();
            const inputManager = getInputManager();
            if (!game || !inputManager) return;

            if (game.viewState.state.mode === 'place_unit' && game.viewState.state.placeUnitType === unitType) {
                inputManager.switchMode('select');
            } else {
                inputManager.switchMode('place_unit', { unitType });
            }
        },

        setSelectMode(): void {
            getInputManager()?.switchMode('select');
        },
    };
}

/** Create game action handlers */
function createGameActions(getGame: () => Game | null, game: ShallowRef<Game | null>) {
    return {
        removeSelected(): void {
            const g = getGame();
            if (!g || g.state.selection.selectedEntityId === null) return;
            g.execute({ type: 'remove_entity', entityId: g.state.selection.selectedEntityId });
            triggerRef(game);
        },

        togglePause(): void {
            const g = getGame();
            if (!g) return;
            if (g.isRunning) g.stop();
            else g.start();
        },

        resetGameState(): void {
            const g = getGame();
            if (!g) return;

            // Clear saved state
            clearSavedGameState();

            // Restore to initial map state (trees, buildings, etc. from map load)
            const restored = gameStatePersistence.restoreToInitialState(g);
            if (restored) {
                // Rebuild inventory visualizer state from restored entities
                g.services.inventoryVisualizer.rebuildFromExistingEntities();
                log.info('Game state reset to initial map state');
            } else {
                // Fallback: no initial state, use clean reset (keeps environment)
                log.warn('No initial state available, resetting to clean state');
                g.resetToCleanState({ keepEnvironment: true, rebuildInventory: true });
            }

            // Force UI update
            triggerRef(game);
        },
    };
}

export function useMapView(
    getFileManager: () => FileManager,
    getInputManager?: () => InputManager | null,
    selectedRace?: Ref<Race>
) {
    // Start IDB sprite cache read immediately — overlaps with everything that follows
    // (route resolution, file read, game constructor, landscape init)
    prefetchSpriteCache();

    const route = useRoute();
    // Check if testMap query param is present - use computed for reactivity
    // in case the route isn't fully resolved when the composable first runs
    const isTestMap = computed(() => {
        const param = route.query['testMap'];
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

        // Guard: prevent concurrent loads
        if (mapLoadState.isLoading) {
            const fileDesc = file ? ' for ' + file.name : '';
            log.debug(`Skipping map load${fileDesc} - already loading`);
            return false;
        }

        // Guard: don't reload same file
        if (file && mapLoadState.currentFile === file.name) {
            log.debug(`Skipping map load for ${file.name} - already loaded`);
            return false;
        }

        mapLoadState.isLoading = true;
        debugStats.startMapLoad();
        // Re-trigger prefetch for subsequent loads (first load uses the setup-time prefetch)
        prefetchSpriteCache();

        try {
            // Destroy old game first to prevent multiple game loops
            if (game.value) {
                // Stop auto-saving before destroying
                gameStatePersistence.stop();
                game.value.destroy();
                game.value = null;
            }

            // Reset initial state tracking for new map
            gameStatePersistence.resetForNewMap();

            if (options.isTestMap) {
                // Load synthetic test map
                mapInfo.value = 'Test map (synthetic 256x256)';
                fileName.value = null;
                mapLoadState.currentFile = '__test_map__';

                // Set map ID for persistence BEFORE loading snapshot
                setCurrentMapId('__test_map__');

                game.value = createTestGame(fm);
                wireFeatureToggles(game.value);

                // Save initial state BEFORE checking for saved game state
                saveInitialState(game.value);

                tryRestoreGameState(game.value);

                // Start auto-saving (won't save initial state again since we already did)
                gameStatePersistence.start(game.value);
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
            wireFeatureToggles(result.game);

            // Set map ID for persistence BEFORE loading snapshot
            setCurrentMapId(file.name);

            // Save initial state BEFORE checking for saved game state
            saveInitialState(result.game);

            tryRestoreGameState(result.game);

            // Start auto-saving (won't save initial state again since we already did)
            gameStatePersistence.start(result.game);

            // Load mission script (non-blocking, only if Lua enabled)
            if (isLuaEnabled()) {
                void result.game.loadScript(file.name).then(scriptResult => {
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
        }
        // For real maps, the file-browser component handles selection
        // and emits 'select' which calls onFileSelect → loadMap
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
        get: () => game.value?.settings.state.showDebugGrid ?? false,
        set: (value: boolean) => {
            if (game.value) game.value.settings.state.showDebugGrid = value;
        },
    });

    const VALID_TABS = new Set(['buildings', 'units', 'resources']);
    const savedTab = localStorage.getItem('sidebar_active_tab');
    const activeTab = ref<'buildings' | 'units' | 'resources'>(
        savedTab && VALID_TABS.has(savedTab) ? (savedTab as 'buildings' | 'units' | 'resources') : 'buildings'
    );
    watch(activeTab, tab => localStorage.setItem('sidebar_active_tab', tab));
    const resourceAmount = ref(1);
    const hoveredTile = ref<TileCoord | null>(null);
    const resourceIcons = ref<Record<number, string>>({});
    const buildingIcons = ref<Record<number, IconEntry>>({});

    // Layer visibility state (loaded from localStorage)
    const layerVisibility = reactive<LayerVisibility>(loadLayerVisibility());

    function updateLayerVisibility(newVisibility: LayerVisibility): void {
        Object.assign(layerVisibility, newVisibility);
        saveLayerVisibility(layerVisibility);
    }

    /** Wire the Territory feature toggle to sync with layer visibility's showTerritory */
    function wireFeatureToggles(g: Game): void {
        g.onTerritoryToggle(enabled => {
            layerVisibility.showTerritory = enabled;
            saveLayerVisibility(layerVisibility);
        });
    }

    // =========================================================================
    // Computed State
    // =========================================================================

    const selectedEntity = computed<Entity | undefined>(() =>
        game.value?.state.selection.selectedEntityId != null
            ? game.value.state.getEntity(game.value.state.selection.selectedEntityId)
            : undefined
    );
    const selectionCount = computed(() => game.value?.state.selection.selectedEntityIds.size ?? 0);
    const isPaused = computed(() => (game.value ? !game.value.isRunning : false));
    const currentPlayerRace = computed(
        () => selectedRace?.value ?? game.value?.playerRaces.get(game.value.currentPlayer) ?? Race.Roman
    );
    const availableBuildings = computed(() =>
        ALL_BUILDINGS.filter(b => isBuildingAvailableForRace(b.type, currentPlayerRace.value))
    );
    const availableUnits = computed(() =>
        ALL_UNITS.filter(u => isUnitAvailableForRace(u.type, currentPlayerRace.value))
    );

    // Mode state - sourced from the game's view state
    const currentMode = computed(() => game.value?.viewState.state.mode ?? 'select');
    const placeBuildingType = computed(() => game.value?.viewState.state.placeBuildingType ?? 0);
    const placeResourceType = computed(() => game.value?.viewState.state.placeResourceType ?? 0);
    const placeUnitType = computed(() => game.value?.viewState.state.placeUnitType ?? 0);

    // Entity counts from game view state
    const EMPTY_COUNTS: LayerCounts = {
        buildings: 0,
        units: 0,
        resources: 0,
        environment: 0,
        trees: 0,
        stones: 0,
        plants: 0,
        other: 0,
    };
    const layerCounts = computed<LayerCounts>(() => {
        const vs = game.value?.viewState.state;
        if (!vs) return EMPTY_COUNTS;
        return {
            buildings: vs.buildingCount,
            units: vs.unitCount,
            resources: vs.resourceCount,
            environment: vs.environmentCount,
            trees: vs.treeCount,
            stones: vs.stoneCount,
            plants: vs.plantCount,
            other: vs.otherCount,
        };
    });

    // =========================================================================
    // Lifecycle
    // =========================================================================

    onMounted(() => {
        initializeMap();
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
        if (game.value?.viewState.state.mode === 'place_resource' && game.value.viewState.state.placeResourceType) {
            const inputManager = getInputManager?.();
            if (inputManager) {
                inputManager.switchMode('place_resource', {
                    resourceType: game.value.viewState.state.placeResourceType,
                    amount: resourceAmount.value,
                });
            }
        }
    });

    function onTileClick(tile: TileCoord) {
        hoveredTile.value = tile;
    }

    // Create mode and action handlers
    const modeToggler = createModeToggler(
        () => game.value,
        () => getInputManager?.() ?? null
    );
    const gameActions = createGameActions(() => game.value, game);

    const setPlaceMode = modeToggler.setPlaceMode;
    const setPlaceResourceMode = (rt: EMaterialType) => modeToggler.setPlaceResourceMode(rt, resourceAmount.value);
    const setPlaceUnitMode = (ut: UnitType) => modeToggler.setPlaceUnitMode(ut);
    const setSelectMode = modeToggler.setSelectMode;
    const removeSelected = gameActions.removeSelected;
    const togglePause = gameActions.togglePause;
    const resetGameState = gameActions.resetGameState;

    // Load icons from GFX files when game becomes available
    watch(game, g => {
        if (g) {
            void loadResourceIcons(getFileManager(), availableResources).then(icons => {
                resourceIcons.value = icons;
            });
            void loadBuildingIcons(getFileManager(), currentPlayerRace.value, ALL_BUILDINGS).then(icons => {
                buildingIcons.value = icons;
            });
        }
    });

    // Reload building icons when race changes (different GFX file per race)
    watch(currentPlayerRace, race => {
        if (game.value) {
            void loadBuildingIcons(getFileManager(), race, ALL_BUILDINGS).then(icons => {
                buildingIcons.value = icons;
            });
        }
    });

    return {
        fileName,
        mapInfo,
        game,
        showDebug,
        activeTab,
        resourceAmount,
        resourceIcons,
        buildingIcons,
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
        resetGameState,
        updateLayerVisibility,
    };
}
