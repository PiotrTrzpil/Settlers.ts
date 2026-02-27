/**
 * Building sprite loading — completed, construction, and animated building sprites.
 * Extracted from SpriteRenderManager to keep file size under the max-lines limit.
 */

import { LogHandler } from '@/utilities/log-handler';
import { EntityTextureAtlas } from '../entity-texture-atlas';
import {
    SpriteMetadataRegistry,
    SpriteEntry,
    Race,
    getBuildingSpriteMap,
    GFX_FILE_NUMBERS,
    BUILDING_DIRECTION,
    AVAILABLE_RACES,
    type BuildingSpriteInfo,
} from '../sprite-metadata';
import { ANIMATION_DEFAULTS } from '@/game/animation';
import { SpriteLoader, type LoadedGfxFileSet } from '../sprite-loader';
import { SafeLoadBatch, yieldToEventLoop } from '../batch-loader';
import { BuildingType, EntityType } from '@/game/entity';
import { isBuildingAvailableForRace } from '@/game/race-availability';

const log = new LogHandler('BuildingSpriteLoader');

export interface BuildingLoadContext {
    spriteLoader: SpriteLoader;
    getPaletteBaseOffset: (fileId: string) => number;
}

/** Load sprites for a single building. Returns null if no sprite data is found. */
async function loadOneBuildingSprites(
    spriteLoader: SpriteLoader,
    fileSet: LoadedGfxFileSet,
    buildingType: BuildingType,
    info: BuildingSpriteInfo,
    atlas: EntityTextureAtlas,
    paletteBase: number,
    race: Race
): Promise<{
    constructionEntry: SpriteEntry | null;
    completedEntry: SpriteEntry | null;
    animationFrames: SpriteEntry[] | null;
} | null> {
    // Some buildings store construction/completed as separate JIL jobs
    // (e.g., SunflowerFarmerHut uses JIL #109 for construction, #110 for completed)
    const hasSplitJobs = info.constructionIndex !== undefined;
    const constructionJobIndex = info.constructionIndex ?? info.index;
    const constructionDirIndex = hasSplitJobs ? 0 : BUILDING_DIRECTION.CONSTRUCTION;
    const completedDirIndex = hasSplitJobs ? 0 : BUILDING_DIRECTION.COMPLETED;

    const dirCount = spriteLoader.getDirectionCount(fileSet, constructionJobIndex);
    if (dirCount === 0) {
        log.warn(
            `No sprite directions for ${BuildingType[buildingType]} (job ${constructionJobIndex}) in ${Race[race]} file`
        );
        return null;
    }

    const constructionSprite = await spriteLoader.loadJobSprite(
        fileSet,
        { jobIndex: constructionJobIndex, directionIndex: constructionDirIndex },
        atlas,
        paletteBase
    );

    const frameCount = spriteLoader.getFrameCount(fileSet, info.index, completedDirIndex);
    let completedSprite = null;
    let animationFrames: SpriteEntry[] | null = null;

    if (frameCount > 1) {
        const anim = await spriteLoader.loadJobAnimation(fileSet, info.index, completedDirIndex, atlas, paletteBase);
        if (anim?.frames.length) {
            animationFrames = anim.frames.map(f => f.entry);
            completedSprite = anim.frames[0];
        }
    } else {
        completedSprite = await spriteLoader.loadJobSprite(
            fileSet,
            { jobIndex: info.index, directionIndex: completedDirIndex },
            atlas,
            paletteBase
        );
    }

    return {
        constructionEntry: constructionSprite?.entry ?? null,
        completedEntry: completedSprite?.entry ?? null,
        animationFrames,
    };
}

/**
 * Load building sprites from a GFX file set.
 * Uses SafeLoadBatch to ensure GPU upload before registration.
 */
async function loadBuildingSpritesForFile(
    fileNum: number,
    atlas: EntityTextureAtlas,
    registry: SpriteMetadataRegistry,
    spriteMap: Partial<Record<BuildingType, BuildingSpriteInfo>>,
    gl: WebGL2RenderingContext,
    race: Race,
    ctx: BuildingLoadContext
): Promise<boolean> {
    const fileId = `${fileNum}`;
    const fileSet = await ctx.spriteLoader.loadFileSet(fileId);
    if (!fileSet?.jilReader || !fileSet.dilReader) {
        log.debug(`GFX/JIL/DIL files not available for ${fileNum}`);
        return false;
    }

    const paletteBase = ctx.getPaletteBaseOffset(fileId);

    try {
        type BuildingData = {
            buildingType: BuildingType;
            constructionEntry: SpriteEntry | null;
            completedEntry: SpriteEntry | null;
            animationFrames: SpriteEntry[] | null;
        };

        const batch = new SafeLoadBatch<BuildingData>();

        // Load all buildings for this file (skip buildings unavailable to this race)
        for (const [typeStr, info] of Object.entries(spriteMap)) {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Partial<Record> values may be undefined
            if (!info || info.file !== fileNum) continue;
            const buildingType = Number(typeStr) as BuildingType;
            if (!isBuildingAvailableForRace(buildingType, race)) continue;

            const sprites = await loadOneBuildingSprites(
                ctx.spriteLoader,
                fileSet,
                buildingType,
                info,
                atlas,
                paletteBase,
                race
            );
            if (sprites) batch.add({ buildingType, ...sprites });
        }

        // Finalize: GPU upload → register
        batch.finalize(atlas, gl, data => {
            if (!data.constructionEntry && !data.completedEntry) return;

            if (data.animationFrames) {
                const frames = new Map([[BUILDING_DIRECTION.COMPLETED, data.animationFrames]]);
                registry.registerAnimatedEntity(
                    EntityType.Building,
                    data.buildingType,
                    frames,
                    ANIMATION_DEFAULTS.FRAME_DURATION_MS,
                    true,
                    race
                );
            }
            registry.registerBuilding(data.buildingType, data.constructionEntry, data.completedEntry, race);
        });

        return batch.count > 0;
    } catch (e) {
        log.error(`Failed to load GFX file ${fileNum}: ${e}`);
        return false;
    }
}

/**
 * Load all building sprites for all available races.
 * Returns true if any building sprites were loaded.
 */
export async function loadBuildingSprites(
    atlas: EntityTextureAtlas,
    registry: SpriteMetadataRegistry,
    gl: WebGL2RenderingContext,
    ctx: BuildingLoadContext
): Promise<{ loaded: boolean; buildingFiles: Set<number> }> {
    const racesToLoad = AVAILABLE_RACES;

    // Collect all building GFX files across all races
    const buildingFiles = new Set<number>();
    const spriteMapsPerRace = new Map<Race, Partial<Record<BuildingType, BuildingSpriteInfo>>>();
    for (const r of racesToLoad) {
        const spriteMap = getBuildingSpriteMap(r);
        spriteMapsPerRace.set(r, spriteMap);
        for (const info of Object.values(spriteMap)) {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Partial values
            if (info) buildingFiles.add(info.file);
        }
    }

    if (buildingFiles.size === 0) {
        log.debug('No building sprites configured');
        return { loaded: false, buildingFiles };
    }

    let loadedAny = false;
    for (const r of racesToLoad) {
        const spriteMap = spriteMapsPerRace.get(r)!;
        for (const fileNum of buildingFiles) {
            if (await loadBuildingSpritesForFile(fileNum, atlas, registry, spriteMap, gl, r, ctx)) {
                loadedAny = true;
            }
        }
        await yieldToEventLoop();
    }

    return { loaded: loadedAny, buildingFiles };
}

/** Collect all building GFX file numbers across all races. */
export function collectBuildingFileNumbers(): Set<number> {
    const buildingFiles = new Set<number>();
    // Always include MAP_OBJECTS and RESOURCES in preload
    buildingFiles.add(GFX_FILE_NUMBERS.MAP_OBJECTS);
    buildingFiles.add(GFX_FILE_NUMBERS.RESOURCES);
    for (const r of AVAILABLE_RACES) {
        const spriteMap = getBuildingSpriteMap(r);
        for (const info of Object.values(spriteMap)) {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Partial values
            if (info) buildingFiles.add(info.file);
        }
    }
    return buildingFiles;
}
