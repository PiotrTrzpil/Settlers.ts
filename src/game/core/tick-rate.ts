/** Simulation tick rate (ticks per second). */
export const TICK_RATE = 30;

/** Convert seconds to simulation ticks. */
export function seconds(s: number): number {
    return s * TICK_RATE;
}
