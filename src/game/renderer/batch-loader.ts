/**
 * Batched async operations with event loop yielding.
 * Keeps UI responsive during heavy async workloads.
 */

export const yieldToEventLoop = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => resolve()));

// =============================================================================
// Safe GPU-upload batch helper
// =============================================================================
//
// To prevent black boxes during progressive rendering, sprites must only be
// registered (made visible) AFTER GPU upload. The pattern is:
//
//   1. Load sprites (blits to CPU buffer, collects results)
//   2. GPU upload (atlas.update)
//   3. Register sprites (now safe to render)
//
// The SafeLoadBatch helper enforces this pattern.

import type { EntityTextureAtlas } from './entity-texture-atlas';

/**
 * Helper for safe progressive sprite loading.
 * Collects loaded sprites, then uploads to GPU, then registers.
 * This prevents black boxes from rendering before GPU has pixel data.
 */
export class SafeLoadBatch<T> {
    private items: T[] = [];

    /** Add a loaded item to the batch */
    add(item: T): void {
        this.items.push(item);
    }

    /** Add multiple loaded items */
    addAll(items: T[]): void {
        this.items.push(...items);
    }

    /**
     * Finalize the batch: upload to GPU, then register all items.
     * @param atlas - The texture atlas to upload
     * @param gl - WebGL context for GPU upload
     * @param register - Function to register each item (called after GPU upload)
     */
    finalize(atlas: EntityTextureAtlas, gl: WebGL2RenderingContext, register: (item: T) => void): void {
        if (this.items.length === 0) {
            return;
        }

        // GPU upload first
        atlas.update(gl);

        // Now safe to register
        for (const item of this.items) {
            register(item);
        }

        this.items = [];
    }

    get count(): number {
        return this.items.length;
    }
}

const DEFAULT_BATCH_SIZE = 5;

/**
 * Process items in parallel batches, yielding between batches.
 * Uses index-based iteration to avoid creating slice arrays.
 */
export async function processBatched<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    batchSize = DEFAULT_BATCH_SIZE
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let resultIdx = 0;

    for (let i = 0; i < items.length; i += batchSize) {
        const batchEnd = Math.min(i + batchSize, items.length);
        const batchCount = batchEnd - i;

        // Create promises for this batch without slicing
        const promises: Promise<R>[] = new Array(batchCount);
        for (let j = 0; j < batchCount; j++) {
            promises[j] = processor(items[i + j]!);
        }

        const batchResults = await Promise.all(promises);

        // Copy results without spread operator
        for (let j = 0; j < batchResults.length; j++) {
            results[resultIdx++] = batchResults[j]!;
        }

        if (batchEnd < items.length) {
            await yieldToEventLoop();
        }
    }

    return results;
}

/**
 * Process items in parallel batches, collecting non-null results.
 */
export async function processBatchedFiltered<T, R>(
    items: T[],
    processor: (item: T) => Promise<R | null>,
    batchSize = DEFAULT_BATCH_SIZE
): Promise<R[]> {
    const results = await processBatched(items, processor, batchSize);
    return results.filter((r): r is R => r !== null);
}

/**
 * Process items in parallel batches, calling handler for each result.
 */
export async function processBatchedWithHandler<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    handler: (result: R, item: T) => void,
    batchSize = DEFAULT_BATCH_SIZE
): Promise<void> {
    await processBatched(
        items,
        async item => {
            const result = await processor(item);
            handler(result, item);
        },
        batchSize
    );
}
