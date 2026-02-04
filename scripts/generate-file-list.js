#!/usr/bin/env node

// Generates public/file-list.txt by scanning all files in public/.
// Cross-platform replacement for create-file-list.bat.
//
// Usage: node scripts/generate-file-list.js

const fs = require('fs');
const path = require('path');

const publicDir = path.resolve(__dirname, '..', 'public');
const outFile = path.join(publicDir, 'file-list.txt');

function walk(dir) {
    const entries = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            entries.push(...walk(full));
        } else if (entry.isFile() && entry.name !== 'file-list.txt') {
            entries.push(full);
        }
    }
    return entries;
}

const files = walk(publicDir)
    .map(f => path.relative(publicDir, f).split(path.sep).join('/'))
    .sort();

fs.writeFileSync(outFile, files.join('\n') + '\n', 'utf8');

console.log(`Wrote ${files.length} entries to ${path.relative(process.cwd(), outFile)}`);
