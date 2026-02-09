/**
 * Interface for systems that update every game tick.
 * Systems register with the GameLoop instead of being called directly.
 */
export interface TickSystem {
    /** Called each fixed-timestep tick */
    tick(dt: number): void;
}
