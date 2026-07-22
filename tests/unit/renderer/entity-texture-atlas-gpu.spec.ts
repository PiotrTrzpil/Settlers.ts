/**
 * Pure unit tests for EntityTextureAtlas GPU array sizing.
 * ANGLE Metal rejects a single TEXTURE_2D_ARRAY larger than ~1 GiB
 * (32 × 4096×4096 R16UI layers). Uploads must split across arrays.
 */
import { describe, it, expect } from 'vitest';
import {
    LAYER_SIZE,
    LAYER_BYTES,
    MAX_LAYERS_PER_GPU_ARRAY,
    MAX_GPU_ARRAYS,
    gpuArrayIndexForLayer,
    localLayerIndex,
    requiredGpuArrayCount,
    nextGpuArrayCapacity,
} from '@/game/renderer/entity-texture-atlas';

describe('EntityTextureAtlas GPU array layout', () => {
    it('caps each GPU array at 1 GiB (32 layers of 4096² R16UI)', () => {
        expect(LAYER_SIZE).toBe(4096);
        expect(LAYER_BYTES).toBe(4096 * 4096 * 2);
        expect(MAX_LAYERS_PER_GPU_ARRAY).toBe(32);
        expect(MAX_LAYERS_PER_GPU_ARRAY * LAYER_BYTES).toBe(1024 * 1024 * 1024);
        // Enough arrays for multi-race atlas (~43 layers) with headroom
        expect(MAX_GPU_ARRAYS * MAX_LAYERS_PER_GPU_ARRAY).toBeGreaterThanOrEqual(64);
    });

    it('maps global layers to array index and local layer', () => {
        expect(gpuArrayIndexForLayer(0)).toBe(0);
        expect(localLayerIndex(0)).toBe(0);
        expect(gpuArrayIndexForLayer(31)).toBe(0);
        expect(localLayerIndex(31)).toBe(31);
        expect(gpuArrayIndexForLayer(32)).toBe(1);
        expect(localLayerIndex(32)).toBe(0);
        expect(gpuArrayIndexForLayer(42)).toBe(1);
        expect(localLayerIndex(42)).toBe(10);
        expect(gpuArrayIndexForLayer(64)).toBe(2);
    });

    it('requires a second GPU array once layer count exceeds 32', () => {
        expect(requiredGpuArrayCount(1)).toBe(1);
        expect(requiredGpuArrayCount(32)).toBe(1);
        expect(requiredGpuArrayCount(33)).toBe(2);
        expect(requiredGpuArrayCount(43)).toBe(2);
        expect(requiredGpuArrayCount(64)).toBe(2);
        expect(requiredGpuArrayCount(65)).toBe(3);
    });

    it('grows capacity by doubling within one array, never past max per array', () => {
        // First allocation: at least MIN (8), not past max
        expect(nextGpuArrayCapacity(1, 0)).toBe(8);
        expect(nextGpuArrayCapacity(5, 0)).toBe(8);
        expect(nextGpuArrayCapacity(9, 8)).toBe(16);
        expect(nextGpuArrayCapacity(17, 16)).toBe(32);
        // Must not jump to 64 (2 GiB) — that is the Metal failure mode
        expect(nextGpuArrayCapacity(33, 32)).toBe(32);
        // Exact fit near the cap
        expect(nextGpuArrayCapacity(32, 16)).toBe(32);
        // used=11, empty array → max(11, MIN=8)=11
        expect(nextGpuArrayCapacity(11, 0)).toBe(11);
    });

    it('never proposes a single-array capacity that exceeds the 1 GiB Metal limit', () => {
        // Simulate growth for a 43-layer atlas (the live multi-race size)
        let cap0 = 0;
        for (let used = 1; used <= 32; used++) {
            cap0 = nextGpuArrayCapacity(used, cap0);
            expect(cap0).toBeLessThanOrEqual(MAX_LAYERS_PER_GPU_ARRAY);
            expect(cap0 * LAYER_BYTES).toBeLessThanOrEqual(1024 * 1024 * 1024);
        }
        // Layers 33–43 live in array 1
        let cap1 = 0;
        for (let used = 1; used <= 11; used++) {
            cap1 = nextGpuArrayCapacity(used, cap1);
            expect(cap1).toBeLessThanOrEqual(MAX_LAYERS_PER_GPU_ARRAY);
        }
        expect(requiredGpuArrayCount(43)).toBe(2);
    });
});
