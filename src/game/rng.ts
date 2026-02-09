/**
 * Seeded Random Number Generator for deterministic game simulation.
 *
 * Uses the Mulberry32 algorithm - fast, simple, and produces good quality
 * random numbers suitable for game logic.
 *
 * CRITICAL: All game logic that needs randomness MUST use this RNG instead
 * of Math.random() to ensure deterministic replay and multiplayer synchronization.
 *
 * Usage:
 * ```typescript
 * const rng = new SeededRng(12345);
 * const value = rng.next();           // 0.0 to 1.0
 * const int = rng.nextInt(6);         // 0 to 5
 * const range = rng.nextRange(10, 20); // 10 to 19
 * const bool = rng.nextBool();        // true or false
 * const item = rng.pick(array);       // random array element
 * rng.shuffle(array);                 // in-place Fisher-Yates shuffle
 * ```
 */

/**
 * Deterministic seeded random number generator using Mulberry32 algorithm.
 */
export class SeededRng {
    private state: number;

    /**
     * Create a new RNG with the given seed.
     * @param seed Initial seed value (will be converted to 32-bit integer)
     */
    constructor(seed: number) {
        // Ensure seed is a 32-bit integer
        this.state = seed >>> 0;
        // Warm up the generator (first few values can be low quality)
        for (let i = 0; i < 10; i++) {
            this.next();
        }
    }

    /**
     * Get the current seed state (for serialization/replay).
     */
    getState(): number {
        return this.state;
    }

    /**
     * Set the RNG state directly (for deserialization/replay).
     */
    setState(state: number): void {
        this.state = state >>> 0;
    }

    /**
     * Generate the next random float in [0, 1).
     */
    next(): number {
        // Mulberry32 algorithm
        let t = (this.state += 0x6D2B79F5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    /**
     * Generate a random integer in [0, max).
     * @param max Exclusive upper bound
     */
    nextInt(max: number): number {
        return Math.floor(this.next() * max);
    }

    /**
     * Generate a random integer in [min, max).
     * @param min Inclusive lower bound
     * @param max Exclusive upper bound
     */
    nextRange(min: number, max: number): number {
        return min + Math.floor(this.next() * (max - min));
    }

    /**
     * Generate a random boolean.
     * @param probability Probability of returning true (default 0.5)
     */
    nextBool(probability: number = 0.5): boolean {
        return this.next() < probability;
    }

    /**
     * Pick a random element from an array.
     * @returns The selected element, or undefined if array is empty
     */
    pick<T>(array: readonly T[]): T | undefined {
        if (array.length === 0) return undefined;
        return array[this.nextInt(array.length)];
    }

    /**
     * Shuffle an array in-place using Fisher-Yates algorithm.
     * @param array The array to shuffle
     * @returns The same array, shuffled
     */
    shuffle<T>(array: T[]): T[] {
        for (let i = array.length - 1; i > 0; i--) {
            const j = this.nextInt(i + 1);
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    /**
     * Create a shuffled copy of an array (does not modify original).
     */
    shuffled<T>(array: readonly T[]): T[] {
        return this.shuffle([...array]);
    }

    /**
     * Fork this RNG to create an independent child RNG.
     * Useful for subsystems that need their own RNG stream.
     */
    fork(): SeededRng {
        // Use current state to seed the child
        return new SeededRng(this.state ^ 0xDEADBEEF);
    }
}

/**
 * Default game seed - can be overridden when starting a game.
 */
export const DEFAULT_GAME_SEED = 12345;

/**
 * Create a new RNG with an optional seed.
 * If no seed is provided, uses the default game seed.
 */
export function createGameRng(seed: number = DEFAULT_GAME_SEED): SeededRng {
    return new SeededRng(seed);
}
