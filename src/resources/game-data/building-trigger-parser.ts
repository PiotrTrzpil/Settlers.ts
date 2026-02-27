/**
 * Parser for BuildingTrigger.xml
 */

import type {
    RaceId,
    RaceBuildingTriggerData,
    BuildingTrigger,
    TriggerEffect,
    TriggerPatch,
    TriggerSound,
} from './types';
import { parseXML, getChildText, getChildNumber } from './xml-utils';

function parseTriggerSound(parent: Element): TriggerSound | null {
    const soundEl = parent.getElementsByTagName('sound')[0];
    if (!soundEl) return null;
    const def = getChildText(soundEl, 'def');
    if (!def) return null;
    return { def };
}

function parseTriggerEffect(effectEl: Element): TriggerEffect {
    return {
        def: getChildText(effectEl, 'def'),
        duration: getChildNumber(effectEl, 'duration'),
        frame: getChildNumber(effectEl, 'frame'),
        x: getChildNumber(effectEl, 'x'),
        y: getChildNumber(effectEl, 'y'),
        smoke: getChildNumber(effectEl, 'smoke') === 1,
        sound: parseTriggerSound(effectEl),
    };
}

function parseTriggerPatch(patchEl: Element): TriggerPatch {
    return {
        def: getChildText(patchEl, 'def'),
        slot: getChildNumber(patchEl, 'slot'),
        duration: getChildNumber(patchEl, 'duration'),
        sound: parseTriggerSound(patchEl),
    };
}

function parseTrigger(triggerEl: Element): BuildingTrigger {
    const id = triggerEl.getAttribute('id') ?? '';

    const effects: TriggerEffect[] = [];
    const effectElements = triggerEl.getElementsByTagName('effect');
    for (let i = 0; i < effectElements.length; i++) {
        effects.push(parseTriggerEffect(effectElements[i]!));
    }

    const patches: TriggerPatch[] = [];
    const patchElements = triggerEl.getElementsByTagName('patch');
    for (let i = 0; i < patchElements.length; i++) {
        patches.push(parseTriggerPatch(patchElements[i]!));
    }

    return { id, effects, patches };
}

/**
 * Parse BuildingTrigger.xml content into trigger data per race.
 */
export function parseBuildingTriggers(xmlContent: string): Map<RaceId, RaceBuildingTriggerData> {
    const doc = parseXML(xmlContent);
    const result = new Map<RaceId, RaceBuildingTriggerData>();

    const raceElements = doc.getElementsByTagName('race');
    for (let i = 0; i < raceElements.length; i++) {
        const raceEl = raceElements[i]!;
        const raceId = raceEl.getAttribute('id')?.trim() as RaceId;
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- getAttribute may return null despite cast
        if (!raceId) continue;

        const triggers = new Map<string, BuildingTrigger>();

        // Only get direct <trigger> children of <race>, not nested
        for (let j = 0; j < raceEl.children.length; j++) {
            const child = raceEl.children[j]!;
            if (child.tagName === 'trigger') {
                const trigger = parseTrigger(child);
                triggers.set(trigger.id, trigger);
            }
        }

        result.set(raceId, { triggers });
    }

    return result;
}
