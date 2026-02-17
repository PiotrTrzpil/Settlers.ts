/**
 * Audio state and control helpers for e2e tests.
 *
 * Standalone functions that operate on a Playwright Page via `page.evaluate()`.
 * GamePage delegates to these; tests can also import them directly.
 */
import type { Page } from '@playwright/test';

// ── Return types ────────────────────────────────────────────────

export interface AudioState {
    musicEnabled: boolean;
    musicPlaying: boolean;
    currentMusicId: string | null;
}

// ── Audio queries ───────────────────────────────────────────────

/** Get current audio state from debug bridge. */
export async function getAudioState(page: Page): Promise<AudioState> {
    return page.evaluate(() => {
        const d = (window as any).__settlers_debug__;
        return {
            musicEnabled: d?.musicEnabled ?? false,
            musicPlaying: d?.musicPlaying ?? false,
            currentMusicId: d?.currentMusicId ?? null,
        };
    });
}

// ── Audio controls ──────────────────────────────────────────────

/**
 * Toggle music on or off via SoundManager.
 * Does NOT wait for frames — caller is responsible for waiting.
 */
export async function setMusicEnabled(page: Page, enabled: boolean): Promise<void> {
    await page.evaluate(e => {
        const game = (window as any).__settlers_game__;
        game?.soundManager?.toggleMusic(e);
    }, enabled);
}
