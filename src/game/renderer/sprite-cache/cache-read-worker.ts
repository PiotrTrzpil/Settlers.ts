/**
 * Web Worker for streaming sprite atlas cache reads off the main thread.
 *
 * Protocol:
 *   Main → Worker: CacheStreamRequest (start reading)
 *   Worker → Main: { type: 'meta', metaJson, paletteBuffer }
 *   Main → Worker: { type: 'set-priority', layerOrder: number[] }
 *   Worker → Main: { type: 'layer', index, buffer } (one per layer, in priority order)
 *   Worker → Main: { type: 'done', timings }
 *
 * All ArrayBuffers are transferred (zero-copy).
 */

// ─── Request types ───

export interface CacheStreamRequest {
    type: 'start';
    cacheName: string;
    metaUrl: string;
    layerUrls: string[];
    paletteUrl: string;
}

export interface CacheSetPriorityRequest {
    type: 'set-priority';
    layerOrder: number[];
}

export type WorkerInboundMessage = CacheStreamRequest | CacheSetPriorityRequest;

// ─── Response types ───

export interface CacheMetaResponse {
    type: 'meta';
    metaJson: string | null;
    timings: {
        cacheOpen: number;
        metaMatch: number;
        metaRead: number;
        layerKickoff: number;
        metaBytes: number;
        layerCount: number;
    };
    error?: string;
}

export interface CachePaletteResponse {
    type: 'palette';
    paletteBuffer: ArrayBuffer | null;
    paletteBytes: number;
    readMs: number;
}

export interface CacheLayerResponse {
    type: 'layer';
    index: number;
    buffer: ArrayBuffer;
}

export interface CacheDoneResponse {
    type: 'done';
    timings: { layerRead: number; total: number; firstLayerMs: number; layerBytes: number };
}

export type WorkerOutboundMessage = CacheMetaResponse | CachePaletteResponse | CacheLayerResponse | CacheDoneResponse;

// ─── Worker implementation ───

const decoder = new TextDecoder();

let cache: Cache | null = null;
let layerUrls: string[] = [];

// Resolved layer buffers from initial parallel read (filled after meta)
let layerReadPromises: Promise<ArrayBuffer | null>[] = [];

async function handleStart(req: CacheStreamRequest): Promise<void> {
    const t0 = performance.now();

    try {
        cache = await caches.open(req.cacheName);
        const tOpen = performance.now();

        // Step 1: cache.match() for meta + palette in parallel
        const [metaResp, paletteResp] = await Promise.all([cache.match(req.metaUrl), cache.match(req.paletteUrl)]);
        const tMatch = performance.now();

        if (!metaResp) {
            const zeroTimings: CacheMetaResponse['timings'] = {
                cacheOpen: Math.round(tOpen - t0),
                metaMatch: Math.round(tMatch - tOpen),
                metaRead: 0,
                layerKickoff: 0,
                metaBytes: 0,
                layerCount: 0,
            };
            postTyped({ type: 'meta', metaJson: null, timings: zeroTimings });
            return;
        }

        // Step 2: read meta arrayBuffer (need layerCount). Palette reads in parallel.
        const palettePromise = paletteResp?.arrayBuffer() ?? Promise.resolve(null);
        const metaBuffer = await metaResp.arrayBuffer();
        const metaJson = decoder.decode(new Uint8Array(metaBuffer));
        const meta = JSON.parse(metaJson) as { layerCount: number };
        const tMetaRead = performance.now();

        // Step 3: kick off ALL layer reads IMMEDIATELY (don't wait for palette)
        layerUrls = req.layerUrls;
        layerReadPromises = [];
        for (let i = 0; i < meta.layerCount; i++) {
            layerReadPromises.push(cache.match(layerUrls[i]!).then(r => r?.arrayBuffer() ?? null));
        }
        const tKickoff = performance.now();

        // Step 4: send meta IMMEDIATELY so main thread can compute priority
        const metaMsg: CacheMetaResponse = {
            type: 'meta',
            metaJson,
            timings: {
                cacheOpen: Math.round(tOpen - t0),
                metaMatch: Math.round(tMatch - tOpen),
                metaRead: Math.round(tMetaRead - tMatch),
                layerKickoff: Math.round(tKickoff - tMetaRead),
                metaBytes: metaBuffer.byteLength,
                layerCount: meta.layerCount,
            },
        };
        postTyped(metaMsg);

        // Step 5: await palette and send separately (layers already reading in background)
        const paletteBuffer = await palettePromise;
        const tPalette = performance.now();
        const palMsg: CachePaletteResponse = {
            type: 'palette',
            paletteBuffer,
            // eslint-disable-next-line no-restricted-syntax -- paletteBuffer can legitimately be null when palette loading fails; 0 byte count is correct
            paletteBytes: paletteBuffer?.byteLength ?? 0,
            readMs: Math.round(tPalette - tKickoff),
        };
        const transferable: ArrayBuffer[] = paletteBuffer ? [paletteBuffer] : [];
        (self as unknown as Worker).postMessage(palMsg, transferable);
    } catch (e) {
        const zeroTimings: CacheMetaResponse['timings'] = {
            cacheOpen: 0,
            metaMatch: 0,
            metaRead: 0,
            layerKickoff: 0,
            metaBytes: 0,
            layerCount: 0,
        };
        postTyped({ type: 'meta', metaJson: null, timings: zeroTimings, error: String(e) });
    }
}

async function handleSetPriority(req: CacheSetPriorityRequest): Promise<void> {
    const t0 = performance.now();
    let firstLayerMs = 0;
    let totalBytes = 0;
    let delivered = 0;

    // Deliver layers in the requested priority order
    for (const layerIndex of req.layerOrder) {
        if (layerIndex >= layerReadPromises.length) {
            continue;
        }
        const buffer = await layerReadPromises[layerIndex]!;
        if (!buffer) {
            continue;
        }

        if (delivered === 0) {
            firstLayerMs = Math.round(performance.now() - t0);
        }
        totalBytes += buffer.byteLength;
        delivered++;

        const msg: CacheLayerResponse = { type: 'layer', index: layerIndex, buffer };
        (self as unknown as Worker).postMessage(msg, [buffer]);
    }

    const done: CacheDoneResponse = {
        type: 'done',
        timings: {
            layerRead: Math.round(performance.now() - t0),
            total: Math.round(performance.now() - t0),
            firstLayerMs,
            layerBytes: totalBytes,
        },
    };
    postTyped(done);
}

function postTyped(msg: WorkerOutboundMessage): void {
    (self as unknown as Worker).postMessage(msg);
}

self.onmessage = (e: MessageEvent<WorkerInboundMessage>) => {
    const msg = e.data;
    if (msg.type === 'start') {
        void handleStart(msg);
    } else {
        void handleSetPriority(msg);
    }
};
