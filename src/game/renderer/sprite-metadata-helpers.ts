
/**
 * Helper to convert Map to array of entries for JSON serialization
 */
export function mapToArray<K, V>(map: Map<K, V>): Array<[K, V]> {
    return Array.from(map.entries());
}

/**
 * Helper to convert array of entries back to Map
 */
export function arrayToMap<K, V>(arr: Array<[K, V]>): Map<K, V> {
    return new Map(arr);
}
