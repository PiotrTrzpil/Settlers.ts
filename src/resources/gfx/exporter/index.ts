/**
 * GFX Image Exporter Module
 *
 * Provides functionality to export images from Settlers 4 GFX files
 * to standard image formats (PNG). Works in both Node.js and browser.
 *
 * Usage (Node.js):
 * ```typescript
 * import { createGfxExporter, NodeFileSystem } from './exporter';
 *
 * const fs = new NodeFileSystem();
 * const exporter = createGfxExporter(fs, fs);
 *
 * const result = await exporter.exportSingleFile('path/to/file.gfx', {
 *     outputDir: './output'
 * });
 * ```
 *
 * Usage (Browser):
 * ```typescript
 * import { createGfxExporter, BrowserFileSystem } from './exporter';
 *
 * const fs = new BrowserFileSystem();
 * await fs.initFromFileList(inputElement.files);
 *
 * const exporter = createGfxExporter(fs, fs);
 * // ...
 * ```
 */

export { RawImageData } from './raw-image-data';
export { PngEncoder, encodePNG, encodePNGSync } from './png-encoder';
export type { IFileReader, IFileWriter } from './file-system';
export {
    NodeFileSystem,
    BrowserFileSystem,
    MemoryFileSystem,
    createFileSystem
} from './file-system';
export type { ExportOptions, ExportResult, GfxFileInfo } from './gfx-image-exporter';
export {
    GfxImageExporter,
    createGfxExporter
} from './gfx-image-exporter';
