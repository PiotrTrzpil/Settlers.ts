/**
 * GameDataLoader - Loads and caches game data from XML files.
 *
 * This is a singleton that loads buildingInfo.xml, jobInfo.xml, and objectInfo.xml
 * once and provides access to the parsed data.
 */

import { LogHandler } from '@/utilities/log-handler';
import { RemoteFile } from '@/utilities/remote-file';
import type {
    GameData,
    RaceId,
    BuildingInfo,
    JobInfo,
    ObjectInfo,
} from './types';
import { parseBuildingInfo } from './building-info-parser';
import { parseJobInfo } from './job-info-parser';
import { parseObjectInfo } from './object-info-parser';

const log = new LogHandler('GameDataLoader');

const GAME_DATA_PATH = '/Siedler4/GameData';

export class GameDataLoader {
    private static instance: GameDataLoader | null = null;

    private data: GameData | null = null;
    private loadPromise: Promise<GameData> | null = null;

    private constructor() {}

    /** Get singleton instance */
    public static getInstance(): GameDataLoader {
        if (!GameDataLoader.instance) {
            GameDataLoader.instance = new GameDataLoader();
        }
        return GameDataLoader.instance;
    }

    /** Check if data is loaded */
    public isLoaded(): boolean {
        return this.data !== null;
    }

    /** Get loaded data (throws if not loaded) */
    public getData(): GameData {
        if (!this.data) {
            throw new Error('GameData not loaded. Call load() first.');
        }
        return this.data;
    }

    /**
     * Load all game data XML files.
     * Returns cached data if already loaded.
     */
    public async load(): Promise<GameData> {
        // Return cached data
        if (this.data) {
            return this.data;
        }

        // Return in-progress load
        if (this.loadPromise) {
            return this.loadPromise;
        }

        // Start loading
        this.loadPromise = this.doLoad();
        return this.loadPromise;
    }

    private async doLoad(): Promise<GameData> {
        const start = performance.now();
        const remoteFile = new RemoteFile();
        remoteFile.cacheEnabled = false; // XML files are small, no need to cache

        log.debug('Loading game data XML files...');

        // Load all XML files in parallel
        const [buildingXml, jobXml, objectXml] = await Promise.all([
            this.loadXmlFile(remoteFile, 'buildingInfo.xml'),
            this.loadXmlFile(remoteFile, 'jobInfo.xml'),
            this.loadXmlFile(remoteFile, 'objectInfo.xml'),
        ]);

        // Parse all files
        const buildings = buildingXml ? parseBuildingInfo(buildingXml) : new Map();
        const jobs = jobXml ? parseJobInfo(jobXml) : new Map();
        const objects = objectXml ? parseObjectInfo(objectXml) : new Map();

        this.data = { buildings, jobs, objects };

        const elapsed = Math.round(performance.now() - start);
        log.debug(`Game data loaded in ${elapsed}ms`);
        this.logStats();

        return this.data;
    }

    private async loadXmlFile(remoteFile: RemoteFile, filename: string): Promise<string | null> {
        const url = `${GAME_DATA_PATH}/${filename}`;
        try {
            const content = await remoteFile.loadString(url);
            return content;
        } catch (e) {
            log.warn(`Failed to load ${filename}: ${e}`);
            return null;
        }
    }

    private logStats(): void {
        if (!this.data) return;

        let totalBuildings = 0;
        let totalJobs = 0;

        for (const [raceId, raceData] of this.data.buildings) {
            log.debug(`  ${raceId}: ${raceData.buildings.size} buildings`);
            totalBuildings += raceData.buildings.size;
        }

        for (const [raceId, raceData] of this.data.jobs) {
            log.debug(`  ${raceId}: ${raceData.jobs.size} jobs`);
            totalJobs += raceData.jobs.size;
        }

        log.debug(`  Total: ${totalBuildings} buildings, ${totalJobs} jobs, ${this.data.objects.size} objects`);
    }

    // ============ Convenience getters ============

    /** Get building info for a specific race and building ID */
    public getBuilding(raceId: RaceId, buildingId: string): BuildingInfo | undefined {
        return this.data?.buildings.get(raceId)?.buildings.get(buildingId);
    }

    /** Get all buildings for a race */
    public getBuildingsForRace(raceId: RaceId): Map<string, BuildingInfo> | undefined {
        return this.data?.buildings.get(raceId)?.buildings;
    }

    /** Get job info for a specific race and job ID */
    public getJob(raceId: RaceId, jobId: string): JobInfo | undefined {
        return this.data?.jobs.get(raceId)?.jobs.get(jobId);
    }

    /** Get all jobs for a race */
    public getJobsForRace(raceId: RaceId): Map<string, JobInfo> | undefined {
        return this.data?.jobs.get(raceId)?.jobs;
    }

    /** Get object info by ID */
    public getObject(objectId: string): ObjectInfo | undefined {
        return this.data?.objects.get(objectId);
    }

    /** Get all objects */
    public getAllObjects(): Map<string, ObjectInfo> | undefined {
        return this.data?.objects;
    }
}

/** Convenience function to get the singleton instance */
export function getGameDataLoader(): GameDataLoader {
    return GameDataLoader.getInstance();
}
