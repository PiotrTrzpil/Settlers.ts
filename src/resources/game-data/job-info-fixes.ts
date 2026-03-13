/**
 * Post-parse fixes for jobInfo.xml data bugs.
 *
 * The original Settlers 4 jobInfo.xml contains several data errors that
 * break our choreography system. Rather than editing the shipped XML
 * (which is kept as-is for authenticity), we patch the parsed data at
 * load time. Each fix is documented with the symptom, root cause, and
 * which races are affected.
 *
 * Fixes are applied in order by {@link applyJobFixes} after all nodes
 * have been parsed. Per-node fixes run first, then per-job fixes.
 */

import type { RaceId, JobNode } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Fix 1: jobPart / entity material mismatch
//
// Symptom:  Iron smelter plays the gold-ore pickup animation instead of
//           iron-ore when collecting raw material.
// Cause:    JOB_SMELTERIRON_WORK has <jobPart>SME_PICKUP_GOLDORE</jobPart>
//           paired with <entity>GOOD_IRONORE</entity>. Our animation
//           resolver derives the pickup/carry animation from the jobPart
//           suffix, so the mismatch plays the wrong animation.
// Affected: All races (the same mismatch appears in every race's copy).
// Fix:      Replace the jobPart suffix with the entity's material name.
//           Only applied when the suffix is a known GOOD_* material name
//           — generic animation suffixes (ANIMAL, FIRSTGOOD, STEEL, WINE,
//           PLANT, OIL, AMMO) are left alone.
// ─────────────────────────────────────────────────────────────────────────────

const GOOD_PREFIX = 'GOOD_';

/** Material-bearing suffixes in jobPart names: PICKUP_X, WALK_X, DROP_X */
const MATERIAL_ACTION_PREFIXES = ['PICKUP_', 'WALK_', 'DROP_'] as const;

/**
 * Known GOOD_* material names from the XML. Only jobPart suffixes matching
 * these are considered "specific material references" eligible for correction.
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

export function fixJobPartEntityMismatch(node: JobNode): void {
    if (!node.entity.startsWith(GOOD_PREFIX)) {
        return;
    }

    const entityMaterial = node.entity.slice(GOOD_PREFIX.length); // e.g., 'IRONORE'
    const underscoreIdx = node.jobPart.indexOf('_');
    if (underscoreIdx === -1) {
        return;
    }

    const prefix = node.jobPart.slice(0, underscoreIdx + 1); // e.g., 'SME_'
    const action = node.jobPart.slice(underscoreIdx + 1); // e.g., 'PICKUP_GOLDORE'

    for (const actionPrefix of MATERIAL_ACTION_PREFIXES) {
        if (!action.startsWith(actionPrefix)) {
            continue;
        }
        const jobPartMaterial = action.slice(actionPrefix.length); // e.g., 'GOLDORE'
        if (!jobPartMaterial || jobPartMaterial === entityMaterial) {
            return;
        }

        // Only correct when the jobPart suffix is a known specific material name.
        // Generic animation names (ANIMAL, STEEL, PLANT, OIL, etc.) are left alone.
        if (!KNOWN_MATERIAL_NAMES.has(jobPartMaterial)) {
            return;
        }

        const fixed = `${prefix}${actionPrefix}${entityMaterial}`;
        node.jobPart = fixed;
        return;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fix 2: missing entity on RESOURCE_GATHERING nodes
//
// Symptom:  Resource-gathering executors see an empty entity and don't know
//           which material to pick up.
// Cause:    Some XML jobs (e.g. farmer harvest) omit the <entity> on
//           RESOURCE_GATHERING but declare it on the subsequent PUT_GOOD.
//           The original game engine infers the material; we normalize at
//           parse time so executors always see a concrete entity.
// Affected: Multiple jobs across all races.
// Fix:      Copy the entity from the nearest subsequent PUT_GOOD node.
// ─────────────────────────────────────────────────────────────────────────────

export function propagateResourceGatheringEntity(nodes: JobNode[]): void {
    const RES_TASKS = ['RESOURCE_GATHERING', 'RESOURCE_GATHERING_VIRTUAL'];
    const PUT_TASKS = ['PUT_GOOD', 'PUT_GOOD_VIRTUAL'];

    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]!;
        if (!RES_TASKS.includes(node.task) || node.entity) {
            continue;
        }

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
// Fix 3: JOB_VINTNER_HARVEST missing WORK_ON_ENTITY node
//
// Symptom:  Vintner never actually harvests vines — the crop harvest handler
//           is never invoked.
// Cause:    The vintner harvest job uses RESOURCE_GATHERING directly (like a
//           waterworker), but all other crop farmers (grain, sunflower, agave,
//           beekeeper) use WORK_ON_ENTITY → RESOURCE_GATHERING. Without the
//           WORK_ON_ENTITY node, the crop harvest handler never fires.
// Affected: All races.
// Fix:      Split the RESOURCE_GATHERING node into WORK_ON_ENTITY (invokes
//           crop harvest handler) + RESOURCE_GATHERING (picks up material).
// ─────────────────────────────────────────────────────────────────────────────

export function fixVintnerHarvestJob(nodes: JobNode[]): void {
    // Find the RESOURCE_GATHERING node with GOOD_WINE after GO_TO_TARGET
    const resIdx = nodes.findIndex((n, i) => i > 0 && n.task === 'RESOURCE_GATHERING' && n.entity === 'GOOD_WINE');
    if (resIdx === -1) {
        return;
    }

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

// ─────────────────────────────────────────────────────────────────────────────
// Fix 4: Viking JOB_WOODCUTTER_WORK has useWork=false on all nodes
//
// Symptom:  Viking woodcutter teleports inside its own building during tree
//           cutting and gets stuck. Happens when the tree is close to the
//           building (e.g. left-down of it).
// Cause:    Roman, Maya (defaults to true), and Trojan woodcutter jobs set
//           useWork=true on tree-relative nodes (GO_VIRTUAL, WORK_ON_ENTITY,
//           etc.). Viking's XML explicitly sets <useWork>false</useWork> on
//           every node. When executeGoVirtual sees useWork=false, it takes
//           the building-interior teleport path (settler.x/y = building pos)
//           instead of walking to tree-relative positions.
// Affected: RACE_VIKING only.
// Fix:      Set useWork=true on the task types that resolve positions relative
//           to the target tree, matching the other three races.
// ─────────────────────────────────────────────────────────────────────────────

const TREE_WORK_TASKS = new Set([
    'GO_VIRTUAL',
    'WORK_ON_ENTITY',
    'WORK_ON_ENTITY_VIRTUAL',
    'RESOURCE_GATHERING_VIRTUAL',
]);

function fixVikingWoodcutterUseWork(nodes: JobNode[]): void {
    for (const node of nodes) {
        if (TREE_WORK_TASKS.has(node.task)) {
            node.useWork = true;
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply all per-node fixes (called for each parsed node individually).
 */
export function applyNodeFixes(node: JobNode): void {
    fixJobPartEntityMismatch(node);
}

/**
 * Apply all per-job fixes (called after all nodes in a job are parsed).
 */
export function applyJobFixes(jobId: string, nodes: JobNode[], raceId: RaceId): void {
    propagateResourceGatheringEntity(nodes);

    if (jobId === 'JOB_VINTNER_HARVEST') {
        fixVintnerHarvestJob(nodes);
    }

    if (jobId === 'JOB_WOODCUTTER_WORK' && raceId === 'RACE_VIKING') {
        fixVikingWoodcutterUseWork(nodes);
    }
}
