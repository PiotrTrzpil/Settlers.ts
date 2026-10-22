#!/usr/bin/env npx tsx

/**
 * Extract Settlers 4 sound effects from your own game installation.
 *
 * Reads S4_Main.exe (sound names + variant table) and Snd/0.sil + Snd/0.snd (the sound
 * archive), converts every sound from IMA ADPCM to 16-bit PCM WAV and writes them, with a
 * sounds.json manifest, to public/Siedler4/Sfx/ — which is git-ignored. See docs/SOUND.md.
 *
 * Usage:
 *   pnpm sounds:extract <path-to-thesettlers4> [--out <dir>]
 *
 * Example:
 *   pnpm sounds:extract ~/Downloads/thesettlers4
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { BinaryReader } from '@/resources/file/binary-reader';
import { SilFileReader } from '@/resources/gfx/sil-file-reader';
import { SndFileReader } from '@/resources/gfx/snd-file-reader';
import { toPlayableWav } from './ima-adpcm-wav';
import { toSoundName, SOUND_MANIFEST_FILE, type SoundManifest } from '@/game/audio/sound-manifest';
import { readExeSoundTable } from './exe-sound-table';

const DEFAULT_OUT = path.resolve(import.meta.dirname, '../../public/Siedler4/Sfx');

/** Resolve a relative path inside the game folder case-insensitively (installs differ in casing). */
function findFile(root: string, relative: string): string | null {
    let current = root;
    for (const part of relative.split('/')) {
        if (!fs.existsSync(current) || !fs.statSync(current).isDirectory()) {
            return null;
        }
        const match = fs.readdirSync(current).find(e => e.toLowerCase() === part.toLowerCase());
        if (!match) {
            return null;
        }
        current = path.join(current, match);
    }
    return current;
}

function readBytes(file: string): Uint8Array {
    return new Uint8Array(fs.readFileSync(file));
}

/** Duration in seconds of a 16-bit PCM WAV produced by toPlayableWav. */
function pcmDuration(wav: Uint8Array): number {
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const byteRate = view.getUint32(28, true);
    const dataBytes = view.getUint32(40, true);
    return Math.round((dataBytes / byteRate) * 1000) / 1000;
}

function parseArgs(argv: string[]): { gameDir: string; outDir: string } {
    const args = [...argv];
    let outDir = DEFAULT_OUT;
    const outIndex = args.indexOf('--out');
    if (outIndex >= 0) {
        outDir = path.resolve(args[outIndex + 1] ?? '');
        args.splice(outIndex, 2);
    }
    const gameDir = args[0];
    if (!gameDir || args.includes('--help')) {
        console.log('Usage: pnpm sounds:extract <path-to-thesettlers4> [--out <dir>]');
        process.exit(gameDir ? 0 : 1);
    }
    return { gameDir: path.resolve(gameDir.replace(/^~(?=$|\/)/, process.env['HOME'] ?? '~')), outDir };
}

function main(): void {
    const { gameDir, outDir } = parseArgs(process.argv.slice(2));
    const exePath = findFile(gameDir, 'S4_Main.exe');
    const silPath = findFile(gameDir, 'Snd/0.sil');
    const sndPath = findFile(gameDir, 'Snd/0.snd');
    const missing = [
        ['S4_Main.exe', exePath],
        ['Snd/0.sil', silPath],
        ['Snd/0.snd', sndPath],
    ].filter(([, p]) => !p);
    if (missing.length > 0 || !exePath || !silPath || !sndPath) {
        console.error(`Missing in ${gameDir}: ${missing.map(([name]) => name).join(', ')}`);
        console.error('Point the job at your Settlers 4 game folder (the one containing S4_Main.exe and Snd/).');
        process.exit(1);
    }

    const sil = new SilFileReader(new BinaryReader(readBytes(silPath)));
    const archive = new SndFileReader(new BinaryReader(readBytes(sndPath)), sil);
    const table = readExeSoundTable(readBytes(exePath), archive.count);

    fs.mkdirSync(outDir, { recursive: true });
    for (const old of fs.readdirSync(outDir)) {
        if (old.endsWith('.wav') || old === SOUND_MANIFEST_FILE) {
            fs.rmSync(path.join(outDir, old));
        }
    }

    const manifest: SoundManifest = { version: 1, sounds: {} };
    let files = 0;
    let bytes = 0;
    for (const entry of table) {
        const name = toSoundName(entry.id);
        const variants = [];
        for (let i = 0; i < entry.count; i++) {
            const wav = archive.getWav(entry.firstSlot + i);
            if (!wav) {
                continue; // empty slot in the original archive (e.g. WORK_HEAL)
            }
            const pcm = toPlayableWav(wav);
            const file = `${name}_${i}.wav`;
            fs.writeFileSync(path.join(outDir, file), pcm);
            variants.push({ file, duration: pcmDuration(pcm) });
            files++;
            bytes += pcm.length;
        }
        if (variants.length > 0) {
            manifest.sounds[name] = variants;
        }
    }
    fs.writeFileSync(path.join(outDir, SOUND_MANIFEST_FILE), JSON.stringify(manifest, null, 1));

    const mb = (bytes / 1024 / 1024).toFixed(1);
    console.log(
        `Extracted ${files} sound files (${mb} MB) for ${Object.keys(manifest.sounds).length} sounds → ${outDir}`
    );
}

main();
