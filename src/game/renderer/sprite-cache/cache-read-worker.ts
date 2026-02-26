/**
 * Web Worker for reading sprite atlas cache entirely off the main thread.
 *
 * Pipeline: Cache API read → decompress (lz4/gzip/none) → transfer to main thread.
 * The entire operation runs in the worker — zero main-thread I/O or CPU work.
 * Result is transferred via postMessage with transferable ArrayBuffer (zero-copy).
 *
 * Compression formats are auto-detected via the tag byte:
 *   0x00 = uncompressed, 0x01 = lz4, 0x02 = gzip
 */

// LZ4 WASM import — eagerly started at worker creation to overlap with I/O
const lz4Promise: Promise<typeof import('lz4-wasm')> = import('lz4-wasm');
const WORKER_T0 = performance.now();

/** Compression tag byte prepended to cached blob */
const enum CompTag {
    None = 0x00,
    Lz4 = 0x01,
    Gzip = 0x02,
}

export interface CacheReadRequest {
    type: 'read';
    id: number;
    cacheName: string;
    cacheUrl: string;
}

export interface CacheReadResponse {
    id: number;
    /** null = cache miss */
    buffer: ArrayBuffer | null;
    compressed: boolean;
    compressionType: 'none' | 'lz4' | 'gzip';
    rawSize: number;
    /** Granular timing breakdown (all in ms) */
    timings: {
        /** Time from worker creation to first message received */
        workerStartup: number;
        /** Time to open Cache handle (0 if reused) */
        cacheOpen: number;
        /** Time for cache.match() */
        cacheMatch: number;
        /** Time for resp.arrayBuffer() — reading bytes from disk */
        cacheRead: number;
        /** Time to load WASM module (0 if already loaded) */
        wasmInit: number;
        /** Time for pure lz4.decompress() / gzip decompress */
        decompress: number;
        /** Total worker time from message received to response ready */
        total: number;
    };
    error?: string;
}

/** Cache handle — opened once, reused */
let cacheHandle: Cache | null = null;
let cacheHandleName: string | null = null;

async function handleRead(req: CacheReadRequest): Promise<CacheReadResponse> {
    const tStart = performance.now();
    const workerStartup = Math.round(tStart - WORKER_T0);

    const miss: CacheReadResponse = {
        id: req.id,
        buffer: null,
        compressed: false,
        compressionType: 'none',
        rawSize: 0,
        timings: { workerStartup, cacheOpen: 0, cacheMatch: 0, cacheRead: 0, wasmInit: 0, decompress: 0, total: 0 },
    };

    try {
        // Cache open
        let cacheOpenMs = 0;
        if (!cacheHandle || cacheHandleName !== req.cacheName) {
            const t = performance.now();
            cacheHandle = await caches.open(req.cacheName);
            cacheHandleName = req.cacheName;
            cacheOpenMs = Math.round(performance.now() - t);
        }

        // cache.match
        const tMatch = performance.now();
        const resp = await cacheHandle.match(req.cacheUrl);
        const cacheMatchMs = Math.round(performance.now() - tMatch);

        if (!resp) {
            miss.timings.cacheOpen = cacheOpenMs;
            miss.timings.cacheMatch = cacheMatchMs;
            miss.timings.total = Math.round(performance.now() - tStart);
            return miss;
        }

        // resp.arrayBuffer — the big disk read
        const tRead = performance.now();
        const raw = await resp.arrayBuffer();
        const cacheReadMs = Math.round(performance.now() - tRead);
        const rawSize = raw.byteLength;

        if (rawSize === 0) {
            miss.timings.cacheOpen = cacheOpenMs;
            miss.timings.cacheMatch = cacheMatchMs;
            miss.timings.cacheRead = cacheReadMs;
            miss.timings.total = Math.round(performance.now() - tStart);
            return miss;
        }

        // Read tag byte
        const tag = new Uint8Array(raw, 0, 1)[0];
        const payload = raw.slice(1);

        let buffer: ArrayBuffer;
        let compressionType: 'none' | 'lz4' | 'gzip';
        let wasmInitMs = 0;
        let decompressMs = 0;

        if (tag === CompTag.Lz4) {
            // WASM init (may already be resolved if started eagerly)
            const tWasm = performance.now();
            const lz4 = await lz4Promise;
            wasmInitMs = Math.round(performance.now() - tWasm);

            // Pure decompress
            const tDecomp = performance.now();
            const decompressed = lz4.decompress(new Uint8Array(payload));
            decompressMs = Math.round(performance.now() - tDecomp);
            buffer = decompressed.buffer as ArrayBuffer;
            compressionType = 'lz4';
        } else if (tag === CompTag.Gzip) {
            const tDecomp = performance.now();
            const ds = new DecompressionStream('gzip');
            const writer = ds.writable.getWriter();
            void writer.write(payload);
            void writer.close();
            buffer = await new Response(ds.readable).arrayBuffer();
            decompressMs = Math.round(performance.now() - tDecomp);
            compressionType = 'gzip';
        } else {
            buffer = payload;
            compressionType = 'none';
        }

        return {
            id: req.id,
            buffer,
            compressed: compressionType !== 'none',
            compressionType,
            rawSize,
            timings: {
                workerStartup,
                cacheOpen: cacheOpenMs,
                cacheMatch: cacheMatchMs,
                cacheRead: cacheReadMs,
                wasmInit: wasmInitMs,
                decompress: decompressMs,
                total: Math.round(performance.now() - tStart),
            },
        };
    } catch (e) {
        miss.timings.total = Math.round(performance.now() - tStart);
        miss.error = String(e);
        return miss;
    }
}

// Worker message handler
self.onmessage = (e: MessageEvent<CacheReadRequest>) => {
    void handleRead(e.data).then(resp => {
        // Transfer the buffer (zero-copy) if present
        const transferable = resp.buffer ? [resp.buffer] : [];
        (self as unknown as Worker).postMessage(resp, transferable);
    });
};
