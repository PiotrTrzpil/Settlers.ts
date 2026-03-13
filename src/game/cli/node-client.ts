import WebSocket from 'ws';
import type { CliResult, WsCommandMessage, WsResultMessage } from './types';

const DEFAULT_URL = 'ws://localhost:5173/__cli__';
const COMMAND_TIMEOUT_MS = 5000;

/** Thin Node.js client for sending CLI commands to the running game. */
export interface GameCliClient {
    /** Send a command and wait for the result. */
    run(command: string): Promise<CliResult>;
    /** Close the WebSocket connection. */
    close(): void;
    /** Whether the WebSocket connection is open. */
    readonly connected: boolean;
}

interface PendingEntry {
    resolve: (result: CliResult) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

function sendCommand(
    ws: WebSocket,
    pending: Map<number, PendingEntry>,
    id: number,
    command: string
): Promise<CliResult> {
    const msg: WsCommandMessage = { id, cmd: command };
    ws.send(JSON.stringify(msg));
    return new Promise<CliResult>((res, rej) => {
        const timer = setTimeout(() => {
            pending.delete(id);
            rej(new Error(`command timed out after ${COMMAND_TIMEOUT_MS}ms: "${command}"`));
        }, COMMAND_TIMEOUT_MS);
        pending.set(id, { resolve: res, reject: rej, timer });
    });
}

/**
 * Connect to the game's CLI WebSocket as a "commander" client.
 * Resolves when the WebSocket connection is open and ready to send commands.
 */
export function connectGameCli(url: string = DEFAULT_URL): Promise<GameCliClient> {
    return new Promise<GameCliClient>((resolve, reject) => {
        const ws = new WebSocket(url);
        let nextId = 1;
        const pending = new Map<number, PendingEntry>();

        ws.on('message', (data: WebSocket.Data) => {
            const msg = JSON.parse(data.toString()) as WsResultMessage;
            const entry = pending.get(msg.id);
            if (!entry) {
                return;
            }
            clearTimeout(entry.timer);
            pending.delete(msg.id);
            entry.resolve({ ok: msg.ok, output: msg.output });
        });

        ws.on('error', (err: Error) => {
            reject(err);
        });

        ws.on('close', () => {
            for (const [id, entry] of pending) {
                clearTimeout(entry.timer);
                pending.delete(id);
                entry.reject(new Error('WebSocket closed while command was pending'));
            }
        });

        ws.on('open', () => {
            const client: GameCliClient = {
                run(command: string): Promise<CliResult> {
                    if (ws.readyState !== WebSocket.OPEN) {
                        return Promise.reject(new Error('WebSocket is not open'));
                    }
                    return sendCommand(ws, pending, nextId++, command);
                },

                close(): void {
                    ws.close();
                },

                get connected(): boolean {
                    return ws.readyState === WebSocket.OPEN;
                },
            };

            resolve(client);
        });
    });
}
