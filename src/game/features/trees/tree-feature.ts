/**
 * Tree Feature - Self-registering feature module for tree lifecycle.
 *
 * This feature manages:
 * - Tree growth (planted saplings -> full trees)
 * - Tree cutting (by woodcutters)
 * - Stump decay and removal
 *
 * The feature wraps TreeSystem and handles event subscriptions.
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import { TreeSystem, TreeStage } from './tree-system';
import { EntityType } from '../../entity';
import { MapObjectType } from '@/game/types/map-object-types';
import type { PlantTreeCommand, PlantTreesAreaCommand } from '../../commands/command-types';
import { executePlantTree, executePlantTreesArea } from '../../commands/handlers/system-handlers';

/**
 * Exports provided by TreeFeature.
 */
export interface TreeFeatureExports {
    /** The tree system instance for querying/manipulating tree state */
    treeSystem: TreeSystem;
}

/**
 * Tree feature definition.
 * No dependencies - uses only core services from context.
 */
export const TreeFeature: FeatureDefinition = {
    id: 'trees',
    dependencies: [],

    create(ctx: FeatureContext) {
        const treeSystem = new TreeSystem({
            gameState: ctx.gameState,
            visualService: ctx.visualService,
            eventBus: ctx.eventBus,
            executeCommand: ctx.executeCommand,
        });

        // Register for map object creation events to auto-register trees
        ctx.on('entity:created', ({ entityId, type, subType }) => {
            if (type === EntityType.MapObject) {
                treeSystem.register(entityId, subType as MapObjectType);
            }
        });

        // Clean up tree state when entities are removed
        ctx.cleanupRegistry.onEntityRemoved(treeSystem.unregister.bind(treeSystem));

        const treeDeps = { state: ctx.gameState, eventBus: ctx.eventBus, treeSystem };

        return {
            systems: [treeSystem],
            exports: { treeSystem } satisfies TreeFeatureExports,
            persistence: [treeSystem],
            commands: {
                plant_tree: cmd => executePlantTree(treeDeps, cmd as PlantTreeCommand),
                plant_trees_area: cmd => executePlantTreesArea({ treeSystem }, cmd as PlantTreesAreaCommand),
            },
            diagnostics: () => {
                const counts = countTreeStages(treeSystem);
                return {
                    label: 'Trees',
                    sections: [
                        {
                            label: 'Status',
                            entries: [
                                { key: 'Total', value: counts.total },
                                { key: 'Growing', value: counts.growing },
                                { key: 'Normal', value: counts.normal },
                                { key: 'Cutting', value: counts.cutting },
                                { key: 'Cut', value: counts.cut },
                            ],
                        },
                    ],
                };
            },
        };
    },
};

function countTreeStages(system: TreeSystem) {
    let total = 0,
        growing = 0,
        normal = 0,
        cutting = 0,
        cut = 0;
    for (const [, state] of system.getAllTreeStates()) {
        total++;
        switch (state.stage) {
        case TreeStage.Growing:
            growing++;
            break;
        case TreeStage.Normal:
            normal++;
            break;
        case TreeStage.Cutting:
            cutting++;
            break;
        case TreeStage.Cut:
            cut++;
            break;
        }
    }
    return { total, growing, normal, cutting, cut };
}
