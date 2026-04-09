/**
 * Frame correction loader — parses frame-corrections.yaml into the correction lookup maps.
 *
 * YAML structure: fileId → jobIndex → direction → frame: [dx, dy] or [dx, dy, true] for manual edits
 */

import { parse } from 'yaml';
import correctionsYaml from './frame-corrections.yaml?raw';

/** A pixel-level offset correction for a single animation frame. */
export interface FrameCorrection {
    /** 0-based frame index within the direction */
    frame: number;
    /** Horizontal pixel shift to apply (positive = move right) */
    dx: number;
    /** Vertical pixel shift to apply (positive = move down) */
    dy: number;
    /** True when set manually via JIL viewer (preserved on re-generation) */
    manual?: boolean;
}

/** Corrections for a specific direction within a job. */
export interface DirectionCorrection {
    /** DIL direction index (0=SE, 1=E, 2=SW, 3=NW, 4=W, 5=NE for 6-dir units) */
    direction: number;
    /** Per-frame corrections */
    frames: readonly FrameCorrection[];
}

type YamlShift = [number, number] | [number, number, true];
type YamlData = Record<string, Record<string, Record<string, Record<string, YamlShift>>>>;

function parseShift(frameStr: string, shift: YamlShift): FrameCorrection {
    const fc: FrameCorrection = { frame: Number(frameStr), dx: shift[0], dy: shift[1] };
    if (shift[2]) {
        fc.manual = true;
    }
    return fc;
}

function parseDirection(dirStr: string, frames: Record<string, YamlShift>): DirectionCorrection {
    const frameCorrections = Object.entries(frames).map(([f, s]) => parseShift(f, s));
    frameCorrections.sort((a, b) => a.frame - b.frame);
    return { direction: Number(dirStr), frames: frameCorrections };
}

function parseCorrections(raw: string): Map<number, Map<number, readonly DirectionCorrection[]>> {
    const data: YamlData = parse(raw) ?? {};
    const result = new Map<number, Map<number, readonly DirectionCorrection[]>>();

    for (const [fileIdStr, jobs] of Object.entries(data)) {
        const jobMap = new Map<number, readonly DirectionCorrection[]>();
        for (const [jobStr, dirs] of Object.entries(jobs)) {
            const directions = Object.entries(dirs).map(([d, f]) => parseDirection(d, f));
            directions.sort((a, b) => a.direction - b.direction);
            jobMap.set(Number(jobStr), directions);
        }
        result.set(Number(fileIdStr), jobMap);
    }

    return result;
}

/** All correction maps indexed by GFX file number. */
export const CORRECTIONS_BY_FILE: Map<number, Map<number, readonly DirectionCorrection[]>> =
    parseCorrections(correctionsYaml);

/** YAML file path relative to project root (for dev-mode saving). */
export const CORRECTIONS_YAML_PATH = 'src/game/renderer/sprite-metadata/frame-corrections.yaml';

/**
 * Update a single correction in the in-memory map.
 * Creates entries for file/job/direction if they don't exist yet.
 */
export function setCorrection(
    fileId: number,
    jobIndex: number,
    dirIndex: number,
    frameIndex: number,
    dx: number,
    dy: number
): void {
    if (!CORRECTIONS_BY_FILE.has(fileId)) {
        CORRECTIONS_BY_FILE.set(fileId, new Map());
    }
    const jobMap = CORRECTIONS_BY_FILE.get(fileId)!;

    const existingDirs = jobMap.get(jobIndex) as DirectionCorrection[] | undefined;
    if (!existingDirs) {
        jobMap.set(jobIndex, [{ direction: dirIndex, frames: [{ frame: frameIndex, dx, dy, manual: true }] }]);
        return;
    }

    let dir = existingDirs.find(d => d.direction === dirIndex);
    if (!dir) {
        dir = { direction: dirIndex, frames: [] };
        existingDirs.push(dir);
        existingDirs.sort((a, b) => a.direction - b.direction);
    }

    const frames = dir.frames as FrameCorrection[];
    const existing = frames.find(f => f.frame === frameIndex);
    if (existing) {
        existing.dx = dx;
        existing.dy = dy;
        existing.manual = true;
    } else {
        frames.push({ frame: frameIndex, dx, dy, manual: true });
        frames.sort((a, b) => a.frame - b.frame);
    }

    // Remove zero corrections
    if (dx === 0 && dy === 0) {
        const idx = frames.findIndex(f => f.frame === frameIndex);
        if (idx >= 0) {
            frames.splice(idx, 1);
        }
    }
}

function serializeJob(lines: string[], jobIndex: number, dirs: readonly DirectionCorrection[]): void {
    const activeDirs = dirs.filter(d => d.frames.length > 0);
    if (activeDirs.length === 0) {
        return;
    }
    lines.push(`  ${jobIndex}:`);
    for (const dir of activeDirs) {
        lines.push(`    ${dir.direction}:`);
        for (const f of dir.frames) {
            const suffix = f.manual ? ', true' : '';
            lines.push(`      ${f.frame}: [${f.dx}, ${f.dy}${suffix}]`);
        }
    }
}

/**
 * Serialize the current in-memory corrections back to YAML string.
 */
export function serializeCorrections(): string {
    const lines: string[] = [
        '# JIL frame offset corrections — fixes mispositioned frames in original game art.',
        '#',
        '# Structure: fileId → jobIndex → direction → frame: [dx, dy] or [dx, dy, true] for manual',
        '# Directions: 0=SE, 1=E, 2=SW, 3=NW, 4=W, 5=NE',
        '#',
        '# Auto-generated by: npx tsx scripts/generate-frame-corrections.ts',
        '# Manual edits (via JIL viewer Save) are preserved on re-generation.',
    ];

    for (const [fileId, jobMap] of [...CORRECTIONS_BY_FILE.entries()].sort((a, b) => a[0] - b[0])) {
        lines.push(`${fileId}:`);
        for (const [jobIndex, dirs] of [...jobMap.entries()].sort((a, b) => a[0] - b[0])) {
            serializeJob(lines, jobIndex, dirs);
        }
    }

    return lines.join('\n') + '\n';
}
