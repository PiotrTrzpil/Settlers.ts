import { LogHandler } from '@/utilities/log-handler';
import { Path } from '@/utilities/path';
import { BinaryReader } from '../resources/file/binary-reader';
import { looksLikeHtmlFallback, reportAssetError } from './asset-error-reporter';

export class RequestError extends Error {
    public state: number;
    public statusText: string;

    constructor(state: number, msg: string) {
        super(msg);
        this.statusText = msg;
        this.state = state;

        Object.seal(this);
    }
}

export class MissingAssetError extends Error {
    constructor(public readonly url: string) {
        super(`Missing asset: ${url}`);
    }
}

const HTML_FALLBACK_MAGIC = [0x3c, 0x21, 0x44, 0x4f, 0x43]; // "<!DOC"
const HTML_FALLBACK_MAGIC_2 = [0x3c, 0x68, 0x74, 0x6d, 0x6c]; // "<html"

function bytesStartWith(buf: ArrayBuffer, magic: number[]): boolean {
    if (buf.byteLength < magic.length) {
        return false;
    }
    const view = new Uint8Array(buf, 0, magic.length);
    for (let i = 0; i < magic.length; i++) {
        if (view[i] !== magic[i]) {
            return false;
        }
    }
    return true;
}

function isHtmlFallbackBinary(contentType: string | null, buf: ArrayBuffer): boolean {
    if (contentType && contentType.toLowerCase().includes('text/html')) {
        return true;
    }
    return bytesStartWith(buf, HTML_FALLBACK_MAGIC) || bytesStartWith(buf, HTML_FALLBACK_MAGIC_2);
}

/**
 * Simple IndexedDB cache for binary file data.
 * Files rarely change, so we cache them indefinitely.
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- static utility class with shared state via static properties
class FileCache {
    private static DB_NAME = 'settlers-file-cache';
    private static DB_VERSION = 1;
    private static STORE_NAME = 'files';
    private static db: IDBDatabase | null = null;
    private static dbPromise: Promise<IDBDatabase | null> | null = null;

    private static async openDb(): Promise<IDBDatabase | null> {
        if (this.db) {
            return this.db;
        }
        if (this.dbPromise) {
            return this.dbPromise;
        }

        this.dbPromise = new Promise(resolve => {
            try {
                const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
                request.onerror = () => resolve(null);
                request.onsuccess = () => {
                    this.db = request.result;
                    resolve(this.db);
                };
                request.onupgradeneeded = event => {
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
        if (!db) {
            return null;
        }

        return new Promise(resolve => {
            try {
                const tx = db.transaction(this.STORE_NAME, 'readonly');
                const store = tx.objectStore(this.STORE_NAME);
                const request = store.get(key);
                // eslint-disable-next-line no-restricted-syntax -- value is nullable by API contract; null coercion
                request.onsuccess = () => resolve(request.result ?? null);
                request.onerror = () => resolve(null);
            } catch {
                resolve(null);
            }
        });
    }

    static async set(key: string, data: ArrayBuffer): Promise<void> {
        const db = await this.openDb();
        if (!db) {
            return;
        }

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

            xhr.onload = async () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    const contentType = xhr.getResponseHeader('content-type');
                    if (isHtmlFallbackBinary(contentType, xhr.response)) {
                        RemoteFile.log.error('missing asset (SPA fallback): ' + url);
                        reportAssetError({ path: url, reason: 'missing' });
                        reject(new MissingAssetError(url));
                        return;
                    }
                    // Cache GFX files for future use
                    if (this.cacheEnabled && this.isCacheableFile(url)) {
                        await FileCache.set(url, xhr.response);
                    }

                    const reader = new BinaryReader(xhr.response, 0, undefined, this.filenameFormUrl(url));
                    resolve(reader);
                } else {
                    RemoteFile.log.error('error load file:' + url);
                    reportAssetError({ path: url, reason: 'missing', detail: `HTTP ${xhr.status}` });
                    reject(new RequestError(xhr.status, xhr.statusText));
                }
            };

            xhr.onerror = () => {
                RemoteFile.log.error('error load file:' + url);
                reportAssetError({ path: url, reason: 'missing', detail: xhr.statusText || 'network error' });
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
        return (
            lower.includes('/gfx/') &&
            (lower.endsWith('.gfx') ||
                lower.endsWith('.gil') ||
                lower.endsWith('.jil') ||
                lower.endsWith('.dil') ||
                lower.endsWith('.pil') ||
                lower.endsWith('.pi4') ||
                lower.endsWith('.pa6') ||
                lower.endsWith('.p46'))
        );
    }

    /**
     * load string data from URL.
     * @param url      Asset URL
     * @param options  expectsHtml: set true when the asset legitimately is HTML; otherwise an HTML body
     *                 is treated as a SPA fallback (= missing) and the promise rejects.
     */
    public loadString(url: string, options: { expectsHtml?: boolean } = {}): Promise<string> {
        const { expectsHtml = false } = options;
        RemoteFile.log.debug('Load file as string: ' + url);

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();

            xhr.onload = () => {
                if (xhr.status < 200 || xhr.status >= 300) {
                    RemoteFile.log.error('error load file:' + url);
                    reportAssetError({ path: url, reason: 'missing', detail: `HTTP ${xhr.status}` });
                    reject(new RequestError(xhr.status, xhr.statusText));
                    return;
                }
                const body = typeof xhr.response === 'string' ? xhr.response : '';
                if (!expectsHtml && looksLikeHtmlFallback(body)) {
                    RemoteFile.log.error('missing asset (SPA fallback): ' + url);
                    reportAssetError({ path: url, reason: 'missing' });
                    reject(new MissingAssetError(url));
                    return;
                }
                resolve(body);
            };

            xhr.onerror = () => {
                RemoteFile.log.error('error load file:' + url);
                reportAssetError({ path: url, reason: 'missing', detail: xhr.statusText || 'network error' });
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

        url = url.substring(0, url.indexOf('#') === -1 ? url.length : url.indexOf('#'));
        url = url.substring(0, url.indexOf('?') === -1 ? url.length : url.indexOf('?'));
        url = url.substring(url.lastIndexOf('/') + 1, url.length);

        return url;
    }
}
