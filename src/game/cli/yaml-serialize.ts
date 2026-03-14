/**
 * YAML serializer for CLI output using the `yaml` library.
 * Pre-processes game objects (Maps, Sets, circular refs, functions)
 * into plain data, then delegates to `yaml.stringify`.
 */

import { stringify } from 'yaml';

/** Serialize a value to YAML text, handling game-specific types safely. */
export function safeYaml(value: unknown, maxDepth = 10): string {
    const seen = new WeakSet<object>();
    const plain = toPlain(value, 0, maxDepth, seen);
    return stringify(plain, { lineWidth: 120 }).trimEnd();
}

/** Recursively convert game objects into plain JSON-safe data for yaml lib. */
function toPlain(val: unknown, depth: number, maxDepth: number, seen: WeakSet<object>): unknown {
    if (val === null || val === undefined) {
        return null;
    }

    const primitive = convertPrimitive(val);
    if (primitive !== undefined) {
        return primitive;
    }

    if (val instanceof Set) {
        if (val.size > 20) {
            return `[Set(${val.size})]`;
        }
        return [...val].map(v => toPlain(v, depth + 1, maxDepth, seen));
    }

    if (typeof val !== 'object') {
        return `[${typeof val}]`;
    }

    if (seen.has(val)) {
        return '[Circular]';
    }
    seen.add(val);

    if (depth >= maxDepth) {
        return Array.isArray(val) ? `[Array(${val.length})]` : '[Object]';
    }

    return convertComplex(val, depth, maxDepth, seen);
}

function convertPrimitive(val: unknown): unknown {
    if (typeof val === 'boolean' || typeof val === 'number' || typeof val === 'string') {
        return val;
    }
    if (typeof val === 'function') {
        return '[Function]';
    }
    if (val instanceof WeakMap || val instanceof WeakRef) {
        return '[WeakRef]';
    }
    return undefined;
}

function convertComplex(val: object, depth: number, maxDepth: number, seen: WeakSet<object>): unknown {
    if (val instanceof Map) {
        if (val.size > 50) {
            return `[Map(${val.size})]`;
        }
        const obj: Record<string, unknown> = {};
        for (const [k, v] of val) {
            obj[String(k)] = toPlain(v, depth + 1, maxDepth, seen);
        }
        return obj;
    }

    if (Array.isArray(val)) {
        return val.map(v => toPlain(v, depth + 1, maxDepth, seen));
    }

    const obj: Record<string, unknown> = {};
    for (const key of Object.keys(val as Record<string, unknown>)) {
        obj[key] = toPlain((val as Record<string, unknown>)[key], depth + 1, maxDepth, seen);
    }
    return obj;
}
