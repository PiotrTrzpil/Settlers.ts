import { LogHandler } from '@/utilities/log-handler';
import { Path } from '@/utilities/path';
import { BinaryReader } from '../resources/file/binary-reader';

class RequestError extends Error {
    public state: number;
    public statusText: string;

    constructor(state: number, msg: string) {
        super(msg);
        this.statusText = msg;
        this.state = state;

        Object.seal(this);
    }
}

/**
 * Simple IndexedDB cache for binary file data.
 * Files rarely change, so we cache them indefinitely.
 */
class FileCache {
    private static DB_NAME = 'settlers-file-cache';
    private static DB_VERSION = 1;
    private static STORE_NAME = 'files';
    private static db: IDBDatabase | null = null;
    private static dbPromise: Promise<IDBDatabase | null> | null = null;

    private static async openDb(): Promise<IDBDatabase | null> {
        if (this.db) return this.db;
        if (this.dbPromise) return this.dbPromise;

        this.dbPromise = new Promise((resolve) => {
            try {
                const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
                request.onerror = () => resolve(null);
                request.onsuccess = () => {
                    this.db = request.result;
                    resolve(this.db);
                };
                request.onupgradeneeded = (event) => {
                    const db = (event.target as IDBOpenDBRequest).result;
                    if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                        db.createObjectStore(this.STORE_NAME);
                    }
                };
            } catch {
                resolve(null);
            }
        });

        return this.dbPromise;
    }

    static async get(key: string): Promise<ArrayBuffer | null> {
        const db = await this.openDb();
        if (!db) return null;

        return new Promise((resolve) => {
            try {
                const tx = db.transaction(this.STORE_NAME, 'readonly');
                const store = tx.objectStore(this.STORE_NAME);
                const request = store.get(key);
                request.onsuccess = () => resolve(request.result ?? null);
                request.onerror = () => resolve(null);
            } catch {
                resolve(null);
            }
        });
    }

    static async set(key: string, data: ArrayBuffer): Promise<void> {
        const db = await this.openDb();
        if (!db) return;

        try {
            const tx = db.transaction(this.STORE_NAME, 'readwrite');
            const store = tx.objectStore(this.STORE_NAME);
            store.put(data, key);
        } catch {
            // Ignore cache write errors
        }
    }
}

/**
* Handle Files loading from remote/web
*/
export class RemoteFile {
    private static log: LogHandler = new LogHandler('RemoteFile');
    private rootPath?: string;
    /** Enable caching for GFX files (these rarely change) */
    public cacheEnabled = true;

    constructor(rootPath?: string) {
        this.rootPath = rootPath;

        Object.seal(this);
    }

    /** load binary data from URL: rootPath + [path] + filename */
    public async loadBinary(path: string, filename?: string): Promise<BinaryReader> {
        const url = Path.combine(this.rootPath, path, filename);

        // Try cache first for GFX files
        if (this.cacheEnabled && this.isCacheableFile(url)) {
            const cached = await FileCache.get(url);
            if (cached) {
                return new BinaryReader(cached, 0, undefined, this.filenameFormUrl(url));
            }
        }

        RemoteFile.log.debug('loading: ' + url);

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();

            xhr.onload = async() => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    // Cache GFX files for future use
                    if (this.cacheEnabled && this.isCacheableFile(url)) {
                        await FileCache.set(url, xhr.response);
                    }

                    const reader = new BinaryReader(xhr.response, 0, undefined, this.filenameFormUrl(url));
                    resolve(reader);
                } else {
                    RemoteFile.log.error('error load file:' + url);
                    reject(new RequestError(xhr.status, xhr.statusText));
                }
            };

            xhr.onerror = () => {
                RemoteFile.log.error('error load file:' + url);
                reject(new RequestError(xhr.status, xhr.statusText));
            };

            xhr.open('GET', url);
            xhr.responseType = 'arraybuffer';

            xhr.send();
        });
    }

    /** Check if a file should be cached (GFX/GIL/JIL/DIL/palette files) */
    private isCacheableFile(url: string): boolean {
        const lower = url.toLowerCase();
        return lower.includes('/gfx/') && (
            lower.endsWith('.gfx') ||
            lower.endsWith('.gil') ||
            lower.endsWith('.jil') ||
            lower.endsWith('.dil') ||
            lower.endsWith('.pil') ||
            lower.endsWith('.pi4') ||
            lower.endsWith('.pa6') ||
            lower.endsWith('.p46')
        );
    }

    /** load string data from URL */
    public loadString(url: string): Promise<string> {
        RemoteFile.log.debug('Load file as string: ' + url);

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();

            xhr.onload = () => {
                resolve(xhr.response);
            };

            xhr.onerror = () => {
                RemoteFile.log.error('error load file:' + url);
                reject(new RequestError(xhr.status, xhr.statusText));
            };

            /// setup query
            xhr.open('GET', url, true);
            xhr.responseType = 'text';

            /// call url
            xhr.send(null);
        });
    }

    /** Extracts the filename form an URL */
    private filenameFormUrl(url: string): string {
        if (url === '') {
            return '';
        }

        url = url.substring(0, (url.indexOf('#') === -1) ? url.length : url.indexOf('#'));
        url = url.substring(0, (url.indexOf('?') === -1) ? url.length : url.indexOf('?'));
        url = url.substring(url.lastIndexOf('/') + 1, url.length);

        return url;
    }
}
