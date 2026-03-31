/**
 * SelectionManager — owns player entity selection state and selection policy.
 *
 * Extracted from GameState to separate selection concerns from the entity store.
 * Commands mutate selection through the methods here; renderers and UI read
 * the public fields.
 */

import { EntityType, UnitCategory, UnitType, getUnitCategory, type Entity, type EntityProvider } from '../entity';

export class SelectionManager {
    /** Primary selection (first selected entity or single selection) */
    public selectedEntityId: number | null = null;
    /** All selected entity IDs (for multi-select) */
    public selectedEntityIds: Set<number> = new Set();

    /** Returns the active player index for selection filtering. */
    private readonly currentPlayerFn: () => number;

    constructor(
        private entityProvider: EntityProvider,
        currentPlayerFn: () => number
    ) {
        this.currentPlayerFn = currentPlayerFn;
    }

    // ─────────────────────────────────────────────────────────────
    // Selection policy
    // ─────────────────────────────────────────────────────────────

    /**
     * Check if an entity can be selected.
     * @param debugSelectAll When true, all units are selectable (debug mode)
     */
    canSelect(entity: Entity | undefined, debugSelectAll = false): boolean {
        if (!entity) {
            return false;
        }
        if (entity.hidden) {
            return false;
        }
        if (entity.player !== this.currentPlayerFn()) {
            return false;
        }
        if (entity.selectable !== false) {
            return true;
        }
        return debugSelectAll && entity.type === EntityType.Unit;
    }

    // ─────────────────────────────────────────────────────────────
    // Selection queries
    // ─────────────────────────────────────────────────────────────

    /** Get all selected entities of a given type. */
    getSelectedByType(type: EntityType): Entity[] {
        const result: Entity[] = [];
        for (const id of this.selectedEntityIds) {
            const entity = this.entityProvider.getEntity(id);
            if (entity && entity.type === type) {
                result.push(entity);
            }
        }
        return result;
    }

    // ─────────────────────────────────────────────────────────────
    // Selection mutations
    // ─────────────────────────────────────────────────────────────

    /** Replace the entire selection with a single entity (or clear). */
    select(entityId: number | null): void {
        this.selectedEntityIds.clear();
        this.selectedEntityId = entityId;
        if (entityId !== null) {
            this.selectedEntityIds.add(entityId);
        }
    }

    /** Clear all selection state. */
    clear(): void {
        this.selectedEntityId = null;
        this.selectedEntityIds.clear();
    }

    /** Toggle an entity in/out of the selection set. */
    toggle(entityId: number): void {
        if (this.selectedEntityIds.has(entityId)) {
            this.selectedEntityIds.delete(entityId);
            if (this.selectedEntityId === entityId) {
                this.selectedEntityId =
                    this.selectedEntityIds.size > 0 ? this.selectedEntityIds.values().next().value! : null;
            }
        } else {
            this.selectedEntityIds.add(entityId);
            if (this.selectedEntityId === null) {
                this.selectedEntityId = entityId;
            }
        }
    }

    /** Replace selection with multiple entities at once. */
    selectMultiple(entityIds: number[]): void {
        this.selectedEntityIds.clear();
        for (const id of entityIds) {
            this.selectedEntityIds.add(id);
        }
        this.selectedEntityId = entityIds.length > 0 ? entityIds[0]! : null;
    }

    /**
     * Select entities from a spatial area, applying selectability filtering.
     * Tiered selection priority (RTS convention):
     *   1. Military soldiers (if any)
     *   2. Specialists and Religious units (if no soldiers)
     *   3. Any other selectable units (if no specialists/religious)
     *   4. All selectables including buildings (if no units at all)
     * @param entities All entities in the area (pre-filtered by caller's spatial query)
     * @param debugSelectAll When true, all units are selectable (debug mode)
     */
    selectArea(entities: Entity[], debugSelectAll = false): number[] {
        const selectable = entities.filter(e => this.canSelect(e, debugSelectAll));
        const units = selectable.filter(e => e.type === EntityType.Unit);

        if (units.length > 0) {
            const soldiers = units.filter(e => getUnitCategory(e.subType as UnitType) === UnitCategory.Military);
            if (soldiers.length > 0) {
                const ids = soldiers.map(e => e.id);
                this.selectMultiple(ids);
                return ids;
            }
            const specialists = units.filter(e => {
                const cat = getUnitCategory(e.subType as UnitType);
                return cat === UnitCategory.Specialist || cat === UnitCategory.Religious;
            });
            if (specialists.length > 0) {
                const ids = specialists.map(e => e.id);
                this.selectMultiple(ids);
                return ids;
            }
        }

        const toSelect = units.length > 0 ? units : selectable;
        const ids = toSelect.map(e => e.id);
        this.selectMultiple(ids);
        return ids;
    }

    /** Remove a single entity from the selection (used during entity removal). */
    deselect(entityId: number): void {
        this.selectedEntityIds.delete(entityId);
        if (this.selectedEntityId === entityId) {
            this.selectedEntityId =
                this.selectedEntityIds.size > 0 ? this.selectedEntityIds.values().next().value! : null;
        }
    }

    /**
     * Remove all selected entities that fail a predicate.
     * Used e.g. when debug "select all units" is turned off to prune non-selectable units.
     */
    deselectWhere(predicate: (entity: Entity) => boolean): void {
        const toRemove: number[] = [];
        for (const id of this.selectedEntityIds) {
            const entity = this.entityProvider.getEntity(id);
            if (entity && predicate(entity)) {
                toRemove.push(id);
            }
        }
        for (const id of toRemove) {
            this.deselect(id);
        }
    }
}
