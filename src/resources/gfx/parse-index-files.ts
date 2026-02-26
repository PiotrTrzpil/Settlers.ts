/**
 * Async helper to parse index files (GIL, JIL, DIL, PIL) in a Web Worker.
 * Eliminates 50ms+ synchronous parse on the main thread.
 */

import type { IndexParseRequest, IndexParseResponse } from './index-file-parse-worker';

// Vite worker import
import ParseWorker from './index-file-parse-worker?worker';

import type { BinaryReader } from '../file/binary-reader';

export interface ParsedIndexFiles {
    gil: Int32Array;
    pil: Int32Array;
    jil: Int32Array | null;
    dil: Int32Array | null;
}

/**
 * Parse GIL/PIL/JIL/DIL files in a worker thread.
 * Transfers buffers to the worker (zero-copy) and receives parsed Int32Arrays back.
 */
export function parseIndexFilesInWorker(files: {
    gil: BinaryReader;
    pil: BinaryReader;
    jil: BinaryReader | null;
    dil: BinaryReader | null;
}): Promise<ParsedIndexFiles> {
    const worker = new ParseWorker();

    const pending = new Map<number, (table: Int32Array) => void>();
    let nextId = 0;

    function postFile(reader: BinaryReader): Promise<Int32Array> {
        return new Promise(resolve => {
            const id = nextId++;
            pending.set(id, resolve);

            const buf = reader.getBuffer();
            const transfer = (buf.buffer as ArrayBuffer).slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
            const request: IndexParseRequest = { id, buffer: transfer };
            worker.postMessage(request, [transfer]);
        });
    }

    worker.onmessage = (e: MessageEvent<IndexParseResponse>) => {
        const { id, offsetTable } = e.data;
        const resolve = pending.get(id);
        if (resolve) {
            pending.delete(id);
            resolve(offsetTable);
        }
    };

    const gilPromise = postFile(files.gil);
    const pilPromise = postFile(files.pil);
    const jilPromise = files.jil ? postFile(files.jil) : Promise.resolve(null);
    const dilPromise = files.dil ? postFile(files.dil) : Promise.resolve(null);

    return Promise.all([gilPromise, pilPromise, jilPromise, dilPromise]).then(([gil, pil, jil, dil]) => {
        worker.terminate();
        return { gil, pil, jil, dil };
    });
}
