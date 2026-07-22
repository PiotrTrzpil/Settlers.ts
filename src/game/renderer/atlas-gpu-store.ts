/**
 * Multi-array GPU storage for the entity sprite atlas.
 *
 * ANGLE Metal rejects a single TEXTURE_2D_ARRAY allocation larger than ~1 GiB.
 * Each 4096² R16UI layer is 32 MiB, so one array may hold at most 32 layers.
 * This store splits layers across multiple TEXTURE_2D_ARRAY objects and binds
 * them to consecutive texture units for the multi-sampler fragment shaders.
 */

import { LogHandler } from '@/utilities/log-handler';
import { LAYER_SIZE, LAYER_BYTES, MAX_LAYERS_PER_GPU_ARRAY, MAX_GPU_ARRAYS } from './entity-texture-atlas-constants';

export { LAYER_SIZE, LAYER_BYTES, MAX_LAYERS_PER_GPU_ARRAY, MAX_GPU_ARRAYS };

/** Minimum layers allocated on first texImage3D for an array (reduces early reallocs). */
const MIN_GPU_CAPACITY = 8;

const log = new LogHandler('AtlasGpuStore');

export function gpuArrayIndexForLayer(layer: number, layersPerArray = MAX_LAYERS_PER_GPU_ARRAY): number {
    return Math.floor(layer / layersPerArray);
}

export function localLayerIndex(layer: number, layersPerArray = MAX_LAYERS_PER_GPU_ARRAY): number {
    return layer % layersPerArray;
}

export function requiredGpuArrayCount(layerCount: number, layersPerArray = MAX_LAYERS_PER_GPU_ARRAY): number {
    if (layerCount <= 0) {
        return 0;
    }
    return Math.ceil(layerCount / layersPerArray);
}

/**
 * Next capacity for one GPU array given how many of its local layers are used.
 * Doubles within the array; never exceeds maxPerArray (the 1 GiB Metal cap).
 */
export function nextGpuArrayCapacity(
    usedLayersInArray: number,
    currentCapacity: number,
    maxPerArray = MAX_LAYERS_PER_GPU_ARRAY,
    minCapacity = MIN_GPU_CAPACITY
): number {
    if (usedLayersInArray <= currentCapacity) {
        return currentCapacity;
    }
    const doubled = currentCapacity > 0 ? currentCapacity * 2 : minCapacity;
    return Math.min(Math.max(usedLayersInArray, doubled, minCapacity), maxPerArray);
}

/** Texture unit for atlas array `arrayIndex` (0-based). Arrays occupy base..base+MAX-1. */
export function atlasTextureUnit(baseUnit: number, arrayIndex: number): number {
    return baseUnit + arrayIndex;
}

interface DirtyRect {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/**
 * Owns WebGL TEXTURE_2D_ARRAY objects for atlas layers, split to stay under
 * the per-texture size limit. CPU layer data lives in EntityTextureAtlas.
 */
export class AtlasGpuStore {
    private readonly baseTextureUnit: number;
    private readonly layersPerArray: number;
    private readonly textures: (WebGLTexture | null)[] = [];
    private readonly capacities: number[] = [];
    /** 1×1×1 R16UI fallback bound to unused array units so samplers are complete. */
    private dummyTexture: WebGLTexture | null = null;
    private glContext: WebGL2RenderingContext | null = null;

    constructor(baseTextureUnit: number, layersPerArray = MAX_LAYERS_PER_GPU_ARRAY) {
        this.baseTextureUnit = baseTextureUnit;
        this.layersPerArray = layersPerArray;
    }

    public get maxLayersPerArray(): number {
        return this.layersPerArray;
    }

    public get maxArrays(): number {
        return MAX_GPU_ARRAYS;
    }

    /** Total GPU layer slots currently allocated (sum of per-array capacities). */
    public get totalCapacity(): number {
        let n = 0;
        for (const c of this.capacities) {
            n += c;
        }
        return n;
    }

    /** Capacity of a single GPU array (0 if not allocated). */
    public capacityOf(arrayIndex: number): number {
        // eslint-disable-next-line no-restricted-syntax -- sparse array: missing index means not allocated yet
        return this.capacities[arrayIndex] ?? 0;
    }

    /**
     * Ensure GPU arrays can hold `totalLayers` CPU layers.
     * Realloc marks the returned set of global layer indices as fully dirty (caller marks).
     * @returns global layer indices that must be re-uploaded after realloc
     */
    public ensureCapacity(gl: WebGL2RenderingContext, totalLayers: number): number[] {
        this.glContext = gl;
        const arraysNeeded = requiredGpuArrayCount(totalLayers, this.layersPerArray);
        if (arraysNeeded > MAX_GPU_ARRAYS) {
            throw new Error(
                `Atlas GPU full: need ${arraysNeeded} arrays for ${totalLayers} layers, max ${MAX_GPU_ARRAYS} ` +
                    `(${MAX_GPU_ARRAYS * this.layersPerArray} layers)`
            );
        }

        const invalidatedLayers: number[] = [];

        for (let a = 0; a < arraysNeeded; a++) {
            const usedInArray = Math.min(this.layersPerArray, totalLayers - a * this.layersPerArray);
            if (usedInArray <= 0) {
                continue;
            }

            // eslint-disable-next-line no-restricted-syntax -- sparse array: missing index means capacity 0
            const current = this.capacities[a] ?? 0;
            if (usedInArray <= current) {
                continue;
            }

            const newCap = nextGpuArrayCapacity(usedInArray, current, this.layersPerArray);
            this.reallocArray(gl, a, newCap);

            const base = a * this.layersPerArray;
            for (let local = 0; local < usedInArray; local++) {
                invalidatedLayers.push(base + local);
            }

            log.debug(
                `GPU array ${a} realloc: ${current} → ${newCap} layers ` +
                    `(${((newCap * LAYER_BYTES) / 1024 / 1024).toFixed(0)}MB)`
            );
        }

        return invalidatedLayers;
    }

    /**
     * Allocate capacities for a known total layer count (cache restore).
     * Same growth rules as ensureCapacity (min headroom, never past 1 GiB/array).
     */
    public allocateExact(gl: WebGL2RenderingContext, totalLayers: number): number[] {
        return this.ensureCapacity(gl, totalLayers);
    }

    /** Upload one layer's dirty region (global layer index). */
    public uploadDirtyLayer(
        gl: WebGL2RenderingContext,
        layerIndex: number,
        layerData: Uint16Array,
        dirty: DirtyRect
    ): void {
        const arrayIdx = gpuArrayIndexForLayer(layerIndex, this.layersPerArray);
        const local = localLayerIndex(layerIndex, this.layersPerArray);
        const tex = this.textures[arrayIdx];
        if (!tex) {
            throw new Error(`uploadDirtyLayer: GPU array ${arrayIdx} not allocated for layer ${layerIndex}`);
        }
        const capacity = this.capacityOf(arrayIdx);
        if (local >= capacity) {
            throw new Error(
                `uploadDirtyLayer: local layer ${local} outside capacity ${capacity} ` + `(global layer ${layerIndex})`
            );
        }

        gl.activeTexture(gl.TEXTURE0 + atlasTextureUnit(this.baseTextureUnit, arrayIdx));
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);

        const isFullLayer =
            dirty.minX === 0 && dirty.minY === 0 && dirty.maxX === LAYER_SIZE && dirty.maxY === LAYER_SIZE;

        if (isFullLayer) {
            gl.texSubImage3D(
                gl.TEXTURE_2D_ARRAY,
                0,
                0,
                0,
                local,
                LAYER_SIZE,
                LAYER_SIZE,
                1,
                gl.RED_INTEGER,
                gl.UNSIGNED_SHORT,
                layerData
            );
        } else {
            gl.pixelStorei(gl.UNPACK_ROW_LENGTH, LAYER_SIZE);
            gl.texSubImage3D(
                gl.TEXTURE_2D_ARRAY,
                0,
                dirty.minX,
                dirty.minY,
                local,
                dirty.maxX - dirty.minX,
                dirty.maxY - dirty.minY,
                1,
                gl.RED_INTEGER,
                gl.UNSIGNED_SHORT,
                layerData,
                dirty.minY * LAYER_SIZE + dirty.minX
            );
            gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
        }
    }

    /**
     * Bind all atlas arrays for rendering. Unused units get a dummy 1×1×1 texture
     * so multi-sampler shaders always see complete textures.
     */
    public bindForRendering(gl: WebGL2RenderingContext): void {
        this.ensureDummy(gl);
        for (let a = 0; a < MAX_GPU_ARRAYS; a++) {
            const unit = atlasTextureUnit(this.baseTextureUnit, a);
            gl.activeTexture(gl.TEXTURE0 + unit);
            const tex = this.textures[a] ?? this.dummyTexture;
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
        }
    }

    public free(): void {
        const gl = this.glContext;
        if (!gl) {
            return;
        }
        for (let i = 0; i < this.textures.length; i++) {
            const t = this.textures[i];
            if (t) {
                gl.deleteTexture(t);
                this.textures[i] = null;
            }
        }
        this.textures.length = 0;
        this.capacities.length = 0;
        if (this.dummyTexture) {
            gl.deleteTexture(this.dummyTexture);
            this.dummyTexture = null;
        }
    }

    /** Reset capacity tracking (CPU restore from cache — GPU reallocated on next upload). */
    public resetCapacities(): void {
        const gl = this.glContext;
        if (gl) {
            for (let i = 0; i < this.textures.length; i++) {
                const t = this.textures[i];
                if (t) {
                    gl.deleteTexture(t);
                }
            }
        }
        this.textures.length = 0;
        this.capacities.length = 0;
    }

    private reallocArray(gl: WebGL2RenderingContext, arrayIndex: number, capacity: number): void {
        if (capacity > this.layersPerArray) {
            throw new Error(
                `reallocArray: capacity ${capacity} exceeds max ${this.layersPerArray} layers per array (1 GiB limit)`
            );
        }

        let tex = this.textures[arrayIndex];
        if (!tex) {
            tex = gl.createTexture();
            this.textures[arrayIndex] = tex;
        }

        gl.activeTexture(gl.TEXTURE0 + atlasTextureUnit(this.baseTextureUnit, arrayIndex));
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);

        // Params must be set before/after storage for completeness
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        gl.getError(); // clear sticky errors before alloc
        gl.texImage3D(
            gl.TEXTURE_2D_ARRAY,
            0,
            gl.R16UI,
            LAYER_SIZE,
            LAYER_SIZE,
            capacity,
            0,
            gl.RED_INTEGER,
            gl.UNSIGNED_SHORT,
            null
        );

        const err = gl.getError();
        if (err !== gl.NO_ERROR) {
            // Do not update capacity — storage is invalid
            throw new Error(
                `texImage3D failed for atlas array ${arrayIndex}: capacity=${capacity} layers ` +
                    `(${((capacity * LAYER_BYTES) / 1024 / 1024).toFixed(0)}MB), glError=${err}. ` +
                    `ANGLE Metal limit is ~1 GiB per TEXTURE_2D_ARRAY.`
            );
        }

        this.capacities[arrayIndex] = capacity;
    }

    private ensureDummy(gl: WebGL2RenderingContext): void {
        if (this.dummyTexture) {
            return;
        }
        this.dummyTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.dummyTexture);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R16UI, 1, 1, 1, 0, gl.RED_INTEGER, gl.UNSIGNED_SHORT, null);
    }
}
