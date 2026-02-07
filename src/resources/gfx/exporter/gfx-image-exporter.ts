import { DilFileReader } from '@/resources/gfx/dil-file-reader';
import { GfxFileReader } from '@/resources/gfx/gfx-file-reader';
import { GhFileReader } from '@/resources/gfx/gh-file-reader';
import { GilFileReader } from '@/resources/gfx/gil-file-reader';
import { IGfxImage } from '@/resources/gfx/igfx-image';
import { JilFileReader } from '@/resources/gfx/jil-file-reader';
import { PaletteCollection } from '@/resources/gfx/palette-collection';
import { PilFileReader } from '@/resources/gfx/pil-file-reader';
import { IFileReader, IFileWriter } from './file-system';
import { encodePNG } from './png-encoder';
import { RawImageData } from './raw-image-data';

/** Export options */
export interface ExportOptions {
    /** Output directory for exported files */
    outputDir: string;

    /** Export format (currently only PNG supported) */
    format?: 'png';

    /** Include image metadata in filename */
    includeMetadata?: boolean;

    /** Callback for progress updates */
    onProgress?: (current: number, total: number, filename: string) => void;

    /** Export specific image indices only */
    imageIndices?: number[];

    /** Prefix for output filenames */
    filenamePrefix?: string;
}

/** Export result */
export interface ExportResult {
    success: boolean;
    exportedCount: number;
    failedCount: number;
    errors: string[];
    files: string[];
}

/** Information about a GFX file set */
export interface GfxFileInfo {
    baseName: string;
    gfxPath: string;
    gilPath: string;
    palettePath: string;
    pilPath: string;
    jilPath?: string;
    dilPath?: string;
    imageCount: number;
}

/**
 * GFX Image Exporter
 * Exports images from Settlers 4 GFX files to standard image formats
 */
export class GfxImageExporter {
    private fileReader: IFileReader;
    private fileWriter: IFileWriter;

    constructor(fileReader: IFileReader, fileWriter: IFileWriter) {
        this.fileReader = fileReader;
        this.fileWriter = fileWriter;
    }

    /**
     * Find all GFX file sets in a directory
     */
    async findGfxFileSets(directory: string): Promise<GfxFileInfo[]> {
        const files = await this.fileReader.listFiles(directory);
        const gfxFiles = files.filter(f => f.toLowerCase().endsWith('.gfx'));

        const fileSets: GfxFileInfo[] = [];

        for (const gfxPath of gfxFiles) {
            const baseName = this.fileReader.basenameWithoutExt(gfxPath);
            const dir = this.fileReader.dirname(gfxPath);

            // Look for required companion files
            const gilPath = this.fileReader.join(dir, `${baseName}.gil`);
            const pa6Path = this.fileReader.join(dir, `${baseName}.pa6`);
            const p46Path = this.fileReader.join(dir, `${baseName}.p46`);
            const pilPath = this.fileReader.join(dir, `${baseName}.pil`);
            const pi4Path = this.fileReader.join(dir, `${baseName}.pi4`);
            const jilPath = this.fileReader.join(dir, `${baseName}.jil`);
            const dilPath = this.fileReader.join(dir, `${baseName}.dil`);

            // Check which palette format exists
            const hasPa6 = await this.fileReader.exists(pa6Path);
            const hasP46 = await this.fileReader.exists(p46Path);
            const hasPil = await this.fileReader.exists(pilPath);
            const hasPi4 = await this.fileReader.exists(pi4Path);
            const hasGil = await this.fileReader.exists(gilPath);

            if (!hasGil) continue;
            if (!hasPa6 && !hasP46) continue;
            if (!hasPil && !hasPi4) continue;

            const hasJil = await this.fileReader.exists(jilPath);
            const hasDil = await this.fileReader.exists(dilPath);

            fileSets.push({
                baseName,
                gfxPath,
                gilPath,
                palettePath: hasPa6 ? pa6Path : p46Path,
                pilPath: hasPil ? pilPath : pi4Path,
                jilPath: hasJil ? jilPath : undefined,
                dilPath: hasDil ? dilPath : undefined,
                imageCount: 0 // Will be populated when loading
            });
        }

        return fileSets;
    }

    /**
     * Find all GH (background texture) files in a directory
     */
    async findGhFiles(directory: string): Promise<string[]> {
        const files = await this.fileReader.listFiles(directory);
        return files.filter(f => {
            const lower = f.toLowerCase();
            return lower.endsWith('.gh5') || lower.endsWith('.gh6');
        });
    }

    /**
     * Load a GFX file reader from file paths
     */
    async loadGfxReader(info: GfxFileInfo): Promise<GfxFileReader> {
        const [gfxData, gilData, paletteData, pilData, jilData, dilData] = await Promise.all([
            this.fileReader.readFile(info.gfxPath),
            this.fileReader.readFile(info.gilPath),
            this.fileReader.readFile(info.palettePath),
            this.fileReader.readFile(info.pilPath),
            info.jilPath ? this.fileReader.readFile(info.jilPath).catch(() => null) : Promise.resolve(null),
            info.dilPath ? this.fileReader.readFile(info.dilPath).catch(() => null) : Promise.resolve(null)
        ]);

        const gilReader = new GilFileReader(gilData);
        const pilReader = new PilFileReader(pilData);
        const paletteCollection = new PaletteCollection(paletteData, pilReader);
        const jilReader = jilData ? new JilFileReader(jilData) : null;
        const dilReader = dilData ? new DilFileReader(dilData) : null;

        return new GfxFileReader(gfxData, gilReader, jilReader, dilReader, paletteCollection);
    }

    /**
     * Load a GH file reader
     */
    async loadGhReader(path: string): Promise<GhFileReader> {
        const data = await this.fileReader.readFile(path);
        return new GhFileReader(data);
    }

    /**
     * Convert IGfxImage to RawImageData
     */
    private imageToRawData(image: IGfxImage): RawImageData {
        const imageData = image.getImageData();
        return RawImageData.fromImageData(imageData);
    }

    /**
     * Build export filename for an image
     */
    private buildExportFilename(
        index: number,
        image: IGfxImage,
        includeMetadata: boolean,
        padLength = 5
    ): string {
        let filename = `${index.toString().padStart(padLength, '0')}`;

        if (includeMetadata) {
            filename += `_${image.width}x${image.height}`;
            if (image.left !== 0 || image.top !== 0) {
                filename += `_offset${image.left}x${image.top}`;
            }
        }

        return filename + '.png';
    }

    /**
     * Export a single image to PNG
     */
    async exportImage(
        image: IGfxImage,
        outputPath: string,
        _includeMetadata = false
    ): Promise<void> {
        const rawData = this.imageToRawData(image);
        const pngData = await encodePNG(rawData);
        await this.fileWriter.writeFile(outputPath, pngData);
    }

    /**
     * Export all images from a GFX file set
     */
    async exportGfxFile(
        info: GfxFileInfo,
        options: ExportOptions
    ): Promise<ExportResult> {
        const result: ExportResult = {
            success: true,
            exportedCount: 0,
            failedCount: 0,
            errors: [],
            files: []
        };

        try {
            const reader = await this.loadGfxReader(info);
            const imageCount = reader.getImageCount();
            info.imageCount = imageCount;

            // Create output directory
            const outputDir = this.fileWriter.join(
                options.outputDir,
                options.filenamePrefix || info.baseName
            );
            await this.fileWriter.mkdir(outputDir);

            // Determine which images to export
            const indices = options.imageIndices ??
                Array.from({ length: imageCount }, (_, i) => i);

            for (let i = 0; i < indices.length; i++) {
                const index = indices[i];

                if (options.onProgress) {
                    options.onProgress(i + 1, indices.length, `${info.baseName}/${index}`);
                }

                try {
                    const image = reader.getImage(index);
                    if (!image) {
                        result.failedCount++;
                        result.errors.push(`Image ${index} is null`);
                        continue;
                    }

                    // Skip empty images
                    if (image.width === 0 || image.height === 0) {
                        continue;
                    }

                    const filename = this.buildExportFilename(
                        index, image, options.includeMetadata ?? false, 5
                    );
                    const outputPath = this.fileWriter.join(outputDir, filename);
                    await this.exportImage(image, outputPath);

                    result.exportedCount++;
                    result.files.push(outputPath);
                } catch (err) {
                    result.failedCount++;
                    result.errors.push(`Image ${index}: ${err}`);
                }
            }
        } catch (err) {
            result.success = false;
            result.errors.push(`Failed to load GFX file: ${err}`);
        }

        return result;
    }

    /**
     * Export all images from a GH file
     */
    async exportGhFile(
        path: string,
        options: ExportOptions
    ): Promise<ExportResult> {
        const result: ExportResult = {
            success: true,
            exportedCount: 0,
            failedCount: 0,
            errors: [],
            files: []
        };

        try {
            const reader = await this.loadGhReader(path);
            const imageCount = reader.getImageCount();

            const baseName = this.fileReader.basenameWithoutExt(path);
            const outputDir = this.fileWriter.join(
                options.outputDir,
                options.filenamePrefix || baseName
            );
            await this.fileWriter.mkdir(outputDir);

            const indices = options.imageIndices ??
                Array.from({ length: imageCount }, (_, i) => i);

            for (let i = 0; i < indices.length; i++) {
                const index = indices[i];

                if (options.onProgress) {
                    options.onProgress(i + 1, indices.length, `${baseName}/${index}`);
                }

                try {
                    const image = reader.getImage(index);
                    if (!image) {
                        result.failedCount++;
                        result.errors.push(`Image ${index} is null`);
                        continue;
                    }

                    if (image.width === 0 || image.height === 0) {
                        continue;
                    }

                    const filename = this.buildExportFilename(
                        index, image, options.includeMetadata ?? false, 3
                    );
                    const outputPath = this.fileWriter.join(outputDir, filename);
                    await this.exportImage(image, outputPath);

                    result.exportedCount++;
                    result.files.push(outputPath);
                } catch (err) {
                    result.failedCount++;
                    result.errors.push(`Image ${index}: ${err}`);
                }
            }
        } catch (err) {
            result.success = false;
            result.errors.push(`Failed to load GH file: ${err}`);
        }

        return result;
    }

    /**
     * Export all GFX files from a directory
     */
    async exportDirectory(
        sourceDir: string,
        options: ExportOptions
    ): Promise<ExportResult> {
        const combinedResult: ExportResult = {
            success: true,
            exportedCount: 0,
            failedCount: 0,
            errors: [],
            files: []
        };

        // Find and export GFX files
        const gfxFileSets = await this.findGfxFileSets(sourceDir);

        for (const fileSet of gfxFileSets) {
            const result = await this.exportGfxFile(fileSet, options);
            combinedResult.exportedCount += result.exportedCount;
            combinedResult.failedCount += result.failedCount;
            combinedResult.errors.push(...result.errors);
            combinedResult.files.push(...result.files);

            if (!result.success) {
                combinedResult.success = false;
            }
        }

        // Find and export GH files
        const ghFiles = await this.findGhFiles(sourceDir);

        for (const ghFile of ghFiles) {
            const result = await this.exportGhFile(ghFile, options);
            combinedResult.exportedCount += result.exportedCount;
            combinedResult.failedCount += result.failedCount;
            combinedResult.errors.push(...result.errors);
            combinedResult.files.push(...result.files);

            if (!result.success) {
                combinedResult.success = false;
            }
        }

        return combinedResult;
    }

    /**
     * Export a single GFX file by path (auto-detects companion files)
     */
    async exportSingleFile(
        filePath: string,
        options: ExportOptions
    ): Promise<ExportResult> {
        const lower = filePath.toLowerCase();

        if (lower.endsWith('.gh5') || lower.endsWith('.gh6')) {
            return this.exportGhFile(filePath, options);
        }

        if (lower.endsWith('.gfx')) {
            const baseName = this.fileReader.basenameWithoutExt(filePath);
            const dir = this.fileReader.dirname(filePath);

            // Find companion files
            const gilPath = this.fileWriter.join(dir, `${baseName}.gil`);
            const pa6Path = this.fileWriter.join(dir, `${baseName}.pa6`);
            const p46Path = this.fileWriter.join(dir, `${baseName}.p46`);
            const pilPath = this.fileWriter.join(dir, `${baseName}.pil`);
            const pi4Path = this.fileWriter.join(dir, `${baseName}.pi4`);
            const jilPath = this.fileWriter.join(dir, `${baseName}.jil`);
            const dilPath = this.fileWriter.join(dir, `${baseName}.dil`);

            const hasPa6 = await this.fileReader.exists(pa6Path);
            const hasPil = await this.fileReader.exists(pilPath);
            const hasJil = await this.fileReader.exists(jilPath);
            const hasDil = await this.fileReader.exists(dilPath);

            const info: GfxFileInfo = {
                baseName,
                gfxPath: filePath,
                gilPath,
                palettePath: hasPa6 ? pa6Path : p46Path,
                pilPath: hasPil ? pilPath : pi4Path,
                jilPath: hasJil ? jilPath : undefined,
                dilPath: hasDil ? dilPath : undefined,
                imageCount: 0
            };

            return this.exportGfxFile(info, options);
        }

        return {
            success: false,
            exportedCount: 0,
            failedCount: 0,
            errors: [`Unknown file type: ${filePath}`],
            files: []
        };
    }

    /**
     * Get information about a GFX file without exporting
     */
    async getGfxInfo(info: GfxFileInfo): Promise<{
        imageCount: number;
        images: Array<{
            index: number;
            width: number;
            height: number;
            left: number;
            top: number;
        }>;
    }> {
        const reader = await this.loadGfxReader(info);
        const imageCount = reader.getImageCount();

        const images: Array<{
            index: number;
            width: number;
            height: number;
            left: number;
            top: number;
        }> = [];

        for (let i = 0; i < imageCount; i++) {
            const image = reader.getImage(i);
            if (image && image.width > 0 && image.height > 0) {
                images.push({
                    index: i,
                    width: image.width,
                    height: image.height,
                    left: image.left,
                    top: image.top
                });
            }
        }

        return { imageCount, images };
    }
}

/**
 * Create an exporter with the given file system implementations
 */
export function createGfxExporter(
    fileReader: IFileReader,
    fileWriter: IFileWriter
): GfxImageExporter {
    return new GfxImageExporter(fileReader, fileWriter);
}
