import { EntityType, type Entity } from '../entity';
import type { GameState } from '../game-state';
import type { ConstructionSiteManager } from './building-construction/construction-site-manager';

/**
 * Iterate all completed (non-construction-site) buildings.
 * Used by features that need to re-initialize building state on restore.
 */
export function forEachCompletedBuilding(
    gameState: GameState,
    constructionSiteManager: ConstructionSiteManager,
    callback: (entity: Entity) => void
): void {
    for (const e of gameState.entities) {
        if (e.type !== EntityType.Building) {
            continue;
        }
        if (constructionSiteManager.hasSite(e.id)) {
            continue;
        }
        callback(e);
    }
}
