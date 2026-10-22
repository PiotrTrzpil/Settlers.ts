/**
 * Unit tests for reading the sound tables out of S4_Main.exe, using a tiny synthetic
 * PE file with the same table layout (no game data involved).
 */

import { describe, it, expect } from 'vitest';
import { readExeSoundTable } from '../../../scripts/extract-sounds/exe-sound-table';

const IMAGE_BASE = 0x400000;
const SECTION_VA = 0x1000;
const SECTION_RAW = 0x200;

/** Build a 32-bit PE with one section holding the given names (ids 1..n) and variant counts. */
function buildExe(names: string[], counts: number[]): Uint8Array {
    const bytes = new Uint8Array(0x2000);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 0x5a4d, true); // MZ
    view.setUint32(0x3c, 0x40, true); // e_lfanew
    view.setUint32(0x40, 0x4550, true); // PE\0\0
    view.setUint16(0x40 + 6, 1, true); // one section
    view.setUint16(0x40 + 20, 224, true); // optional header size
    view.setUint32(0x40 + 24 + 28, IMAGE_BASE, true);
    const section = 0x40 + 24 + 224;
    view.setUint32(section + 12, SECTION_VA, true);
    view.setUint32(section + 16, bytes.length - SECTION_RAW, true);
    view.setUint32(section + 20, SECTION_RAW, true);

    const va = (offset: number) => IMAGE_BASE + SECTION_VA + offset - SECTION_RAW;
    let pos = SECTION_RAW + 4;
    const nameVa: number[] = [];
    for (const name of names) {
        nameVa.push(va(pos));
        Array.from(name, (c, i) => (bytes[pos + i] = c.charCodeAt(0)));
        pos += name.length + 1;
    }
    pos = (pos + 7) & ~3;
    names.forEach((_, i) => {
        view.setUint32(pos, nameVa[i]!, true);
        view.setInt32(pos + 4, i + 1, true);
        pos += 8;
    });
    pos += 16;
    let end = 0;
    for (const count of counts) {
        end += count;
        view.setInt32(pos, count, true);
        view.setInt32(pos + 8, end, true);
        pos += 12;
    }
    return bytes;
}

describe('readExeSoundTable', () => {
    it('maps each named sound to its slot range, skipping SOUND_NO_SOUND', () => {
        const exe = buildExe(['SOUND_NO_SOUND', 'SOUND_AMB_BIRD', 'SOUND_WORK_AXE'], [1, 3, 2]);
        expect(readExeSoundTable(exe, 6)).toEqual([
            { id: 'SOUND_AMB_BIRD', numericId: 2, firstSlot: 1, count: 3 },
            { id: 'SOUND_WORK_AXE', numericId: 3, firstSlot: 4, count: 2 },
        ]);
    });

    it('rejects a variant table that needs more slots than the archive has', () => {
        const exe = buildExe(['SOUND_NO_SOUND', 'SOUND_AMB_BIRD'], [1, 5]);
        expect(() => readExeSoundTable(exe, 4)).toThrow(/variant table not found/);
    });

    it('rejects files that are not executables', () => {
        expect(() => readExeSoundTable(new Uint8Array(0x100), 10)).toThrow(/MZ/);
    });
});
