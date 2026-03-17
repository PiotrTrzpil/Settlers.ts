#!/usr/bin/env tsx
/**
 * Standalone timeline receiver — connects to the game's CLI WebSocket
 * and records timeline events to a local SQLite database.
 *
 *   pnpm timeline:record
 *   CLI_URL=ws://localhost:5174/__cli__ pnpm timeline:record
 *
 * Press Ctrl-C to stop recording. The DB is written to output/timeline/live/.
 *
 * Usually not needed — the Vite plugin records automatically during dev.
 * Use this for recording from a remote server or custom setups.
 */

import WebSocket from 'ws';
import type { WsTimelineBatch, WsTimelineSubscribe, WsTimelineUnsubscribe } from '../src/game/cli/types';
import { createLiveTimeline } from './lib/live-timeline-writer';

// ─── Constants ───────────────────────────────────────────────

const STATUS_INTERVAL_MS = 5_000;
const RECONNECT_DELAY_MS = 2_000;
const MAX_RECONNECT_DELAY_MS = 15_000;

const url = process.env['CLI_URL'] ?? 'ws://localhost:5173/__cli__';

// ─── Main ────────────────────────────────────────────────────

const { writer, dbPath } = createLiveTimeline();

let shuttingDown = false;
let ws: WebSocket | null = null;
let statusTimer: ReturnType<typeof setInterval> | undefined;
let lastReportedCount = 0;
let reconnectDelay = RECONNECT_DELAY_MS;

console.log(`Recording to ${dbPath}`);

function connect(): void {
    if (shuttingDown) return;

    console.log(`Connecting to ${url}...`);
    ws = new WebSocket(url);

    ws.on('open', () => {
        console.log('Connected — subscribing to timeline...');
        reconnectDelay = RECONNECT_DELAY_MS;
        const msg: WsTimelineSubscribe = { type: 'timeline:subscribe' };
        ws!.send(JSON.stringify(msg));

        if (!statusTimer) {
            statusTimer = setInterval(() => {
                const count = writer.entryCount;
                if (count !== lastReportedCount) {
                    console.log(`  ${count} entries recorded`);
                    lastReportedCount = count;
                }
            }, STATUS_INTERVAL_MS);
        }
    });

    ws.on('message', (data: WebSocket.RawData) => {
        let msg: unknown;
        try {
            msg = JSON.parse(String(data));
        } catch {
            return;
        }

        if (typeof msg !== 'object' || msg === null || !('type' in msg)) return;

        const typed = msg as { type: string };

        if (typed.type === 'timeline:batch') {
            writer.recordBatch((msg as WsTimelineBatch).entries);
        } else if (typed.type === 'timeline:end') {
            console.log('Received timeline:end — game destroyed.');
        }
    });

    ws.on('close', () => {
        ws = null;
        if (shuttingDown) return;
        writer.flush();
        const delay = Math.min(reconnectDelay, MAX_RECONNECT_DELAY_MS);
        console.log(`Disconnected — reconnecting in ${(delay / 1000).toFixed(0)}s...`);
        setTimeout(connect, delay);
        reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY_MS);
    });

    ws.on('error', () => {
        // onclose fires after onerror — reconnect logic is handled there
    });
}

connect();

// ─── Graceful shutdown ───────────────────────────────────────

process.on('SIGINT', () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\nSIGINT — unsubscribing and finalizing...');

    if (statusTimer) clearInterval(statusTimer);

    if (ws && ws.readyState === WebSocket.OPEN) {
        const msg: WsTimelineUnsubscribe = { type: 'timeline:unsubscribe' };
        ws.send(JSON.stringify(msg));
    }

    writer.close();
    console.log(`Finalized: ${writer.entryCount} entries → ${dbPath}`);
    process.exit(0);
});
