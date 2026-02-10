/**
 * Pool of Web Workers for parallel sprite decoding.
 * Distributes decode requests across workers and returns promises.
 * All decoding produces Uint16Array of palette indices for the R16UI atlas.
 */

import type { DecodeRequest, DecodeResponse } from './sprite-decode-worker';

// Vite worker import
import DecodeWorker from './sprite-decode-worker?worker';

/** Result from decodeIndexed */
export interface DecodeResult {
    indices: Uint16Array;
    width: number;
    height: number;
}

interface PendingRequest {
    resolve: (result: DecodeResult) => void;
    reject: (error: Error) => void;
}

export class SpriteDecoderPool {
    private workers: Worker[] = [];
    private pendingRequests = new Map<number, PendingRequest>();
    private nextRequestId = 0;
    private nextWorkerIndex = 0;
    private isDestroyed = false;
    private decodeCount = 0;

    constructor(workerCount: number = navigator.hardwareConcurrency || 8) {
        // Create worker pool
        const actualCount = Math.min(workerCount, 8); // Cap at 8 workers
        console.log(`[SpriteDecoderPool] Creating ${actualCount} workers`);
        for (let i = 0; i < actualCount; i++) {
            const worker = new DecodeWorker();
            worker.onmessage = this.handleMessage.bind(this);
            worker.onerror = this.handleError.bind(this);
            this.workers.push(worker);
        }
    }

    private handleMessage(e: MessageEvent<DecodeResponse>): void {
        const { id, indices, width, height } = e.data;
        const pending = this.pendingRequests.get(id);
        if (pending) {
            this.pendingRequests.delete(id);
            this.decodeCount++;
            pending.resolve({ indices, width, height });
        }
    }

    /** Get the number of sprites decoded by workers */
    public getDecodeCount(): number {
        return this.decodeCount;
    }

    private handleError(e: ErrorEvent): void {
        console.error('Sprite decoder worker error:', e.message, e.filename, e.lineno, e.colno, e);
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
            const worker = this.workers[this.nextWorkerIndex];
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
        if (!result.indices) {
            throw new Error(`Indexed decode failed: no indices for ${width}x${height}`);
        }
        return result.indices;
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
        const warmUpPromises = this.workers.map((worker) => {
            return new Promise<void>((resolve) => {
                const id = this.nextRequestId++;

                const handler = (e: MessageEvent<DecodeResponse>) => {
                    if (e.data.id === id) {
                        worker.removeEventListener('message', handler);
                        resolve();
                    }
                };
                worker.addEventListener('message', handler);

                // Send minimal ping - worker will decode 0 pixels and return immediately
                const request: DecodeRequest = {
                    id,
                    buffer: new ArrayBuffer(0),
                    offset: 0,
                    width: 0,
                    height: 0,
                    imgType: 0,
                    paletteOffset: 0,
                };
                worker.postMessage(request);
            });
        });

        return Promise.all(warmUpPromises).then(() => {
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
        this.workers = [];

        // Reject any pending requests
        for (const pending of this.pendingRequests.values()) {
            pending.reject(new Error('Decoder pool destroyed'));
        }
        this.pendingRequests.clear();
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

/**
 * Warm up the decoder pool to eliminate first-batch startup latency.
 * Call this during file preload, before sprites are loaded.
 */
export async function warmUpDecoderPool(): Promise<void> {
    const pool = getDecoderPool();
    await pool.warmUp();
}
