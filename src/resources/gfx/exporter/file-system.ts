import { BinaryReader } from '@/resources/file/binary-reader';

/**
 * Platform-agnostic file system interface
 * Implementations work in both Node.js and browser environments
 */

/** File read result */
export interface IReadResult {
    data: Uint8Array;
    filename: string;
}

/** File writer interface for exporting */
export interface IFileWriter {
    /** Write binary data to a file */
    writeFile(path: string, data: Uint8Array<ArrayBuffer>): Promise<void>;

    /** Create directory if it doesn't exist */
    mkdir(path: string): Promise<void>;

    /** Check if path exists */
    exists(path: string): Promise<boolean>;

    /** Join path components */
    join(...parts: string[]): string;
}

/** File reader interface for loading files */
export interface IFileReader {
    /** Read a single file */
    readFile(path: string): Promise<BinaryReader>;

    /** Read multiple files */
    readFiles(paths: string[]): Promise<Map<string, BinaryReader>>;

    /** List files matching a pattern */
    listFiles(directory: string, pattern?: RegExp): Promise<string[]>;

    /** Check if file exists */
    exists(path: string): Promise<boolean>;

    /** Join path components */
    join(...parts: string[]): string;

    /** Get the directory name from a path */
    dirname(path: string): string;

    /** Get the base filename from a path */
    basename(path: string): string;

    /** Get filename without extension */
    basenameWithoutExt(path: string): string;
}

/**
 * Node.js file system implementation
 */
export class NodeFileSystem implements IFileReader, IFileWriter {
    private fs: typeof import('fs/promises') | null = null;
    private pathModule: typeof import('path') | null = null;

    private async ensureModules(): Promise<void> {
        if (!this.fs) {
            this.fs = await import('fs/promises');
        }
        if (!this.pathModule) {
            this.pathModule = await import('path');
        }
    }

    async readFile(path: string): Promise<BinaryReader> {
        await this.ensureModules();
        const data = await this.fs!.readFile(path);
        return new BinaryReader(new Uint8Array(data), 0, null, this.basename(path));
    }

    async readFiles(paths: string[]): Promise<Map<string, BinaryReader>> {
        const result = new Map<string, BinaryReader>();
        const promises = paths.map(async(p) => {
            try {
                const reader = await this.readFile(p);
                result.set(p, reader);
            } catch {
                // Skip files that can't be read
            }
        });
        await Promise.all(promises);
        return result;
    }

    async listFiles(directory: string, pattern?: RegExp): Promise<string[]> {
        await this.ensureModules();
        try {
            const entries = await this.fs!.readdir(directory, { withFileTypes: true });
            const files: string[] = [];

            for (const entry of entries) {
                if (entry.isFile()) {
                    if (!pattern || pattern.test(entry.name)) {
                        files.push(this.join(directory, entry.name));
                    }
                }
            }

            return files;
        } catch {
            return [];
        }
    }

    async writeFile(path: string, data: Uint8Array<ArrayBuffer>): Promise<void> {
        await this.ensureModules();
        await this.fs!.writeFile(path, data);
    }

    async mkdir(path: string): Promise<void> {
        await this.ensureModules();
        await this.fs!.mkdir(path, { recursive: true });
    }

    async exists(path: string): Promise<boolean> {
        await this.ensureModules();
        try {
            await this.fs!.access(path);
            return true;
        } catch {
            return false;
        }
    }

    join(...parts: string[]): string {
        // Synchronous path join using simple logic
        return parts
            .filter(Boolean)
            .join('/')
            .replace(/\/+/g, '/')
            .replace(/\/$/, '');
    }

    dirname(path: string): string {
        const lastSlash = path.lastIndexOf('/');
        if (lastSlash <= 0) return '.';
        return path.substring(0, lastSlash);
    }

    basename(path: string): string {
        const lastSlash = path.lastIndexOf('/');
        return lastSlash >= 0 ? path.substring(lastSlash + 1) : path;
    }

    basenameWithoutExt(path: string): string {
        const name = this.basename(path);
        const dotIndex = name.lastIndexOf('.');
        return dotIndex > 0 ? name.substring(0, dotIndex) : name;
    }
}

/**
 * Browser file system implementation using File System Access API
 * Falls back to download triggers for writes
 */
export class BrowserFileSystem implements IFileReader, IFileWriter {
    private directoryHandle: FileSystemDirectoryHandle | null = null;
    private files: Map<string, File> = new Map();

    /** Initialize with a FileList from input element or drag-drop */
    // eslint-disable-next-line @typescript-eslint/require-await -- sync impl of async interface
    public async initFromFileList(fileList: FileList): Promise<void> {
        this.files.clear();
        for (const file of fileList) {
            // Use webkitRelativePath if available, otherwise just the name
            const path = (file as any).webkitRelativePath || file.name;
            this.files.set(path.toLowerCase(), file);
        }
    }

    /** Initialize with a directory handle from showDirectoryPicker */
    public async initFromDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
        this.directoryHandle = handle;
        await this.scanDirectory(handle, '');
    }

    private async scanDirectory(handle: FileSystemDirectoryHandle, basePath: string): Promise<void> {
        for await (const [name, entry] of (handle as any).entries()) {
            const path = basePath ? `${basePath}/${name}` : name;

            if (entry.kind === 'file') {
                const file = await entry.getFile();
                this.files.set(path.toLowerCase(), file);
            } else if (entry.kind === 'directory') {
                await this.scanDirectory(entry, path);
            }
        }
    }

    async readFile(path: string): Promise<BinaryReader> {
        const normalizedPath = path.toLowerCase().replace(/\\/g, '/');
        const file = this.files.get(normalizedPath);

        if (!file) {
            throw new Error(`File not found: ${path}`);
        }

        const buffer = await file.arrayBuffer();
        return new BinaryReader(new Uint8Array(buffer), 0, null, file.name);
    }

    async readFiles(paths: string[]): Promise<Map<string, BinaryReader>> {
        const result = new Map<string, BinaryReader>();
        const promises = paths.map(async(p) => {
            try {
                const reader = await this.readFile(p);
                result.set(p, reader);
            } catch {
                // Skip files that can't be read
            }
        });
        await Promise.all(promises);
        return result;
    }

    // eslint-disable-next-line @typescript-eslint/require-await -- sync impl of async interface
    async listFiles(directory: string, pattern?: RegExp): Promise<string[]> {
        const normalizedDir = directory.toLowerCase().replace(/\\/g, '/');
        const result: string[] = [];

        for (const [path] of this.files) {
            if (path.startsWith(normalizedDir)) {
                const relativePath = path.substring(normalizedDir.length);
                // Only include direct children (no subdirectory files)
                if (!relativePath.includes('/') || relativePath.startsWith('/')) {
                    if (!pattern || pattern.test(path)) {
                        result.push(path);
                    }
                }
            }
        }

        return result;
    }

    async writeFile(path: string, data: Uint8Array<ArrayBuffer>): Promise<void> {
        // Try File System Access API first
        if (this.directoryHandle) {
            try {
                const parts = path.split('/');
                const fileName = parts.pop()!;
                let dirHandle = this.directoryHandle;

                // Create subdirectories
                for (const part of parts) {
                    if (part) {
                        dirHandle = await dirHandle.getDirectoryHandle(part, { create: true });
                    }
                }

                const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(data);
                await writable.close();
                return;
            } catch {
                // Fall through to download
            }
        }

        // Fallback: trigger download
        this.downloadFile(this.basename(path), data);
    }

    private downloadFile(filename: string, data: Uint8Array<ArrayBuffer>): void {
        const blob = new Blob([data], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 100);
    }

    async mkdir(path: string): Promise<void> {
        if (this.directoryHandle) {
            const parts = path.split('/').filter(Boolean);
            let dirHandle = this.directoryHandle;

            for (const part of parts) {
                dirHandle = await dirHandle.getDirectoryHandle(part, { create: true });
            }
        }
        // For download fallback, mkdir is a no-op
    }

    // eslint-disable-next-line @typescript-eslint/require-await -- sync impl of async interface
    async exists(path: string): Promise<boolean> {
        const normalizedPath = path.toLowerCase().replace(/\\/g, '/');
        return this.files.has(normalizedPath);
    }

    join(...parts: string[]): string {
        return parts
            .filter(Boolean)
            .join('/')
            .replace(/\/+/g, '/')
            .replace(/\/$/, '');
    }

    dirname(path: string): string {
        const lastSlash = path.lastIndexOf('/');
        if (lastSlash <= 0) return '.';
        return path.substring(0, lastSlash);
    }

    basename(path: string): string {
        const lastSlash = path.lastIndexOf('/');
        return lastSlash >= 0 ? path.substring(lastSlash + 1) : path;
    }

    basenameWithoutExt(path: string): string {
        const name = this.basename(path);
        const dotIndex = name.lastIndexOf('.');
        return dotIndex > 0 ? name.substring(0, dotIndex) : name;
    }
}

/**
 * Memory-based file system for testing or in-memory operations
 */
export class MemoryFileSystem implements IFileReader, IFileWriter {
    private files: Map<string, Uint8Array> = new Map();

    /** Add a file to the memory file system */
    public addFile(path: string, data: Uint8Array): void {
        this.files.set(path.toLowerCase(), data);
    }

    /** Get all stored files */
    public getFiles(): Map<string, Uint8Array> {
        return new Map(this.files);
    }

    // eslint-disable-next-line @typescript-eslint/require-await -- sync impl of async interface
    async readFile(path: string): Promise<BinaryReader> {
        const normalizedPath = path.toLowerCase();
        const data = this.files.get(normalizedPath);

        if (!data) {
            throw new Error(`File not found: ${path}`);
        }

        return new BinaryReader(data, 0, null, this.basename(path));
    }

    async readFiles(paths: string[]): Promise<Map<string, BinaryReader>> {
        const result = new Map<string, BinaryReader>();
        for (const p of paths) {
            try {
                const reader = await this.readFile(p);
                result.set(p, reader);
            } catch {
                // Skip files that can't be read
            }
        }
        return result;
    }

    // eslint-disable-next-line @typescript-eslint/require-await -- sync impl of async interface
    async listFiles(directory: string, pattern?: RegExp): Promise<string[]> {
        const normalizedDir = directory.toLowerCase();
        const result: string[] = [];

        for (const [path] of this.files) {
            if (path.startsWith(normalizedDir)) {
                if (!pattern || pattern.test(path)) {
                    result.push(path);
                }
            }
        }

        return result;
    }

    // eslint-disable-next-line @typescript-eslint/require-await -- sync impl of async interface
    async writeFile(path: string, data: Uint8Array<ArrayBuffer>): Promise<void> {
        this.files.set(path.toLowerCase(), data);
    }

    async mkdir(_path: string): Promise<void> {
        // No-op for memory file system
    }

    // eslint-disable-next-line @typescript-eslint/require-await -- sync impl of async interface
    async exists(path: string): Promise<boolean> {
        return this.files.has(path.toLowerCase());
    }

    join(...parts: string[]): string {
        return parts
            .filter(Boolean)
            .join('/')
            .replace(/\/+/g, '/')
            .replace(/\/$/, '');
    }

    dirname(path: string): string {
        const lastSlash = path.lastIndexOf('/');
        if (lastSlash <= 0) return '.';
        return path.substring(0, lastSlash);
    }

    basename(path: string): string {
        const lastSlash = path.lastIndexOf('/');
        return lastSlash >= 0 ? path.substring(lastSlash + 1) : path;
    }

    basenameWithoutExt(path: string): string {
        const name = this.basename(path);
        const dotIndex = name.lastIndexOf('.');
        return dotIndex > 0 ? name.substring(0, dotIndex) : name;
    }
}

/**
 * Detect the current platform and create appropriate file system
 */
export function createFileSystem(): IFileReader & IFileWriter {
    if (typeof process !== 'undefined' && process.versions?.node) {
        return new NodeFileSystem();
    }
    return new BrowserFileSystem();
}
