/**
 * Pool of Web Workers for parallel sprite decoding.
 * Distributes decode requests across workers and returns promises.
 * All decoding produces Uint16Array of palette indices for the R16UI atlas.
 */

import type { DecodeRequest, DecodeResponse } from './sprite-decode-worker';
import type {
    BatchDecodeRequest,
    BatchDecodeResponse,
    BatchSpriteDescriptor,
    BatchSpriteResult,
} from './sprite-batch-decode-worker';

// Vite worker imports
import DecodeWorker from './sprite-decode-worker?worker';
import BatchDecodeWorker from './sprite-batch-decode-worker?worker';

/** Result from decodeIndexed */
export interface DecodeResult {
    indices: Uint16Array;
    width: number;
    height: number;
}

/** Result from batch decode — per-sprite metadata + shared index buffer */
export interface BatchDecodeResult {
    results: BatchSpriteResult[];
    allIndices: Uint16Array;
}

interface PendingRequest {
    resolve: (result: DecodeResult) => void;
    reject: (error: Error) => void;
}

interface PendingBatchRequest {
    resolve: (result: BatchDecodeResult) => void;
    reject: (error: Error) => void;
}

export class SpriteDecoderPool {
    private workers: Worker[] = [];
    private batchWorkers: Worker[] = [];
    private pendingRequests = new Map<number, PendingRequest>();
    private pendingBatchRequests = new Map<number, PendingBatchRequest>();
    private nextRequestId = 0;
    private nextWorkerIndex = 0;
    private nextBatchWorkerIndex = 0;
    private isDestroyed = false;
    private decodeCount = 0;
    private workerCount: number;

    constructor(workerCount: number = navigator.hardwareConcurrency || 8) {
        this.workerCount = Math.min(workerCount, 8); // Cap at 8 workers
        console.log(
            `[SpriteDecoderPool] Creating ${this.workerCount} decode workers (batch workers created on demand)`
        );
        for (let i = 0; i < this.workerCount; i++) {
            const worker = new DecodeWorker();
            worker.onmessage = this.handleMessage.bind(this);
            worker.onerror = this.handleError.bind(this);
            this.workers.push(worker);
        }
    }

    /** Lazily create batch workers on first use. */
    private ensureBatchWorkers(): void {
        if (this.batchWorkers.length > 0) {
            return;
        }
        for (let i = 0; i < this.workerCount; i++) {
            const batchWorker = new BatchDecodeWorker();
            batchWorker.onmessage = this.handleBatchMessage.bind(this);
            batchWorker.onerror = this.handleError.bind(this);
            this.batchWorkers.push(batchWorker);
        }
    }

    private handleMessage(e: MessageEvent<DecodeResponse>): void {
        const { id, indices, width, height, error } = e.data;
        const pending = this.pendingRequests.get(id);
        if (pending) {
            this.pendingRequests.delete(id);
            if (error) {
                pending.reject(new Error(`Sprite decode worker error: ${error}`));
            } else {
                this.decodeCount++;
                pending.resolve({ indices, width, height });
            }
        }
    }

    private handleBatchMessage(e: MessageEvent<BatchDecodeResponse>): void {
        const pending = this.pendingBatchRequests.get(e.data.id);
        if (pending) {
            this.pendingBatchRequests.delete(e.data.id);
            if (e.data.error) {
                pending.reject(new Error(`Batch decode worker error: ${e.data.error}`));
            } else {
                this.decodeCount += e.data.results.length;
                pending.resolve({ results: e.data.results, allIndices: e.data.allIndices });
            }
        }
    }

    /** Get the number of sprites decoded by workers */
    public getDecodeCount(): number {
        return this.decodeCount;
    }

    private handleError(e: ErrorEvent): void {
        console.error('Sprite decoder worker error:', e.message, e.filename, e.lineno, e.colno, e);

        // Catastrophic worker error (OOM, script load failure, etc.) —
        // reject all pending requests since we can't map the error to a specific request
        const error = new Error(`Worker crashed: ${e.message}`);
        for (const pending of this.pendingRequests.values()) {
            pending.reject(error);
        }
        this.pendingRequests.clear();
        for (const pending of this.pendingBatchRequests.values()) {
            pending.reject(error);
        }
        this.pendingBatchRequests.clear();
    }

    /**
     * Send a decode request to a worker (shared logic for both modes).
     */
    private sendRequest(request: DecodeRequest, buffer: ArrayBuffer): Promise<DecodeResult> {
        if (this.isDestroyed) {
            return Promise.reject(new Error('Decoder pool is destroyed'));
        }

        return new Promise((resolve, reject) => {
            const id = this.nextRequestId++;
            this.pendingRequests.set(id, { resolve, reject });

            // Round-robin worker selection
            const worker = this.workers[this.nextWorkerIndex]!;
            this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;

            // Only slice the portion of the buffer the worker needs
            const maxBytes = Math.max(8192, request.width * request.height * 2);
            const endOffset = Math.min(request.offset + maxBytes, buffer.byteLength);
            const bufferSlice = buffer.slice(request.offset, endOffset);

            const adjustedRequest: DecodeRequest = { ...request, id, buffer: bufferSlice, offset: 0 };
            worker.postMessage(adjustedRequest, [bufferSlice]);
        });
    }

    /**
     * Decode a sprite to palette indices (indexed mode).
     * Returns a Uint16Array where each element is a combined palette index.
     * Special values: 0 = transparent, 1 = shadow.
     *
     * @param paletteBaseOffset Base offset for this file's palette in the combined palette texture
     */
    public async decodeIndexed(
        buffer: ArrayBuffer,
        offset: number,
        width: number,
        height: number,
        imgType: number,
        paletteOffset: number,
        paletteBaseOffset: number,
        trimTop: number = 0,
        trimBottom: number = 0
    ): Promise<Uint16Array> {
        const request: DecodeRequest = {
            id: 0, // Will be set by sendRequest
            buffer,
            offset,
            width,
            height,
            imgType,
            paletteOffset,
            trimTop,
            trimBottom,
            paletteBaseOffset,
        };

        const result = await this.sendRequest(request, buffer);
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive check on worker response payload
        if (!result.indices) {
            throw new Error(`Indexed decode failed: no indices for ${width}x${height}`);
        }
        return result.indices;
    }

    /**
     * Batch decode: send the entire GFX file buffer + a manifest of sprite descriptors
     * to a worker. The worker parses headers and decodes all sprites in one pass.
     *
     * For large manifests, splits across multiple batch workers via round-robin.
     */
    public decodeBatch(gfxBuffer: ArrayBuffer, manifest: BatchSpriteDescriptor[]): Promise<BatchDecodeResult> {
        if (this.isDestroyed) {
            return Promise.reject(new Error('Decoder pool is destroyed'));
        }

        if (manifest.length === 0) {
            return Promise.resolve({ results: [], allIndices: new Uint16Array(0) });
        }

        this.ensureBatchWorkers();

        // For small manifests or single worker, send everything to one worker
        const workerCount = this.batchWorkers.length;
        if (manifest.length <= 64 || workerCount <= 1) {
            return this.sendBatchRequest(gfxBuffer, manifest);
        }

        // Split manifest across workers for parallelism
        const chunkSize = Math.ceil(manifest.length / workerCount);
        const chunks: BatchSpriteDescriptor[][] = [];
        for (let i = 0; i < manifest.length; i += chunkSize) {
            chunks.push(manifest.slice(i, i + chunkSize));
        }

        const promises = chunks.map(chunk => this.sendBatchRequest(gfxBuffer, chunk));

        return Promise.all(promises).then(chunkResults => {
            // Merge results from all chunks
            let totalLength = 0;
            for (const cr of chunkResults) {
                totalLength += cr.allIndices.length;
            }

            const mergedIndices = new Uint16Array(totalLength);
            const mergedResults: BatchSpriteResult[] = [];
            let offset = 0;

            for (const cr of chunkResults) {
                mergedIndices.set(cr.allIndices, offset);
                for (const r of cr.results) {
                    mergedResults.push({
                        ...r,
                        indicesOffset: r.indicesOffset + offset,
                    });
                }
                offset += cr.allIndices.length;
            }

            return { results: mergedResults, allIndices: mergedIndices };
        });
    }

    private sendBatchRequest(gfxBuffer: ArrayBuffer, manifest: BatchSpriteDescriptor[]): Promise<BatchDecodeResult> {
        return new Promise((resolve, reject) => {
            const id = this.nextRequestId++;
            this.pendingBatchRequests.set(id, { resolve, reject });

            const worker = this.batchWorkers[this.nextBatchWorkerIndex]!;
            this.nextBatchWorkerIndex = (this.nextBatchWorkerIndex + 1) % this.batchWorkers.length;

            // Send a copy of the buffer so the worker can use it without affecting others
            const bufferCopy = gfxBuffer.slice(0);
            const request: BatchDecodeRequest = { id, gfxBuffer: bufferCopy, manifest };
            worker.postMessage(request, [bufferCopy]);
        });
    }

    /**
     * Check if the pool has any workers available.
     */
    public get isAvailable(): boolean {
        return this.workers.length > 0 && !this.isDestroyed;
    }

    /**
     * Warm up all workers by sending a ping message.
     * Workers will load their scripts and be ready for actual decode requests.
     * Returns a promise that resolves when all workers have responded.
     */
    public warmUp(): Promise<void> {
        if (this.isDestroyed || this.workers.length === 0) {
            return Promise.resolve();
        }

        const start = performance.now();

        const pingWorker = (worker: Worker, message: unknown): Promise<void> => {
            return new Promise<void>(resolve => {
                const id = this.nextRequestId++;
                const handler = (e: MessageEvent<{ id: number }>) => {
                    if (e.data.id === id) {
                        worker.removeEventListener('message', handler);
                        resolve();
                    }
                };
                worker.addEventListener('message', handler);
                worker.postMessage({ ...(message as object), id });
            });
        };

        const decodeWarmups = this.workers.map(worker =>
            pingWorker(worker, {
                buffer: new ArrayBuffer(0),
                offset: 0,
                width: 0,
                height: 0,
                imgType: 0,
                paletteOffset: 0,
            })
        );

        // Only warm batch workers if they've already been created (don't force lazy init)
        const batchWarmups = this.batchWorkers.map(worker =>
            pingWorker(worker, { gfxBuffer: new ArrayBuffer(0), manifest: [] })
        );

        return Promise.all([...decodeWarmups, ...batchWarmups]).then(() => {
            const elapsed = performance.now() - start;
            console.log(`[SpriteDecoderPool] Workers warmed up in ${elapsed.toFixed(1)}ms`);
        });
    }

    /**
     * Destroy all workers and clean up.
     */
    public destroy(): void {
        this.isDestroyed = true;
        for (const worker of this.workers) {
            worker.terminate();
        }
        for (const worker of this.batchWorkers) {
            worker.terminate();
        }
        this.workers = [];
        this.batchWorkers = [];

        // Reject any pending requests
        for (const pending of this.pendingRequests.values()) {
            pending.reject(new Error('Decoder pool destroyed'));
        }
        this.pendingRequests.clear();
        for (const pending of this.pendingBatchRequests.values()) {
            pending.reject(new Error('Decoder pool destroyed'));
        }
        this.pendingBatchRequests.clear();
    }
}

// Global singleton pool - shared across HMR reloads
let globalPool: SpriteDecoderPool | null = null;

export function getDecoderPool(): SpriteDecoderPool {
    if (!globalPool || !globalPool.isAvailable) {
        globalPool = new SpriteDecoderPool();
    }
    return globalPool;
}

export function destroyDecoderPool(): void {
    if (globalPool) {
        globalPool.destroy();
        globalPool = null;
    }
}

// Terminate workers on HMR to prevent OOM from accumulated Web Workers
if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        destroyDecoderPool();
    });
}

/**
 * Warm up the decoder pool to eliminate first-batch startup latency.
 * Call this during file preload, before sprites are loaded.
 */
export async function warmUpDecoderPool(): Promise<void> {
    const pool = getDecoderPool();
    await pool.warmUp();
}
