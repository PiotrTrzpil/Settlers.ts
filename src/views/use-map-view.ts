import { ref, shallowRef, triggerRef, computed, watch, onMounted, reactive } from 'vue';
import { useRoute } from 'vue-router';
import { MapLoader } from '@/resources/map/map-loader';
import { Game } from '@/game/game';
import { createTestMapLoader } from '@/game/test-map-factory';
import { Entity, EntityType, TileCoord, UnitType, BuildingType, MapObjectType } from '@/game/entity';
import { FileManager, IFileSource } from '@/utilities/file-manager';
import { LogHandler } from '@/utilities/log-handler';
import {
    LayerVisibility,
    loadLayerVisibility,
    saveLayerVisibility,
    isResourceDeposit,
    getEnvironmentSubLayer,
    EnvironmentSubLayer,
} from '@/game/renderer/layer-visibility';
import { debugStats } from '@/game/debug-stats';
import type { InputManager } from '@/game/input';

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
    { type: BuildingType.Winegrower, id: 'winegrower', name: 'Winegrower', icon: '🍇' },
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
    { type: UnitType.Builder, id: 'builder', name: 'Builder', icon: '👷' },
    { type: UnitType.Swordsman, id: 'swordsman', name: 'Swordsman', icon: '⚔️' },
    { type: UnitType.Bowman, id: 'bowman', name: 'Bowman', icon: '🏹' },
    { type: UnitType.Pikeman, id: 'pikeman', name: 'Pikeman', icon: '🔱' },
    { type: UnitType.Priest, id: 'priest', name: 'Priest', icon: '🙏' },
    { type: UnitType.Pioneer, id: 'pioneer', name: 'Pioneer', icon: '🚩' },
    { type: UnitType.Thief, id: 'thief', name: 'Thief', icon: '🥷' },
    { type: UnitType.Geologist, id: 'geologist', name: 'Geologist', icon: '🔍' },
];

export function useMapView(
    getFileManager: () => FileManager,
    getInputManager?: () => InputManager | null
) {
    const route = useRoute();
    const isTestMap = route.query.testMap === 'true';

    const fileName = ref<string | null>(null);
    const mapInfo = ref('');
    const game = shallowRef<Game | null>(null);

    // Use debug stats for persisted settings
    const showDebug = computed({
        get: () => debugStats.state.debugGridEnabled,
        set: (value: boolean) => { debugStats.state.debugGridEnabled = value }
    });
    const showTerritoryBorders = computed({
        get: () => debugStats.state.territoryBordersEnabled,
        set: (value: boolean) => { debugStats.state.territoryBordersEnabled = value }
    });

    const activeTab = ref<'buildings' | 'units'>('buildings');
    const hoveredTile = ref<TileCoord | null>(null);

    // Layer visibility state (loaded from localStorage)
    const layerVisibility = reactive<LayerVisibility>(loadLayerVisibility());

    function updateLayerVisibility(newVisibility: LayerVisibility): void {
        Object.assign(layerVisibility, newVisibility);
        saveLayerVisibility(layerVisibility);
    }

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

    // Mode state - use debugStats as the single source of truth (reactive and instant)
    const currentMode = computed(() => debugStats.state.mode);
    const placeBuildingType = computed(() => debugStats.state.placeBuildingType);

    /** Compute entity counts per layer */
    const layerCounts = computed<LayerCounts>(() => {
        const counts: LayerCounts = {
            buildings: 0,
            units: 0,
            resources: 0,
            environment: 0,
            trees: 0,
            stones: 0,
            plants: 0,
            other: 0,
        };

        if (!game.value) return counts;

        for (const entity of game.value.state.entities) {
            switch (entity.type) {
            case EntityType.Building:
                counts.buildings++;
                break;
            case EntityType.Unit:
                counts.units++;
                break;
            case EntityType.MapObject: {
                const objType = entity.subType as MapObjectType;
                if (isResourceDeposit(objType)) {
                    counts.resources++;
                } else {
                    counts.environment++;
                    const subLayer = getEnvironmentSubLayer(objType);
                    switch (subLayer) {
                    case EnvironmentSubLayer.Trees:
                        counts.trees++;
                        break;
                    case EnvironmentSubLayer.Stones:
                        counts.stones++;
                        break;
                    case EnvironmentSubLayer.Plants:
                        counts.plants++;
                        break;
                    case EnvironmentSubLayer.Other:
                        counts.other++;
                        break;
                    }
                }
                break;
            }
            }
        }

        return counts;
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
        const inputManager = getInputManager?.();
        if (!inputManager) return;

        // Toggle behavior: if already placing this building type, exit to select mode
        // Use debugStats as the single source of truth for mode state
        if (debugStats.state.mode === 'place_building' && debugStats.state.placeBuildingType === buildingType) {
            inputManager.switchMode('select');
        } else {
            inputManager.switchMode('place_building', {
                buildingType,
                player: game.value.currentPlayer,
            });
        }
    }

    function setSelectMode() {
        if (!game.value) return;
        const inputManager = getInputManager?.();
        if (inputManager) {
            inputManager.switchMode('select');
        }
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

        // Spawn at camera center
        const inputManager = getInputManager?.();
        const centerTile = inputManager?.getCenterTile();
        if (centerTile) {
            spawnX = centerTile.x;
            spawnY = centerTile.y;
        }

        // Fallback to any land tile if center unavailable
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
        currentMode,
        placeBuildingType,
        availableBuildings,
        availableUnits,
        layerVisibility,
        layerCounts,
        onFileSelect,
        onTileClick,
        setPlaceMode,
        setSelectMode,
        removeSelected,
        togglePause,
        spawnUnit,
        updateLayerVisibility
    };
}
