/**
 * AmbientSounds — background sounds chosen from what the camera is looking at.
 *
 * A few times per second a random spot inside the audible area is sampled. Its terrain
 * (sea, river, beach, desert, mountain/snow, swamp, or land next to trees) decides which
 * ambient sound may play there; animal farms and beekeepers nearby add animal noises.
 * Each source rests for the length of its clip plus a pause, so long recordings
 * (waves, wind) don't stack, and only a few ambient sounds play at once.
 *
 * Presentation only — never touches game state.
 */

import type { SoundName } from './sound-manifest';
import { positionalMix, type SoundListener } from './sound-position';
import { randomUnit } from './random-unit';

export type AmbientSource =
    | 'ocean'
    | 'river'
    | 'beach'
    | 'desert'
    | 'mountain'
    | 'swamp'
    | 'forest'
    | 'pigs'
    | 'donkeys'
    | 'bees';

interface AmbientDef {
    sound: SoundName;
    /** Volume relative to other effects (tuned by ear; SoundFX.cfg values are not usable as-is) */
    gain: number;
    /** Average pause after the clip ends before this source plays again */
    restMs: number;
}

const AMBIENT: Record<AmbientSource, AmbientDef> = {
    ocean: { sound: 'AMB_OCEAN', gain: 0.45, restMs: 0 },
    river: { sound: 'AMB_RIVER', gain: 0.4, restMs: 0 },
    beach: { sound: 'ANIMAL_SEAGUL', gain: 0.35, restMs: 4000 },
    desert: { sound: 'AMB_DESERT', gain: 0.3, restMs: 2000 },
    mountain: { sound: 'AMB_WIND', gain: 0.3, restMs: 2000 },
    swamp: { sound: 'ANIMAL_BUG', gain: 0.3, restMs: 2000 },
    forest: { sound: 'AMB_BIRD', gain: 0.35, restMs: 1200 },
    pigs: { sound: 'ANIMAL_PIG', gain: 0.45, restMs: 5000 },
    donkeys: { sound: 'ANIMAL_DONKEY', gain: 0.45, restMs: 6000 },
    bees: { sound: 'AMB_BEES', gain: 0.35, restMs: 3000 },
};

/** How often a new ambient sound is considered. */
const ATTEMPT_INTERVAL_MS = 500;
/** Max ambient sounds playing at the same time. */
const MAX_ACTIVE = 3;
/** Chance that an attempt listens to a nearby animal building instead of the terrain. */
const BUILDING_CHANCE = 0.3;
/** Trees within this many tiles make a spot count as "forest". */
const TREE_RADIUS = 3;

export interface AmbientPoint {
    x: number;
    y: number;
    source: AmbientSource;
}

export interface AmbientSoundsDeps {
    /** Raw ground type at a tile, or null outside the map */
    groundTypeAt(x: number, y: number): number | null;
    hasTreeNear(x: number, y: number, radius: number): boolean;
    /** Finished buildings near the listener that make ambient noise (animal farms, beekeepers) */
    noisyBuildingsNear(listener: SoundListener): AmbientPoint[];
    play(name: SoundName, gain: number, pan: number): number | null;
}

/**
 * Ambient source for a ground type (LandscapeType values from the map file).
 * `treeNear` is only called for plain land.
 */
export function classifyTerrain(groundType: number, treeNear: () => boolean): AmbientSource | null {
    if (groundType <= 8) {
        return 'ocean';
    }
    if (groundType >= 96 && groundType <= 99) {
        return 'river';
    }
    switch (groundType) {
        case 48:
            return 'beach';
        case 64: // desert
        case 65:
            return 'desert';
        case 32: // rock
        case 35: // snow ↔ rock
        case 128: // snow
        case 129:
            return 'mountain';
        case 80: // swamp
        case 81:
            return 'swamp';
        default:
            return treeNear() ? 'forest' : null;
    }
}

export class AmbientSounds {
    private nextAttemptAt = 0;
    private busyUntil = new Map<AmbientSource, number>();
    private activeEnds: number[] = [];

    constructor(private readonly deps: AmbientSoundsDeps) {}

    /** Call once per rendered frame. */
    update(listener: SoundListener, nowMs: number): void {
        if (nowMs < this.nextAttemptAt) {
            return;
        }
        this.nextAttemptAt = nowMs + ATTEMPT_INTERVAL_MS;
        this.activeEnds = this.activeEnds.filter(end => end > nowMs);
        if (this.activeEnds.length >= MAX_ACTIVE) {
            return;
        }

        const point = this.pickPoint(listener);
        if (!point || this.isResting(point.source, nowMs)) {
            return;
        }
        const mix = positionalMix(listener, point);
        if (!mix) {
            return;
        }
        const def = AMBIENT[point.source];
        const duration = this.deps.play(def.sound, mix.gain * def.gain, mix.pan);
        if (duration === null) {
            return;
        }
        const end = nowMs + duration * 1000;
        this.activeEnds.push(end);
        this.busyUntil.set(point.source, end + def.restMs * (0.5 + randomUnit()));
    }

    private isResting(source: AmbientSource, nowMs: number): boolean {
        const until = this.busyUntil.get(source);
        return until !== undefined && until > nowMs;
    }

    private pickPoint(listener: SoundListener): AmbientPoint | null {
        if (randomUnit() < BUILDING_CHANCE) {
            const buildings = this.deps.noisyBuildingsNear(listener);
            if (buildings.length > 0) {
                return buildings[Math.floor(randomUnit() * buildings.length)]!;
            }
        }
        // Uniform random spot in the audible circle (screen space), converted back to tile coords
        const r = listener.radius * Math.sqrt(randomUnit());
        const angle = randomUnit() * Math.PI * 2;
        const y = Math.round(listener.y + r * Math.sin(angle));
        const x = Math.round(listener.x - listener.y * 0.5 + r * Math.cos(angle) + y * 0.5);
        const groundType = this.deps.groundTypeAt(x, y);
        if (groundType === null) {
            return null;
        }
        const source = classifyTerrain(groundType, () => this.deps.hasTreeNear(x, y, TREE_RADIUS));
        return source ? { x, y, source } : null;
    }
}
