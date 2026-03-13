/**
 * Per-tile ore vein data — stores ore type and remaining level for every map tile.
 *
 * Layer 0 (pure data): flat typed arrays, same pattern as TerrainData.
 * Mountain tiles can hold ore levels 0-16 (0 = empty).
 */

import { OreType } from './ore-type';

export class OreVeinData {
    /** Ore type per tile (OreType enum value). */
    readonly oreType: Uint8Array;
    /** Ore level per tile (0 = empty, 1-16 = minable). */
    readonly oreLevel: Uint8Array;
    /** Prospected state per tile (0 = not prospected, 1 = prospected). */
    readonly prospected: Uint8Array;
    readonly mapWidth: number;
    readonly mapHeight: number;

    constructor(width: number, height: number) {
        const total = width * height;
        this.oreType = new Uint8Array(total);
        this.oreLevel = new Uint8Array(total);
        this.prospected = new Uint8Array(total);
        this.mapWidth = width;
        this.mapHeight = height;
    }

    private toIndex(x: number, y: number): number {
        return (x % this.mapWidth) + (y % this.mapHeight) * this.mapWidth;
    }

    getOreType(x: number, y: number): OreType {
        return this.oreType[this.toIndex(x, y)]! as OreType;
    }

    getOreLevel(x: number, y: number): number {
        return this.oreLevel[this.toIndex(x, y)]!;
    }

    setOre(x: number, y: number, type: OreType, level: number): void {
        const idx = this.toIndex(x, y);
        this.oreType[idx] = type;
        this.oreLevel[idx] = level;
    }

    isProspected(x: number, y: number): boolean {
        return this.prospected[this.toIndex(x, y)]! !== 0;
    }

    setProspected(x: number, y: number): void {
        this.prospected[this.toIndex(x, y)] = 1;
    }

    clearProspected(x: number, y: number): void {
        this.prospected[this.toIndex(x, y)] = 0;
    }

    /**
     * Check if any tile within a Chebyshev radius of (cx, cy) has
     * the required ore type with level > 0.
     */
    hasOreInRadius(cx: number, cy: number, radius: number, requiredType: OreType): boolean {
        const x0 = Math.max(0, cx - radius);
        const x1 = Math.min(this.mapWidth - 1, cx + radius);
        const y0 = Math.max(0, cy - radius);
        const y1 = Math.min(this.mapHeight - 1, cy + radius);

        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const idx = this.toIndex(x, y);
                if (this.oreType[idx] === requiredType && this.oreLevel[idx]! > 0) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Consume 1 ore level from a random tile (within Chebyshev radius)
     * that has the required ore type. Returns true if ore was consumed.
     * Uses the provided `pickIndex(count)` to select among candidates.
     */
    consumeOreInRadius(
        cx: number,
        cy: number,
        radius: number,
        requiredType: OreType,
        pickIndex: (count: number) => number
    ): boolean {
        const x0 = Math.max(0, cx - radius);
        const x1 = Math.min(this.mapWidth - 1, cx + radius);
        const y0 = Math.max(0, cy - radius);
        const y1 = Math.min(this.mapHeight - 1, cy + radius);

        // Collect all candidate tile indices
        const candidates: number[] = [];
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const idx = this.toIndex(x, y);
                if (this.oreType[idx] === requiredType && this.oreLevel[idx]! > 0) {
                    candidates.push(idx);
                }
            }
        }

        if (candidates.length === 0) {
            return false;
        }

        const idx = candidates[pickIndex(candidates.length)]!;
        this.oreLevel[idx] = this.oreLevel[idx]! - 1;
        return true;
    }

    /** Total remaining ore of a given type across the entire map. */
    getTotalOre(type: OreType): number {
        let total = 0;
        for (let i = 0; i < this.oreType.length; i++) {
            if (this.oreType[i] === type) {
                total += this.oreLevel[i]!;
            }
        }
        return total;
    }
}
