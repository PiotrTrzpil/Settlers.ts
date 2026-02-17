/**
 * Source fingerprint for stale server detection.
 *
 * Computes a hash from git state (HEAD + working tree status in src/).
 * Used by:
 *   - vite.config.ts: injects as __SOURCE_HASH__ define
 *   - global-setup.ts: compares against running server's hash
 *   - smoke test: verifies served code matches current source
 *
 * Detects: new files, deleted files, renamed files, modified files.
 * Does NOT detect: content-only changes within already-modified files
 * (those are handled by Vite's HMR, not stale server detection).
 */

import { execSync } from 'child_process';
import { createHash } from 'crypto';

export function computeSourceHash(): string {
    try {
        const head = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
        // git status --porcelain shows M/A/D/?? status for each changed file
        // This captures new, modified, deleted, and untracked files in src/
        const status = execSync('git status --porcelain -- src/', { encoding: 'utf-8' }).trim();
        return createHash('md5')
            .update(head + '\n' + status)
            .digest('hex')
            .slice(0, 12);
    } catch {
        return 'unknown';
    }
}
