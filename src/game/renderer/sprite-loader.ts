/**
 * Unified sprite loading service for all entity types.
 * Handles GFX file loading, sprite extraction, and atlas packing.
 */

import { LogHandler } from '@/utilities/log-handler';
import { FileManager } from '@/utilities/file-manager';
import { GfxFileReader } from '@/resources/gfx/gfx-file-reader';
import { GilFileReader } from '@/resources/gfx/gil-file-reader';
import { JilFileReader } from '@/resources/gfx/jil-file-reader';
import { DilFileReader } from '@/resources/gfx/dil-file-reader';
import { PilFileReader } from '@/resources/gfx/pil-file-reader';
import { PaletteCollection } from '@/resources/gfx/palette-collection';
import { IGfxImage } from '@/resources/gfx/igfx-image';
import { EntityTextureAtlas, AtlasRegion } from './entity-texture-atlas';
import { SpriteEntry, PIXELS_TO_WORLD } from './sprite-metadata';

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
    image: IGfxImage;
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
export class SpriteLoader {
    private static log = new LogHandler('SpriteLoader');

    private fileManager: FileManager;
    private loadedFileSets: Map<string, LoadedGfxFileSet> = new Map();

    constructor(fileManager: FileManager) {
        this.fileManager = fileManager;
    }

    /**
     * Load and cache a GFX file set.
     * Returns null if files are not available.
     */
    public async loadFileSet(fileId: string): Promise<LoadedGfxFileSet | null> {
        // Return cached file set if available
        if (this.loadedFileSets.has(fileId)) {
            return this.loadedFileSets.get(fileId)!;
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

        // Build readers
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

        const fileSet: LoadedGfxFileSet = {
            fileId,
            gfxReader,
            gilReader,
            jilReader,
            dilReader,
            paletteCollection,
        };

        this.loadedFileSets.set(fileId, fileSet);
        SpriteLoader.log.debug(`Loaded GFX file set: ${fileId}`);

        return fileSet;
    }

    /**
     * Load a sprite by JIL job index and pack it into the atlas.
     * Uses the first direction and first frame by default.
     */
    public loadJobSprite(
        fileSet: LoadedGfxFileSet,
        config: JobSpriteConfig,
        atlas: EntityTextureAtlas
    ): LoadedSprite | null {
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

        return this.packSpriteIntoAtlas(gfxImage, atlas);
    }

    /**
     * Load a sprite by direct GIL index and pack it into the atlas.
     */
    public loadDirectSprite(
        fileSet: LoadedGfxFileSet,
        gilIndex: number,
        paletteIndex: number,
        atlas: EntityTextureAtlas
    ): LoadedSprite | null {
        const gfxOffset = fileSet.gilReader.getImageOffset(gilIndex);
        const gfxImage = fileSet.gfxReader.readImage(gfxOffset, paletteIndex);

        if (!gfxImage) {
            SpriteLoader.log.debug(`Failed to read image at GIL index ${gilIndex}`);
            return null;
        }

        return this.packSpriteIntoAtlas(gfxImage, atlas);
    }

    /**
     * Trim pixel rows from top and bottom of an ImageData.
     * Used to remove artifact lines from sprite edges.
     */
    private trimImageData(imageData: ImageData, trimTop: number, trimBottom: number): ImageData {
        const newHeight = imageData.height - trimTop - trimBottom;
        if (newHeight <= 0) return imageData;

        const trimmed = new ImageData(imageData.width, newHeight);
        const srcData = imageData.data;
        const dstData = trimmed.data;
        const rowBytes = imageData.width * 4;

        // Copy rows, skipping trimTop rows from the start
        for (let y = 0; y < newHeight; y++) {
            const srcOffset = (y + trimTop) * rowBytes;
            const dstOffset = y * rowBytes;
            for (let x = 0; x < rowBytes; x++) {
                dstData[dstOffset + x] = srcData[srcOffset + x];
            }
        }

        return trimmed;
    }

    /**
     * Pack a GFX image into the atlas and create a SpriteEntry.
     */
    private packSpriteIntoAtlas(gfxImage: IGfxImage, atlas: EntityTextureAtlas): LoadedSprite | null {
        const rawImageData = gfxImage.getImageData();

        // Trim pixels from top and bottom to remove artifact lines
        const imageData = this.trimImageData(rawImageData, 1, 5);

        const region = atlas.reserve(imageData.width, imageData.height);

        if (!region) {
            SpriteLoader.log.error(`Atlas full, cannot fit sprite ${imageData.width}x${imageData.height}`);
            return null;
        }

        atlas.blit(region, imageData);

        // GFX offset convention: left/top are distances from sprite edge to anchor point.
        // To position the sprite so the anchor aligns with worldX/worldY:
        // - offsetX = -left (move sprite left so anchor lands at worldX)
        // - offsetY = -(top - 1) because we trimmed 1 pixel from top
        const entry: SpriteEntry = {
            atlasRegion: region,
            offsetX: -gfxImage.left * PIXELS_TO_WORLD,
            offsetY: -(gfxImage.top - 1) * PIXELS_TO_WORLD,
            widthWorld: imageData.width * PIXELS_TO_WORLD,
            heightWorld: imageData.height * PIXELS_TO_WORLD,
        };

        return { image: gfxImage, region, entry };
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
     * Returns null if the animation cannot be loaded.
     */
    public loadJobAnimation(
        fileSet: LoadedGfxFileSet,
        jobIndex: number,
        directionIndex: number,
        atlas: EntityTextureAtlas
    ): LoadedAnimation | null {
        if (!fileSet.jilReader || !fileSet.dilReader) {
            SpriteLoader.log.debug(`JIL/DIL not available for file ${fileSet.fileId}`);
            return null;
        }

        // Navigate: job -> direction
        // Use getItem(jobIndex) directly to access the correct job
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

        const frames: LoadedSprite[] = [];

        for (let i = 0; i < frameItems.length; i++) {
            const frameItem = frameItems[i];
            const gfxOffset = fileSet.gilReader.getImageOffset(frameItem.index);
            const gfxImage = fileSet.gfxReader.readImage(gfxOffset, jobIndex);

            if (!gfxImage) {
                SpriteLoader.log.debug(`Failed to read frame ${i} for job ${jobIndex}`);
                continue;
            }

            const loadedSprite = this.packSpriteIntoAtlas(gfxImage, atlas);
            if (loadedSprite) {
                frames.push(loadedSprite);
            }
        }

        if (frames.length === 0) {
            return null;
        }

        return {
            frames,
            frameCount: frames.length,
        };
    }

    /**
     * Get the number of jobs in a file set.
     */
    public getJobCount(fileSet: LoadedGfxFileSet): number {
        if (!fileSet.jilReader) return 0;
        return fileSet.jilReader.getItems(0).length;
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
        this.loadedFileSets.clear();
    }

    /**
     * Clear a specific file set from cache.
     */
    public clearFileSet(fileId: string): void {
        this.loadedFileSets.delete(fileId);
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
    /** Map objects (trees, stones, resources) - typically file 6 or 20 */
    MAP_OBJECTS: 20,
} as const;
