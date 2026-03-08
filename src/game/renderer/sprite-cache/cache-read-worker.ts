/**
 * Web Worker for reading sprite atlas cache entirely off the main thread.
 *
 * Reads all Cache API entries for a race (meta + layers + palette) in parallel,
 * then transfers ArrayBuffers back to the main thread via zero-copy postMessage.
 *
 * The entire 1GB+ I/O happens here — zero main-thread blocking.
 */

export interface CacheBatchReadRequest {
    type: 'batch-read';
    cacheName: string;
    metaUrl: string;
    layerUrls: string[];
    paletteUrl: string;
}

export interface CacheBatchReadResponse {
    /** null = cache miss */
    metaJson: string | null;
    /** Per-layer ArrayBuffers (null entries = missing) */
    layerBuffers: (ArrayBuffer | null)[];
    /** Palette ArrayBuffer (null = missing) */
    paletteBuffer: ArrayBuffer | null;
    timings: {
        cacheOpen: number;
        metaRead: number;
        layerRead: number;
        total: number;
    };
    error?: string;
}

const decoder = new TextDecoder();

async function handleBatchRead(req: CacheBatchReadRequest): Promise<CacheBatchReadResponse> {
    const t0 = performance.now();
    const miss: CacheBatchReadResponse = {
        metaJson: null,
        layerBuffers: [],
        paletteBuffer: null,
        timings: { cacheOpen: 0, metaRead: 0, layerRead: 0, total: 0 },
    };

    try {
        const cache = await caches.open(req.cacheName);
        const tOpen = performance.now();
        miss.timings.cacheOpen = Math.round(tOpen - t0);

        // Read metadata first (need layerCount to know how many layers to expect)
        const metaResp = await cache.match(req.metaUrl);
        if (!metaResp) {
            miss.timings.total = Math.round(performance.now() - t0);
            return miss;
        }
        const metaBuffer = await metaResp.arrayBuffer();
        const metaJson = decoder.decode(new Uint8Array(metaBuffer));
        const meta = JSON.parse(metaJson) as { layerCount: number };
        const tMeta = performance.now();
        miss.timings.metaRead = Math.round(tMeta - tOpen);

        // Read only the actual layers (not all 64 URL slots) + palette in parallel
        const actualLayerUrls = req.layerUrls.slice(0, meta.layerCount);
        const layerPromises = actualLayerUrls.map(url => cache.match(url).then(r => r?.arrayBuffer() ?? null));
        const palettePromise = cache.match(req.paletteUrl).then(r => r?.arrayBuffer() ?? null);

        const [layerBuffers, paletteBuffer] = await Promise.all([Promise.all(layerPromises), palettePromise]);
        const tLayers = performance.now();

        const result: CacheBatchReadResponse = {
            metaJson,
            layerBuffers,
            paletteBuffer,
            timings: {
                cacheOpen: Math.round(tOpen - t0),
                metaRead: Math.round(tMeta - tOpen),
                layerRead: Math.round(tLayers - tMeta),
                total: Math.round(tLayers - t0),
            },
        };
        return result;
    } catch (e) {
        miss.timings.total = Math.round(performance.now() - t0);
        miss.error = String(e);
        return miss;
    }
}

self.onmessage = (e: MessageEvent<CacheBatchReadRequest>) => {
    void handleBatchRead(e.data).then(resp => {
        // Transfer all ArrayBuffers (zero-copy to main thread)
        const transferable: ArrayBuffer[] = [];
        for (const buf of resp.layerBuffers) {
            if (buf) transferable.push(buf);
        }
        if (resp.paletteBuffer) transferable.push(resp.paletteBuffer);
        (self as unknown as Worker).postMessage(resp, transferable);
    });
};
