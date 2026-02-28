/**
 * Parser for SettlerValues.xml
 */

import type { RaceId, RaceSettlerValueData, SettlerValueInfo } from './types';
import { parseXML, getChildText, getTextArray } from './xml-utils';

export function parseSettlerValues(xmlContent: string): Map<RaceId, RaceSettlerValueData> {
    const doc = parseXML(xmlContent);
    const result = new Map<RaceId, RaceSettlerValueData>();

    const raceElements = doc.getElementsByTagName('race');
    for (let i = 0; i < raceElements.length; i++) {
        const raceEl = raceElements[i]!;
        const raceId = raceEl.getAttribute('id') as RaceId;

        const settlers = new Map<string, SettlerValueInfo>();
        // Only iterate direct <settler> children of <race>, not nested ones
        for (let j = 0; j < raceEl.children.length; j++) {
            const child = raceEl.children[j]!;
            if (child.tagName !== 'settler') continue;

            const id = child.getAttribute('id') ?? '';
            const animLists = getTextArray(child, 'animList');
            const role = getChildText(child, 'role');
            const tool = getChildText(child, 'tool');

            // searchTypes are inside <search> container
            const searchEl = child.getElementsByTagName('search')[0];
            const searchTypes = searchEl ? getTextArray(searchEl, 'searchType') : [];

            settlers.set(id, { id, role, searchTypes, tool, animLists });
        }

        result.set(raceId, { settlers });
    }

    return result;
}
