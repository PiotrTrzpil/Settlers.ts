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
import { parseIndexFilesInWorker } from '@/resources/gfx/parse-index-files';
import { GfxImage } from '@/resources/gfx/gfx-image';
import { EntityTextureAtlas, AtlasRegion } from './entity-texture-atlas';
import { SpriteEntry, PIXELS_TO_WORLD } from './sprite-metadata';
import { getDecoderPool } from './sprite-decoder-pool';
import type { BatchSpriteDescriptor, BatchSpriteResult } from './sprite-batch-decode-worker';

/**
 * Trim configuration for sprite loading.
 * Specifies how many pixel rows to remove from top and bottom of sprites.
 */
export interface SpriteTrim {
    top: number;
    bottom: number;
}

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
    image: GfxImage | null;
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
    // eslint-disable-next-line complexity -- file loading handles multiple format variations
    public async loadFileSet(fileId: string): Promise<LoadedGfxFileSet | null> {
        // Return cached file set if available (module-level cache persists across HMR)
        if (globalFileSetCache.has(fileId)) {
            return globalFileSetCache.get(fileId)!; // OK: has() check above guarantees entry exists
        }

        // Check for .pil or .pi4 palette index format
        const pilFileExists = this.fileManager.findFile(fileId + '.pil', false);
        const paletteIndexExt = pilFileExists ? '.pil' : '.pi4';
        const paletteExt = pilFileExists ? '.pa6' : '.p46';

        // Load all required files
        const files = await this.fileManager.readFiles(
            {
                gfx: `${fileId}.gfx`,
                gil: `${fileId}.gil`,
                jil: `${fileId}.jil`,
                dil: `${fileId}.dil`,
                palette: `${fileId}${paletteExt}`,
                paletteIndex: `${fileId}${paletteIndexExt}`,
            },
            true
        );

        // Check minimum required files
        if (
            !files['gfx']?.length ||
            !files['gil']?.length ||
            !files['palette']?.length ||
            !files['paletteIndex']?.length
        ) {
            SpriteLoader.log.debug(`GFX file set ${fileId} not available`);
            return null;
        }

        // Parse index files off main thread via worker
        const parseStart = performance.now();

        const parsed = await parseIndexFilesInWorker({
            gil: files['gil'],
            pil: files['paletteIndex'],
            jil: files['jil']?.length ? files['jil'] : null,
            dil: files['dil']?.length ? files['dil'] : null,
        });

        const gilReader = new GilFileReader(parsed.gil);
        const pilReader = new PilFileReader(parsed.pil);
        const paletteCollection = new PaletteCollection(files['palette'], pilReader);

        const jilReader = parsed.jil ? new JilFileReader(parsed.jil) : null;
        const dilReader = parsed.dil ? new DilFileReader(parsed.dil) : null;

        const gfxReader = new GfxFileReader(files['gfx'], gilReader, jilReader, dilReader, paletteCollection);

        const parseTime = performance.now() - parseStart;
        if (parseTime > 50) {
            SpriteLoader.log.debug(
                `parseFileSet(${fileId}) took ${parseTime.toFixed(1)}ms (includes worker round-trip)`
            );
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
    private getJobImage(fileSet: LoadedGfxFileSet, config: JobSpriteConfig): GfxImage | null {
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
            SpriteLoader.log.debug(
                `Job index ${jobIndex} not found in file ${fileSet.fileId} (total jobs: ${totalJobs})`
            );
            return null;
        }
        // Note: removed verbose per-job loading log - too noisy during normal operation
        const dirItems = fileSet.dilReader.getItems(jobItem.offset, jobItem.length);
        if (directionIndex >= dirItems.length) {
            SpriteLoader.log.debug(`Direction ${directionIndex} out of range for job ${jobIndex}`);
            return null;
        }

        const dirItem = dirItems[directionIndex]!;
        const frameItems = fileSet.gilReader.getItems(dirItem.offset, dirItem.length);
        if (frameIndex >= frameItems.length) {
            SpriteLoader.log.debug(`Frame ${frameIndex} out of range for job ${jobIndex} direction ${directionIndex}`);
            return null;
        }

        // Get the GFX image
        const frameItem = frameItems[frameIndex]!;
        const gfxOffset = fileSet.gilReader.getImageOffset(frameItem.index);
        const gfxImage = fileSet.gfxReader.readImage(gfxOffset, jobIndex);

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- readImage may return null at GFX file boundary
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
        paletteBaseOffset: number,
        trimOverride?: SpriteTrim
    ): Promise<LoadedSprite | null> {
        let gfxImage: GfxImage | null;

        if (paletteIndex !== null) {
            gfxImage = this.getDirectImage(fileSet, gilIndex, paletteIndex);
        } else {
            gfxImage = fileSet.gfxReader.getImage(gilIndex);
        }

        if (!gfxImage) return null;
        return this.packSpriteIntoAtlas(gfxImage, atlas, paletteBaseOffset, trimOverride);
    }

    /**
     * Get a GFX image by direct GIL index without decoding.
     */
    private getDirectImage(fileSet: LoadedGfxFileSet, gilIndex: number, paletteIndex: number): GfxImage | null {
        const gfxOffset = fileSet.gilReader.getImageOffset(gilIndex);
        const gfxImage = fileSet.gfxReader.readImage(gfxOffset, paletteIndex);

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- readImage may return null at GFX file boundary
        if (!gfxImage) {
            SpriteLoader.log.debug(`Failed to read image at GIL index ${gilIndex}`);
            return null;
        }

        return gfxImage;
    }

    /** Threshold for logging slow main-thread operations (ms) */
    private static readonly SLOW_OP_THRESHOLD_MS = 2;

    /**
     * Default trim for all sprites (removes artifact lines from original game assets).
     * Top rows often have stray pixels, bottom rows contain alignment artifacts.
     */
    private static readonly DEFAULT_TRIM: SpriteTrim = { top: 5, bottom: 3 };

    /**
     * Trim palette index rows by skipping top/bottom.
     * Returns a Uint16Array with only the retained rows.
     */
    private trimIndices(
        indices: Uint16Array,
        width: number,
        height: number,
        trimTop: number,
        trimBottom: number
    ): Uint16Array {
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
        gfxImage: GfxImage,
        atlas: EntityTextureAtlas,
        paletteBaseOffset: number,
        trimOverride?: SpriteTrim
    ): LoadedSprite | null {
        const trim = trimOverride ?? SpriteLoader.DEFAULT_TRIM;
        const trimmedHeight = gfxImage.height - trim.top - trim.bottom;
        if (trimmedHeight <= 0) {
            SpriteLoader.log.debug(`Sprite too small after trimming: ${gfxImage.width}x${gfxImage.height}`);
            return null;
        }

        const region = atlas.reserve(gfxImage.width, trimmedHeight);
        if (!region) {
            SpriteLoader.log.error(`Atlas full, cannot fit sprite ${gfxImage.width}x${trimmedHeight}`);
            return null;
        }

        const rawIndices = gfxImage.getIndexData();
        const trimmedIndices = this.trimIndices(rawIndices, gfxImage.width, gfxImage.height, trim.top, trim.bottom);

        atlas.blitIndices(region, trimmedIndices);

        // Include per-sprite paletteOffset in the base so the shader
        // can reconstruct the full palette index without Uint16 overflow
        const entry: SpriteEntry = {
            atlasRegion: region,
            offsetX: -gfxImage.left * PIXELS_TO_WORLD,
            offsetY: -(gfxImage.top - trim.top) * PIXELS_TO_WORLD,
            widthWorld: gfxImage.width * PIXELS_TO_WORLD,
            heightWorld: trimmedHeight * PIXELS_TO_WORLD,
            paletteBaseOffset: paletteBaseOffset + gfxImage.paletteOffset,
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
        gfxImage: GfxImage,
        atlas: EntityTextureAtlas,
        paletteBaseOffset: number,
        trimOverride?: SpriteTrim
    ): Promise<LoadedSprite | null> {
        const trim = trimOverride ?? SpriteLoader.DEFAULT_TRIM;
        const pool = getDecoderPool();
        const params = gfxImage.getDecodeParams();

        const trimmedWidth = params.width;
        const trimmedHeight = params.height - trim.top - trim.bottom;

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
                trim.top,
                trim.bottom
            );

            atlas.blitIndices(region, indices);

            // Include per-sprite paletteOffset in the base so the shader
            // can reconstruct the full palette index without Uint16 overflow
            const entry: SpriteEntry = {
                atlasRegion: region,
                offsetX: -gfxImage.left * PIXELS_TO_WORLD,
                offsetY: -(gfxImage.top - trim.top) * PIXELS_TO_WORLD,
                widthWorld: trimmedWidth * PIXELS_TO_WORLD,
                heightWorld: trimmedHeight * PIXELS_TO_WORLD,
                paletteBaseOffset: paletteBaseOffset + params.paletteOffset,
            };

            return { image: gfxImage, region, entry };
        } catch (e) {
            SpriteLoader.log.debug(`Worker decode failed, falling back to sync: ${e}`);
            return this.packSpriteIntoAtlasFallback(gfxImage, atlas, paletteBaseOffset, trimOverride);
        }
    }

    /**
     * Get the number of frames for a job/direction combination.
     */
    public getFrameCount(fileSet: LoadedGfxFileSet, jobIndex: number, directionIndex: number): number {
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

        const dirItem = dirItems[directionIndex]!;
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

        const dirItem = dirItems[directionIndex]!;
        const frameItems = fileSet.gilReader.getItems(dirItem.offset, dirItem.length);

        if (frameItems.length === 0) {
            SpriteLoader.log.debug(`No frames for job ${jobIndex} direction ${directionIndex}`);
            return null;
        }

        // Collect all frame images first
        const frameImages: GfxImage[] = [];
        for (let i = 0; i < frameItems.length; i++) {
            const frameItem = frameItems[i]!;
            const gfxOffset = fileSet.gilReader.getImageOffset(frameItem.index);
            const gfxImage = fileSet.gfxReader.readImage(gfxOffset, jobIndex);

            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- readImage may return null at GFX file boundary
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

        // Load all directions in parallel — atlas.reserve() is sync and safe to interleave
        const promises = Array.from({ length: directionCount }, (_, dir) =>
            this.loadJobAnimation(fileSet, jobIndex, dir, atlas, paletteBaseOffset).then(anim => [dir, anim] as const)
        );
        const results = await Promise.all(promises);

        const result = new Map<number, LoadedSprite[]>();
        for (const [dir, animation] of results) {
            if (animation && animation.frames.length > 0) {
                result.set(dir, animation.frames);
            }
        }

        return result.size > 0 ? result : null;
    }

    /**
     * Blit a single decoded sprite result from a batch into the atlas.
     * Returns the LoadedSprite if successful, or null if the sprite is empty or atlas is full.
     */
    private blitBatchResult(
        sr: BatchSpriteResult,
        allIndices: Uint16Array,
        atlas: EntityTextureAtlas,
        paletteBaseOffset: number,
        trimTop: number
    ): LoadedSprite | null {
        if (sr.height <= 0 || sr.width <= 0) return null;

        const region = atlas.reserve(sr.width, sr.height);
        if (!region) {
            SpriteLoader.log.error(`Atlas full, cannot fit sprite ${sr.width}x${sr.height}`);
            return null;
        }

        const indices = allIndices.subarray(sr.indicesOffset, sr.indicesOffset + sr.indicesLength);
        atlas.blitIndices(region, indices);

        const entry: SpriteEntry = {
            atlasRegion: region,
            offsetX: -sr.left * PIXELS_TO_WORLD,
            offsetY: -(sr.top - trimTop) * PIXELS_TO_WORLD,
            widthWorld: sr.width * PIXELS_TO_WORLD,
            heightWorld: sr.height * PIXELS_TO_WORLD,
            paletteBaseOffset: paletteBaseOffset + sr.paletteOffset,
        };

        return { image: null, region, entry };
    }

    /**
     * Build a batch manifest for a job's frames across all directions.
     * Returns the manifest entries and a parallel array mapping each entry to its direction index.
     */
    private buildJobManifest(
        fileSet: LoadedGfxFileSet,
        jobIndex: number,
        trim: SpriteTrim
    ): { manifest: BatchSpriteDescriptor[]; dirIndices: number[] } | null {
        const jobItem = fileSet.jilReader!.getItem(jobIndex);
        if (!jobItem) return null;

        const dirItems = fileSet.dilReader!.getItems(jobItem.offset, jobItem.length);
        if (dirItems.length === 0) return null;

        const manifest: BatchSpriteDescriptor[] = [];
        const dirIndices: number[] = [];
        const paletteOffset = fileSet.paletteCollection.getOffset(jobIndex);

        for (let d = 0; d < dirItems.length; d++) {
            const dirItem = dirItems[d]!;
            const frameItems = fileSet.gilReader.getItems(dirItem.offset, dirItem.length);

            for (let f = 0; f < frameItems.length; f++) {
                const gfxOffset = fileSet.gilReader.getImageOffset(frameItems[f]!.index);
                manifest.push({ gfxOffset, paletteOffset, trimTop: trim.top, trimBottom: trim.bottom });
                dirIndices.push(d);
            }
        }

        return manifest.length > 0 ? { manifest, dirIndices } : null;
    }

    /** Build a combined manifest for multiple jobs. */
    private buildMultiJobManifest(
        fileSet: LoadedGfxFileSet,
        jobIndices: number[],
        trim: SpriteTrim
    ): { manifest: BatchSpriteDescriptor[]; entryMap: { jobIndex: number; dir: number }[] } {
        const manifest: BatchSpriteDescriptor[] = [];
        const entryMap: { jobIndex: number; dir: number }[] = [];

        for (const jobIndex of jobIndices) {
            const built = this.buildJobManifest(fileSet, jobIndex, trim);
            if (!built) continue;
            for (let i = 0; i < built.manifest.length; i++) {
                manifest.push(built.manifest[i]!);
                entryMap.push({ jobIndex, dir: built.dirIndices[i]! });
            }
        }

        return { manifest, entryMap };
    }

    /** Insert a sprite into a nested job→direction→sprites map. */
    private static insertIntoJobMap(
        map: Map<number, Map<number, LoadedSprite[]>>,
        jobIndex: number,
        dir: number,
        sprite: LoadedSprite
    ): void {
        let jobDirs = map.get(jobIndex);
        if (!jobDirs) {
            jobDirs = new Map<number, LoadedSprite[]>();
            map.set(jobIndex, jobDirs);
        }
        let dirSprites = jobDirs.get(dir);
        if (!dirSprites) {
            dirSprites = [];
            jobDirs.set(dir, dirSprites);
        }
        dirSprites.push(sprite);
    }

    /**
     * Batch-load multiple jobs (all directions × all frames each) in a single worker round-trip.
     * Best for loading many jobs from the same GFX file (e.g., all unit types for a race).
     *
     * @param paletteBaseOffset Base offset for this file's palette in the combined texture
     */
    public async loadMultiJobBatch(
        fileSet: LoadedGfxFileSet,
        jobIndices: number[],
        atlas: EntityTextureAtlas,
        paletteBaseOffset: number
    ): Promise<Map<number, Map<number, LoadedSprite[]>>> {
        const result = new Map<number, Map<number, LoadedSprite[]>>();

        if (!fileSet.jilReader || !fileSet.dilReader) return result;

        const pool = getDecoderPool();

        // Build one big manifest for all jobs
        const trim = SpriteLoader.DEFAULT_TRIM;
        const { manifest, entryMap } = this.buildMultiJobManifest(fileSet, jobIndices, trim);
        if (manifest.length === 0) return result;

        const batchResult = await pool.decodeBatch(fileSet.gfxReader.getBuffer(), manifest);

        for (let i = 0; i < batchResult.results.length; i++) {
            const sprite = this.blitBatchResult(
                batchResult.results[i]!,
                batchResult.allIndices,
                atlas,
                paletteBaseOffset,
                trim.top
            );
            if (!sprite) continue;
            SpriteLoader.insertIntoJobMap(result, entryMap[i]!.jobIndex, entryMap[i]!.dir, sprite);
        }

        return result;
    }

    /**
     * Batch-load sprites by direct GIL indices using the combined parse+decode worker.
     * All sprites are decoded in one worker round-trip.
     *
     * @param paletteBaseOffset Base offset for this file's palette in the combined texture
     */
    public async loadDirectSpriteBatch(
        fileSet: LoadedGfxFileSet,
        gilIndices: readonly number[],
        paletteIndex: number | null,
        atlas: EntityTextureAtlas,
        paletteBaseOffset: number,
        trimOverride?: SpriteTrim
    ): Promise<Map<number, LoadedSprite>> {
        const resultMap = new Map<number, LoadedSprite>();

        if (gilIndices.length === 0) return resultMap;

        const pool = getDecoderPool();

        const trim = trimOverride ?? SpriteLoader.DEFAULT_TRIM;
        const manifest: BatchSpriteDescriptor[] = [];

        for (const gilIndex of gilIndices) {
            const gfxOffset = fileSet.gilReader.getImageOffset(gilIndex);
            let pIdx: number;
            if (paletteIndex != null) {
                pIdx = paletteIndex;
            } else if (fileSet.dilReader && fileSet.jilReader) {
                // Reverse lookup: GIL → DIL → JIL to find the owning job index,
                // same as GfxFileReader.getImage() does for single-sprite loading.
                const dirOffset = fileSet.dilReader.reverseLookupIndex(gilIndex);
                pIdx = fileSet.jilReader.reverseLookupIndex(dirOffset);
            } else {
                pIdx = gilIndex;
            }
            manifest.push({
                gfxOffset,
                paletteOffset: fileSet.paletteCollection.getOffset(pIdx),
                trimTop: trim.top,
                trimBottom: trim.bottom,
            });
        }

        const batchResult = await pool.decodeBatch(fileSet.gfxReader.getBuffer(), manifest);

        for (let i = 0; i < batchResult.results.length; i++) {
            const sprite = this.blitBatchResult(
                batchResult.results[i]!,
                batchResult.allIndices,
                atlas,
                paletteBaseOffset,
                trim.top
            );
            if (sprite) resultMap.set(gilIndices[i]!, sprite);
        }

        return resultMap;
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
