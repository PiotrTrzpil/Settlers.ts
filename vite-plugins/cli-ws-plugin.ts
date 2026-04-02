/* eslint-disable sonarjs/no-unused-collection -- timelineSubscribers is iterated via for-of */
/**
 * Vite dev-only plugin: WebSocket relay at `/__cli__`.
 *
 * Creates a WS server that bridges external CLI commanders (LLM agents)
 * to the in-browser game executor. Commands flow commander → relay → executor,
 * results flow executor → relay → commander.
 *
 * Only active in `serve` mode.
 */

import type { Plugin } from 'vite';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, WebSocket } from 'ws';
import type {
    WsCommandMessage,
    WsResultMessage,
    WsRegisterMessage,
    WsControlMessage,
    WsPushMessage,
    WsTimelineBatch,
} from '../src/game/cli/types';
import { createLiveTimeline, type LiveTimelineWriter } from '../scripts/lib/live-timeline-writer';

const HEARTBEAT_INTERVAL = 30_000;
const CLI_PATH = '/__cli__';

interface PendingCommand {
    commander: WebSocket;
    id: number;
}

export function cliWsPlugin(): Plugin {
    return {
        name: 'cli-ws',
        apply: 'serve',
        configureServer(server) {
            // httpServer is null during Vitest — nothing to attach to
            if (!server.httpServer) return;

            const wss = new WebSocketServer({ noServer: true });

            let executor: WebSocket | null = null;
            const commanders = new Set<WebSocket>();
            const timelineSubscribers = new Set<WebSocket>();
            let pending: PendingCommand | null = null;
            const queue: { commander: WebSocket; msg: WsCommandMessage }[] = [];

            // ── Auto-record timeline to SQLite ─────────────────────
            let timelineWriter: LiveTimelineWriter | null = null;
            try {
                const session = createLiveTimeline();
                timelineWriter = session.writer;
                console.log(`[cli-ws] Timeline recording → ${session.dbPath}`);
            } catch (err) {
                console.warn('[cli-ws] Timeline auto-record failed to init:', err);
            }

            // ── Heartbeat ──────────────────────────────────────────
            const alive = new WeakMap<WebSocket, boolean>();

            const heartbeat = setInterval(() => {
                for (const ws of wss.clients) {
                    if (!alive.get(ws)) {
                        ws.terminate();
                        continue;
                    }
                    alive.set(ws, false);
                    ws.ping();
                }
            }, HEARTBEAT_INTERVAL);

            wss.on('close', () => clearInterval(heartbeat));

            // ── Upgrade handler ────────────────────────────────────
            server.httpServer!.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
                const url = new URL(req.url!, `http://${req.headers.host}`);
                if (url.pathname !== CLI_PATH) return;

                wss.handleUpgrade(req, socket, head, ws => {
                    wss.emit('connection', ws, req);
                });
            });

            // ── Connection handling ────────────────────────────────
            wss.on('connection', (ws: WebSocket) => {
                alive.set(ws, true);
                ws.on('pong', () => alive.set(ws, true));
                ws.on('error', (err: Error) => {
                    console.warn(`[cli-ws] WebSocket error: ${err.message}`);
                    ws.terminate();
                });

                // First message determines the role
                let identified = false;

                ws.on('message', (raw: Buffer | string) => {
                    const data = JSON.parse(typeof raw === 'string' ? raw : raw.toString());

                    // Registration: executor identifies itself
                    if (!identified) {
                        identified = true;
                        if (isRegisterMessage(data)) {
                            registerExecutor(ws);
                            return;
                        }
                        // Not a register message — this is a commander
                        commanders.add(ws);
                        // The first message is already a command or control, process it
                        if (hasType(data)) {
                            handleCommanderControl(ws, data as WsControlMessage);
                        } else {
                            handleCommanderMessage(ws, data as WsCommandMessage);
                        }
                        return;
                    }

                    // Subsequent messages — discriminate by `type` field
                    if (ws === executor) {
                        if (hasType(data)) {
                            handleExecutorPush(data as WsPushMessage);
                        } else {
                            handleExecutorMessage(data as WsResultMessage);
                        }
                    } else if (hasType(data)) {
                        handleCommanderControl(ws, data as WsControlMessage);
                    } else {
                        handleCommanderMessage(ws, data as WsCommandMessage);
                    }
                });

                ws.on('close', () => {
                    if (ws === executor) {
                        onExecutorClose();
                    } else {
                        onCommanderClose(ws);
                    }
                });
            });

            /** Fail a pending command, notifying the commander if still connected. */
            function failPending(reason: string): void {
                if (!pending) return;
                if (pending.commander.readyState === WebSocket.OPEN) {
                    sendTo(pending.commander, { id: pending.id, ok: false, output: reason });
                }
                pending = null;
            }

            function onExecutorClose(): void {
                executor = null;
                failPending('game disconnected (executor closed)');
                // Fail all queued commands too
                for (const entry of queue.splice(0)) {
                    if (entry.commander.readyState === WebSocket.OPEN) {
                        sendTo(entry.commander, {
                            id: entry.msg.id,
                            ok: false,
                            output: 'game disconnected (executor closed)',
                        });
                    }
                }
            }

            function onCommanderClose(ws: WebSocket): void {
                commanders.delete(ws);
                // Clean up timeline subscription
                if (timelineSubscribers.delete(ws)) {
                    if (timelineSubscribers.size === 0 && executor && executor.readyState === WebSocket.OPEN) {
                        sendTo(executor, { type: 'timeline:unsubscribe' });
                    }
                }
                // Drop any pending/queued commands from this commander
                if (pending?.commander === ws) {
                    pending = null;
                    drainQueue();
                }
                for (let i = queue.length - 1; i >= 0; i--) {
                    if (queue[i]!.commander === ws) queue.splice(i, 1);
                }
            }

            function registerExecutor(ws: WebSocket): void {
                if (executor && executor.readyState === WebSocket.OPEN) {
                    executor.close(1000, 'replaced by new executor');
                }
                // If a command was in-flight when the old executor disconnected
                // (e.g. HMR reload), fail it so the relay is unblocked.
                failPending('game reloaded — executor reconnected, please retry');
                executor = ws;
                // Fresh game = fresh timeline (HMR reload resets ticks to 0)
                timelineWriter?.reset();
                // Always subscribe — the relay records timeline to SQLite,
                // plus re-sync any external subscribers
                sendTo(ws, { type: 'timeline:subscribe' } as WsControlMessage);
                // Drain any commands that were queued while executor was disconnected
                drainQueue();
            }

            function handleCommanderMessage(ws: WebSocket, msg: WsCommandMessage): void {
                if (!executor || executor.readyState !== WebSocket.OPEN) {
                    sendTo(ws, { id: msg.id, ok: false, output: 'game not connected' });
                    return;
                }

                if (pending) {
                    // Serialize: queue the command
                    queue.push({ commander: ws, msg });
                    return;
                }

                dispatchToExecutor(ws, msg);
            }

            function dispatchToExecutor(commander: WebSocket, msg: WsCommandMessage): void {
                pending = { commander, id: msg.id };
                sendTo(executor!, msg);
            }

            function handleExecutorMessage(msg: WsResultMessage): void {
                if (!pending) return;

                if (msg.id === pending.id && pending.commander.readyState === WebSocket.OPEN) {
                    sendTo(pending.commander, msg);
                }
                pending = null;
                drainQueue();
            }

            function drainQueue(): void {
                while (queue.length > 0) {
                    const next = queue.shift()!;
                    if (next.commander.readyState !== WebSocket.OPEN) continue;
                    if (!executor || executor.readyState !== WebSocket.OPEN) {
                        sendTo(next.commander, {
                            id: next.msg.id,
                            ok: false,
                            output: 'game not connected',
                        });
                        continue;
                    }
                    dispatchToExecutor(next.commander, next.msg);
                    return; // Only dispatch one at a time
                }
            }

            function handleCommanderControl(ws: WebSocket, msg: WsControlMessage): void {
                if (msg.type === 'timeline:subscribe') {
                    timelineSubscribers.add(ws);
                } else if (msg.type === 'timeline:unsubscribe') {
                    timelineSubscribers.delete(ws);
                }
                // Forward to executor so it can start/stop capture
                if (executor && executor.readyState === WebSocket.OPEN) {
                    sendTo(executor, msg);
                }
            }

            function handleExecutorPush(msg: WsPushMessage): void {
                if (msg.type === 'timeline:batch') {
                    // Write to local SQLite
                    timelineWriter?.recordBatch((msg as WsTimelineBatch).entries);
                    // Forward to external subscribers
                    for (const sub of timelineSubscribers) {
                        if (sub.readyState === WebSocket.OPEN) {
                            sendTo(sub, msg);
                        }
                    }
                } else if (msg.type === 'timeline:end') {
                    for (const sub of timelineSubscribers) {
                        if (sub.readyState === WebSocket.OPEN) {
                            sendTo(sub, msg);
                        }
                    }
                    timelineSubscribers.clear();
                }
            }

            type WsMessage = WsCommandMessage | WsResultMessage | WsControlMessage | WsPushMessage;

            function sendTo(ws: WebSocket, data: WsMessage): void {
                ws.send(JSON.stringify(data));
            }

            function hasType(data: unknown): boolean {
                return (
                    typeof data === 'object' &&
                    data !== null &&
                    'type' in data &&
                    typeof (data as Record<string, unknown>)['type'] === 'string'
                );
            }

            function isRegisterMessage(data: unknown): data is WsRegisterMessage {
                return (
                    typeof data === 'object' &&
                    data !== null &&
                    (data as WsRegisterMessage).type === 'register' &&
                    (data as WsRegisterMessage).role === 'executor'
                );
            }

            // Clean up on server close
            server.httpServer!.on('close', () => {
                wss.close();
                timelineWriter?.close();
                timelineWriter = null;
            });
        },
    };
}
