/**
 * Resource Request System
 *
 * Defines types and helpers for buildings to request materials from the logistics system.
 * Requests are prioritized and timestamped to ensure fair ordering.
 */

import { EMaterialType } from '../../economy/material-type';

/**
 * Priority levels for resource requests.
 * Lower numeric value = higher priority.
 */
export enum RequestPriority {
    /** Urgent requests (e.g., military, critical production) */
    High = 0,
    /** Standard production requests */
    Normal = 1,
    /** Low priority requests (e.g., stockpiling) */
    Low = 2,
}

/**
 * Status of a resource request.
 */
export enum RequestStatus {
    /** Request is waiting for a carrier to be assigned */
    Pending = 0,
    /** A carrier has been assigned and is picking up the material */
    InProgress = 1,
    /** Request has been fulfilled */
    Fulfilled = 2,
    /** Request was cancelled */
    Cancelled = 3,
}

/**
 * A request for materials to be delivered to a building.
 */
export interface ResourceRequest {
    /** Unique identifier for this request */
    readonly id: number;
    /** Entity ID of the building requesting the material */
    readonly buildingId: number;
    /** Type of material requested */
    readonly materialType: EMaterialType;
    /** Amount of material requested */
    amount: number;
    /** Priority level of the request */
    priority: RequestPriority;
    /** Timestamp when the request was created (for ordering) */
    readonly timestamp: number;
    /** Current status of the request */
    status: RequestStatus;
    /** Entity ID of the carrier fulfilling this request (if any) */
    assignedCarrier: number | null;
    /** Entity ID of the source building (if matched) */
    sourceBuilding: number | null;
    /** Timestamp when the request was assigned to a carrier (for timeout detection) */
    assignedAt: number | null;
}

/**
 * Create a new resource request.
 *
 * @param id Unique identifier for this request
 * @param buildingId Entity ID of the requesting building
 * @param materialType Type of material requested
 * @param amount Amount of material requested
 * @param priority Priority level (defaults to Normal)
 * @returns A new ResourceRequest
 */
export function createResourceRequest(
    id: number,
    buildingId: number,
    materialType: EMaterialType,
    amount: number,
    priority: RequestPriority = RequestPriority.Normal,
): ResourceRequest {
    return {
        id,
        buildingId,
        materialType,
        amount: Math.max(1, Math.floor(amount)),
        priority,
        timestamp: Date.now(),
        status: RequestStatus.Pending,
        assignedCarrier: null,
        sourceBuilding: null,
        assignedAt: null,
    };
}

/**
 * Compare two requests for sorting.
 * Orders by: priority (ascending), then timestamp (ascending).
 *
 * @returns Negative if a should come before b, positive if b should come before a
 */
export function compareRequests(a: ResourceRequest, b: ResourceRequest): number {
    // First compare by priority (lower = higher priority)
    if (a.priority !== b.priority) {
        return a.priority - b.priority;
    }
    // Then by timestamp (older requests first)
    return a.timestamp - b.timestamp;
}

/**
 * Check if a request can be assigned to a carrier.
 */
export function canAssignRequest(request: ResourceRequest): boolean {
    return request.status === RequestStatus.Pending;
}

/**
 * Check if a request is still active (pending or in progress).
 */
export function isRequestActive(request: ResourceRequest): boolean {
    return request.status === RequestStatus.Pending || request.status === RequestStatus.InProgress;
}
