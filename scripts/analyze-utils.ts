/**
 * Analyze utilities/ directory for size and coupling issues.
 * Uses dependency-cruiser as a library to check for "god files" with too many dependents.
 */

import { cruise, type ICruiseResult } from 'dependency-cruiser';
import { readdirSync } from 'fs';
import { relative } from 'path';

const UTILITIES_PATH = 'src/utilities';
const MAX_UTIL_FILES = 15;
const MAX_DEPENDENTS = 10;

interface FileStats {
    path: string;
    dependentCount: number;
}

async function getUtilFiles(): Promise<string[]> {
    try {
        const entries = readdirSync(UTILITIES_PATH, { withFileTypes: true });
        return entries
            .filter(e => e.isFile() && (e.name.endsWith('.ts') || e.name.endsWith('.vue')))
            .filter(e => !e.name.endsWith('.d.ts'))
            .map(e => e.name);
    } catch {
        return [];
    }
}

async function analyzeDependents(): Promise<FileStats[]> {
    const cruiseResult = await cruise(['src'], {
        doNotFollow: { path: 'node_modules' },
        tsPreCompilationDeps: true,
        tsConfig: { fileName: 'tsconfig.json' }
    });

    const result = cruiseResult.output as ICruiseResult;
    const dependentCounts = new Map<string, Set<string>>();

    // Count how many files depend on each utilities/ file
    for (const module of result.modules) {
        for (const dep of module.dependencies) {
            const resolved = dep.resolved;
            if (resolved.startsWith('src/utilities/')) {
                if (!dependentCounts.has(resolved)) {
                    dependentCounts.set(resolved, new Set());
                }
                dependentCounts.get(resolved)!.add(module.source);
            }
        }
    }

    return Array.from(dependentCounts.entries())
        .map(([path, dependents]) => ({
            path: relative('src', path),
            dependentCount: dependents.size
        }))
        .sort((a, b) => b.dependentCount - a.dependentCount);
}

async function main() {
    console.log('Analyzing utilities/ directory...\n');

    let hasErrors = false;

    // Check file count
    const files = await getUtilFiles();
    const fileCount = files.length;

    console.log(`Files in utilities/: ${fileCount}`);
    if (fileCount > MAX_UTIL_FILES) {
        console.error(`  ERROR: utilities/ has ${fileCount} files (max: ${MAX_UTIL_FILES})`);
        console.error('  Consider splitting into domain-specific modules.\n');
        hasErrors = true;
    } else if (fileCount > MAX_UTIL_FILES * 0.8) {
        console.warn(`  WARNING: utilities/ approaching limit (${fileCount}/${MAX_UTIL_FILES})\n`);
    } else {
        console.log('  OK\n');
    }

    // Check for god files
    console.log('Checking for overly-coupled files...');
    try {
        const stats = await analyzeDependents();
        const godFiles = stats.filter(s => s.dependentCount > MAX_DEPENDENTS);

        if (godFiles.length > 0) {
            console.error(`  ERROR: Found ${godFiles.length} file(s) with too many dependents:\n`);
            for (const file of godFiles) {
                console.error(`    ${file.path}: ${file.dependentCount} dependents (max: ${MAX_DEPENDENTS})`);
            }
            console.error('\n  Consider breaking these into smaller, focused modules.');
            hasErrors = true;
        } else {
            console.log('  OK - No overly-coupled files found.\n');
        }

        // Show top 5 most-used utilities for info
        if (stats.length > 0) {
            console.log('Top used utilities:');
            for (const file of stats.slice(0, 5)) {
                console.log(`  ${file.path}: ${file.dependentCount} dependents`);
            }
        }
    } catch (error) {
        console.warn('  Could not analyze dependencies (dependency-cruiser error)');
        console.warn(`  ${error}\n`);
    }

    process.exit(hasErrors ? 1 : 0);
}

main().catch(console.error);
