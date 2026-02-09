import { LogHandler } from '@/utilities/log-handler';

const log = new LogHandler('MapResources');

/**
 * Analyze raw resource type values in the map data.
 * Useful for reverse-engineering the byte value mappings.
 *
 * @returns Map of raw value -> count
 */
export function analyzeResourceTypes(resourceType: Uint8Array): Map<number, number> {
    const counts = new Map<number, number>();

    for (let i = 0; i < resourceType.length; i++) {
        const val = resourceType[i];
        if (val !== 0) {
            counts.set(val, (counts.get(val) ?? 0) + 1);
        }
    }

    // Log distribution
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    log.debug(`Resource type distribution (${sorted.length} unique values):`);
    for (const [type, count] of sorted.slice(0, 20)) {
        log.debug(`  Raw ${type}: ${count} tiles`);
    }
    if (sorted.length > 20) {
        log.debug(`  ... and ${sorted.length - 20} more values`);
    }

    return counts;
}
