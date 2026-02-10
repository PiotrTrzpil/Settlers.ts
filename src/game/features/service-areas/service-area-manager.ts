/**
 * Service Area Manager
 *
 * Manages service areas for all logistics hubs (taverns) in the game.
 * Each hub has exactly one service area that defines its operational range.
 */

import {
    ServiceArea,
    createServiceArea,
    clampRadius,
    DEFAULT_SERVICE_RADIUS,
} from './service-area';

/**
 * Events emitted by the ServiceAreaManager.
 * These can be used by other systems (UI, debug visualization) to react to changes.
 */
export interface ServiceAreaEvents {
    /** Emitted when a new service area is created */
    created: { serviceArea: ServiceArea };
    /** Emitted when a service area is removed */
    removed: { buildingId: number };
    /** Emitted when a service area's radius changes */
    radiusChanged: { buildingId: number; oldRadius: number; newRadius: number };
    /** Emitted when a service area's center changes */
    centerChanged: { buildingId: number; oldX: number; oldY: number; newX: number; newY: number };
}

/**
 * Callback type for service area event listeners.
 */
export type ServiceAreaEventListener<K extends keyof ServiceAreaEvents> = (
    data: ServiceAreaEvents[K]
) => void;

/**
 * Manages service areas for logistics hubs.
 *
 * Service areas define the circular regions where hub carriers can operate.
 * Multiple hubs can have overlapping service areas, allowing flexibility
 * in logistics network design.
 */
export class ServiceAreaManager {
    /** Map of building entity ID -> ServiceArea */
    private serviceAreas: Map<number, ServiceArea> = new Map();

    /** Event listeners */
    private listeners: {
        [K in keyof ServiceAreaEvents]?: Set<ServiceAreaEventListener<K>>;
    } = {};

    /**
     * Create a service area for a building.
     *
     * @param buildingId Entity ID of the building (tavern/logistics hub)
     * @param playerId Player who owns this building
     * @param x X coordinate of the building (used as center)
     * @param y Y coordinate of the building (used as center)
     * @param radius Optional custom radius (defaults to DEFAULT_SERVICE_RADIUS)
     * @returns The created ServiceArea
     */
    createServiceArea(
        buildingId: number,
        playerId: number,
        x: number,
        y: number,
        radius: number = DEFAULT_SERVICE_RADIUS,
    ): ServiceArea {
        const serviceArea = createServiceArea(buildingId, playerId, x, y, radius);
        this.serviceAreas.set(buildingId, serviceArea);
        this.emit('created', { serviceArea });
        return serviceArea;
    }

    /**
     * Remove a service area for a building.
     *
     * @param buildingId Entity ID of the building
     * @returns true if the service area was removed, false if it didn't exist
     */
    removeServiceArea(buildingId: number): boolean {
        const existed = this.serviceAreas.delete(buildingId);
        if (existed) {
            this.emit('removed', { buildingId });
        }
        return existed;
    }

    /**
     * Get the service area for a building.
     *
     * @param buildingId Entity ID of the building
     * @returns The ServiceArea or undefined if not found
     */
    getServiceArea(buildingId: number): ServiceArea | undefined {
        return this.serviceAreas.get(buildingId);
    }

    /**
     * Set the radius of a building's service area.
     *
     * @param buildingId Entity ID of the building
     * @param radius New radius in tiles (will be clamped to valid range)
     * @returns true if successful, false if building has no service area
     */
    setRadius(buildingId: number, radius: number): boolean {
        const serviceArea = this.serviceAreas.get(buildingId);
        if (!serviceArea) return false;

        const oldRadius = serviceArea.radius;
        const newRadius = clampRadius(radius);

        if (oldRadius !== newRadius) {
            serviceArea.radius = newRadius;
            this.emit('radiusChanged', { buildingId, oldRadius, newRadius });
        }

        return true;
    }

    /**
     * Set the center position of a building's service area.
     *
     * This allows offsetting the service area from the building's position,
     * which can be useful for specialized logistics configurations.
     *
     * @param buildingId Entity ID of the building
     * @param x New center X coordinate
     * @param y New center Y coordinate
     * @returns true if successful, false if building has no service area
     */
    setCenter(buildingId: number, x: number, y: number): boolean {
        const serviceArea = this.serviceAreas.get(buildingId);
        if (!serviceArea) return false;

        const oldX = serviceArea.centerX;
        const oldY = serviceArea.centerY;

        if (oldX !== x || oldY !== y) {
            serviceArea.centerX = x;
            serviceArea.centerY = y;
            this.emit('centerChanged', { buildingId, oldX, oldY, newX: x, newY: y });
        }

        return true;
    }

    /**
     * Get all service areas.
     *
     * @returns Iterator over all ServiceAreas
     */
    getAllServiceAreas(): IterableIterator<ServiceArea> {
        return this.serviceAreas.values();
    }

    /**
     * Get all service areas as an array.
     * Useful when you need to filter or map over service areas.
     */
    getAllServiceAreasArray(): ServiceArea[] {
        return Array.from(this.serviceAreas.values());
    }

    /**
     * Get all service areas for a specific player.
     */
    getServiceAreasForPlayer(playerId: number): ServiceArea[] {
        return this.getAllServiceAreasArray().filter(area => area.playerId === playerId);
    }

    /**
     * Get the number of service areas.
     */
    get size(): number {
        return this.serviceAreas.size;
    }

    /**
     * Check if a building has a service area.
     */
    hasServiceArea(buildingId: number): boolean {
        return this.serviceAreas.has(buildingId);
    }

    /**
     * Clear all service areas.
     * Useful for testing or game reset.
     */
    clear(): void {
        const buildingIds = Array.from(this.serviceAreas.keys());
        this.serviceAreas.clear();
        for (const buildingId of buildingIds) {
            this.emit('removed', { buildingId });
        }
    }

    /**
     * Restore a service area from serialized data (used by persistence).
     * Does not emit events to avoid duplicate notifications during load.
     */
    restoreServiceArea(data: {
        buildingId: number;
        playerId: number;
        centerX: number;
        centerY: number;
        radius: number;
    }): void {
        const serviceArea = createServiceArea(
            data.buildingId,
            data.playerId,
            data.centerX,
            data.centerY,
            data.radius
        );
        this.serviceAreas.set(data.buildingId, serviceArea);
    }

    // === Event System ===

    /**
     * Subscribe to a service area event.
     */
    on<K extends keyof ServiceAreaEvents>(
        event: K,
        listener: ServiceAreaEventListener<K>,
    ): void {
        if (!this.listeners[event]) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.listeners[event] = new Set() as any;
        }
        (this.listeners[event] as Set<ServiceAreaEventListener<K>>).add(listener);
    }

    /**
     * Unsubscribe from a service area event.
     */
    off<K extends keyof ServiceAreaEvents>(
        event: K,
        listener: ServiceAreaEventListener<K>,
    ): void {
        const listeners = this.listeners[event] as Set<ServiceAreaEventListener<K>> | undefined;
        if (listeners) {
            listeners.delete(listener);
        }
    }

    /**
     * Emit a service area event.
     */
    private emit<K extends keyof ServiceAreaEvents>(
        event: K,
        data: ServiceAreaEvents[K],
    ): void {
        const listeners = this.listeners[event] as Set<ServiceAreaEventListener<K>> | undefined;
        if (listeners) {
            for (const listener of listeners) {
                listener(data);
            }
        }
    }
}
