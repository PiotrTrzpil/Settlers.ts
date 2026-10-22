# Sound Effects

Settlers.ts plays the original Settlers 4 sound effects, but **no game audio is part of this
repository** — not the original files and not converted ones. Every player extracts the sounds from
their own copy of the game with a one-off job. The output lands in `public/Siedler4/`, which is
git-ignored like all other game assets.

## Quick start

```sh
pnpm sounds:extract /path/to/thesettlers4
```

Point it at the game folder — the one containing `S4_Main.exe` and `Snd/`. It takes about a second
and writes ~300 WAV files (~40 MB) plus `sounds.json` to `public/Siedler4/Sfx/`. Reload the game
afterwards. Re-running the job replaces the previous output.

Without this step the game still runs; sound effects are simply silent and the browser console
says which command to run. Music is unaffected (it is read directly from `Snd/*.mp3`).

> The Windows export (`scripts/export-game-files.ps1`) does not copy `S4_Main.exe`, so run the
> job against the installed game folder itself.

## What the job reads

| File | What it contains |
|------|------------------|
| `Snd/0.snd` | The sound archive: ~300 WAV recordings in numbered *slots*, no names |
| `Snd/0.sil` | Slot index: where each slot starts in `0.snd` |
| `S4_Main.exe` | The tables that say which slots belong to which sound (e.g. `SOUND_WORK_AXE`) |

`GameData/jobSoundList.xml` (which animation frame plays which sound) is read by the game at
runtime from the normal game assets — it is not touched by the job.

## How the sounds are extracted

### 1. Slot index — `0.sil`

A 20-byte resource header, then one little-endian `int32` per slot: the absolute byte offset of that
slot's entry in `0.snd`, or `0` for an empty slot. Slot 0 is always empty. The shipped file has
301 slots (299 with audio).

### 2. Sound archive — `0.snd`

A 20-byte resource header, then the slot entries:

```
int32  count   (always 1)
int32  size
byte[size]     a complete WAV file, starting with "RIFF"
```

Reader: `src/resources/gfx/sil-file-reader.ts`, `src/resources/gfx/snd-file-reader.ts`.

### 3. Sound names — `S4_Main.exe`

The archive has no names. The game maps its sound ids to slots with two tables in the executable's
data sections:

1. **Name table** — 8-byte entries `{ char* name; int32 id }`, sorted by id, starting with
   `{ "SOUND_NO_SOUND", 1 }`. Example: `{ "SOUND_WORK_AXE", 13 }`.
2. **Variant table** — 12-byte entries `{ int32 count; int32 0; int32 cumulativeEnd }`, one per id
   (entry *k* belongs to id *k+1*). Sound id *k+1* owns slots `[end − count, end)`; the first entry is
   `{ 1, 0, 1 }` (`SOUND_NO_SOUND` → empty slot 0).

Many sounds have several recorded variants (e.g. 33 bird calls, 7 axe strikes); the game picks one
at random each time. The job finds both tables by searching (string → pointer → table), not by fixed
offsets, and checks that the variant table fits the number of slots in `0.sil`.

Code: `scripts/extract-sounds/exe-sound-table.ts`.

How the mapping was confirmed: durations line up with what the names describe (10 short hammer
hits, ~0.1 s button clicks alternating down/up, 2–3 s falling trees, 25 death cries), the only
empty slot belongs to `SOUND_WORK_HEAL`, and the table sums exactly to the archive's slot count.

### 4. Conversion — IMA ADPCM → PCM

Every recording is a WAV with format tag `0x11` (Microsoft IMA ADPCM, 4 bits per sample; mono 22/44 kHz
and stereo 44 kHz). Browsers can't decode that, so the job converts each file to plain 16-bit PCM WAV:

- Data comes in blocks of `blockAlign` bytes. Each block starts with a 4-byte header per channel
  (`int16` first sample, `uint8` step index, `uint8` reserved).
- After the headers, each channel has 4-byte groups (8 samples, low nibble first), interleaved
  channel by channel for stereo.
- Each 4-bit code updates the predictor with the standard IMA step/index tables.
- Output stops at the sample count from the WAV's `fact` chunk.

Code: `scripts/extract-sounds/ima-adpcm-wav.ts`. Its output was compared with ffmpeg's `adpcm_ima_wav`
decoder on all 299 recordings: every sample is identical (ffmpeg emits up to 7 extra samples at
the very end because it ignores the `fact` length).

## Output

```
public/Siedler4/Sfx/
  sounds.json          { "version": 1, "sounds": { "WORK_AXE": [{ "file": "WORK_AXE_0.wav", "duration": 0.43 }, …], … } }
  AMB_BIRD_0.wav …     one 16-bit PCM WAV per variant, named <SOUND>_<variant>.wav
```

Sound names drop the `SOUND_` prefix. The manifest format is `src/game/audio/sound-manifest.ts`.

## How the game uses them

- **Work and combat** (`src/game/audio/world-sounds.ts`): when an animation listed in
  `jobSoundList.xml` reaches its frame (e.g. `WC_CUT_TREE` frame 6 → `WORK_AXE`), the sound plays at
  that settler. Deaths, falling trees and tower archers are driven by game events.
- **Ambient** (`src/game/audio/ambient-sounds.ts`): a few times per second a random spot in view is
  sampled. Sea → waves, river → river, beach → seagulls, desert → desert wind, rock/snow → wind,
  swamp → insects, land next to trees → birds. Pig farms, donkey ranches and beekeepers add animal
  noises. Long clips don't overlap themselves, and at most three ambient sounds play at once.
- Volume and stereo pan follow the camera; only things near the visible area are heard. The
  *SFX volume* / *Enable SFX* settings apply.

`Config/SoundFX.cfg` lists values such as `SOUND_AMB_BIRD = 4` and `SOUND_AMB_RIVER = 1` next to
`SOUND_MISC_HEAL = 100`. Read as volume percentages these would make birds and rivers inaudible, so
their meaning is unclear and they are not used; ambient levels are set in `ambient-sounds.ts`.
