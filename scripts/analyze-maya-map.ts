
import fs from 'fs';
import path from 'path';
import { OriginalMapLoader } from '@/resources/map/original/original-map/game-map-loader';
import { BinaryReader } from '@/resources/file/binary-reader';

const mapPath = path.join(process.cwd(), 'public/Siedler4/Map/Campaign/AO_maya1.map');

console.log(`Reading map: ${mapPath}`);

try {
    const buffer = fs.readFileSync(mapPath);
    const data = new Uint8Array(buffer);
    const reader = new BinaryReader(data, 0, data.byteLength, 'AO_maya1.map');
    const loader = new OriginalMapLoader(reader);

    if (!loader) {
        console.error('Failed to load map');
        process.exit(1);
    }

    const landscape = loader.landscape as any;

    const off1 = landscape.getSlice(1); // Ground
    const off2 = landscape.getSlice(2); // Species (Subtype)
    const _off3 = landscape.getSlice(3); // Type (always 64?)

    console.log(`Total tiles: ${off2.length}`);

    // Analyze where Species 3 (Birch) lives
    const groundCountsForSpecies3 = new Map<number, number>();
    const groundCountsForSpecies4 = new Map<number, number>();
    const groundCountsForSpecies8 = new Map<number, number>();

    for (let i = 0; i < off2.length; i++) {
        const s = off2[i];
        const g = off1[i];

        if (s === 3) {
            groundCountsForSpecies3.set(g, (groundCountsForSpecies3.get(g) ?? 0) + 1);
        }
        if (s === 4) {
            groundCountsForSpecies4.set(g, (groundCountsForSpecies4.get(g) ?? 0) + 1);
        }
        if (s === 8) {
            groundCountsForSpecies8.set(g, (groundCountsForSpecies8.get(g) ?? 0) + 1);
        }
    }

    console.log('\nWhere is Species 3 (Birch)? Offset 1 distribution:');
    for (const [g, c] of [...groundCountsForSpecies3.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`Offset 1 = ${g}: ${c}`);
    }

    console.log('\nWhere is Species 4 (Palm)? Offset 1 distribution:');
    for (const [g, c] of [...groundCountsForSpecies4.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`Offset 1 = ${g}: ${c}`);
    }

    console.log('\nWhere is Species 8? Offset 1 distribution:');
    for (const [g, c] of [...groundCountsForSpecies8.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`Offset 1 = ${g}: ${c}`);
    }

} catch (e) {
    console.error('Error:', e);
}
