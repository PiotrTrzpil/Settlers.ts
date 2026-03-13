/** Whether the settler is walking to the building or already inside */
export enum SettlerBuildingStatus {
    /** Settler is walking toward the building with intent to enter */
    Approaching = 'approaching',
    /** Settler is confirmed inside the building (entity.hidden = true) */
    Inside = 'inside',
}

/** A settler's building commitment */
export interface SettlerBuildingLocation {
    readonly buildingId: number;
    readonly status: SettlerBuildingStatus;
}

/** Event emitted when a building is destroyed while settlers are approaching it */
export interface ApproachInterruptedEvent {
    readonly settlerId: number;
    readonly buildingId: number;
}

/** What SettlerBuildingLocationManager exposes to other features */
export interface ISettlerBuildingLocationManager {
    /**
     * Register settler as walking toward a building with intent to enter.
     * Settler remains visible. Throws if settler is already tracked.
     */
    markApproaching(settlerId: number, buildingId: number): void;

    /**
     * Cancel an approaching registration (e.g., settler was redirected).
     * No-op if settler is not tracked as approaching.
     */
    cancelApproach(settlerId: number): void;

    /**
     * Confirm settler is now inside the building.
     * Sets entity.hidden = true.
     * If settler was registered as Approaching this building, transitions to Inside.
     * Also accepts direct entry (no prior markApproaching).
     * Throws if settler is already Inside, or if Approaching a different building.
     */
    enterBuilding(settlerId: number, buildingId: number): void;

    /**
     * Mark settler as exiting the building.
     * Sets entity.hidden = false. Throws if settler is not tracked as Inside.
     */
    exitBuilding(settlerId: number): void;

    /** Returns current location (approaching or inside), or null if settler is not tracked */
    getLocation(settlerId: number): SettlerBuildingLocation | null;

    /** Returns true if settler is confirmed inside a building (hidden). If buildingId is given, also checks it matches. */
    isInside(settlerId: number, buildingId?: number): boolean;

    /** Returns true if settler is tracked (approaching or inside) */
    isCommitted(settlerId: number): boolean;

    /** Returns all settler IDs currently inside the given building */
    getOccupants(buildingId: number): readonly number[];

    /** Returns all settler IDs approaching the given building */
    getApproaching(buildingId: number): readonly number[];
}

export interface SettlerLocationExports {
    locationManager: ISettlerBuildingLocationManager;
}
