/**
 * Quick CLI access for node -e scripts. Usage:
 *
 *   node -e "const c = await require('./scripts/cli-helper.ts').connect(); ..."
 */
import { connectGameCli } from '../src/game/cli/node-client';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const RESULT_FILE = join(tmpdir(), 'cli-result.json');

export async function connect(url = 'ws://localhost:5174/__cli__') {
    const client = await connectGameCli(url);
    return {
        /** Run command, print output (saves large results to $TMPDIR/cli-result.json). */
        async q(cmd: string): Promise<string> {
            const { ok, output } = await client.run(cmd);
            if (output.length > 4096) {
                writeFileSync(RESULT_FILE, output);
                return `=> ${RESULT_FILE} (${(output.length / 1024).toFixed(1)}KB)`;
            }
            if (!ok) return `ERR: ${output}`;
            return output;
        },
        /** Run command, return raw result. */
        run: client.run.bind(client),
        close: client.close.bind(client),
    };
}
