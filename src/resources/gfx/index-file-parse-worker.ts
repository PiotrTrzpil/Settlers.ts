/**
 * Web Worker for parsing index files (GIL, JIL, DIL, PIL) off the main thread.
 * Each file is a 20-byte header followed by int32 offset entries.
 * Returns the parsed Int32Array offset table via transferable.
 */

export interface IndexParseRequest {
    id: number;
    /** Raw file bytes */
    buffer: ArrayBuffer;
}

export interface IndexParseResponse {
    id: number;
    /** Parsed offset table */
    offsetTable: Int32Array;
}

function parseOffsetTable(buffer: ArrayBuffer): Int32Array {
    const headerSize = 20;

    if (buffer.byteLength < headerSize) {
        return new Int32Array(0);
    }

    const payloadBytes = buffer.byteLength - headerSize;
    const count = payloadBytes / 4;
    const view = new DataView(buffer);
    const table = new Int32Array(count);

    for (let i = 0; i < count; i++) {
        table[i] = view.getInt32(headerSize + i * 4, true); // little-endian
    }

    return table;
}

self.onmessage = (e: MessageEvent<IndexParseRequest>) => {
    const { id, buffer } = e.data;
    const offsetTable = parseOffsetTable(buffer);

    const response: IndexParseResponse = { id, offsetTable };
    (self as unknown as Worker).postMessage(response, [offsetTable.buffer]);
};
