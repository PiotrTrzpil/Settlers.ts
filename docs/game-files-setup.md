# Setting Up Game Files

The app needs original Settlers 4 assets to render anything. You must provide them from a legal copy of the game.

## Option A: Export and import (recommended)

### 1. Export on Windows

On a Windows machine with Settlers 4 installed, run the export script from the project:

```powershell
.\scripts\export-game-files.ps1 -SourcePath "D:\Games\thesettlers4"
```

This creates `settlers4-assets.zip` on your Desktop. See [Finding your install directory](#finding-your-install-directory) if you're unsure of the path.

To include Settlers United HD textures (~2 GB):

```powershell
.\scripts\export-game-files.ps1 -SourcePath "D:\Games\thesettlers4" -IncludeHD
```

Use `-OutputPath` to change the zip location:

```powershell
.\scripts\export-game-files.ps1 -SourcePath "D:\Games\thesettlers4" -OutputPath "C:\Temp\settlers4-assets.zip"
```

### 2. Import on dev machine

Copy the zip(s) to your dev machine, then:

```sh
python3 scripts/import-game-files.py /path/to/zips
```

This looks for `settlers4-assets.zip` (required) and `settlers4-hd-assets.zip` (optional, auto-detected) in the given directory, extracts them into `public/Siedler4/`, and generates `file-list.txt`.

> **Note:** Use `import-game-files.py` instead of plain `unzip` — the export script creates zips with Windows-style backslash paths that macOS/Linux `unzip` doesn't handle correctly.

## Option B: Manual setup (any OS)

1. Locate your Settlers 4 install directory (the folder containing `game.lib`)
2. Copy the following into `./public/Siedler4/`:

| Source | Required | Purpose |
|--------|----------|---------|
| `game.lib` | **Yes** | Main data archive; the app checks for this to detect game data |
| `Gfx/` | **Yes** | Graphics, textures, palettes, animation indices |
| `Map/` | Optional | Original game maps (`.map`, `.edm`) |
| `Save/` | Optional | Save game files (`.exe`) |
| `gfx.lib` | Optional | Alternate graphics archive |

3. Generate the file list:

```sh
node scripts/generate-file-list.js
```

## Verifying the setup

After setup, your `public/` directory should look like:

```
public/
├── file-list.txt          # generated
├── Siedler4/
│   ├── game.lib
│   ├── Gfx/
│   │   ├── 0.gfx, 0.gil, 0.jil, 0.dil
│   │   ├── 0.pil, 0.pa6  (or 0.pi4, 0.p46)
│   │   ├── 1.gfx, 1.gil, ...
│   │   ├── 2.gh6         # landscape texture (critical)
│   │   └── ...
│   ├── Map/               # optional
│   └── Save/              # optional
└── ...
```

### Critical file

`Gfx/2.gh6` is required for landscape texture rendering. If the map view shows errors, verify this file was copied.

## Finding your install directory

**Settlers United / Ubisoft Connect**: The launcher at `C:\Program Files\Settlers United` is an Electron app -- it does *not* contain the game files directly. To find the actual game directory:

1. Open **Ubisoft Connect**
2. Go to **Settlers United** (or The Settlers History Collection)
3. Click **Properties** (gear icon) → **Installation**
4. The install path shown there is the game directory (e.g. `D:\Games\thesettlers4`)

The folder containing `game.lib` may be a subdirectory like `S4_Main/` within that path.

### Known install locations

| Distribution | Typical path |
|-------------|-------------|
| Settlers United (Ubisoft Connect) | Check Ubisoft Connect → Properties → Installation |
| History Collection (Ubisoft) | `C:\Program Files (x86)\Ubisoft\...\The Settlers History Collection\S4_Main` |
| Classic Blue Byte | `C:\Program Files (x86)\BlueByte\Settlers4` |
| GOG | `C:\Program Files (x86)\GOG Galaxy\Games\Settlers 4\S4_Main` |

If your install is elsewhere, pass it with `-SourcePath`.

## Required file formats reference

| Extension | Type | Purpose |
|-----------|------|---------|
| `.lib` | Archive | Compressed game data (game.lib, gfx.lib) |
| `.gfx` | Graphics | Raw sprite image data |
| `.gil` | Index | Frame offsets into .gfx |
| `.jil` | Index | Job animation indices |
| `.dil` | Index | Direction indices |
| `.pil` / `.pi4` | Palette index | Color palette lookup |
| `.pa6` / `.p46` | Palette data | Color palette values |
| `.gh5` / `.gh6` | Background | Landscape and background images |
| `.gl5` / `.gl6` | Background | Alternative background format |
| `.map` / `.edm` | Map | Original game maps |
| `.exe` | Savegame | Game save files (with 6656-byte exe header) |
