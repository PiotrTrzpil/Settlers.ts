/**
 * Synchronous loader for game data XML files using Node.js fs.
 *
 * Intended for use in headless/test environments where the browser fetch API is unavailable.
 * Polyfills DOMParser via jsdom when running in Node.js (the existing XML parsers use it).
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { JSDOM } from 'jsdom';
import type { GameData } from './types';
import { parseBuildingInfo } from './building-info-parser';
import { parseJobInfo } from './job-info-parser';
import { parseObjectInfo } from './object-info-parser';
import { parseBuildingTriggers } from './building-trigger-parser';
import { parseSettlerValues } from './settler-values-parser';

/** Ensure DOMParser is available globally (Node.js lacks it; the existing XML parsers need it). */
function ensureDOMParser(): void {
    if (typeof globalThis.DOMParser === 'undefined') {
        const dom = new JSDOM('');
        globalThis.DOMParser = dom.window.DOMParser;
    }
}

/**
 * Load and parse all game data XML files from the given base directory synchronously.
 *
 * If a file does not exist, the corresponding field will be an empty Map rather than throwing.
 * If a file exists but cannot be parsed, an error is thrown with the file name and cause.
 *
 * @param basePath - Path to the directory containing the XML files (e.g. 'public/Siedler4/GameData').
 *                   Resolved to an absolute path automatically.
 */
export function loadGameDataFromFiles(basePath: string): GameData {
    ensureDOMParser();
    const absPath = resolve(basePath);

    function readXml(filename: string): string | null {
        const filePath = resolve(absPath, filename);
        if (!existsSync(filePath)) return null;
        return readFileSync(filePath, 'utf-8');
    }

    function parseOrEmpty<T>(filename: string, xml: string | null, parser: (xml: string) => T, empty: T): T {
        if (xml === null) return empty;
        try {
            return parser(xml);
        } catch (e) {
            throw new Error(`Failed to parse ${filename}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
        }
    }

    const buildingXml = readXml('buildingInfo.xml');
    const jobXml = readXml('jobInfo.xml');
    const objectXml = readXml('objectInfo.xml');
    const triggerXml = readXml('BuildingTrigger.xml');
    const settlerXml = readXml('SettlerValues.xml');

    return {
        buildings: parseOrEmpty('buildingInfo.xml', buildingXml, parseBuildingInfo, new Map()),
        jobs: parseOrEmpty('jobInfo.xml', jobXml, parseJobInfo, new Map()),
        objects: parseOrEmpty('objectInfo.xml', objectXml, parseObjectInfo, new Map()),
        buildingTriggers: parseOrEmpty('BuildingTrigger.xml', triggerXml, parseBuildingTriggers, new Map()),
        settlers: parseOrEmpty('SettlerValues.xml', settlerXml, parseSettlerValues, new Map()),
    };
}
