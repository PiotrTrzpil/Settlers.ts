import type { GameCli } from './cli';
import type {
    WsCommandMessage,
    WsControlMessage,
    WsRegisterMessage,
    WsResultMessage,
    WsTimelineBatch,
    WsTimelineEnd,
} from './types';
import { getBridge } from '@/game/debug/debug-bridge';

const MAX_RETRIES = 5;
const RECONNECT_DELAY_MS = 1000;

/** Handle returned from connectCliWs for timeline integration. */
export interface CliWsHandle {
    /** Send a timeline:end push to notify all subscribers that recording stopped. */
    sendTimelineEnd(): void;
}

/**
 * Connects the in-browser CLI engine to the Vite dev server's WS relay as the "executor".
 * Incoming commands from external clients (LLM agents) are dispatched to `cli.run()`
 * and results are sent back over the WebSocket.
 *
 * Only activates in dev mode — no-op in production builds.
 * Returns a handle for timeline integration (sending timeline:end).
 */
export function connectCliWs(cli: GameCli): CliWsHandle | undefined {
    if (!import.meta.env.DEV) {
        return undefined;
    }

    let retries = 0;
    let ws: WebSocket | null = null;

    function connect(): void {
        const url = `ws://${location.host}/__cli__`;
        ws = new WebSocket(url);

        ws.onopen = () => {
            retries = 0;
            const register: WsRegisterMessage = { type: 'register', role: 'executor' };
            ws!.send(JSON.stringify(register));

            // Wire timeline capture flush → WS push
            const capture = getBridge().timelineCapture;
            if (capture) {
                capture.onFlush = entries => {
                    if (!ws || ws.readyState !== WebSocket.OPEN) {
                        return;
                    }
                    const batch: WsTimelineBatch = {
                        type: 'timeline:batch',
                        entries,
                    };
                    ws.send(JSON.stringify(batch));
                };
            }
        };

        ws.onmessage = (event: MessageEvent) => {
            const data = JSON.parse(event.data as string);

            // Control messages have a `type` field; commands do not
            if (typeof data.type === 'string') {
                handleControlMessage(data as WsControlMessage);
                return;
            }

            const msg = data as WsCommandMessage;
            const result = cli.run(msg.cmd);
            const response: WsResultMessage = {
                id: msg.id,
                ok: result.ok,
                output: result.output,
            };
            ws!.send(JSON.stringify(response));
        };

        ws.onclose = () => {
            // Detach timeline flush callback so capture doesn't send to a dead socket
            const capture = getBridge().timelineCapture;
            if (capture) {
                capture.onFlush = null;
            }

            ws = null;
            if (retries < MAX_RETRIES) {
                retries++;
                setTimeout(connect, RECONNECT_DELAY_MS);
            }
        };

        ws.onerror = () => {
            // onclose fires after onerror — reconnect logic is handled there
        };
    }

    function handleControlMessage(msg: WsControlMessage): void {
        const capture = getBridge().timelineCapture;
        if (msg.type === 'timeline:subscribe') {
            if (capture) {
                capture.addSubscriber();
            }
        } else {
            if (capture) {
                capture.removeSubscriber();
            }
        }
    }

    /** Send a timeline:end push to notify all subscribers that recording stopped. */
    function sendTimelineEnd(): void {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            return;
        }
        const end: WsTimelineEnd = { type: 'timeline:end' };
        ws.send(JSON.stringify(end));
    }

    connect();

    return { sendTimelineEnd };
}
