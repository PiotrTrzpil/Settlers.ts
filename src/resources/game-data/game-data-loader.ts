/**
 * GameDataLoader - Loads and caches game data from XML files.
 *
 * This is a singleton that loads buildingInfo.xml, jobInfo.xml, and objectInfo.xml
 * once and provides access to the parsed data.
 */

import { LogHandler } from '@/utilities/log-handler';
import { RemoteFile } from '@/utilities/remote-file';
import type { GameData, RaceId, BuildingInfo, JobInfo, ObjectInfo, BuildingTrigger, SettlerValueInfo } from './types';
import { parseBuildingInfo } from './building-info-parser';
import { parseJobInfo } from './job-info-parser';
import { parseObjectInfo } from './object-info-parser';
import { parseBuildingTriggers } from './building-trigger-parser';
import { parseSettlerValues } from './settler-values-parser';

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

    /** Reset singleton for testing. Clears all loaded data. */
    public static resetInstance(): void {
        GameDataLoader.instance = null;
    }

    /** Inject pre-built GameData directly (for unit tests). */
    public setData(data: GameData): void {
        this.data = data;
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
        const [buildingXml, jobXml, objectXml, triggerXml, settlerXml] = await Promise.all([
            this.loadXmlFile(remoteFile, 'buildingInfo.xml'),
            this.loadXmlFile(remoteFile, 'jobInfo.xml'),
            this.loadXmlFile(remoteFile, 'objectInfo.xml'),
            this.loadXmlFile(remoteFile, 'BuildingTrigger.xml'),
            this.loadXmlFile(remoteFile, 'SettlerValues.xml'),
        ]);

        // Parse all files
        const buildings = buildingXml ? parseBuildingInfo(buildingXml) : new Map();
        const jobs = jobXml ? parseJobInfo(jobXml) : new Map();
        const objects = objectXml ? parseObjectInfo(objectXml) : new Map();
        const buildingTriggers = triggerXml ? parseBuildingTriggers(triggerXml) : new Map();
        const settlers = settlerXml ? parseSettlerValues(settlerXml) : new Map();

        this.data = { buildings, jobs, objects, buildingTriggers, settlers };

        const elapsed = Math.round(performance.now() - start);

        let totalBuildings = 0;
        let totalJobs = 0;
        let totalTriggers = 0;
        let totalSettlers = 0;
        for (const [, raceData] of this.data.buildings) {
            totalBuildings += raceData.buildings.size;
        }
        for (const [, raceData] of this.data.jobs) {
            totalJobs += raceData.jobs.size;
        }
        for (const [, raceData] of this.data.buildingTriggers) {
            totalTriggers += raceData.triggers.size;
        }
        for (const [, raceData] of this.data.settlers) {
            totalSettlers += raceData.settlers.size;
        }

        log.debug(
            `Game data loaded in ${elapsed}ms: ${totalBuildings} buildings, ${totalJobs} jobs, ` +
                `${this.data.objects.size} objects, ${totalTriggers} triggers, ${totalSettlers} settlers`
        );

        return this.data;
    }

    private async loadXmlFile(remoteFile: RemoteFile, filename: string): Promise<string | null> {
        const url = `${GAME_DATA_PATH}/${filename}`;
        try {
            const content = await remoteFile.loadString(url);
            return content;
        } catch (e) {
            log.warn(`Failed to load ${filename}: ${String(e)}`);
            return null;
        }
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

    /** Get a building trigger for a specific race and trigger ID */
    public getBuildingTrigger(raceId: RaceId, triggerId: string): BuildingTrigger | undefined {
        return this.data?.buildingTriggers.get(raceId)?.triggers.get(triggerId);
    }

    /** Get all building triggers for a race */
    public getBuildingTriggersForRace(raceId: RaceId): Map<string, BuildingTrigger> | undefined {
        return this.data?.buildingTriggers.get(raceId)?.triggers;
    }

    /** Get settler value info for a specific race and settler ID */
    public getSettler(raceId: RaceId, settlerId: string): SettlerValueInfo | undefined {
        return this.data?.settlers.get(raceId)?.settlers.get(settlerId);
    }
}

/** Convenience function to get the singleton instance */
export function getGameDataLoader(): GameDataLoader {
    return GameDataLoader.getInstance();
}
