/**
 * Parser for buildingInfo.xml
 */

import { LogHandler } from '@/utilities/log-handler';
import type {
    RaceId,
    RaceBuildingData,
    BuildingInfo,
    BuildingPileInfo,
    BuilderInfo,
    PositionOffset,
    BoundingRect,
} from './types';
import {
    parseXML,
    getChildText,
    getChildNumber,
    getChildBool,
    getValueArray,
} from './xml-utils';

const log = new LogHandler('BuildingInfoParser');

function parsePositionOffset(parent: Element, tagName: string): PositionOffset {
    const el = parent.getElementsByTagName(tagName)[0];
    if (!el) return { xOffset: 0, yOffset: 0 };

    return {
        xOffset: getChildNumber(el, 'xOffset'),
        yOffset: getChildNumber(el, 'yOffset'),
    };
}

function parseBoundingRect(parent: Element): BoundingRect {
    const el = parent.getElementsByTagName('bitBoundingRect')[0];
    if (!el) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };

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

function parseBuilding(buildingEl: Element): BuildingInfo {
    const id = buildingEl.getAttribute('id') ?? '';

    // Parse piles
    const piles: BuildingPileInfo[] = [];
    const pileElements = buildingEl.getElementsByTagName('pile');
    for (let i = 0; i < pileElements.length; i++) {
        piles.push(parsePile(pileElements[i]));
    }

    // Parse builder infos
    const builderInfos: BuilderInfo[] = [];
    const builderInfoElements = buildingEl.getElementsByTagName('builderInfo');
    for (let i = 0; i < builderInfoElements.length; i++) {
        builderInfos.push(parseBuilderInfo(builderInfoElements[i]));
    }

    // Parse animLists
    const animLists: string[] = [];
    const animListsContainer = buildingEl.getElementsByTagName('animLists')[0];
    if (animListsContainer) {
        const animListElements = animListsContainer.getElementsByTagName('animList');
        for (let i = 0; i < animListElements.length; i++) {
            const text = animListElements[i].textContent?.trim();
            if (text) animLists.push(text);
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
        animLists,
        piles,
        builderInfos,
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
        const raceEl = raceElements[i];
        const raceId = raceEl.getAttribute('id') as RaceId;
        if (!raceId) continue;

        const buildings = new Map<string, BuildingInfo>();
        const buildingElements = raceEl.getElementsByTagName('building');

        for (let j = 0; j < buildingElements.length; j++) {
            const building = parseBuilding(buildingElements[j]);
            buildings.set(building.id, building);
        }

        result.set(raceId, { buildings });
        log.debug(`Parsed ${buildings.size} buildings for ${raceId}`);
    }

    return result;
}
