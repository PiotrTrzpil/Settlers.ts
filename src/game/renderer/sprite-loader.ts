/**
 * Unified sprite loading service for all entity types.
 * Handles GFX file loading, sprite extraction, and atlas packing.
 * Uses Web Workers for off-main-thread sprite decoding.
 */

import { LogHandler } from '@/utilities/log-handler';
import { FileManager } from '@/utilities/file-manager';
import { GfxFileReader } from '@/resources/gfx/gfx-file-reader';
import { GilFileReader } from '@/resources/gfx/gil-file-reader';
import { JilFileReader } from '@/resources/gfx/jil-file-reader';
import { DilFileReader } from '@/resources/gfx/dil-file-reader';
import { PilFileReader } from '@/resources/gfx/pil-file-reader';
import { PaletteCollection } from '@/resources/gfx/palette-collection';
import { GfxImage } from '@/resources/gfx/gfx-image';
import { EntityTextureAtlas, AtlasRegion } from './entity-texture-atlas';
import { SpriteEntry, PIXELS_TO_WORLD } from './sprite-metadata';
import { getDecoderPool } from './sprite-decoder-pool';

/**
 * Loaded GFX file set with all readers initialized.
 */
export interface LoadedGfxFileSet {
    fileId: string;
    gfxReader: GfxFileReader;
    gilReader: GilFileReader;
    jilReader: JilFileReader | null;
    dilReader: DilFileReader | null;
    paletteCollection: PaletteCollection;
}

/**
 * Result of loading a sprite into the atlas.
 */
export interface LoadedSprite {
    image: GfxImage;
    region: AtlasRegion;
    entry: SpriteEntry;
}

/**
 * Configuration for loading sprites from a JIL job.
 */
export interface JobSpriteConfig {
    jobIndex: number;
    /** Direction index. Default: 1 (completed building). D0 = construction, D1 = completed. */
    directionIndex?: number;
    frameIndex?: number; // Default: 0 (first frame)
}

/**
 * Result of loading an animation (multiple frames).
 */
export interface LoadedAnimation {
    frames: LoadedSprite[];
    frameCount: number;
}

/**
 * Unified sprite loader service.
 * Provides methods for loading sprites from GFX files into texture atlases.
 */
/**
 * Module-level cache for parsed file sets.
 * Persists across Vue HMR to avoid re-parsing files on code changes.
 */
const globalFileSetCache = new Map<string, LoadedGfxFileSet>();

export class SpriteLoader {
    private static log = new LogHandler('SpriteLoader');

    private fileManager: FileManager;

    constructor(fileManager: FileManager) {
        this.fileManager = fileManager;
    }

    /**
     * Load and cache a GFX file set.
     * Uses module-level cache that persists across HMR.
     * Returns null if files are not available.
     */
    public async loadFileSet(fileId: string): Promise<LoadedGfxFileSet | null> {
        // Return cached file set if available (module-level cache persists across HMR)
        if (globalFileSetCache.has(fileId)) {
            return globalFileSetCache.get(fileId)!;
        }

        // Check for .pil or .pi4 palette index format
        const pilFileExists = this.fileManager.findFile(fileId + '.pil', false);
        const paletteIndexExt = pilFileExists ? '.pil' : '.pi4';
        const paletteExt = pilFileExists ? '.pa6' : '.p46';

        // Load all required files
        const files = await this.fileManager.readFiles({
            gfx: `${fileId}.gfx`,
            gil: `${fileId}.gil`,
            jil: `${fileId}.jil`,
            dil: `${fileId}.dil`,
            palette: `${fileId}${paletteExt}`,
            paletteIndex: `${fileId}${paletteIndexExt}`,
        }, true);

        // Check minimum required files
        if (!files.gfx?.length || !files.gil?.length || !files.palette?.length || !files.paletteIndex?.length) {
            SpriteLoader.log.debug(`GFX file set ${fileId} not available`);
            return null;
        }

        // Build readers - these parse binary files synchronously on main thread
        const parseStart = performance.now();

        const gilReader = new GilFileReader(files.gil);
        const pilReader = new PilFileReader(files.paletteIndex);
        const paletteCollection = new PaletteCollection(files.palette, pilReader);

        // JIL/DIL are optional (for direct GIL access vs job-based access)
        const jilReader = files.jil?.length ? new JilFileReader(files.jil) : null;
        const dilReader = files.dil?.length ? new DilFileReader(files.dil) : null;

        const gfxReader = new GfxFileReader(
            files.gfx,
            gilReader,
            jilReader,
            dilReader,
            paletteCollection
        );

        const parseTime = performance.now() - parseStart;
        if (parseTime > 50) {
            console.warn(`[SpriteLoader] parseFileSet(${fileId}) took ${parseTime.toFixed(1)}ms (gil=${gilReader.length} images)`);
        }

        const fileSet: LoadedGfxFileSet = {
            fileId,
            gfxReader,
            gilReader,
            jilReader,
            dilReader,
            paletteCollection,
        };

        globalFileSetCache.set(fileId, fileSet);
        return fileSet;
    }

    /**
     * Load a sprite by JIL job index and pack it into the atlas.
     * Decodes off main thread using worker pool.
     *
     * @param paletteBaseOffset Base offset for this file's palette in the combined texture
     */
    public async loadJobSprite(
        fileSet: LoadedGfxFileSet,
        config: JobSpriteConfig,
        atlas: EntityTextureAtlas,
        paletteBaseOffset: number
    ): Promise<LoadedSprite | null> {
        const gfxImage = this.getJobImage(fileSet, config);
        if (!gfxImage) return null;
        return this.packSpriteIntoAtlas(gfxImage, atlas, paletteBaseOffset);
    }

    /**
     * Get a GFX image by job index without decoding.
     * Shared helper for sync and async loading.
     */
    private getJobImage(
        fileSet: LoadedGfxFileSet,
        config: JobSpriteConfig
    ): GfxImage | null {
        const start = performance.now();
        const { jobIndex, directionIndex = 1, frameIndex = 0 } = config;

        if (!fileSet.jilReader || !fileSet.dilReader) {
            SpriteLoader.log.debug(`JIL/DIL not available for file ${fileSet.fileId}`);
            return null;
        }

        // Navigate: job -> direction -> frame
        // Use getItem(jobIndex) directly to access the correct job, not indexed array
        const totalJobs = fileSet.jilReader.length;
        const jobItem = fileSet.jilReader.getItem(jobIndex);
        if (!jobItem) {
            SpriteLoader.log.debug(`Job index ${jobIndex} not found in file ${fileSet.fileId} (total jobs: ${totalJobs})`);
            return null;
        }
        // Note: removed verbose per-job loading log - too noisy during normal operation
        const dirItems = fileSet.dilReader.getItems(jobItem.offset, jobItem.length);
        if (directionIndex >= dirItems.length) {
            SpriteLoader.log.debug(`Direction ${directionIndex} out of range for job ${jobIndex}`);
            return null;
        }

        const dirItem = dirItems[directionIndex];
        const frameItems = fileSet.gilReader.getItems(dirItem.offset, dirItem.length);
        if (frameIndex >= frameItems.length) {
            SpriteLoader.log.debug(`Frame ${frameIndex} out of range for job ${jobIndex} direction ${directionIndex}`);
            return null;
        }

        // Get the GFX image
        const frameItem = frameItems[frameIndex];
        const gfxOffset = fileSet.gilReader.getImageOffset(frameItem.index);
        const gfxImage = fileSet.gfxReader.readImage(gfxOffset, jobIndex);

        if (!gfxImage) {
            SpriteLoader.log.debug(`Failed to read image for job ${jobIndex} in file ${fileSet.fileId}`);
            return null;
        }

        const elapsed = performance.now() - start;
        if (elapsed > SpriteLoader.SLOW_OP_THRESHOLD_MS) {
            console.warn(`[SpriteLoader] getJobImage(${fileSet.fileId}, job=${jobIndex}) took ${elapsed.toFixed(1)}ms`);
        }

        return gfxImage;
    }

    /**
     * Load a sprite by direct GIL index and pack it into the atlas.
     * Decodes off main thread using worker pool.
     *
     * @param paletteBaseOffset Base offset for this file's palette in the combined texture
     */
    public async loadDirectSprite(
        fileSet: LoadedGfxFileSet,
        gilIndex: number,
        paletteIndex: number | null,
        atlas: EntityTextureAtlas,
        paletteBaseOffset: number
    ): Promise<LoadedSprite | null> {
        let gfxImage: GfxImage | null;

        if (paletteIndex !== null) {
            gfxImage = this.getDirectImage(fileSet, gilIndex, paletteIndex);
        } else {
            gfxImage = fileSet.gfxReader.getImage(gilIndex);
        }

        if (!gfxImage) return null;
        return this.packSpriteIntoAtlas(gfxImage, atlas, paletteBaseOffset);
    }

    /**
     * Get a GFX image by direct GIL index without decoding.
     */
    private getDirectImage(
        fileSet: LoadedGfxFileSet,
        gilIndex: number,
        paletteIndex: number
    ): GfxImage | null {
        const gfxOffset = fileSet.gilReader.getImageOffset(gilIndex);
        const gfxImage = fileSet.gfxReader.readImage(gfxOffset, paletteIndex);

        if (!gfxImage) {
            SpriteLoader.log.debug(`Failed to read image at GIL index ${gilIndex}`);
            return null;
        }

        return gfxImage;
    }

    /** Threshold for logging slow main-thread operations (ms) */
    private static readonly SLOW_OP_THRESHOLD_MS = 2;

    /**
     * Trim amounts for sprites (removes artifact lines from original game assets).
     * Top row often has stray pixels, bottom rows contain alignment artifacts.
     */
    private static readonly TRIM_TOP = 1;
    private static readonly TRIM_BOTTOM = 5;

    /**
     * Trim palette index rows by skipping top/bottom.
     * Returns a Uint16Array with only the retained rows.
     */
    private trimIndices(indices: Uint16Array, width: number, height: number, trimTop: number, trimBottom: number): Uint16Array {
        const newHeight = height - trimTop - trimBottom;
        if (newHeight <= 0 || newHeight === height) return indices;

        const trimmed = new Uint16Array(width * newHeight);
        for (let y = 0; y < newHeight; y++) {
            const srcOffset = (y + trimTop) * width;
            const dstOffset = y * width;
            trimmed.set(indices.subarray(srcOffset, srcOffset + width), dstOffset);
        }
        return trimmed;
    }

    /**
     * Pack a GFX image into the atlas and create a SpriteEntry.
     * Synchronous fallback using indexed decoding — used only when workers unavailable.
     */
    private packSpriteIntoAtlasFallback(
        gfxImage: GfxImage, atlas: EntityTextureAtlas, paletteBaseOffset: number
    ): LoadedSprite | null {
        const trimmedHeight = gfxImage.height - SpriteLoader.TRIM_TOP - SpriteLoader.TRIM_BOTTOM;
        if (trimmedHeight <= 0) {
            SpriteLoader.log.debug(`Sprite too small after trimming: ${gfxImage.width}x${gfxImage.height}`);
            return null;
        }

        const region = atlas.reserve(gfxImage.width, trimmedHeight);
        if (!region) {
            SpriteLoader.log.error(`Atlas full, cannot fit sprite ${gfxImage.width}x${trimmedHeight}`);
            return null;
        }

        const rawIndices = gfxImage.getIndexData(paletteBaseOffset);
        const trimmedIndices = this.trimIndices(
            rawIndices, gfxImage.width, gfxImage.height,
            SpriteLoader.TRIM_TOP, SpriteLoader.TRIM_BOTTOM
        );

        atlas.blitIndices(region, trimmedIndices);

        const entry: SpriteEntry = {
            atlasRegion: region,
            offsetX: -gfxImage.left * PIXELS_TO_WORLD,
            offsetY: -(gfxImage.top - SpriteLoader.TRIM_TOP) * PIXELS_TO_WORLD,
            widthWorld: gfxImage.width * PIXELS_TO_WORLD,
            heightWorld: trimmedHeight * PIXELS_TO_WORLD,
        };

        return { image: gfxImage, region, entry };
    }

    /**
     * Pack a GFX image into the atlas asynchronously using worker pool.
     * Uses indexed decoding: outputs palette indices (Uint16Array) and blits into R16UI atlas.
     *
     * @param paletteBaseOffset Base offset for this file's palette in the combined texture
     */
    private async packSpriteIntoAtlas(
        gfxImage: GfxImage, atlas: EntityTextureAtlas, paletteBaseOffset: number
    ): Promise<LoadedSprite | null> {
        const pool = getDecoderPool();

        if (!pool.isAvailable) {
            return this.packSpriteIntoAtlasFallback(gfxImage, atlas, paletteBaseOffset);
        }

        const params = gfxImage.getDecodeParams();

        const trimmedWidth = params.width;
        const trimmedHeight = params.height - SpriteLoader.TRIM_TOP - SpriteLoader.TRIM_BOTTOM;

        if (trimmedHeight <= 0) {
            SpriteLoader.log.debug(`Sprite too small after trimming: ${params.width}x${params.height}`);
            return null;
        }

        const region = atlas.reserve(trimmedWidth, trimmedHeight);

        if (!region) {
            SpriteLoader.log.error(`Atlas full, cannot fit sprite ${trimmedWidth}x${trimmedHeight}`);
            return null;
        }

        try {
            const indices = await pool.decodeIndexed(
                params.buffer,
                params.offset,
                params.width,
                params.height,
                params.imgType,
                params.paletteOffset,
                paletteBaseOffset,
                SpriteLoader.TRIM_TOP,
                SpriteLoader.TRIM_BOTTOM
            );

            atlas.blitIndices(region, indices);

            const entry: SpriteEntry = {
                atlasRegion: region,
                offsetX: -gfxImage.left * PIXELS_TO_WORLD,
                offsetY: -(gfxImage.top - SpriteLoader.TRIM_TOP) * PIXELS_TO_WORLD,
                widthWorld: trimmedWidth * PIXELS_TO_WORLD,
                heightWorld: trimmedHeight * PIXELS_TO_WORLD,
            };

            return { image: gfxImage, region, entry };
        } catch (e) {
            SpriteLoader.log.debug(`Worker decode failed, falling back to sync: ${e}`);
            return this.packSpriteIntoAtlasFallback(gfxImage, atlas, paletteBaseOffset);
        }
    }

    /**
     * Get the number of frames for a job/direction combination.
     */
    public getFrameCount(
        fileSet: LoadedGfxFileSet,
        jobIndex: number,
        directionIndex: number
    ): number {
        if (!fileSet.jilReader || !fileSet.dilReader) {
            return 0;
        }

        // Use getItem(jobIndex) directly to access the correct job
        const jobItem = fileSet.jilReader.getItem(jobIndex);
        if (!jobItem) {
            return 0;
        }
        const dirItems = fileSet.dilReader.getItems(jobItem.offset, jobItem.length);
        if (directionIndex >= dirItems.length) {
            return 0;
        }

        const dirItem = dirItems[directionIndex];
        return dirItem.length;
    }

    /**
     * Load all frames for a job/direction as an animation.
     * Decodes frames off main thread using worker pool.
     *
     * @param paletteBaseOffset Base offset for this file's palette in the combined texture
     */
    public async loadJobAnimation(
        fileSet: LoadedGfxFileSet,
        jobIndex: number,
        directionIndex: number,
        atlas: EntityTextureAtlas,
        paletteBaseOffset: number
    ): Promise<LoadedAnimation | null> {
        if (!fileSet.jilReader || !fileSet.dilReader) {
            SpriteLoader.log.debug(`JIL/DIL not available for file ${fileSet.fileId}`);
            return null;
        }

        const jobItem = fileSet.jilReader.getItem(jobIndex);
        if (!jobItem) {
            SpriteLoader.log.debug(`Job index ${jobIndex} not found in file ${fileSet.fileId}`);
            return null;
        }

        const dirItems = fileSet.dilReader.getItems(jobItem.offset, jobItem.length);
        if (directionIndex >= dirItems.length) {
            SpriteLoader.log.debug(`Direction ${directionIndex} out of range for job ${jobIndex}`);
            return null;
        }

        const dirItem = dirItems[directionIndex];
        const frameItems = fileSet.gilReader.getItems(dirItem.offset, dirItem.length);

        if (frameItems.length === 0) {
            SpriteLoader.log.debug(`No frames for job ${jobIndex} direction ${directionIndex}`);
            return null;
        }

        // Collect all frame images first
        const frameImages: GfxImage[] = [];
        for (let i = 0; i < frameItems.length; i++) {
            const frameItem = frameItems[i];
            const gfxOffset = fileSet.gilReader.getImageOffset(frameItem.index);
            const gfxImage = fileSet.gfxReader.readImage(gfxOffset, jobIndex);

            if (gfxImage) {
                frameImages.push(gfxImage);
            }
        }

        if (frameImages.length === 0) {
            return null;
        }

        // Decode all frames in parallel using worker pool
        const framePromises = frameImages.map(img => this.packSpriteIntoAtlas(img, atlas, paletteBaseOffset));
        const results = await Promise.all(framePromises);

        const frames: LoadedSprite[] = results.filter((r): r is LoadedSprite => r !== null);

        if (frames.length === 0) {
            return null;
        }

        return {
            frames,
            frameCount: frames.length,
        };
    }

    /**
     * Get the number of directions for a job.
     * Returns 0 if job doesn't exist or JIL/DIL not available.
     */
    public getDirectionCount(fileSet: LoadedGfxFileSet, jobIndex: number): number {
        if (!fileSet.jilReader || !fileSet.dilReader) return 0;

        const jobItem = fileSet.jilReader.getItem(jobIndex);
        if (!jobItem) return 0;

        const dirItems = fileSet.dilReader.getItems(jobItem.offset, jobItem.length);
        return dirItems.length;
    }

    /**
     * Load all directions for a job, each with all its animation frames.
     * Returns a Map of direction index -> array of sprite entries.
     *
     * @param paletteBaseOffset Base offset for this file's palette in the combined texture
     */
    public async loadJobAllDirections(
        fileSet: LoadedGfxFileSet,
        jobIndex: number,
        atlas: EntityTextureAtlas,
        paletteBaseOffset: number
    ): Promise<Map<number, LoadedSprite[]> | null> {
        const directionCount = this.getDirectionCount(fileSet, jobIndex);
        if (directionCount === 0) return null;

        const result = new Map<number, LoadedSprite[]>();

        for (let dir = 0; dir < directionCount; dir++) {
            const animation = await this.loadJobAnimation(fileSet, jobIndex, dir, atlas, paletteBaseOffset);
            if (animation && animation.frames.length > 0) {
                result.set(dir, animation.frames);
            }
        }

        return result.size > 0 ? result : null;
    }

    /**
     * Get the number of jobs in a file set.
     * Uses jilReader.length directly to get total count including null entries.
     */
    public getJobCount(fileSet: LoadedGfxFileSet): number {
        if (!fileSet.jilReader) return 0;
        return fileSet.jilReader.length;
    }

    /**
     * Get the number of images in a file set (direct GIL access).
     */
    public getImageCount(fileSet: LoadedGfxFileSet): number {
        return fileSet.gilReader.length;
    }

    /**
     * Clear cached file sets to free memory.
     */
    public clearCache(): void {
        globalFileSetCache.clear();
    }

    /**
     * Clear a specific file set from cache.
     */
    public clearFileSet(fileId: string): void {
        globalFileSetCache.delete(fileId);
    }
}

/**
 * Common GFX file numbers for Settlers 4.
 */
export const GFX_FILES = {
    /** Roman building/unit sprites */
    ROMAN: 10,
    /** Viking building/unit sprites */
    VIKING: 11,
    /** Mayan building/unit sprites */
    MAYAN: 12,
    /** Trojan building/unit sprites */
    TROJAN: 13,
    /** Dark Tribe building/unit sprites */
    DARK_TRIBE: 14,
    /** Landscape textures */
    LANDSCAPE: 2,
    /** Map objects (trees, stones, resources) - typically file 5 */
    MAP_OBJECTS: 5,
} as const;
