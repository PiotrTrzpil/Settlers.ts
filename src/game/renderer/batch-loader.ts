/**
 * Batched async operations with event loop yielding.
 * Keeps UI responsive during heavy async workloads.
 */

const yieldToEventLoop = (): Promise<void> =>
    new Promise(resolve => requestAnimationFrame(() => resolve()));

const DEFAULT_BATCH_SIZE = 5;

/** Threshold for logging slow batches (ms) */
const SLOW_BATCH_THRESHOLD_MS = 16; // One frame at 60fps

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
        const batchStart = performance.now();
        const batchEnd = Math.min(i + batchSize, items.length);
        const batchCount = batchEnd - i;

        // Create promises for this batch without slicing
        const promises: Promise<R>[] = new Array(batchCount);
        for (let j = 0; j < batchCount; j++) {
            promises[j] = processor(items[i + j]);
        }

        const batchResults = await Promise.all(promises);

        // Copy results without spread operator
        for (let j = 0; j < batchResults.length; j++) {
            results[resultIdx++] = batchResults[j];
        }

        const batchTime = performance.now() - batchStart;
        if (batchTime > SLOW_BATCH_THRESHOLD_MS) {
            console.info(`[Batch] batch ${Math.floor(i / batchSize) + 1} (${batchCount} items) took ${batchTime.toFixed(1)}ms`);
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
        async(item) => {
            const result = await processor(item);
            handler(result, item);
        },
        batchSize
    );
}
