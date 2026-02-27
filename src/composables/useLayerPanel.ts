/**
 * Composable for the layer panel UI logic.
 *
 * Manages layer visibility state, river texture configuration,
 * environment sub-layer toggling, and object type filtering.
 */

import { reactive, computed, type Ref } from 'vue';
import type { LayerVisibility } from '@/game/renderer/layer-visibility';
import { loadLayerVisibility, saveLayerVisibility } from '@/game/renderer/layer-visibility';
import { RIVER_SLOT_PERMS } from '@/game/renderer/landscape/textures/landscape-texture-map';
import { debugStats } from '@/game/debug-stats';

/**
 * Returns reactive layer visibility state, river config state, and all actions
 * needed by the layer panel.
 *
 * @param onEmit - Callback invoked whenever visibility changes and should be emitted to the parent
 */
export function useLayerPanel(onEmit: (value: LayerVisibility) => void): {
    visibility: LayerVisibility;
    stats: typeof debugStats.state;
    slotPermLabel: Ref<string>;
    configIndex: Ref<number>;
    otherEnabled: Ref<boolean>;
    visibleCount: Ref<number>;
    totalCount: number;
    isEnvironmentPartial: Ref<boolean>;
    envBadgeColor: Ref<'neutral' | 'warn' | 'success'>;
    environmentStatusText: Ref<string>;
    objectFilterLabel: Ref<string>;
    applyRiverConfig: () => void;
    cycleSlotPerm: (dir: number) => void;
    onEnvironmentMasterChange: (value: boolean) => void;
    showAll: () => void;
    hideAll: () => void;
    toggleObjectFilter: (e: Event) => void;
    changeObjectFilter: (delta: number) => void;
    onFilterInput: (e: Event) => void;
    saveAndEmit: () => void;
} {
    const visibility = reactive<LayerVisibility>(loadLayerVisibility());
    const stats = debugStats.state;

    const totalCount = 4; // Buildings, Units, Resources, Environment

    const slotPermLabel = computed(() => {
        const perm = RIVER_SLOT_PERMS[stats.riverSlotPermutation % RIVER_SLOT_PERMS.length]!;
        return perm.join('-');
    });

    const configIndex = computed(() => {
        return (
            stats.riverSlotPermutation * 8 +
            (stats.riverFlipInner ? 4 : 0) +
            (stats.riverFlipOuter ? 2 : 0) +
            (stats.riverFlipMiddle ? 1 : 0) +
            1
        );
    });

    function applyRiverConfig(): void {
        const lr = window.__settlers__?.landscape;
        if (lr) {
            lr.rebuildRiverTextures({
                slotPermutation: stats.riverSlotPermutation,
                flipInner: stats.riverFlipInner,
                flipOuter: stats.riverFlipOuter,
                flipMiddle: stats.riverFlipMiddle,
            });
        }
    }

    function cycleSlotPerm(dir: number): void {
        const len = RIVER_SLOT_PERMS.length;
        stats.riverSlotPermutation = (((stats.riverSlotPermutation + dir) % len) + len) % len;
        applyRiverConfig();
    }

    const otherEnabled = computed(() => visibility.environment && visibility.environmentLayers.other);

    const visibleCount = computed(() => {
        let count = 0;
        if (visibility.buildings) count++;
        if (visibility.units) count++;
        if (visibility.resources) count++;
        if (visibility.environment) count++;
        return count;
    });

    const isEnvironmentPartial = computed(() => {
        if (!visibility.environment) return false;
        const layers = visibility.environmentLayers;
        const allTrue = layers.trees && layers.stones && layers.plants && layers.other;
        const allFalse = !layers.trees && !layers.stones && !layers.plants && !layers.other;
        return !allTrue && !allFalse;
    });

    const envBadgeColor = computed((): 'neutral' | 'warn' | 'success' => {
        if (!visibility.environment) return 'neutral';
        if (isEnvironmentPartial.value) return 'warn';
        return 'success';
    });

    const environmentStatusText = computed(() => {
        if (!visibility.environment) return 'off';
        const layers = visibility.environmentLayers;
        const count = [layers.trees, layers.stones, layers.plants, layers.other].filter(Boolean).length;
        if (count === 4) return 'all';
        if (count === 0) return 'none';
        return `${count}/4`;
    });

    function onEnvironmentMasterChange(value: boolean): void {
        if (value) {
            visibility.environmentLayers.trees = true;
            visibility.environmentLayers.stones = true;
            visibility.environmentLayers.plants = true;
            visibility.environmentLayers.other = true;
        }
        saveAndEmit();
    }

    function showAll(): void {
        visibility.buildings = true;
        visibility.units = true;
        visibility.resources = true;
        visibility.environment = true;
        visibility.environmentLayers.trees = true;
        visibility.environmentLayers.stones = true;
        visibility.environmentLayers.plants = true;
        visibility.environmentLayers.other = true;
        saveAndEmit();
    }

    function hideAll(): void {
        visibility.buildings = false;
        visibility.units = false;
        visibility.resources = false;
        visibility.environment = false;
        saveAndEmit();
    }

    const objectFilterLabel = computed(() => {
        const t = visibility.debugObjectTypeFilter;
        if (t === null) return '';
        if (t >= 1 && t <= 18) return `Tree type ${t}`;
        return `Raw type ${t}`;
    });

    function toggleObjectFilter(e: Event): void {
        const checked = (e.target as HTMLInputElement).checked;
        visibility.debugObjectTypeFilter = checked ? 1 : null;
        saveAndEmit();
    }

    function changeObjectFilter(delta: number): void {
        const current = visibility.debugObjectTypeFilter ?? 1;
        visibility.debugObjectTypeFilter = Math.max(1, Math.min(255, current + delta));
        saveAndEmit();
    }

    function onFilterInput(e: Event): void {
        const val = parseInt((e.target as HTMLInputElement).value, 10);
        if (!isNaN(val) && val >= 1 && val <= 255) {
            visibility.debugObjectTypeFilter = val;
            saveAndEmit();
        }
    }

    function saveAndEmit(): void {
        saveLayerVisibility(visibility);
        onEmit({ ...visibility, environmentLayers: { ...visibility.environmentLayers } });
    }

    return {
        visibility,
        stats,
        slotPermLabel,
        configIndex,
        otherEnabled,
        visibleCount,
        totalCount,
        isEnvironmentPartial,
        envBadgeColor,
        environmentStatusText,
        objectFilterLabel,
        applyRiverConfig,
        cycleSlotPerm,
        onEnvironmentMasterChange,
        showAll,
        hideAll,
        toggleObjectFilter,
        changeObjectFilter,
        onFilterInput,
        saveAndEmit,
    };
}
