import fs from 'fs';
import path from 'path';

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '../public');
const silPath = path.join(publicDir, 'Siedler4/Snd/0.sil');
const sndPath = path.join(publicDir, 'Siedler4/Snd/0.snd');

function printHex(buffer: Buffer, name: string) {
    console.log(`\n--- ${name} (First 64 bytes) ---`);
    let output = '';
    for (let i = 0; i < Math.min(64, buffer.length); i++) {
        output += buffer[i].toString(16).padStart(2, '0') + ' ';
        if ((i + 1) % 16 === 0) output += '\n';
    }
    console.log(output);

    console.log('--- ASCII ---');
    let ascii = '';
    for (let i = 0; i < Math.min(64, buffer.length); i++) {
        const c = buffer[i];
        ascii += (c >= 32 && c <= 126) ? String.fromCharCode(c) : '.';
    }
    console.log(ascii);

    // Try reading as 32-bit integers (for .sil index)
    if (name.includes('.sil')) {
        console.log('--- Int32LE ---');
        for (let i = 0; i < Math.min(64, buffer.length); i += 4) {
            console.log(`${i}: ${buffer.readInt32LE(i)}`);
        }
        console.log('--- Int32BE ---');
        for (let i = 0; i < Math.min(64, buffer.length); i += 4) {
            console.log(`${i}: ${buffer.readInt32BE(i)}`);
        }
    }
}

if (fs.existsSync(silPath)) {
    const sil = fs.readFileSync(silPath);
    printHex(sil, '0.sil');
} else {
    console.log('0.sil not found at', silPath);
}

if (fs.existsSync(sndPath)) {
    const snd = fs.readFileSync(sndPath);
    // printHex(snd, '0.snd');

    console.log('\n--- Scanning 0.snd for "RIFF" ---');
    let count = 0;
    for (let i = 0; i < snd.length - 4; i++) {
        // R I F F = 52 49 46 46
        if (snd[i] === 0x52 && snd[i + 1] === 0x49 && snd[i + 2] === 0x46 && snd[i + 3] === 0x46) {
            console.log(`Found RIFF at offset: ${i} (0x${i.toString(16)})`);

            // Read Size (next 4 bytes LE)
            const size = snd.readInt32LE(i + 4);
            console.log(`  - Chunk Size: ${size}`);
            console.log(`  - End: ${i + 8 + size}`);

            // Check Format - WAVE signature
            const isWave = snd[i + 8] === 0x57 && snd[i + 9] === 0x41 &&
                           snd[i + 10] === 0x56 && snd[i + 11] === 0x45;
            const hasFmtChunk = snd[i + 12] === 0x66 && snd[i + 13] === 0x6d &&
                                snd[i + 14] === 0x74 && snd[i + 15] === 0x20;

            if (isWave) {
                console.log(`  - Type: WAVE`);
            }
            if (isWave && hasFmtChunk) {
                const audioFormat = snd.readUInt16LE(i + 20);
                console.log(`  - AudioFormat: ${audioFormat} (1=PCM, 17=IMA ADPCM)`);
            }

            count++;
            if (count > 10) {
                console.log('... stopping scan after 10 items');
                break;
            }
        }
    }
}
