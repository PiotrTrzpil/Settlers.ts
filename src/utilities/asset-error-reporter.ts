import { reactive, readonly } from 'vue';

export type AssetErrorReason = 'missing' | 'parse' | 'corrupted';

export interface AssetError {
    path: string;
    reason: AssetErrorReason;
    detail?: string;
}

interface State {
    errors: AssetError[];
}

const state = reactive<State>({ errors: [] });
const seenPaths = new Set<string>();

export function reportAssetError(err: AssetError): void {
    if (seenPaths.has(err.path)) {
        return;
    }
    seenPaths.add(err.path);
    state.errors.push(err);
}

export function clearAssetErrors(): void {
    seenPaths.clear();
    state.errors.splice(0, state.errors.length);
}

export const assetErrors = readonly(state);

/** True when the body looks like an SPA index.html fallback. */
export function looksLikeHtmlFallback(body: string): boolean {
    const head = body.slice(0, 200).trimStart().toLowerCase();
    return head.startsWith('<!doctype html') || head.startsWith('<html');
}
