import { describe, it, expect } from 'vitest';
import { BinaryReader } from '@/resources/file/binary-reader';

describe('BinaryReader bounds handling', () => {
    it('readByte returns 0 once the cursor reaches the end of the buffer', () => {
        const reader = new BinaryReader(new Uint8Array([7]));

        expect(reader.readByte()).toBe(7);
        expect(reader.readByte()).toBe(0);
    });

    it('readInt after setOffset reads regardless of the previous cursor position', () => {
        const reader = new BinaryReader(new Uint8Array([1, 0, 0, 0, 2, 0, 0, 0]));

        expect(reader.readInt()).toBe(1);
        expect(reader.readInt()).toBe(2);

        // Cursor is at the end of the buffer — repositioning must make the
        // data readable again.
        reader.setOffset(0);
        expect(reader.readInt()).toBe(1);
    });

    it('readInt at an out-of-bounds position returns 0 without advancing the cursor', () => {
        const reader = new BinaryReader(new Uint8Array([1, 2, 3, 4]));

        reader.setOffset(100);
        expect(reader.readInt()).toBe(0);
        expect(reader.getOffset()).toBe(100);
    });

    it('reads multi-byte values little- and big-endian at the cursor', () => {
        const reader = new BinaryReader(new Uint8Array([0x01, 0x02, 0x03, 0x04]));

        expect(reader.readWord()).toBe(0x0201);
        reader.setOffset(0);
        expect(reader.readWordBE()).toBe(0x0102);
        reader.setOffset(0);
        expect(reader.readInt()).toBe(0x04030201);
        reader.setOffset(0);
        expect(reader.readIntBE()).toBe(0x01020304);
        reader.setOffset(0);
        expect(reader.readIntBE(2)).toBe(0x0102);
        expect(reader.getOffset()).toBe(2);
    });
});
