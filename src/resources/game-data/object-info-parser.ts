/**
 * Parser for objectInfo.xml
 */

import { LogHandler } from '@/utilities/log-handler';
import type { ObjectInfo } from './types';
import { parseXML, getChildNumber } from './xml-utils';

const log = new LogHandler('ObjectInfoParser');

function parseObject(objectEl: Element): ObjectInfo {
    const id = objectEl.getAttribute('id') ?? '';

    return {
        id,
        blocking: getChildNumber(objectEl, 'blocking'),
        building: getChildNumber(objectEl, 'building'),
        repellent: getChildNumber(objectEl, 'repellent'),
        animType: getChildNumber(objectEl, 'animType'),
        layer: getChildNumber(objectEl, 'layer'),
        version: getChildNumber(objectEl, 'version', 1),
        pingPong: getChildNumber(objectEl, 'pingPong'),
    };
}

/**
 * Parse objectInfo.xml content into object data.
 * Objects are not race-specific.
 */
export function parseObjectInfo(xmlContent: string): Map<string, ObjectInfo> {
    const doc = parseXML(xmlContent);
    const result = new Map<string, ObjectInfo>();

    const objectElements = doc.getElementsByTagName('object');
    for (let i = 0; i < objectElements.length; i++) {
        const obj = parseObject(objectElements[i]);
        result.set(obj.id, obj);
    }

    log.debug(`Parsed ${result.size} objects`);
    return result;
}
