/**
 * Composable for construction progress data displayed in the selection panel.
 *
 * Returns construction phase, overall progress, and material delivery status
 * for a building currently under construction. Returns null when the building
 * is operational (no active construction site).
 */

import { computed, type Ref } from 'vue';
import type { Entity } from '@/game/entity';
import { EntityType } from '@/game/entity';
import { EMaterialType } from '@/game/economy';
import { BuildingConstructionPhase } from '@/game/features/building-construction';
import type { Game } from '@/game/game';

export interface ConstructionMaterialInfo {
    name: string;
    delivered: number;
    required: number;
}

export interface ConstructionInfo {
    /** Human-readable phase name */
    phase: string;
    /** Overall construction progress, 0.0–1.0 */
    overallProgress: number;
    /** Per-material delivery progress */
    materials: ConstructionMaterialInfo[];
}

const PHASE_LABELS: Record<BuildingConstructionPhase, string> = {
    [BuildingConstructionPhase.WaitingForDiggers]: 'Waiting for diggers',
    [BuildingConstructionPhase.TerrainLeveling]: 'Leveling terrain',
    [BuildingConstructionPhase.Evacuating]: 'Leveling terrain',
    [BuildingConstructionPhase.WaitingForBuilders]: 'Waiting for builders',
    [BuildingConstructionPhase.ConstructionRising]: 'Under construction',
    [BuildingConstructionPhase.CompletedRising]: 'Completing',
    [BuildingConstructionPhase.Completed]: 'Completed',
};

/**
 * Computes overall progress (0.0–1.0) from construction site fields.
 * Phases 0–2: levelingProgress * 0.3
 * Phase 3:    0.3 + constructionProgress * 0.7
 * Phase 4+:   1.0
 */
function computeOverallProgress(
    phase: BuildingConstructionPhase,
    levelingProgress: number,
    constructionProgress: number
): number {
    if (phase <= BuildingConstructionPhase.WaitingForBuilders) {
        return levelingProgress * 0.3;
    }
    if (phase === BuildingConstructionPhase.ConstructionRising) {
        return 0.3 + constructionProgress * 0.7;
    }
    return 1.0;
}

/**
 * Returns reactive construction info for the given selected entity.
 * When the selected building has an active construction site, returns progress data.
 * When the building is operational (no site), returns null.
 *
 * @param game - Ref to the current Game instance (may be null)
 * @param selectedEntity - Ref to the currently selected entity (may be undefined)
 * @param tick - Ref to the game tick counter, used to trigger re-evaluation each frame
 */
export function useConstructionInfo(
    game: Ref<Game | null>,
    selectedEntity: Ref<Entity | undefined>,
    tick: Ref<number>
): { constructionInfo: Ref<ConstructionInfo | null> } {
    const constructionInfo = computed<ConstructionInfo | null>(() => {
        // Touch tick to re-evaluate every frame (construction state changes each tick)
        // eslint-disable-next-line sonarjs/void-use -- intentionally touch reactive tick to trigger re-evaluation
        void tick.value;

        const entity = selectedEntity.value;
        if (!entity || entity.type !== EntityType.Building) {
            return null;
        }
        if (!game.value) {
            return null;
        }

        const csm = game.value.services.constructionSiteManager;
        const site = csm.getSite(entity.id);
        if (!site) {
            return null;
        }

        const overallProgress = computeOverallProgress(site.phase, site.terrain.progress, site.building.progress);

        const materials: ConstructionMaterialInfo[] = site.materials.costs.map(cost => {
            const throughput = game.value!.services.inventoryManager.getThroughput(entity.id, cost.material);
            return {
                name: EMaterialType[cost.material],
                delivered: throughput.totalIn,
                required: cost.count,
            };
        });

        return {
            phase: PHASE_LABELS[site.phase],
            overallProgress,
            materials,
        };
    });

    return { constructionInfo };
}
