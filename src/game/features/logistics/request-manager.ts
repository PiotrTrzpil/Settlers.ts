/**
 * Request Manager
 *
 * Manages the queue of resource requests from buildings.
 * Tracks pending, in-progress, and fulfilled requests.
 */

import { EMaterialType } from '../../economy/material-type';
import {
    ResourceRequest,
    RequestPriority,
    RequestStatus,
    createResourceRequest,
    compareRequests,
    canAssignRequest,
    isRequestActive,
} from './resource-request';

/**
 * Reasons why a request was reset to pending.
 */
export type RequestResetReason =
    | 'carrier_removed'
    | 'source_unavailable'
    | 'timeout'
    | 'pickup_failed'
    | 'building_destroyed'
    | 'assignment_failed'
    | 'cancelled';

/**
 * Events emitted by the RequestManager.
 */
export interface RequestManagerEvents {
    /** Emitted when a new request is added */
    requestAdded: { request: ResourceRequest };
    /** Emitted when a request is removed/cancelled */
    requestRemoved: { requestId: number };
    /** Emitted when a request is assigned to a carrier */
    requestAssigned: { request: ResourceRequest; carrierId: number; sourceBuilding: number };
    /** Emitted when a request is fulfilled */
    requestFulfilled: { request: ResourceRequest };
    /** Emitted when a request is reset to pending (e.g., carrier dropped it, timeout) */
    requestReset: { request: ResourceRequest; reason: RequestResetReason };
}

/**
 * Callback type for request event listeners.
 */
export type RequestEventListener<K extends keyof RequestManagerEvents> = (data: RequestManagerEvents[K]) => void;

/**
 * Manages resource requests from buildings.
 *
 * Provides methods to add, remove, query, and fulfill requests.
 * Maintains requests sorted by priority and timestamp.
 */
export class RequestManager {
    /** All requests indexed by ID */
    private requests: Map<number, ResourceRequest> = new Map();

    /** Next request ID */
    private nextId = 1;

    /** Cached sorted pending requests list */
    private pendingCache: ResourceRequest[] = [];

    /** Whether the pending cache needs to be rebuilt.
     * Set to true by invalidatePendingCache() when requests are mutated. */
    private pendingCacheDirty = true;

    /** Event listeners */
    private listeners: {
        [K in keyof RequestManagerEvents]?: Set<RequestEventListener<K>>;
    } = {};

    /**
     * Add a new resource request.
     *
     * @param buildingId Entity ID of the requesting building
     * @param materialType Type of material requested
     * @param amount Amount of material requested
     * @param priority Priority level (defaults to Normal)
     * @returns The created request
     */
    addRequest(
        buildingId: number,
        materialType: EMaterialType,
        amount: number,
        priority: RequestPriority = RequestPriority.Normal
    ): ResourceRequest {
        const request = createResourceRequest(this.nextId++, buildingId, materialType, amount, priority);

        this.requests.set(request.id, request);
        this.invalidatePendingCache();
        this.emit('requestAdded', { request });

        return request;
    }

    /**
     * Remove a request by ID.
     *
     * @param requestId ID of the request to remove
     * @returns True if the request was removed
     */
    removeRequest(requestId: number): boolean {
        const request = this.requests.get(requestId);
        if (!request) return false;

        // Mark as cancelled if still active
        if (isRequestActive(request)) {
            request.status = RequestStatus.Cancelled;
        }

        this.requests.delete(requestId);
        this.invalidatePendingCache();
        this.emit('requestRemoved', { requestId });

        return true;
    }

    /**
     * Get a request by ID.
     *
     * @param requestId ID of the request
     * @returns The request or undefined
     */
    getRequest(requestId: number): ResourceRequest | undefined {
        return this.requests.get(requestId);
    }

    /**
     * Get all requests for a specific building.
     *
     * @param buildingId Entity ID of the building
     * @param activeOnly If true, only return active requests (default: true)
     * @returns Array of requests for this building
     */
    getRequestsForBuilding(buildingId: number, activeOnly: boolean = true): ResourceRequest[] {
        const result: ResourceRequest[] = [];

        for (const request of this.requests.values()) {
            if (request.buildingId !== buildingId) continue;
            if (activeOnly && !isRequestActive(request)) continue;
            result.push(request);
        }

        return result;
    }

    /**
     * Get all pending requests sorted by priority and timestamp.
     * Results are cached and only rebuilt when requests change.
     *
     * @returns Array of pending requests, sorted by priority then timestamp
     */
    getPendingRequests(): ResourceRequest[] {
        if (this.pendingCacheDirty) {
            this.pendingCache.length = 0;

            for (const request of this.requests.values()) {
                if (canAssignRequest(request)) {
                    this.pendingCache.push(request);
                }
            }

            this.pendingCache.sort(compareRequests);
            this.pendingCacheDirty = false;
        }

        return this.pendingCache;
    }

    /**
     * Mark a request as being fulfilled by a carrier.
     *
     * @param requestId ID of the request
     * @param sourceBuilding Entity ID of the building providing the material
     * @param carrierId Entity ID of the carrier fulfilling the request
     * @returns True if the request was assigned
     */
    assignRequest(requestId: number, sourceBuilding: number, carrierId: number): boolean {
        const request = this.requests.get(requestId);
        if (!request || !canAssignRequest(request)) return false;

        request.status = RequestStatus.InProgress;
        request.assignedCarrier = carrierId;
        request.sourceBuilding = sourceBuilding;
        request.assignedAt = Date.now();
        this.invalidatePendingCache();

        this.emit('requestAssigned', { request, carrierId, sourceBuilding });

        return true;
    }

    /**
     * Mark a request as fulfilled.
     * Removes the request from the active queue.
     *
     * @param requestId ID of the request
     * @returns True if the request was fulfilled
     */
    fulfillRequest(requestId: number): boolean {
        const request = this.requests.get(requestId);
        if (!request) return false;
        if (request.status !== RequestStatus.InProgress) return false;

        request.status = RequestStatus.Fulfilled;
        this.invalidatePendingCache();
        this.emit('requestFulfilled', { request });

        // Remove fulfilled requests to prevent memory buildup
        this.requests.delete(requestId);

        return true;
    }

    /**
     * Cancel all requests for a building.
     * Useful when a building is destroyed.
     *
     * @param buildingId Entity ID of the building
     * @returns Number of requests cancelled
     */
    cancelRequestsForBuilding(buildingId: number): number {
        const toRemove: number[] = [];

        for (const request of this.requests.values()) {
            if (request.buildingId === buildingId) {
                toRemove.push(request.id);
            }
        }

        // Sort for deterministic event emission order
        toRemove.sort((a, b) => a - b);

        for (const id of toRemove) {
            this.removeRequest(id);
        }

        return toRemove.length;
    }

    /**
     * Reset all requests assigned to a carrier back to pending.
     * Useful when a carrier is removed or reassigned.
     *
     * @param carrierId Entity ID of the carrier
     * @returns Number of requests reset
     */
    resetRequestsForCarrier(carrierId: number): number {
        let count = 0;

        for (const requestId of this.sortedRequestIds()) {
            const request = this.requests.get(requestId);
            if (!request)
                throw new Error(
                    `RequestManager: request ${requestId} missing from internal map (resetRequestsForCarrier)`
                );
            if (request.assignedCarrier === carrierId && request.status === RequestStatus.InProgress) {
                this.resetToPending(request, 'carrier_removed');
                count++;
            }
        }

        if (count > 0) this.invalidatePendingCache();
        return count;
    }

    /**
     * Reset all requests that were sourcing from a specific building.
     * Useful when a source building is destroyed or its inventory depleted.
     *
     * @param buildingId Entity ID of the source building
     * @returns Number of requests reset
     */
    resetRequestsFromSource(buildingId: number): number {
        let count = 0;

        for (const requestId of this.sortedRequestIds()) {
            const request = this.requests.get(requestId);
            if (!request)
                throw new Error(
                    `RequestManager: request ${requestId} missing from internal map (resetRequestsFromSource)`
                );
            if (request.sourceBuilding === buildingId && request.status === RequestStatus.InProgress) {
                this.resetToPending(request, 'source_unavailable');
                count++;
            }
        }

        if (count > 0) this.invalidatePendingCache();
        return count;
    }

    /**
     * Reset a single request back to pending.
     *
     * @param requestId ID of the request to reset
     * @param reason Reason for the reset
     * @returns True if the request was reset
     */
    resetRequest(requestId: number, reason: RequestResetReason): boolean {
        const request = this.requests.get(requestId);
        if (!request || request.status !== RequestStatus.InProgress) {
            return false;
        }

        this.resetToPending(request, reason);
        this.invalidatePendingCache();
        return true;
    }

    /**
     * Get all in-progress requests that have been assigned longer than the given duration.
     *
     * @param maxAgeMs Maximum age in milliseconds before a request is considered stalled
     * @returns Array of requests that have exceeded the timeout
     */
    getStalledRequests(maxAgeMs: number): ResourceRequest[] {
        const now = Date.now();
        const stalled: ResourceRequest[] = [];

        for (const request of this.requests.values()) {
            if (request.status === RequestStatus.InProgress && request.assignedAt !== null) {
                const age = now - request.assignedAt;
                if (age > maxAgeMs) {
                    stalled.push(request);
                }
            }
        }

        return stalled;
    }

    /**
     * Get count of pending requests.
     */
    getPendingCount(): number {
        let count = 0;
        for (const request of this.requests.values()) {
            if (canAssignRequest(request)) count++;
        }
        return count;
    }

    /**
     * Check if a building has any pending requests for a specific material.
     *
     * @param buildingId Entity ID of the building
     * @param materialType Type of material
     * @returns True if there's a pending request for this material
     */
    hasPendingRequest(buildingId: number, materialType: EMaterialType): boolean {
        for (const request of this.requests.values()) {
            if (
                request.buildingId === buildingId &&
                request.materialType === materialType &&
                canAssignRequest(request)
            ) {
                return true;
            }
        }
        return false;
    }

    /**
     * Update the priority of a pending request.
     * Cannot change priority of in-progress requests.
     *
     * @param requestId ID of the request
     * @param priority New priority level
     * @returns True if priority was updated
     */
    updatePriority(requestId: number, priority: RequestPriority): boolean {
        const request = this.requests.get(requestId);
        if (!request) return false;

        // Only allow priority updates for pending requests
        if (request.status !== RequestStatus.Pending) return false;

        request.priority = priority;
        this.invalidatePendingCache();
        return true;
    }

    /**
     * Clear all requests.
     * Useful for testing or game reset.
     */
    clear(): void {
        const ids = Array.from(this.requests.keys());
        this.requests.clear();
        this.invalidatePendingCache();
        this.nextId = 1;
        for (const id of ids) {
            this.emit('requestRemoved', { requestId: id });
        }
    }

    /**
     * Get all requests.
     */
    getAllRequests(): IterableIterator<ResourceRequest> {
        return this.requests.values();
    }

    /**
     * Restore a request from serialized data (used by persistence).
     * Does not emit events to avoid duplicate notifications during load.
     */
    restoreRequest(data: {
        id: number;
        buildingId: number;
        materialType: EMaterialType;
        amount: number;
        priority: RequestPriority;
        timestamp: number;
        status: RequestStatus;
        assignedCarrier: number | null;
        sourceBuilding: number | null;
        assignedAt: number | null;
    }): void {
        this.requests.set(data.id, { ...data });
        this.invalidatePendingCache();

        if (data.id >= this.nextId) {
            this.nextId = data.id + 1;
        }
    }

    /** Reset an in-progress request back to pending and emit the reset event. */
    private resetToPending(request: ResourceRequest, reason: RequestResetReason): void {
        request.status = RequestStatus.Pending;
        request.assignedCarrier = null;
        request.sourceBuilding = null;
        request.assignedAt = null;
        this.emit('requestReset', { request, reason });
    }

    /** Return request IDs sorted numerically for deterministic iteration. */
    private sortedRequestIds(): number[] {
        return [...this.requests.keys()].sort((a, b) => a - b);
    }

    private invalidatePendingCache(): void {
        this.pendingCacheDirty = true;
    }

    // === Event System ===

    /**
     * Subscribe to a request event.
     */
    on<K extends keyof RequestManagerEvents>(event: K, listener: RequestEventListener<K>): void {
        if (!this.listeners[event]) {
            this.listeners[event] = new Set<RequestEventListener<K>>() as any; // TS limitation with mapped type writes
        }
        this.listeners[event]!.add(listener);
    }

    /**
     * Unsubscribe from a request event.
     */
    off<K extends keyof RequestManagerEvents>(event: K, listener: RequestEventListener<K>): void {
        const listeners = this.listeners[event];
        if (listeners) {
            listeners.delete(listener);
        }
    }

    /**
     * Emit a request event.
     */
    private emit<K extends keyof RequestManagerEvents>(event: K, data: RequestManagerEvents[K]): void {
        const listeners = this.listeners[event];
        if (listeners) {
            for (const listener of listeners) {
                listener(data);
            }
        }
    }
}
