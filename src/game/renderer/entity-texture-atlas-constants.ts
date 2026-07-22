/** Fixed layer size — each layer is LAYER_SIZE × LAYER_SIZE pixels.
 *  4096×4096 = 32 MiB per layer at 2 bytes/pixel (R16UI). */
export const LAYER_SIZE = 4096;

/** Bytes per layer (R16UI). */
export const LAYER_BYTES = LAYER_SIZE * LAYER_SIZE * 2;

/**
 * Max layers per GPU TEXTURE_2D_ARRAY: 32 × 32 MiB = exactly 1 GiB.
 * ANGLE Metal rejects larger single allocations
 * ("Texture total allocation size is too large" / GL error 1282).
 */
export const MAX_LAYERS_PER_GPU_ARRAY = 32;

/** Max GPU arrays bound as multi-samplers. 4 × 32 = 128 layers. */
export const MAX_GPU_ARRAYS = 4;
