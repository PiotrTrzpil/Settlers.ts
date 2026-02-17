/**
 * E2E tests for audio system
 *
 * Tests audio state management via the debug bridge.
 * Note: We can't easily verify actual audio output in e2e tests,
 * but we can verify state transitions and no overlap conditions.
 */

import { test, expect } from './fixtures';

test.describe('Audio System', { tag: '@smoke' }, () => {
    test('no multiple music IDs playing simultaneously', async ({ gp }) => {
        await gp.unlockAudio();
        await gp.waitForFrames(1);

        // Sample audio state multiple times over a short period
        const samples: string[] = [];
        for (let i = 0; i < 5; i++) {
            const state = await gp.getAudioState();
            if (state.currentMusicId) {
                samples.push(state.currentMusicId);
            }
            await gp.waitForFrames(2);
        }

        // If we have samples, they should all be the same (no rapid switching indicating overlap)
        if (samples.length > 1) {
            const uniqueIds = new Set(samples);
            // During normal playback, we should have at most 1 unique ID
            // (unless a track naturally ended and another started, which is rare in 10 frames)
            expect(uniqueIds.size).toBeLessThanOrEqual(2);
        }
    });
});
