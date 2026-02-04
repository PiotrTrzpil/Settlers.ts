import { IMapLoader } from '@/resources/map/imap-loader';
import { IMapLandscape } from '@/resources/map/imap-landscape';
import { GeneralMapInformation } from '@/resources/map/general-map-information';
import { MapSize } from '@/utilities/map-size';
import { LandscapeType } from './renderer/landscape/landscape-type';

const MAP_SIZE = 256;

/** Terrain band definitions as fractions of the map height */
const TERRAIN_BANDS: ReadonlyArray<{ frac0: number; frac1: number; type: LandscapeType }> = [
    { frac0: 0.00, frac1: 0.08, type: LandscapeType.Water7 },
    { frac0: 0.08, frac1: 0.14, type: LandscapeType.Beach },
    { frac0: 0.14, frac1: 0.22, type: LandscapeType.Grass },
    { frac0: 0.22, frac1: 0.28, type: LandscapeType.GrassDark },
    { frac0: 0.28, frac1: 0.34, type: LandscapeType.GrassDry },
    { frac0: 0.34, frac1: 0.40, type: LandscapeType.Desert },
    { frac0: 0.40, frac1: 0.46, type: LandscapeType.Rock },
    { frac0: 0.46, frac1: 0.52, type: LandscapeType.Swamp },
    { frac0: 0.52, frac1: 0.58, type: LandscapeType.Mud },
    { frac0: 0.58, frac1: 0.64, type: LandscapeType.Snow },
    { frac0: 0.64, frac1: 0.70, type: LandscapeType.DustyWay },
    { frac0: 0.70, frac1: 0.76, type: LandscapeType.RockyWay },
    // River gradient: Grass → River4 → River3 → River1
    { frac0: 0.76, frac1: 0.82, type: LandscapeType.Grass },
    { frac0: 0.82, frac1: 0.88, type: LandscapeType.River4 },
    { frac0: 0.88, frac1: 0.94, type: LandscapeType.River3 },
    { frac0: 0.94, frac1: 1.00, type: LandscapeType.River1 },
];

function getTerrainForRow(row: number): LandscapeType {
    const frac = row / MAP_SIZE;
    for (const band of TERRAIN_BANDS) {
        if (frac >= band.frac0 && frac < band.frac1) return band.type;
    }
    return LandscapeType.Grass;
}

/**
 * Creates a synthetic, deterministic IMapLoader for E2E testing.
 * The 256x256 map has horizontal bands of every major terrain type
 * with gentle height variation.
 */
export function createTestMapLoader(): IMapLoader {
    const mapSize = new MapSize(MAP_SIZE, MAP_SIZE);
    const total = MAP_SIZE * MAP_SIZE;
    const groundType = new Uint8Array(total);
    const groundHeight = new Uint8Array(total);

    for (let y = 0; y < MAP_SIZE; y++) {
        const terrainType = getTerrainForRow(y);
        for (let x = 0; x < MAP_SIZE; x++) {
            const idx = mapSize.toIndex(x, y);
            groundType[idx] = terrainType;
            // Gentle sine-wave height variation
            groundHeight[idx] = Math.floor(10 + 5 * Math.sin(x * 0.1) + 3 * Math.sin(y * 0.15));
        }
    }

    const landscape: IMapLandscape = {
        getGroundType: () => groundType,
        getGroundHeight: () => groundHeight,
    };

    const general = new GeneralMapInformation();

    return {
        landscape,
        general,
        mapSize,
    };
}
