#!/usr/bin/env tsx
/**
 * Send commands to the running game via the CLI WebSocket.
 *
 *   pnpm cli "ls buildings"
 *   pnpm cli "js state.getGroundEntityAt(140,443)"
 *   pnpm cli                  # interactive REPL
 */

import { connectGameCli } from '../src/game/cli/node-client';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createInterface } from 'readline';

const RESULT_FILE = join(tmpdir(), 'cli-result.json');

const urls = process.env['CLI_URL']
    ? [process.env['CLI_URL']]
    : ['ws://localhost:5173/__cli__', 'ws://localhost:5174/__cli__'];

let client!: Awaited<ReturnType<typeof connectGameCli>>;
for (let i = 0; i < urls.length; i++) {
    try {
        client = await connectGameCli(urls[i]!);
        break;
    } catch {
        if (i === urls.length - 1) throw new Error(`Could not connect to any of: ${urls.join(', ')}`);
    }
}
const args = process.argv.slice(2).join(' ');

if (args) {
    print(await client.run(args));
    client.close();
} else {
    const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: 'cli> ' });
    rl.prompt();
    for await (const line of rl) {
        const cmd = line.trim();
        if (!cmd || cmd === 'exit') break;
        print(await client.run(cmd));
        rl.prompt();
    }
    client.close();
}

function print({ ok, output }: { ok: boolean; output: string }): void {
    if (output.length > 4096) {
        writeFileSync(RESULT_FILE, output);
        console.log(`=> ${RESULT_FILE} (${(output.length / 1024).toFixed(1)}KB)`);
    } else {
        console.log(output);
    }
    if (!ok) process.exitCode = 1;
}
