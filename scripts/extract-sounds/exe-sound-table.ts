/**
 * Reads the sound-effect tables out of S4_Main.exe (Settlers 4, 32-bit PE).
 *
 * Snd/0.snd holds ~300 unnamed sound slots. The game maps its sound ids to slots with
 * two tables in the executable's data sections:
 *
 * 1. Name table — 8-byte entries `{ char* name; int32 id }`, sorted by id, starting
 *    with `{ "SOUND_NO_SOUND", 1 }`, e.g. `{ "SOUND_WORK_AXE", 13 }`.
 * 2. Variant table — 12-byte entries `{ int32 count; int32 0; int32 cumulativeEnd }`,
 *    one per id (entry k ↔ id k+1). Sound id k+1 owns slots [end - count, end).
 *    The first entry is `{ 1, 0, 1 }` (SOUND_NO_SOUND → empty slot 0).
 *
 * Both tables are located by searching, not by fixed offsets, so slightly different
 * builds of the executable work as long as the layout is the same.
 */

const MZ = 0x5a4d;
const PE = 0x4550;
const NO_SOUND = 'SOUND_NO_SOUND';
const NAME_PREFIX = 'SOUND_';

export interface SoundSlots {
    /** Original id, e.g. `SOUND_WORK_AXE` */
    id: string;
    numericId: number;
    firstSlot: number;
    count: number;
}

interface Section {
    virtualAddress: number;
    rawPointer: number;
    rawSize: number;
}

class PeImage {
    readonly view: DataView;
    readonly imageBase: number;
    readonly sections: Section[] = [];

    constructor(readonly bytes: Uint8Array) {
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (this.view.getUint16(0, true) !== MZ) {
            throw new Error('Not an executable (missing MZ header)');
        }
        const pe = this.view.getUint32(0x3c, true);
        if (this.view.getUint32(pe, true) !== PE) {
            throw new Error('Not a PE executable');
        }
        const sectionCount = this.view.getUint16(pe + 6, true);
        const optionalHeaderSize = this.view.getUint16(pe + 20, true);
        this.imageBase = this.view.getUint32(pe + 24 + 28, true);
        for (let i = 0; i < sectionCount; i++) {
            const s = pe + 24 + optionalHeaderSize + 40 * i;
            this.sections.push({
                virtualAddress: this.view.getUint32(s + 12, true),
                rawSize: this.view.getUint32(s + 16, true),
                rawPointer: this.view.getUint32(s + 20, true),
            });
        }
    }

    offsetToVa(offset: number): number | null {
        const s = this.sections.find(x => offset >= x.rawPointer && offset < x.rawPointer + x.rawSize);
        return s ? this.imageBase + s.virtualAddress + (offset - s.rawPointer) : null;
    }

    vaToOffset(va: number): number | null {
        const rva = va - this.imageBase;
        const s = this.sections.find(x => rva >= x.virtualAddress && rva < x.virtualAddress + x.rawSize);
        return s ? s.rawPointer + (rva - s.virtualAddress) : null;
    }

    /** Read a NUL-terminated ASCII string at a virtual address (max 64 chars). */
    stringAt(va: number): string | null {
        const offset = this.vaToOffset(va);
        if (offset === null) {
            return null;
        }
        let s = '';
        for (let i = offset; i < this.bytes.length && i < offset + 64; i++) {
            const c = this.bytes[i]!;
            if (c === 0) {
                return s;
            }
            s += String.fromCharCode(c);
        }
        return null;
    }

    int32(offset: number): number {
        return this.view.getInt32(offset, true);
    }
}

function findCString(bytes: Uint8Array, text: string): number[] {
    const needle = Array.from(text + '\0', c => c.charCodeAt(0));
    const hits: number[] = [];
    for (let i = 1; i + needle.length <= bytes.length; i++) {
        if (bytes[i - 1] === 0 && needle.every((b, j) => bytes[i + j] === b)) {
            hits.push(i);
        }
    }
    return hits;
}

/** Read consecutive `{ char* name; int32 id }` entries starting at `offset`. */
function readNamesAt(img: PeImage, offset: number): Map<number, string> {
    const names = new Map<number, string>();
    for (let e = offset; e + 8 <= img.bytes.length; e += 8) {
        const name = img.stringAt(img.view.getUint32(e, true));
        if (!name?.startsWith(NAME_PREFIX)) {
            break;
        }
        names.set(img.int32(e + 4), name);
    }
    return names;
}

/** Find the name table and return id → name. */
function readNameTable(img: PeImage): Map<number, string> {
    for (const strOffset of findCString(img.bytes, NO_SOUND)) {
        const va = img.offsetToVa(strOffset);
        for (let o = 0; va !== null && o + 8 <= img.bytes.length; o += 4) {
            if (img.view.getUint32(o, true) === va && img.int32(o + 4) === 1) {
                const names = readNamesAt(img, o);
                if (names.size > 1) {
                    return names;
                }
            }
        }
    }
    throw new Error(`Sound name table not found (no reference to "${NO_SOUND}" with id 1)`);
}

/** True if a valid variant table with `n` entries starts at `o`. */
function isVariantTable(img: PeImage, o: number, n: number, maxSlots: number): boolean {
    let end = 0;
    for (let k = 0; k < n; k++) {
        const e = o + k * 12;
        if (e + 12 > img.bytes.length) {
            return false;
        }
        const count = img.int32(e);
        if (count < 0 || count > 64 || img.int32(e + 4) !== 0 || img.int32(e + 8) !== end + count) {
            return false;
        }
        end += count;
    }
    return end <= maxSlots;
}

/**
 * Extract the sound id → slot mapping.
 * @param maxSlots Number of slots in the matching .sil file (used to validate the table)
 */
export function readExeSoundTable(exe: Uint8Array, maxSlots: number): SoundSlots[] {
    const img = new PeImage(exe);
    const names = readNameTable(img);
    const n = Math.max(...names.keys());

    for (let o = 0; o + 12 <= exe.length; o += 4) {
        if (img.int32(o) !== 1 || img.int32(o + 4) !== 0 || img.int32(o + 8) !== 1) {
            continue;
        }
        if (!isVariantTable(img, o, n, maxSlots)) {
            continue;
        }
        const result: SoundSlots[] = [];
        for (let k = 0; k < n; k++) {
            const count = img.int32(o + k * 12);
            const end = img.int32(o + k * 12 + 8);
            const id = names.get(k + 1);
            if (id && id !== NO_SOUND && count > 0) {
                result.push({ id, numericId: k + 1, firstSlot: end - count, count });
            }
        }
        return result;
    }
    throw new Error(`Sound variant table not found (expected ${n} entries within ${maxSlots} slots)`);
}
