import { ref, watch, type Ref } from 'vue';
import { FileManager } from '@/utilities/file-manager';
import { GfxFileReader } from '@/resources/gfx/gfx-file-reader';
import { GilFileReader } from '@/resources/gfx/gil-file-reader';
import { PaletteCollection } from '@/resources/gfx/palette-collection';
import { PilFileReader } from '@/resources/gfx/pil-file-reader';
import { BuildingType } from '@/game/entity';
import {
    BUILDING_ICON_FILE_NUMBERS,
    BUILDING_ICON_INDICES,
    Race
} from '@/game/renderer/sprite-metadata';
import { LogHandler } from '@/utilities/log-handler';

const log = new LogHandler('BuildingIcons');

/** Cache of GFX readers by race */
const gfxReaderCache = new Map<Race, GfxFileReader>();

/** Cache of loading promises to avoid duplicate loads */
const loadingPromises = new Map<Race, Promise<GfxFileReader | null>>();

/** Cache of icon data URLs by race, building type, and selected state */
const iconDataUrlCache = new Map<string, string>();

/**
 * Load the icon GFX file for a specific race.
 */
async function loadIconGfx(fileManager: FileManager, race: Race): Promise<GfxFileReader | null> {
    // Return cached reader if available
    if (gfxReaderCache.has(race)) {
        return gfxReaderCache.get(race)!;
    }

    // Return existing loading promise if in progress
    if (loadingPromises.has(race)) {
        return loadingPromises.get(race)!;
    }

    const loadPromise = (async (): Promise<GfxFileReader | null> => {
        try {
            const fileId = BUILDING_ICON_FILE_NUMBERS[race].toString();
            const fileNameList: { [key: string]: string } = {
                gfx: fileId + '.gfx',
                gil: fileId + '.gil',
            };

            // Check for palette files
            const pilFileExists = fileManager.findFile(fileId + '.pil', false);
            if (pilFileExists) {
                fileNameList.paletteIndex = fileId + '.pil';
                fileNameList.palette = fileId + '.pa6';
            } else {
                fileNameList.paletteIndex = fileId + '.pi4';
                fileNameList.palette = fileId + '.p46';
            }

            const files = await fileManager.readFiles(fileNameList, true);
            if (!files.gfx || !files.gil || !files.paletteIndex || !files.palette) {
                log.error(`Failed to load icon GFX files for race ${race}`);
                return null;
            }

            const paletteIndexReader = new PilFileReader(files.paletteIndex);
            const paletteCollection = new PaletteCollection(files.palette, paletteIndexReader);
            const gilFileReader = new GilFileReader(files.gil);

            const reader = new GfxFileReader(
                files.gfx,
                gilFileReader,
                null, // No JIL for direct index access
                null, // No DIL for direct index access
                paletteCollection
            );

            log.debug(`Loaded icon GFX ${fileId}.gfx with ${reader.getImageCount()} images for race ${Race[race]}`);

            // Cache the reader
            gfxReaderCache.set(race, reader);
            return reader;
        } catch (e) {
            log.error(`Failed to load icon GFX for race ${race}`, e instanceof Error ? e : new Error(String(e)));
            return null;
        } finally {
            loadingPromises.delete(race);
        }
    })();

    loadingPromises.set(race, loadPromise);
    return loadPromise;
}

/**
 * Get the icon index for a building type and race.
 * @param selected - If true, returns the selected variant index
 */
function getIconIndex(race: Race, buildingType: BuildingType, selected = false): number {
    const raceIcons = BUILDING_ICON_INDICES[race];
    if (!raceIcons) return -1;
    const indices = raceIcons[buildingType];
    if (!indices) return -1;
    return selected ? indices[1] : indices[0];
}

/**
 * Render an icon to a data URL.
 */
function renderIconToDataUrl(gfxReader: GfxFileReader, iconIndex: number): string | null {
    if (iconIndex < 0 || iconIndex >= gfxReader.getImageCount()) {
        return null;
    }

    const img = gfxReader.getImage(iconIndex);
    if (!img) {
        return null;
    }

    const imageData = img.getImageData();
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        return null;
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
}

/**
 * Get or create a cached icon data URL.
 * @param selected - If true, returns the selected variant
 */
function getCachedIconUrl(race: Race, buildingType: BuildingType, gfxReader: GfxFileReader, selected = false): string | null {
    const cacheKey = `${race}-${buildingType}-${selected ? 'sel' : 'unsel'}`;

    if (iconDataUrlCache.has(cacheKey)) {
        return iconDataUrlCache.get(cacheKey)!;
    }

    const iconIndex = getIconIndex(race, buildingType, selected);
    if (iconIndex < 0) return null;

    const dataUrl = renderIconToDataUrl(gfxReader, iconIndex);

    if (dataUrl) {
        iconDataUrlCache.set(cacheKey, dataUrl);
    }

    return dataUrl;
}

/**
 * Composable for loading and displaying building icons.
 * Icons are race-specific and cached for fast switching.
 */
export function useBuildingIcons(
    fileManager: Ref<FileManager | null>,
    currentRace: Ref<Race>
) {
    const iconsLoaded = ref(false);
    const iconUrls = ref<Map<BuildingType, string>>(new Map());
    const selectedIconUrls = ref<Map<BuildingType, string>>(new Map());
    let currentGfxReader: GfxFileReader | null = null;

    async function loadIconsForRace(race: Race) {
        if (!fileManager.value) return;

        const reader = await loadIconGfx(fileManager.value, race);
        if (!reader) {
            iconsLoaded.value = false;
            iconUrls.value = new Map();
            selectedIconUrls.value = new Map();
            return;
        }

        currentGfxReader = reader;
        updateIconUrls(race, reader);
        iconsLoaded.value = true;
    }

    function updateIconUrls(race: Race, gfxReader: GfxFileReader) {
        const newUrls = new Map<BuildingType, string>();
        const newSelectedUrls = new Map<BuildingType, string>();

        const raceIcons = BUILDING_ICON_INDICES[race] || {};
        for (const [typeStr] of Object.entries(raceIcons)) {
            const buildingType = Number(typeStr) as BuildingType;
            const url = getCachedIconUrl(race, buildingType, gfxReader, false);
            const selectedUrl = getCachedIconUrl(race, buildingType, gfxReader, true);
            if (url) {
                newUrls.set(buildingType, url);
            }
            if (selectedUrl) {
                newSelectedUrls.set(buildingType, selectedUrl);
            }
        }

        iconUrls.value = newUrls;
        selectedIconUrls.value = newSelectedUrls;
    }

    // Load icons when file manager becomes available
    watch(fileManager, () => {
        if (fileManager.value) {
            void loadIconsForRace(currentRace.value);
        }
    }, { immediate: true });

    // Update icons when race changes
    watch(currentRace, (newRace) => {
        void loadIconsForRace(newRace);
    });

    function getIconUrl(buildingType: BuildingType, selected = false): string | null {
        if (selected) {
            return selectedIconUrls.value.get(buildingType) ?? null;
        }
        return iconUrls.value.get(buildingType) ?? null;
    }

    return {
        iconsLoaded,
        iconUrls,
        selectedIconUrls,
        getIconUrl,
    };
}
