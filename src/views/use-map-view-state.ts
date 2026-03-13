import { ref, computed, watch, reactive, type Ref, type ShallowRef } from 'vue';
import { Entity, TileCoord } from '@/game/entity';
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

const EMPTY_COUNTS: LayerCounts = {
    buildings: 0,
    units: 0,
    piles: 0,
    environment: 0,
    trees: 0,
    stones: 0,
    plants: 0,
    other: 0,
};

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
    const hoveredTile = ref<TileCoord | null>(null);
    const resourceIcons = ref<Record<number, string>>({});
    const buildingIcons = ref<Record<number, IconEntry>>({});
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

/** Computed properties derived from game state. */
export function setupComputedState(game: ShallowRef<Game | null>, selectedRace?: Ref<Race>) {
    const showDebug = computed({
        get: () => game.value?.settings.state.showDebugGrid ?? false,
        set: (value: boolean) => {
            if (game.value) {
                game.value.settings.state.showDebugGrid = value;
            }
        },
    });

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
    const placeResourceType = computed(() => game.value?.viewState.state.placePileType ?? 0);
    const placeUnitType = computed(() => game.value?.viewState.state.placeUnitType ?? 0);

    const layerCounts = computed<LayerCounts>(() => {
        const vs = game.value?.viewState.state;
        if (!vs) {
            return EMPTY_COUNTS;
        }
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
        showDebug,
        selectedEntity,
        selectionCount,
        isPaused,
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
