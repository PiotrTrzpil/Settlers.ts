import { ref, computed, watch, reactive, type Ref } from 'vue';
import { BuildingType, Entity, Tile } from '@/game/entity';
import { isUnitAvailableForRace, isBuildingAvailableForRace } from '@/game/data/race-availability';
import { Race } from '@/game/core/race';
import type { Game } from '@/game/game';
import { LayerVisibility, loadLayerVisibility, saveLayerVisibility } from '@/game/renderer/layer-visibility';
import type { IconEntry } from './sprite-icon-loader';
import { ALL_BUILDINGS, ALL_UNITS } from './palette-data';

/** Entity counts per layer for display in the layer panel */
export interface LayerCounts {
    buildings: number;
    units: number;
    piles: number;
    environment: number;
    trees: number;
    stones: number;
    plants: number;
    other: number;
}

/** Reactive UI state for the map view sidebar and overlays. */
export function setupUIState() {
    const VALID_TABS = new Set(['buildings', 'units', 'resources', 'specialists']);
    const savedTab = localStorage.getItem('sidebar_active_tab');
    const activeTab = ref<'buildings' | 'units' | 'resources' | 'specialists'>(
        savedTab && VALID_TABS.has(savedTab)
            ? (savedTab as 'buildings' | 'units' | 'resources' | 'specialists')
            : 'buildings'
    );
    watch(activeTab, tab => localStorage.setItem('sidebar_active_tab', tab));

    const resourceAmount = ref(1);
    const hoveredTile = ref<Tile | null>(null);
    const resourceIcons = ref<Record<string, string>>({});
    const buildingIcons = ref<Partial<Record<BuildingType, IconEntry>>>({});
    const unitIcons = ref<Record<string, IconEntry>>({});
    const specialistIcons = ref<Record<string, IconEntry>>({});

    // Layer visibility state (loaded from localStorage)
    const layerVisibility = reactive<LayerVisibility>(loadLayerVisibility());

    function updateLayerVisibility(newVisibility: LayerVisibility): void {
        Object.assign(layerVisibility, newVisibility);
        saveLayerVisibility(layerVisibility);
    }

    return {
        activeTab,
        resourceAmount,
        hoveredTile,
        resourceIcons,
        buildingIcons,
        unitIcons,
        specialistIcons,
        layerVisibility,
        updateLayerVisibility,
    };
}

/**
 * Computed properties derived from game state.
 * Game is guaranteed non-null — this runs inside a component that only renders when game exists.
 */
export function setupComputedState(game: Game, selectedRace?: Ref<Race>) {
    // selectedEntityId and selectedCount live on viewState.state (a Vue reactive object),
    // so these computeds re-evaluate automatically when selection changes each tick.
    const selectedEntity = computed<Entity | undefined>(() => {
        const entityId = game.viewState.state.selectedEntityId;
        if (entityId == null) {
            return undefined;
        }
        return game.state.getEntity(entityId);
    });
    const selectionCount = computed(() => game.viewState.state.selectedCount);
    const currentPlayerRace = computed(
        () => selectedRace?.value ?? game.playerRaces.get(game.currentPlayer) ?? Race.Roman
    );
    const availableBuildings = computed(() =>
        ALL_BUILDINGS.filter(b => isBuildingAvailableForRace(b.type, currentPlayerRace.value))
    );
    const availableUnits = computed(() =>
        ALL_UNITS.filter(u => isUnitAvailableForRace(u.type, currentPlayerRace.value))
    );

    // Mode state — sourced from the game's reactive view state
    const currentMode = computed(() => game.viewState.state.mode);
    const placeBuildingType = computed(() => game.viewState.state.placeBuildingType);
    const placeResourceType = computed(() => game.viewState.state.placePileType);
    const placeUnitType = computed(() => game.viewState.state.placeUnitType);

    const layerCounts = computed<LayerCounts>(() => {
        const vs = game.viewState.state;
        return {
            buildings: vs.buildingCount,
            units: vs.unitCount,
            piles: vs.pileCount,
            environment: vs.environmentCount,
            trees: vs.treeCount,
            stones: vs.stoneCount,
            plants: vs.plantCount,
            other: vs.otherCount,
        };
    });

    return {
        selectedEntity,
        selectionCount,
        currentPlayerRace,
        availableBuildings,
        availableUnits,
        currentMode,
        placeBuildingType,
        placeResourceType,
        placeUnitType,
        layerCounts,
    };
}
