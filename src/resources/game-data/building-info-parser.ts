/**
 * Parser for buildingInfo.xml
 */

import type {
    RaceId,
    RaceBuildingData,
    BuildingInfo,
    BuildingPileInfo,
    BuilderInfo,
    BuildingPatch,
    BuildingSettlerPos,
    PatchSound,
    PositionOffset,
    BoundingRect,
} from './types';
import { parseXML, getChildText, getChildNumber, getChildBool, getValueArray } from './xml-utils';

function parsePositionOffset(parent: Element, tagName: string): PositionOffset {
    const el = parent.getElementsByTagName(tagName)[0];
    if (!el) {
        return { xOffset: 0, yOffset: 0 };
    }

    return {
        xOffset: getChildNumber(el, 'xOffset'),
        yOffset: getChildNumber(el, 'yOffset'),
    };
}

function parseBoundingRect(parent: Element): BoundingRect {
    const el = parent.getElementsByTagName('bitBoundingRect')[0];
    if (!el) {
        return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    }

    return {
        minX: getChildNumber(el, 'minX'),
        maxX: getChildNumber(el, 'maxX'),
        minY: getChildNumber(el, 'minY'),
        maxY: getChildNumber(el, 'maxY'),
    };
}

function parsePile(pileEl: Element): BuildingPileInfo {
    return {
        xPixelOffset: getChildNumber(pileEl, 'xPixelOffset'),
        yPixelOffset: getChildNumber(pileEl, 'yPixelOffset'),
        xOffset: getChildNumber(pileEl, 'xOffset'),
        yOffset: getChildNumber(pileEl, 'yOffset'),
        good: getChildText(pileEl, 'good'),
        type: getChildNumber(pileEl, 'type'),
        patch: getChildNumber(pileEl, 'patch'),
        appearance: getChildNumber(pileEl, 'appearance'),
    };
}

function parseBuilderInfo(builderEl: Element): BuilderInfo {
    return {
        xOffset: getChildNumber(builderEl, 'xOffset'),
        yOffset: getChildNumber(builderEl, 'yOffset'),
        dir: getChildNumber(builderEl, 'dir'),
    };
}

function parsePatchSound(patchEl: Element): PatchSound | null {
    const soundEl = patchEl.getElementsByTagName('sound')[0];
    if (!soundEl) {
        return null;
    }
    return {
        def: getChildText(soundEl, 'def'),
        frame: getChildNumber(soundEl, 'frame'),
        random: getChildNumber(soundEl, 'random'),
    };
}

function parsePatch(patchEl: Element): BuildingPatch {
    return {
        slot: getChildNumber(patchEl, 'slot'),
        ticks: getChildNumber(patchEl, 'ticks'),
        job: getChildText(patchEl, 'job'),
        type: getChildText(patchEl, 'type'),
        sound: parsePatchSound(patchEl),
    };
}

function parseSettlerPos(settlerEl: Element): BuildingSettlerPos {
    return {
        xOffset: getChildNumber(settlerEl, 'xOffset'),
        yOffset: getChildNumber(settlerEl, 'yOffset'),
        direction: getChildNumber(settlerEl, 'direction'),
        top: getChildBool(settlerEl, 'top'),
    };
}

function parseBuilding(buildingEl: Element): BuildingInfo {
    // eslint-disable-next-line no-restricted-syntax -- XML attribute parsing: getAttribute returns null for missing attributes (external data boundary)
    const id = buildingEl.getAttribute('id') ?? '';

    // Parse piles
    const piles: BuildingPileInfo[] = [];
    const pileElements = buildingEl.getElementsByTagName('pile');
    for (let i = 0; i < pileElements.length; i++) {
        piles.push(parsePile(pileElements[i]!));
    }

    // Parse builder infos
    const builderInfos: BuilderInfo[] = [];
    const builderInfoElements = buildingEl.getElementsByTagName('builderInfo');
    for (let i = 0; i < builderInfoElements.length; i++) {
        builderInfos.push(parseBuilderInfo(builderInfoElements[i]!));
    }

    // Parse patches (animation overlays: smoke, fire, animals, etc.)
    const patches: BuildingPatch[] = [];
    const patchesContainer = buildingEl.getElementsByTagName('patches')[0];
    if (patchesContainer) {
        // Only get direct <patch> children of <patches>, not nested ones
        for (let i = 0; i < patchesContainer.children.length; i++) {
            const child = patchesContainer.children[i]!;
            if (child.tagName === 'patch') {
                patches.push(parsePatch(child));
            }
        }
    }

    // Parse settler positions (garrison positions for military buildings)
    const settlers: BuildingSettlerPos[] = [];
    const settlerElements = buildingEl.getElementsByTagName('settler');
    for (let i = 0; i < settlerElements.length; i++) {
        settlers.push(parseSettlerPos(settlerElements[i]!));
    }

    // Parse animLists
    const animLists: string[] = [];
    const animListsContainer = buildingEl.getElementsByTagName('animLists')[0];
    if (animListsContainer) {
        const animListElements = animListsContainer.getElementsByTagName('animList');
        for (let i = 0; i < animListElements.length; i++) {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- textContent may be null at runtime despite TS type
            const text = animListElements[i]!.textContent?.trim();
            if (text) {
                animLists.push(text);
            }
        }
    }

    return {
        id,
        hotSpotX: getChildNumber(buildingEl, 'iHotSpotX'),
        hotSpotY: getChildNumber(buildingEl, 'iHotSpotY'),
        stone: getChildNumber(buildingEl, 'stone'),
        boards: getChildNumber(buildingEl, 'boards'),
        gold: getChildNumber(buildingEl, 'gold'),
        lines: getChildNumber(buildingEl, 'lines'),
        buildingPosLines: getValueArray(buildingEl, 'buildingPosLines'),
        digPosLines: getValueArray(buildingEl, 'digPosLines'),
        repealingPosLines: getValueArray(buildingEl, 'repealingPosLines'),
        blockPosLines: getValueArray(buildingEl, 'blockPosLines'),
        waterPosLines: getValueArray(buildingEl, 'waterPosLines'),
        waterFreePosLines: getValueArray(buildingEl, 'waterFreePosLines'),
        waterBlockPosLines: getValueArray(buildingEl, 'waterBlockPosLines'),
        boundingRect: parseBoundingRect(buildingEl),
        builderNumber: getChildNumber(buildingEl, 'builderNumber'),
        flag: parsePositionOffset(buildingEl, 'flag'),
        door: parsePositionOffset(buildingEl, 'door'),
        workingPos: parsePositionOffset(buildingEl, 'workingpos'),
        miniFlag: parsePositionOffset(buildingEl, 'miniflag'),
        pileNumber: getChildNumber(buildingEl, 'pileNumber'),
        kind: getChildText(buildingEl, 'kind'),
        inhabitant: getChildText(buildingEl, 'inhabitant'),
        tool: getChildText(buildingEl, 'tool'),
        productionDelay: getChildNumber(buildingEl, 'productiondelay'),
        influenceRadius: getChildNumber(buildingEl, 'influenceRadius'),
        explorerRadius: getChildNumber(buildingEl, 'explorerRadius'),
        workingAreaRadius: getChildNumber(buildingEl, 'workingAreaRadius'),
        calcProd: getChildBool(buildingEl, 'calcProd'),
        settlerNumber: getChildNumber(buildingEl, 'settlerNumber'),
        hitpoints: getChildNumber(buildingEl, 'Hitpoints'),
        armor: getChildNumber(buildingEl, 'Armor'),
        patchSettlerSlot: getChildNumber(buildingEl, 'patchSettlerSlot'),
        patches,
        settlers,
        animLists,
        piles,
        builderInfos,
        dummyValue: getChildNumber(buildingEl, 'dummyValue'),
        gridChangedForExport: getChildNumber(buildingEl, 'gridChangedForExport'),
        gridVersion: getChildNumber(buildingEl, 'gridVersion'),
        helperFile: getChildText(buildingEl, 'helperFile'),
        helperX: getChildNumber(buildingEl, 'helperX'),
        helperY: getChildNumber(buildingEl, 'helperY'),
    };
}

/**
 * Parse buildingInfo.xml content into building data per race.
 */
export function parseBuildingInfo(xmlContent: string): Map<RaceId, RaceBuildingData> {
    const doc = parseXML(xmlContent);
    const result = new Map<RaceId, RaceBuildingData>();

    const raceElements = doc.getElementsByTagName('race');
    for (let i = 0; i < raceElements.length; i++) {
        const raceEl = raceElements[i]!;
        const raceId = raceEl.getAttribute('id') as RaceId;
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- getAttribute may return null despite cast
        if (!raceId) {
            continue;
        }

        const buildings = new Map<string, BuildingInfo>();
        const buildingElements = raceEl.getElementsByTagName('building');

        for (let j = 0; j < buildingElements.length; j++) {
            const building = parseBuilding(buildingElements[j]!);
            buildings.set(building.id, building);
        }

        result.set(raceId, { buildings });
    }

    return result;
}
