/**
 * One-shot: reclassify raw-object-registry entries based on dark-land analysis.
 * Dry-run by default. Pass --apply to write changes.
 */
import * as fs from 'fs';

const REGISTRY_PATH = 'src/resources/map/raw-object-registry.ts';
const APPLY = process.argv.includes('--apply');

// Raw values to reclassify to DarkGround (dark% ≥ 85% across 373 maps)
const TO_DARK_GROUND: Map<number, { darkPct: number; total: number; maps: number }> = new Map([
    [93, { darkPct: 93, total: 532, maps: 44 }],
    [99, { darkPct: 95, total: 465, maps: 40 }],
    [100, { darkPct: 95, total: 402, maps: 44 }],
    [101, { darkPct: 91, total: 156, maps: 38 }],
    [104, { darkPct: 97, total: 877, maps: 49 }],
    [105, { darkPct: 98, total: 829, maps: 50 }],
    [106, { darkPct: 98, total: 759, maps: 50 }],
    [111, { darkPct: 95, total: 1879, maps: 49 }],
    [112, { darkPct: 95, total: 1100, maps: 47 }],
    [113, { darkPct: 94, total: 917, maps: 45 }],
    [114, { darkPct: 94, total: 617, maps: 46 }],
    [137, { darkPct: 98, total: 72, maps: 18 }],
    [138, { darkPct: 100, total: 74, maps: 17 }],
    [139, { darkPct: 100, total: 59, maps: 16 }],
    [140, { darkPct: 100, total: 60, maps: 17 }],
    [141, { darkPct: 98, total: 84, maps: 22 }],
    [142, { darkPct: 100, total: 36, maps: 9 }],
    [143, { darkPct: 100, total: 43, maps: 12 }],
    [144, { darkPct: 98, total: 69, maps: 17 }],
    [145, { darkPct: 98, total: 51, maps: 15 }],
    [146, { darkPct: 100, total: 70, maps: 15 }],
    [147, { darkPct: 98, total: 76, maps: 19 }],
    [148, { darkPct: 98, total: 57, maps: 16 }],
    [149, { darkPct: 98, total: 295, maps: 22 }],
    [150, { darkPct: 100, total: 12, maps: 7 }],
    [233, { darkPct: 98, total: 238, maps: 39 }],
    [234, { darkPct: 99, total: 148, maps: 26 }],
    [235, { darkPct: 99, total: 145, maps: 30 }],
    [236, { darkPct: 99, total: 154, maps: 32 }],
    [237, { darkPct: 96, total: 165, maps: 36 }],
    [238, { darkPct: 100, total: 71, maps: 23 }],
    [239, { darkPct: 100, total: 126, maps: 28 }],
    [240, { darkPct: 97, total: 141, maps: 29 }],
    [241, { darkPct: 98, total: 182, maps: 33 }],
    [242, { darkPct: 100, total: 78, maps: 13 }],
    [243, { darkPct: 97, total: 79, maps: 29 }],
    [244, { darkPct: 98, total: 317, maps: 31 }],
    [246, { darkPct: 88, total: 125, maps: 33 }],
    [247, { darkPct: 97, total: 137, maps: 35 }],
    [248, { darkPct: 88, total: 162, maps: 37 }],
    [249, { darkPct: 94, total: 459, maps: 32 }],
    [251, { darkPct: 97, total: 289, maps: 33 }],
    [252, { darkPct: 97, total: 89, maps: 27 }],
]);

let content = fs.readFileSync(REGISTRY_PATH, 'utf-8');
let changes = 0;

for (const [raw, info] of TO_DARK_GROUND) {
    // Match the line for this raw value
    const lineRegex = new RegExp(
        `(\\{ raw: ${raw},\\s+label: ')(\\w+)'(,\\s+category: MapObjectCategory\\.)(\\w+)(,\\s+notes: ')([^']*)(')`,
        'g'
    );
    const match = lineRegex.exec(content);
    if (!match) {
        console.log(`SKIP raw=${raw}: line not found`);
        continue;
    }

    const oldLabel = match[2];
    const oldCategory = match[4];

    // Skip if already DarkGround
    if (oldCategory === 'DarkGround' || oldCategory === 'DarkGroundRare') {
        console.log(`SKIP raw=${raw}: already ${oldCategory}`);
        continue;
    }

    // New label: DarkPlant{raw} for plants, DarkDesert{raw} for desert
    const newLabel = `DarkPlant${raw}`;
    const newNotes = `dark-land:${info.darkPct}%, ${info.total} across ${info.maps} maps; was ${oldCategory}`;

    console.log(`raw=${raw}: ${oldLabel} (${oldCategory}) → ${newLabel} (DarkGround) [dark=${info.darkPct}%]`);

    content = content.replace(match[0], `${match[1]}${newLabel}'${match[3]}DarkGround${match[5]}${newNotes}'`);
    changes++;
}

if (APPLY) {
    fs.writeFileSync(REGISTRY_PATH, content);
    console.log(`\nApplied ${changes} changes to ${REGISTRY_PATH}`);
} else {
    console.log(`\nDry run: ${changes} changes would be made. Use --apply to write.`);
}
