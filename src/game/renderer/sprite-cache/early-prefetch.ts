/**
 * Ultra-early cache prefetch — starts the Cache API worker before Vue, router, or any
 * heavy modules load. Imported at the very top of main.ts (before everything else).
 *
 * This module intentionally duplicates cache URL constants and race localStorage access
 * to avoid pulling in the full sprite-cache / race module import chains. The ~300ms of
 * module resolution in Vite dev mode is the time we're reclaiming.
 *
 * The worker handle + meta promise are stored in module-level state and consumed later
 * by SpriteAtlasCacheManager.tryStreamingRestore() via consumeEarlyPrefetch().
 */

import CacheReadWorker from './cache-read-worker?worker';
import type { WorkerOutboundMessage, CacheStreamRequest, CacheSetPriorityRequest } from './cache-read-worker';
import { type Race, loadSavedRace, formatRace } from '@/game/core/race';

// ── Constants (must match sprite-atlas-cache.ts) ──

declare const __BUILD_TIME__: string;

const CACHE_SCHEMA_VERSION = 22;
const BUILD_VERSION =
    typeof __BUILD_TIME__ !== 'undefined'
        ? `${__BUILD_TIME__}-v${CACHE_SCHEMA_VERSION}`
        : `dev-v${CACHE_SCHEMA_VERSION}`;

const CACHE_NAME = 'settlers-atlas-v7';
const MAX_LAYER_URLS = 64;

function metaUrl(race: Race): string {
    return `/_settlers_atlas_/${race}/meta?v=${BUILD_VERSION}`;
}
function layerUrl(race: Race, i: number): string {
    return `/_settlers_atlas_/${race}/L${i}?v=${BUILD_VERSION}`;
}
function paletteUrl(race: Race): string {
    return `/_settlers_atlas_/${race}/pal?v=${BUILD_VERSION}`;
}

// ── Check if cache is disabled ──

function isCacheDisabled(): boolean {
    try {
        const stored = localStorage.getItem('settlers_game_settings');
        if (!stored) {
            return false;
        }
        const settings = JSON.parse(stored);
        return settings.cacheDisabled === true;
    } catch {
        return false;
    }
}

// ── Prefetch state (consumed by sprite-atlas-cache-manager) ──

export interface EarlyPrefetchHandle {
    race: Race;
    worker: Worker;
    metaPromise: Promise<{ metaJson: string; timings: Record<string, number> } | null>;
    sendPriority: (layerOrder: number[]) => void;
    setPaletteCb: (fn: (paletteData: Uint8Array | null) => void) => void;
    setLayerCb: (fn: (index: number, buffer: ArrayBuffer) => void) => void;
    setDoneCb: (fn: (timings: { layerRead: number; total: number }) => void) => void;
}

let earlyHandle: EarlyPrefetchHandle | null = null;

/** Consume the early prefetch handle (returns null if not available or already consumed). */
export function consumeEarlyPrefetch(): EarlyPrefetchHandle | null {
    const h = earlyHandle;
    earlyHandle = null;
    return h;
}

/** Invalidate any early prefetch in progress — terminates worker and clears handle. */
export function invalidateEarlyPrefetch(): void {
    if (earlyHandle) {
        earlyHandle.worker.terminate();
        earlyHandle = null;
    }
}

/** Get the race that was prefetched (without consuming). */
export function getEarlyPrefetchRace(): Race | null {
    // eslint-disable-next-line no-restricted-syntax -- optional chaining; null when source is absent
    return earlyHandle?.race ?? null;
}

// ── Start the prefetch immediately on module evaluation ──

if (!isCacheDisabled()) {
    const race = loadSavedRace();
    console.log(`[${performance.now().toFixed(0)}ms] [cache] early prefetch started for ${formatRace(race)}`);

    const worker = new CacheReadWorker();
    const layerUrls: string[] = [];
    for (let i = 0; i < MAX_LAYER_URLS; i++) {
        layerUrls.push(layerUrl(race, i));
    }

    // Callbacks — initially buffer arrivals, then replay when real handlers are wired.
    // This is critical because palette/layers/done can arrive BEFORE the cache manager
    // consumes the handle and wires real callbacks (hundreds of ms gap).
    let paletteCb: ((paletteData: Uint8Array | null) => void) | null = null;
    let layerCb: ((index: number, buffer: ArrayBuffer) => void) | null = null;
    let doneCb: ((timings: { layerRead: number; total: number }) => void) | null = null;

    // Buffered arrivals (replayed when real callbacks are wired)
    let bufferedPalette: { data: Uint8Array | null } | null = null;
    const bufferedLayers: { index: number; buffer: ArrayBuffer }[] = [];
    let bufferedDone: { timings: { layerRead: number; total: number } } | null = null;

    let gotPalette = false;
    let gotDone = false;

    const maybeTerminate = () => {
        if (gotPalette && gotDone) {
            worker.terminate();
        }
    };

    let resolveMeta: (value: { metaJson: string; timings: Record<string, number> } | null) => void;
    const metaPromise = new Promise<{ metaJson: string; timings: Record<string, number> } | null>(resolve => {
        resolveMeta = resolve;
    });

    const handleMeta = (msg: Extract<WorkerOutboundMessage, { type: 'meta' }>) => {
        if (!msg.metaJson || msg.error) {
            worker.terminate();
            resolveMeta(null);
            return;
        }
        const t = msg.timings;
        console.log(
            `[${performance.now().toFixed(0)}ms] [cache] meta for ${formatRace(race)} ` +
                `(worker: open=${t.cacheOpen}ms match=${t.metaMatch}ms metaRead=${t.metaRead}ms ` +
                `layerKickoff=${t.layerKickoff}ms) meta=${Math.round(t.metaBytes / 1024)}KB layers=${t.layerCount}`
        );
        resolveMeta({ metaJson: msg.metaJson, timings: t });
    };

    const handlePalette = (msg: Extract<WorkerOutboundMessage, { type: 'palette' }>) => {
        const pd = msg.paletteBuffer ? new Uint8Array(msg.paletteBuffer) : null;
        console.log(
            `[${performance.now().toFixed(0)}ms] [cache] palette: ${Math.round(msg.paletteBytes / 1024)}KB in ${msg.readMs}ms`
        );
        gotPalette = true;
        if (paletteCb) {
            paletteCb(pd);
        } else {
            bufferedPalette = { data: pd };
        }
        maybeTerminate();
    };

    const handleLayer = (msg: Extract<WorkerOutboundMessage, { type: 'layer' }>) => {
        if (layerCb) {
            layerCb(msg.index, msg.buffer);
        } else {
            bufferedLayers.push({ index: msg.index, buffer: msg.buffer });
        }
    };

    const handleDone = (msg: Extract<WorkerOutboundMessage, { type: 'done' }>) => {
        console.log(
            `[${performance.now().toFixed(0)}ms] [cache] all layers streamed ` +
                `(firstLayer=${msg.timings.firstLayerMs}ms read=${msg.timings.layerRead}ms ` +
                `${(msg.timings.layerBytes / 1024 / 1024).toFixed(1)}MB)`
        );
        gotDone = true;
        if (doneCb) {
            doneCb(msg.timings);
        } else {
            bufferedDone = { timings: msg.timings };
        }
        maybeTerminate();
    };

    worker.onmessage = (e: MessageEvent<WorkerOutboundMessage>) => {
        const msg = e.data;
        if (msg.type === 'meta') {
            handleMeta(msg);
        } else if (msg.type === 'palette') {
            handlePalette(msg);
        } else if (msg.type === 'layer') {
            handleLayer(msg);
        } else {
            handleDone(msg);
        }
    };

    worker.onerror = () => {
        worker.terminate();
        resolveMeta(null);
    };

    const req: CacheStreamRequest = {
        type: 'start',
        cacheName: CACHE_NAME,
        metaUrl: metaUrl(race),
        layerUrls,
        paletteUrl: paletteUrl(race),
    };
    worker.postMessage(req);

    const sendPriority = (layerOrder: number[]) => {
        const msg: CacheSetPriorityRequest = { type: 'set-priority', layerOrder };
        worker.postMessage(msg);
    };

    earlyHandle = {
        race,
        worker,
        metaPromise,
        sendPriority,
        setPaletteCb: fn => {
            paletteCb = fn;
            // Replay buffered palette if it arrived before the callback was wired
            if (bufferedPalette) {
                fn(bufferedPalette.data);
                bufferedPalette = null;
            }
        },
        setLayerCb: fn => {
            layerCb = fn;
            // Replay buffered layers
            for (const l of bufferedLayers) {
                fn(l.index, l.buffer);
            }
            bufferedLayers.length = 0;
        },
        setDoneCb: fn => {
            doneCb = fn;
            // Replay buffered done
            if (bufferedDone) {
                fn(bufferedDone.timings);
                bufferedDone = null;
            }
        },
    };
}
