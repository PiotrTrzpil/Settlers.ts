/**
 * Maps source block coordinates to destination atlas block coordinates.
 * Populated during copyToTextureMap() and queried during getTextureA/B().
 *
 * Multiple texture objects can share the same source position (e.g. River1/2/3
 * or overlapping gradient rows). The first copyToTextureMap() call for a given
 * source position "claims" it; subsequent textures with the same source skip
 * the copy and share the atlas slot.
 */
export class AtlasLayout {
    private mapping = new Map<number, { destX: number; destY: number }>();

    private static key(srcX: number, srcY: number): number {
        return (srcX << 16) | (srcY & 0xFFFF);
    }

    /** Record a source→dest mapping. */
    public set(srcX: number, srcY: number, destX: number, destY: number): void {
        this.mapping.set(AtlasLayout.key(srcX, srcY), { destX, destY });
    }

    /** Check whether a source position already has an atlas mapping. */
    public has(srcX: number, srcY: number): boolean {
        return this.mapping.has(AtlasLayout.key(srcX, srcY));
    }

    /** Look up dest position for a source position. Returns (0,0) if unmapped. */
    public get(srcX: number, srcY: number): { destX: number; destY: number } {
        return this.mapping.get(AtlasLayout.key(srcX, srcY)) ?? { destX: 0, destY: 0 };
    }
}
