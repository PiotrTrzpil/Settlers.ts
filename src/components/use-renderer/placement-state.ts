/**
 * Placement mode state mapping — converts input render state into entity renderer placement preview.
 */

import type { EntityRenderer } from '@/game/renderer/entity-renderer';
import type { BuildingPreview, ResourcePreview, ModeRenderState } from '@/game/input/render-state';

/** Handle placement mode rendering state using consolidated preview */
export function updatePlacementModeState(er: EntityRenderer, renderState: ModeRenderState | null | undefined): void {
    const preview = renderState?.preview;

    // Handle new unified PlacementPreview type
    if (preview?.type === 'placement') {
        // eslint-disable-next-line no-restricted-syntax -- optional value with sensible numeric default
        const amount = (preview.extra?.['amount'] as number | undefined) ?? 1;
        const variation = preview.entityType === 'pile' ? Math.max(0, Math.min(amount - 1, 7)) : undefined;

        er.placementPreview = {
            tile: { x: preview.x, y: preview.y },
            valid: preview.valid,
            entityType: preview.entityType,
            subType: preview.subType,
            race: preview.race,
            variation,
            level: preview.extra?.['level'] as number | undefined,
        };
    } else if (preview?.type === 'building') {
        // Handle legacy BuildingPreview for backward compatibility
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- legacy union type
        const buildingPreview: BuildingPreview = preview;
        er.placementPreview = {
            tile: { x: buildingPreview.x, y: buildingPreview.y },
            valid: buildingPreview.valid,
            entityType: 'building',
            subType: buildingPreview.buildingType,
        };
    } else if (preview?.type === 'pile') {
        // Handle legacy ResourcePreview for backward compatibility
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- legacy union type
        const resourcePreview: ResourcePreview = preview;
        // eslint-disable-next-line no-restricted-syntax -- optional value with sensible numeric default
        const amount = resourcePreview.amount ?? 1;
        er.placementPreview = {
            tile: { x: resourcePreview.x, y: resourcePreview.y },
            valid: resourcePreview.valid,
            entityType: 'pile',
            subType: resourcePreview.materialType,
            variation: Math.max(0, Math.min(amount - 1, 7)),
        };
    } else {
        er.placementPreview = null;
    }
}

/** Clear placement mode state */
export function clearPlacementModeState(er: EntityRenderer): void {
    er.placementPreview = null;
}
