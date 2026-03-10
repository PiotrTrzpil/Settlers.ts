/**
 * Parser for jobInfo.xml
 */

import type { RaceId, RaceJobData, JobInfo, JobNode } from './types';
import { parseXML, getChildText, getChildNumber, getChildBool } from './xml-utils';

function parseJobNode(nodeEl: Element): JobNode {
    return {
        task: getChildText(nodeEl, 'task').replace('CEntityTask::', ''),
        jobPart: getChildText(nodeEl, 'jobPart'),
        x: getChildNumber(nodeEl, 'x'),
        y: getChildNumber(nodeEl, 'y'),
        duration: getChildNumber(nodeEl, 'duration'),
        dir: getChildNumber(nodeEl, 'dir', -1),
        forward: getChildNumber(nodeEl, 'forward', 1),
        visible: getChildNumber(nodeEl, 'visible', 1),
        useWork: getChildBool(nodeEl, 'useWork', true),
        entity: getChildText(nodeEl, 'entity'),
        trigger: getChildText(nodeEl, 'trigger'),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// XML data fix: jobPart / entity material mismatch
//
// The original jobInfo.xml has a bug in JOB_SMELTERIRON_WORK:
//   <jobPart>SME_PICKUP_GOLDORE</jobPart>  +  <entity>GOOD_IRONORE</entity>
//
// The jobPart says GOLDORE but the entity is IRONORE. Our resolver derives
// the pickup/carry animation from the jobPart suffix, so this mismatch causes
// the wrong animation to play. We fix the jobPart at parse time to match the
// entity, since the entity field is authoritative (it's what the game actually
// picks up / puts down).
//
// IMPORTANT: Only fix when the jobPart suffix is itself a specific material name
// (matches a known GOOD_* type). Many jobParts use intentionally generic suffixes
// (ANIMAL, FIRSTGOOD, STEEL, WINE, PLANT, OIL, AMMO) that are NOT material names
// and must be left alone — they reference animation variants, not materials.
// ─────────────────────────────────────────────────────────────────────────────

const GOOD_PREFIX = 'GOOD_';

/** Material-bearing suffixes in jobPart names: PICKUP_X, WALK_X, DROP_X */
const MATERIAL_ACTION_PREFIXES = ['PICKUP_', 'WALK_', 'DROP_'] as const;

/**
 * Known GOOD_* material names from the XML. Only jobPart suffixes matching these
 * are considered "specific material references" eligible for mismatch correction.
 * Generic animation names (ANIMAL, STEEL, WINE, PLANT, OIL, etc.) are NOT in this set.
 */
const KNOWN_MATERIAL_NAMES: ReadonlySet<string> = new Set([
    'LOG',
    'STONE',
    'COAL',
    'IRONORE',
    'GOLDORE',
    'GRAIN',
    'PIG',
    'WATER',
    'FISH',
    'BOARD',
    'IRONBAR',
    'GOLDBAR',
    'FLOUR',
    'BREAD',
    'MEAT',
    'WINE',
    'AXE',
    'PICKAXE',
    'SAW',
    'HAMMER',
    'SCYTHE',
    'ROD',
    'SWORD',
    'BOW',
    'SULFUR',
    'ARMOR',
    'BATTLEAXE',
    'AGAVE',
    'BLOWGUN',
    'GOAT',
    'MEAD',
    'HONEY',
    'SHEEP',
    'SHOVEL',
    'CATAPULT',
    'GOOSE',
    'TEQUILA',
    'SUNFLOWER',
    'SUNFLOWEROIL',
    'AMMO',
    'GUNPOWDER',
]);

/**
 * If a node has a GOOD_* entity and the jobPart contains a specific material suffix
 * that doesn't match the entity, correct the jobPart to match.
 *
 * Only fires when the jobPart suffix is a known material name — generic suffixes
 * like ANIMAL, FIRSTGOOD, STEEL, PLANT are left untouched.
 */
function fixJobPartEntityMismatch(node: JobNode, jobId: string): void {
    if (!node.entity.startsWith(GOOD_PREFIX)) return;

    const entityMaterial = node.entity.slice(GOOD_PREFIX.length); // e.g., 'IRONORE'
    const underscoreIdx = node.jobPart.indexOf('_');
    if (underscoreIdx === -1) return;

    const prefix = node.jobPart.slice(0, underscoreIdx + 1); // e.g., 'SME_'
    const action = node.jobPart.slice(underscoreIdx + 1); // e.g., 'PICKUP_GOLDORE'

    for (const actionPrefix of MATERIAL_ACTION_PREFIXES) {
        if (!action.startsWith(actionPrefix)) continue;
        const jobPartMaterial = action.slice(actionPrefix.length); // e.g., 'GOLDORE'
        if (!jobPartMaterial || jobPartMaterial === entityMaterial) return;

        // Only correct when the jobPart suffix is a known specific material name.
        // Generic animation names (ANIMAL, STEEL, PLANT, OIL, etc.) are left alone.
        if (!KNOWN_MATERIAL_NAMES.has(jobPartMaterial)) return;

        const fixed = `${prefix}${actionPrefix}${entityMaterial}`;
        console.info(
            `[jobInfo fix] ${jobId}: corrected jobPart '${node.jobPart}' → '${fixed}' ` + `(entity says ${node.entity})`
        );
        node.jobPart = fixed;
        return;
    }
}

/**
 * Propagate entity from PUT_GOOD/PUT_GOOD_VIRTUAL to preceding RESOURCE_GATHERING
 * nodes that have an empty entity field.
 *
 * Some XML jobs (e.g. farmer harvest) omit the entity on RESOURCE_GATHERING but
 * declare it on the subsequent PUT_GOOD. The game engine infers the material;
 * we normalize at parse time so executors always see a concrete entity.
 */
function propagateResourceGatheringEntity(nodes: JobNode[]): void {
    const RES_TASKS = ['RESOURCE_GATHERING', 'RESOURCE_GATHERING_VIRTUAL'];
    const PUT_TASKS = ['PUT_GOOD', 'PUT_GOOD_VIRTUAL'];

    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]!;
        if (!RES_TASKS.includes(node.task) || node.entity) continue;

        // Search forward for nearest PUT_GOOD with an entity
        for (let j = i + 1; j < nodes.length; j++) {
            const candidate = nodes[j]!;
            if (PUT_TASKS.includes(candidate.task) && candidate.entity) {
                node.entity = candidate.entity;
                break;
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// XML data fix: JOB_VINTNER_HARVEST missing WORK_ON_ENTITY node
//
// The original jobInfo.xml has the vintner harvest job using RESOURCE_GATHERING
// directly (like a waterworker), but all other crop farmers (grain, sunflower,
// agave, beekeeper) use WORK_ON_ENTITY → RESOURCE_GATHERING. Without the
// WORK_ON_ENTITY node, the crop harvest handler never fires and vines are
// never actually harvested through the crop system.
//
// Fix: split the RESOURCE_GATHERING node into WORK_ON_ENTITY (invokes crop
// harvest handler) + RESOURCE_GATHERING (picks up the material).
// ─────────────────────────────────────────────────────────────────────────────

function fixVintnerHarvestJob(nodes: JobNode[]): void {
    // Find the RESOURCE_GATHERING node with GOOD_WINE after GO_TO_TARGET
    const resIdx = nodes.findIndex(
        (n, i) => i > 0 && n.task === 'RESOURCE_GATHERING' && n.entity === 'GOOD_WINE'
    );
    if (resIdx === -1) return;

    const resNode = nodes[resIdx]!;

    // Insert WORK_ON_ENTITY before the RESOURCE_GATHERING node
    const workNode: JobNode = {
        task: 'WORK_ON_ENTITY',
        jobPart: resNode.jobPart,
        x: resNode.x,
        y: resNode.y,
        duration: resNode.duration,
        dir: resNode.dir,
        forward: resNode.forward,
        visible: resNode.visible,
        useWork: true,
        entity: '',
        trigger: '',
    };

    // Make the RESOURCE_GATHERING instant (material pickup only, like grain farmer)
    resNode.duration = 0;
    resNode.useWork = true;

    nodes.splice(resIdx, 0, workNode);
}

function parseJob(jobEl: Element): JobInfo {
    const id = jobEl.getAttribute('id') ?? '';
    const nodes: JobNode[] = [];

    const nodeElements = jobEl.getElementsByTagName('node');
    for (let i = 0; i < nodeElements.length; i++) {
        const node = parseJobNode(nodeElements[i]!);
        fixJobPartEntityMismatch(node, id);
        nodes.push(node);
    }

    propagateResourceGatheringEntity(nodes);

    if (id === 'JOB_VINTNER_HARVEST') {
        fixVintnerHarvestJob(nodes);
    }

    return { id, nodes };
}

/**
 * Parse jobInfo.xml content into job data per race.
 */
export function parseJobInfo(xmlContent: string): Map<RaceId, RaceJobData> {
    const doc = parseXML(xmlContent);
    const result = new Map<RaceId, RaceJobData>();

    const raceElements = doc.getElementsByTagName('race');
    for (let i = 0; i < raceElements.length; i++) {
        const raceEl = raceElements[i]!;
        const raceId = raceEl.getAttribute('id') as RaceId;
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- getAttribute may return null despite cast
        if (!raceId) continue;

        const jobs = new Map<string, JobInfo>();
        const jobElements = raceEl.getElementsByTagName('job');

        for (let j = 0; j < jobElements.length; j++) {
            const job = parseJob(jobElements[j]!);
            jobs.set(job.id, job);
        }

        result.set(raceId, { jobs });
    }

    return result;
}
