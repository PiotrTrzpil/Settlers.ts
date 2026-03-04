/**
 * Iterate a `Map<number, V>` in ascending key order.
 * Pre-collects entries so deletions during iteration are safe.
 */
export function sortedEntries<V>(map: Map<number, V>): [number, V][] {
    return [...map.keys()].sort((a, b) => a - b).map(k => [k, map.get(k)!]);
}
