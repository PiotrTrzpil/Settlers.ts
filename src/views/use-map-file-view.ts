import { ref, computed, type Ref, type ComputedRef } from 'vue';
import { MapLoader } from '@/resources/map/map-loader';
import { OriginalMapFile } from '@/resources/map/original/original-map-file';
import { MapChunk } from '@/resources/map/original/map-chunk';
import { MapChunkType } from '@/resources/map/original/map-chunk-type';
import type { IMapLoader } from '@/resources/map/imap-loader';
import type { MapEntityData } from '@/resources/map/map-entity-data';
import { FileManager, IFileSource } from '@/utilities/file-manager';
import { LogHandler } from '@/utilities/log-handler';
import { getGroundTypeName, parseResourceValue, S4Tribe, S4SettlerType, S4BuildingType, S4GoodType } from '@/resources/map/s4-types';

const log = new LogHandler('MapFileView');

/** Extended chunk info with additional display properties */
export interface ChunkInfo {
    chunk: MapChunk;
    typeName: string;
    category: 'general' | 'landscape' | 'entities' | 'player' | 'savegame' | 'unknown';
    icon: string;
}

/** Individual stat entry with name and count */
export interface StatEntry {
    value: number;
    name: string;
    count: number;
}

/** Statistics for map analysis */
export interface MapStats {
    /** Ground/terrain type breakdown */
    terrain: StatEntry[];
    /** Resource type breakdown */
    resources: StatEntry[];
    /** Object type breakdown (for compatibility) */
    objects: Record<number, number>;
    /** Resource summary by category */
    resourceSummary: {
        fish: number;
        coal: number;
        iron: number;
        gold: number;
        sulphur: number;
        stonemine: number;
        stone: number;
        wood: number;
    };
    totalTerrain: number;
    totalObjects: number;
    totalResources: number;
}

/** Map metadata extracted from the file */
export interface MapMetadata {
    version: string;
    sourceType: 'savegame' | 'map' | 'unknown';
    mapSize: { width: number; height: number } | null;
    chunkCount: number;
}

/** Chunk type to category mapping */
const chunkCategoryMap: Partial<Record<MapChunkType, ChunkInfo['category']>> = {
    [MapChunkType.MapGeneralInformation]: 'general',
    [MapChunkType.SaveGameGeneralInformation]: 'general',
    [MapChunkType.MapPreview]: 'general',
    [MapChunkType.MapLandscape]: 'landscape',
    [MapChunkType.SaveGameMapLandscape]: 'landscape',
    [MapChunkType.MapObjects]: 'entities',
    [MapChunkType.MapSettlers]: 'entities',
    [MapChunkType.MapBuildings]: 'entities',
    [MapChunkType.MapStacks]: 'entities',
    [MapChunkType.SaveGameMapObjects]: 'entities',
    [MapChunkType.SaveGameSettlers]: 'entities',
    [MapChunkType.SaveGameBuildings]: 'entities',
    [MapChunkType.SaveGamePiles]: 'entities',
    [MapChunkType.SaveGameAnimals]: 'entities',
    [MapChunkType.SaveGameVehicles]: 'entities',
    [MapChunkType.SaveGameDecoObjects]: 'entities',
    [MapChunkType.MapPlayerInformation]: 'player',
    [MapChunkType.MapTeamInformation]: 'player',
    [MapChunkType.SaveGamePlayers]: 'player',
    [MapChunkType.SaveGameStatistic1]: 'player',
    [MapChunkType.SaveGameStatistic2]: 'player',
    [MapChunkType.SaveGameGroups]: 'player',
    [MapChunkType.SaveGameCommentText]: 'savegame',
    [MapChunkType.SaveGameFog]: 'savegame',
    [MapChunkType.SaveGameLogo]: 'savegame',
    [MapChunkType.SaveGameCurrent]: 'savegame',
    [MapChunkType.SaveGameFutureEvents]: 'savegame',
    [MapChunkType.SaveGameEffects]: 'savegame',
    [MapChunkType.SaveGameAI]: 'savegame',
    [MapChunkType.SaveGameES]: 'savegame',
    [MapChunkType.SaveGameScript]: 'savegame',
    [MapChunkType.SaveGameFlyingEntities]: 'savegame',
    [MapChunkType.SaveGameTraders]: 'savegame',
};

/** Get category for a chunk type */
function getChunkCategory(type: MapChunkType): ChunkInfo['category'] {
    return chunkCategoryMap[type] ?? 'unknown';
}

/** Get icon for a chunk category */
function getCategoryIcon(category: ChunkInfo['category']): string {
    switch (category) {
    case 'general': return '📋';
    case 'landscape': return '🗺️';
    case 'entities': return '🏠';
    case 'player': return '👤';
    case 'savegame': return '💾';
    default: return '❓';
    }
}

/** Convert a MapChunk to ChunkInfo with display properties */
function toChunkInfo(chunk: MapChunk): ChunkInfo {
    const category = getChunkCategory(chunk.chunkType);
    return {
        chunk,
        typeName: chunk.chunkTypeAsString || `Unknown (${chunk.chunkType})`,
        category,
        icon: getCategoryIcon(category),
    };
}

/** Analyze bytes and count non-zero values */
function analyzeBytes(data: Uint8Array): Record<number, number> {
    const counts: Record<number, number> = {};
    for (let i = 0; i < data.length; i++) {
        const val = data[i];
        if (val === 0) continue;
        counts[val] = (counts[val] || 0) + 1;
    }
    return counts;
}

/** Calculate statistics from map loader */
function calculateStats(loader: IMapLoader): MapStats | null {
    const l = loader.landscape;
    if (!l) return null;

    const terrainList: StatEntry[] = [];
    const resourceList: StatEntry[] = [];
    const objectCounts: Record<number, number> = {};
    const resourceSummary = {
        fish: 0,
        coal: 0,
        iron: 0,
        gold: 0,
        sulphur: 0,
        stonemine: 0,
        stone: 0,
        wood: 0,
    };
    let totalTerrain = 0;
    let totalObjects = 0;
    let totalResources = 0;

    // Analyze terrain types (byte 1 of WorldField - terrainId)
    const groundData = l.getGroundType();
    if (groundData) {
        const terrainCounts = analyzeBytes(groundData);
        for (const [val, count] of Object.entries(terrainCounts)) {
            terrainList.push({
                value: Number(val),
                name: getGroundTypeName(Number(val)),
                count,
            });
            totalTerrain += count;
        }
        terrainList.sort((a, b) => b.count - a.count);
    }

    // Analyze terrain attributes (byte 2 - dark land, pond, sun level)
    // Note: Trees are NOT stored here - they're in MapObjects chunk (type 6)
    if (l.getTerrainAttributes) {
        const data = l.getTerrainAttributes();
        Object.assign(objectCounts, analyzeBytes(data));
        totalObjects = Object.values(objectCounts).reduce((a, b) => a + b, 0);
    }

    // Analyze gameplay attributes (byte 3 - founding stone, fog of war)
    if (l.getGameplayAttributes) {
        const data = l.getGameplayAttributes();
        const resourceCounts = analyzeBytes(data);

        for (const [val, count] of Object.entries(resourceCounts)) {
            const parsed = parseResourceValue(Number(val));
            resourceList.push({
                value: Number(val),
                name: parsed.name,
                count,
            });

            // Aggregate by category
            const key = parsed.type as keyof typeof resourceSummary;
            if (key in resourceSummary) {
                resourceSummary[key] += count;
            }
            totalResources += count;
        }
        resourceList.sort((a, b) => b.count - a.count);
    }

    return {
        terrain: terrainList,
        resources: resourceList,
        objects: objectCounts,
        resourceSummary,
        totalTerrain,
        totalObjects,
        totalResources,
    };
}

/** Process entity data into display summary */
function processEntityData(entityData: MapEntityData | undefined): EntitySummary | null {
    if (!entityData) return null;

    const summary: EntitySummary = {
        players: [],
        settlers: [],
        buildings: [],
        stacks: [],
        totals: {
            players: entityData.players.length,
            settlers: entityData.settlers.length,
            buildings: entityData.buildings.length,
            stacks: entityData.stacks.length,
        },
    };

    // Process players
    for (const p of entityData.players) {
        summary.players.push({
            index: p.playerIndex,
            tribe: S4Tribe[p.tribe] ?? `Unknown(${p.tribe})`,
            startX: p.startX,
            startY: p.startY,
        });
    }

    // Aggregate settlers by type and player
    const settlerMap = new Map<string, { type: string; count: number; player: number }>();
    for (const s of entityData.settlers) {
        const key = `${s.settlerType}-${s.player}`;
        const existing = settlerMap.get(key);
        if (existing) {
            existing.count++;
        } else {
            settlerMap.set(key, {
                type: S4SettlerType[s.settlerType] ?? `Unknown(${s.settlerType})`,
                count: 1,
                player: s.player,
            });
        }
    }
    summary.settlers = Array.from(settlerMap.values()).sort((a, b) => b.count - a.count);

    // Aggregate buildings by type and player
    const buildingMap = new Map<string, { type: string; count: number; player: number }>();
    for (const b of entityData.buildings) {
        const key = `${b.buildingType}-${b.player}`;
        const existing = buildingMap.get(key);
        if (existing) {
            existing.count++;
        } else {
            buildingMap.set(key, {
                type: S4BuildingType[b.buildingType] ?? `Unknown(${b.buildingType})`,
                count: 1,
                player: b.player,
            });
        }
    }
    summary.buildings = Array.from(buildingMap.values()).sort((a, b) => b.count - a.count);

    // Aggregate stacks by material type
    const stackMap = new Map<number, { type: string; totalAmount: number }>();
    for (const s of entityData.stacks) {
        const existing = stackMap.get(s.materialType);
        if (existing) {
            existing.totalAmount += s.amount;
        } else {
            stackMap.set(s.materialType, {
                type: S4GoodType[s.materialType] ?? `Unknown(${s.materialType})`,
                totalAmount: s.amount,
            });
        }
    }
    summary.stacks = Array.from(stackMap.values()).sort((a, b) => b.totalAmount - a.totalAmount);

    return summary;
}

/** Format file size in human-readable format */
export function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Group chunks by category */
export function groupChunksByCategory(chunks: ChunkInfo[]): Record<ChunkInfo['category'], ChunkInfo[]> {
    const groups: Record<ChunkInfo['category'], ChunkInfo[]> = {
        general: [],
        landscape: [],
        entities: [],
        player: [],
        savegame: [],
        unknown: [],
    };

    for (const chunk of chunks) {
        groups[chunk.category].push(chunk);
    }

    return groups;
}

/** Processed entity summary for display */
export interface EntitySummary {
    players: Array<{
        index: number;
        tribe: string;
        startX?: number;
        startY?: number;
    }>;
    settlers: Array<{
        type: string;
        count: number;
        player: number;
    }>;
    buildings: Array<{
        type: string;
        count: number;
        player: number;
    }>;
    stacks: Array<{
        type: string;
        totalAmount: number;
    }>;
    totals: {
        players: number;
        settlers: number;
        buildings: number;
        stacks: number;
    };
}

export interface UseMapFileViewReturn {
    // State
    fileName: Ref<string | null>;
    mapInfo: Ref<string>;
    mapLoader: Ref<IMapLoader | null>;
    chunks: Ref<ChunkInfo[]>;
    selectedChunk: Ref<ChunkInfo | null>;
    stats: Ref<MapStats | null>;
    entitySummary: Ref<EntitySummary | null>;
    metadata: ComputedRef<MapMetadata | null>;
    isLoading: Ref<boolean>;
    error: Ref<string | null>;

    // Computed
    groupedChunks: ComputedRef<Record<ChunkInfo['category'], ChunkInfo[]>>;
    previewChunk: ComputedRef<MapChunk | null>;

    // Actions
    onFileSelect: (file: IFileSource) => void;
    selectChunk: (chunk: ChunkInfo | null) => void;
}

export function useMapFileView(
    getFileManager: () => FileManager | null
): UseMapFileViewReturn {
    const fileName = ref<string | null>(null);
    const mapInfo = ref('');
    const mapLoader = ref<IMapLoader | null>(null);
    const mapFile = ref<OriginalMapFile | null>(null);
    const chunks = ref<ChunkInfo[]>([]);
    const selectedChunk = ref<ChunkInfo | null>(null);
    const stats = ref<MapStats | null>(null);
    const entitySummary = ref<EntitySummary | null>(null);
    const isLoading = ref(false);
    const error = ref<string | null>(null);

    const metadata = computed<MapMetadata | null>(() => {
        if (!mapLoader.value || !mapFile.value) return null;

        const loader = mapLoader.value;
        return {
            version: loader.toString().split('\n')[0] || 'Unknown',
            sourceType: loader.toString().includes('SaveGame') ? 'savegame' : 'map',
            mapSize: loader.mapSize,
            chunkCount: mapFile.value.getChunkCount(),
        };
    });

    const groupedChunks = computed(() => groupChunksByCategory(chunks.value));

    const previewChunk = computed<MapChunk | null>(() => {
        const preview = chunks.value.find((c: ChunkInfo) => c.chunk.chunkType === MapChunkType.MapPreview);
        return preview?.chunk ?? null;
    });

    function onFileSelect(file: IFileSource) {
        fileName.value = file.name;
        void loadFile(file);
    }

    async function loadFile(file: IFileSource) {
        const fm = getFileManager();
        if (!fm) {
            error.value = 'File manager not available';
            return;
        }

        isLoading.value = true;
        error.value = null;
        selectedChunk.value = null;

        try {
            const fileData = await file.readBinary();
            if (!fileData) {
                throw new Error('Unable to read file: ' + file.name);
            }

            const loader = MapLoader.getLoader(fileData);
            if (!loader) {
                throw new Error('Unsupported file format: ' + file.name);
            }

            mapLoader.value = loader;
            mapInfo.value = loader.toString();

            // Cast to OriginalMapFile to access chunks
            const origFile = loader as unknown as OriginalMapFile;
            if (typeof origFile.getChunkCount === 'function') {
                mapFile.value = origFile;
                chunks.value = buildChunkList(origFile);
            } else {
                mapFile.value = null;
                chunks.value = [];
            }

            stats.value = calculateStats(loader);
            entitySummary.value = processEntityData(loader.entityData);
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            log.error('Failed to load file', e instanceof Error ? e : new Error(message));
            error.value = message;
            mapLoader.value = null;
            mapFile.value = null;
            chunks.value = [];
            stats.value = null;
            entitySummary.value = null;
        } finally {
            isLoading.value = false;
        }
    }

    function buildChunkList(map: OriginalMapFile): ChunkInfo[] {
        const list: ChunkInfo[] = [];
        const count = map.getChunkCount();
        for (let i = 0; i < count; i++) {
            const chunk = map.getChunkByIndex(i);
            list.push(toChunkInfo(chunk));
        }
        return list;
    }

    function selectChunk(chunk: ChunkInfo | null) {
        selectedChunk.value = chunk;
    }

    return {
        fileName,
        mapInfo,
        mapLoader,
        chunks,
        selectedChunk,
        stats,
        entitySummary,
        metadata,
        isLoading,
        error,
        groupedChunks,
        previewChunk,
        onFileSelect,
        selectChunk,
    };
}
