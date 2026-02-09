/**
 * Service Area Manager
 *
 * Manages service areas for all taverns in the game.
 * Each tavern has exactly one service area that defines its operational range.
 */

import { ServiceArea, createServiceArea, DEFAULT_SERVICE_RADIUS } from './service-area';

/**
 * Manages service areas for taverns.
 *
 * Service areas define the circular regions where tavern carriers can operate.
 * Multiple taverns can have overlapping service areas, allowing flexibility
 * in logistics network design.
 */
export class ServiceAreaManager {
    /** Map of tavern entity ID -> ServiceArea */
    private serviceAreas: Map<number, ServiceArea> = new Map();

    /**
     * Create a service area for a tavern.
     *
     * @param tavernId Entity ID of the tavern
     * @param x X coordinate of the tavern (used as center)
     * @param y Y coordinate of the tavern (used as center)
     * @param radius Optional custom radius (defaults to DEFAULT_SERVICE_RADIUS)
     * @returns The created ServiceArea
     */
    createServiceArea(
        tavernId: number,
        x: number,
        y: number,
        radius: number = DEFAULT_SERVICE_RADIUS,
    ): ServiceArea {
        const serviceArea = createServiceArea(tavernId, x, y, radius);
        this.serviceAreas.set(tavernId, serviceArea);
        return serviceArea;
    }

    /**
     * Remove a service area for a tavern.
     *
     * @param tavernId Entity ID of the tavern
     * @returns true if the service area was removed, false if it didn't exist
     */
    removeServiceArea(tavernId: number): boolean {
        return this.serviceAreas.delete(tavernId);
    }

    /**
     * Get the service area for a tavern.
     *
     * @param tavernId Entity ID of the tavern
     * @returns The ServiceArea or undefined if not found
     */
    getServiceArea(tavernId: number): ServiceArea | undefined {
        return this.serviceAreas.get(tavernId);
    }

    /**
     * Set the radius of a tavern's service area.
     *
     * @param tavernId Entity ID of the tavern
     * @param radius New radius in tiles
     * @returns true if successful, false if tavern has no service area
     */
    setRadius(tavernId: number, radius: number): boolean {
        const serviceArea = this.serviceAreas.get(tavernId);
        if (!serviceArea) return false;

        serviceArea.radius = Math.max(1, radius); // Minimum radius of 1
        return true;
    }

    /**
     * Set the center position of a tavern's service area.
     *
     * This allows offsetting the service area from the tavern's position,
     * which can be useful for specialized logistics configurations.
     *
     * @param tavernId Entity ID of the tavern
     * @param x New center X coordinate
     * @param y New center Y coordinate
     * @returns true if successful, false if tavern has no service area
     */
    setCenter(tavernId: number, x: number, y: number): boolean {
        const serviceArea = this.serviceAreas.get(tavernId);
        if (!serviceArea) return false;

        serviceArea.centerX = x;
        serviceArea.centerY = y;
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
     * Get the number of service areas.
     */
    get size(): number {
        return this.serviceAreas.size;
    }

    /**
     * Check if a tavern has a service area.
     */
    hasServiceArea(tavernId: number): boolean {
        return this.serviceAreas.has(tavernId);
    }

    /**
     * Clear all service areas.
     * Useful for testing or game reset.
     */
    clear(): void {
        this.serviceAreas.clear();
    }
}
