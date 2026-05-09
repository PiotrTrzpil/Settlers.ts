<template>
    <div class="home">
        <div class="home-card">
            <div class="home-header">
                <h1 class="home-title">
                    <span class="title-ornament" aria-hidden="true"></span>
                    <span class="title-text">
                        <span class="title-name">Settlers</span><span class="title-ext">.ts</span>
                    </span>
                    <span class="title-ornament" aria-hidden="true"></span>
                </h1>
                <p class="home-subtitle">A Settlers 4 browser remake</p>
            </div>

            <div v-if="isValidSettlers" class="home-body">
                <button class="play-btn" @click="$router.push('/map-select')">&#9654; Game Mode</button>
                <button class="dev-btn" @click="$router.push('/map-view')">&#9881; Dev Mode</button>

                <div class="options">
                    <div class="options-title">Settings</div>

                    <Checkbox v-model="luaEnabled" label="Enable Lua scripting" @update:modelValue="saveLuaSetting">
                        <Badge color="neutral">experimental</Badge>
                    </Checkbox>

                    <Checkbox v-model="homeSettings.state.cacheDisabled" label="Disable sprite cache">
                        <span class="hint-inline">(slower loading)</span>
                    </Checkbox>

                    <div class="cache-controls">
                        <button class="secondary-btn" @click="handleClearCache" :disabled="isClearing">
                            {{ isClearing ? 'Clearing...' : 'Clear Cache' }}
                        </button>
                        <span class="hint">Clears all cached sprite data</span>
                    </div>

                    <div class="cache-controls">
                        <button class="secondary-btn" @click="handleClearGameState" :disabled="isClearingState">
                            {{ isClearingState ? 'Clearing...' : 'Clear Game State' }}
                        </button>
                        <span class="hint">Removes all saved sessions and game state</span>
                    </div>
                </div>
            </div>

            <div v-else class="home-body setup-section">
                <h2 class="setup-title">Setup Required</h2>
                <p class="setup-desc">
                    Provide your Settlers 4 game directory to begin.<br />
                    Files are only accessed by your browser — nothing is uploaded.
                </p>

                <div class="file-select-group">
                    <div class="file-select-option">
                        <span class="file-select-label">Select game folder</span>
                        <label class="file-btn">
                            Browse Folder
                            <input type="file" directory webkitdirectory multiple @change="selectFiles" />
                        </label>
                    </div>

                    <div class="divider-or">or</div>

                    <div class="file-select-option">
                        <span class="file-select-label">Select individual files</span>
                        <label class="file-btn">
                            Browse Files
                            <input type="file" multiple name="files[]" @change="selectFiles" />
                        </label>
                    </div>
                </div>
            </div>

            <div class="home-footer">
                <div>
                    Found a bug or want to contribute?
                    <a href="https://github.com/tomsoftware/Settlers.ts" target="_blank" rel="noopener"
                        >View on GitHub</a
                    >
                </div>
                <div class="home-disclaimer">Unaffiliated fan remake. The Settlers is a trademark of Ubisoft.</div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import Badge from '@/components/Badge.vue';
import Checkbox from '@/components/Checkbox.vue';
import { FileManager } from '@/utilities/file-manager';
import { LocalFileProvider } from '@/utilities/local-file-provider';
import { GameSettingsManager } from '@/game/game-settings';
import { clearAllCaches } from '@/game/renderer/sprite-cache';
import { clearAllGameState, open as openSaveDb } from '@/game/persistence/indexed-db-store';
import { clearLabelCache } from '@/views/gfx-view-labels';

// Local settings instance — loads from localStorage.
// When Game is later created, it reads the same persisted state.
const homeSettings = new GameSettingsManager();

const props = defineProps<{
    fileManager: FileManager;
}>();

const isValidSettlers = ref(false);
const luaEnabled = ref(loadLuaSetting());
const isClearing = ref(false);
const isClearingState = ref(false);

function loadLuaSetting(): boolean {
    try {
        return localStorage.getItem('settlers_luaEnabled') === 'true';
    } catch {
        return false;
    }
}

function saveLuaSetting(): void {
    try {
        localStorage.setItem('settlers_luaEnabled', String(luaEnabled.value));
    } catch {
        // localStorage not available
    }
}

async function handleClearCache(): Promise<void> {
    isClearing.value = true;
    try {
        await clearAllCaches();
        clearLabelCache();
    } finally {
        isClearing.value = false;
    }
}

async function handleClearGameState(): Promise<void> {
    isClearingState.value = true;
    try {
        await openSaveDb();
        await clearAllGameState();
    } finally {
        isClearingState.value = false;
    }
}

// Invalidate cache when disabling — stored format changes
watch(
    () => homeSettings.state.cacheDisabled,
    () => {
        void clearAllCaches();
        clearLabelCache();
    }
);

function checkIsValidSettlers() {
    // Classic editions have game.lib; History Edition has unpacked files
    isValidSettlers.value =
        props.fileManager.findFile('game.lib', false) != null || props.fileManager.findFile('2.gh6', false) != null;
}

async function selectFiles(e: Event) {
    if (!e.target) {
        return;
    }

    const files = (e.target as HTMLInputElement).files;
    if (!files) {
        return;
    }

    await props.fileManager.addSource(new LocalFileProvider(files));

    checkIsValidSettlers();
}

watch(
    () => props.fileManager,
    () => {
        checkIsValidSettlers();
    }
);

checkIsValidSettlers();
</script>

<style scoped>
.home {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    padding: 24px;
    background: var(--bg-darkest);
}

.home-card {
    width: 100%;
    max-width: 480px;
    background: var(--bg-dark);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    overflow: hidden;
}

/* Header */
.home-header {
    padding: 28px 32px 20px;
    border-bottom: 1px solid var(--border);
    text-align: center;
}

.home-title {
    margin: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    line-height: 1;
}

.title-text {
    display: inline-flex;
    align-items: baseline;
    white-space: nowrap;
}

.title-name {
    font-family: 'Cinzel', 'Trajan Pro', 'Optima', Georgia, serif;
    font-size: 2.6rem;
    font-weight: 600;
    letter-spacing: 4px;
    text-transform: uppercase;
    background: linear-gradient(180deg, #f6e0a4 0%, #e8c87e 30%, #c8932a 65%, #8a6020 100%);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    color: transparent;
    text-shadow:
        0 1px 0 rgba(0, 0, 0, 0.6),
        0 0 22px rgba(212, 160, 48, 0.18);
    filter: drop-shadow(0 2px 1px rgba(0, 0, 0, 0.7));
}

.title-ext {
    font-family: 'JetBrains Mono', 'SFMono-Regular', Menlo, Consolas, monospace;
    font-size: 1rem;
    font-weight: 500;
    color: var(--text-accent);
    letter-spacing: 0.5px;
    margin-left: -2px;
    align-self: flex-end;
    transform: translateY(-0.35em);
    opacity: 0.95;
}

.title-ornament {
    flex: 1 1 auto;
    max-width: 70px;
    height: 1px;
    background: linear-gradient(to right, transparent 0%, var(--border-strong) 30%, var(--text-accent) 100%);
    position: relative;
}

.title-ornament:last-child {
    background: linear-gradient(to left, transparent 0%, var(--border-strong) 30%, var(--text-accent) 100%);
}

.title-ornament::after {
    content: '';
    position: absolute;
    top: 50%;
    right: -1px;
    width: 6px;
    height: 6px;
    background: var(--text-accent);
    transform: translateY(-50%) rotate(45deg);
    box-shadow: 0 0 6px rgba(212, 160, 48, 0.6);
}

.title-ornament:last-child::after {
    right: auto;
    left: -1px;
}

.home-subtitle {
    margin: 10px 0 0;
    font-size: 0.78rem;
    color: var(--text-secondary);
    letter-spacing: 3px;
    text-transform: uppercase;
    font-weight: 500;
}

/* Body */
.home-body {
    padding: 24px 32px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
}

/* Play button */
.play-btn {
    font-size: 1.2rem;
    font-weight: 600;
    padding: 12px 56px;
    cursor: pointer;
    background: #426a30;
    color: #e4eed8;
    border: 1px solid #56823e;
    border-radius: 6px;
    letter-spacing: 1px;
    transition:
        background 0.15s,
        border-color 0.15s;
    width: 100%;
}

.play-btn:hover {
    background: #56823e;
    border-color: #6a994e;
}

/* Dev mode button */
.dev-btn {
    font-size: 1.2rem;
    font-weight: 600;
    padding: 12px 56px;
    cursor: pointer;
    background: var(--bg-mid);
    color: var(--text);
    border: 1px solid var(--border-mid);
    border-radius: 6px;
    letter-spacing: 1px;
    transition:
        background 0.15s,
        border-color 0.15s;
    width: 100%;
}

.dev-btn:hover {
    background: var(--bg-raised);
    border-color: var(--border-hover);
}

/* Options panel */
.options {
    width: 100%;
    padding: 14px 16px;
    background: var(--bg-darkest);
    border: 1px solid var(--border);
    border-radius: 6px;
}

.options-title {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.8px;
    margin-bottom: 12px;
}

/* Style Checkbox component to match the home page context */
.options :deep(.control-row) {
    color: var(--text);
    font-size: 0.875rem;
    gap: 8px;
    margin-bottom: 10px;
}

.options :deep(.control-row:last-of-type) {
    margin-bottom: 0;
}

.hint-inline {
    color: var(--text-dim);
    font-size: 0.8rem;
}

.cache-controls {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--bg-mid);
    display: flex;
    align-items: center;
    gap: 12px;
}

.secondary-btn {
    padding: 5px 14px;
    background: var(--bg-mid);
    color: var(--text);
    border: 1px solid var(--border-mid);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.8rem;
    transition: background 0.15s;
}

.secondary-btn:hover:not(:disabled) {
    background: var(--bg-raised);
    border-color: var(--border-hover);
}

.secondary-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.hint {
    color: var(--text-dim);
    font-size: 0.78rem;
}

/* Setup section */
.setup-section {
    text-align: center;
}

.setup-title {
    margin: 0;
    font-size: 1.1rem;
    color: var(--text);
    font-weight: 600;
}

.setup-desc {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-secondary);
    line-height: 1.6;
}

.file-select-group {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.file-select-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: var(--bg-darkest);
    border: 1px solid var(--border);
    border-radius: 6px;
}

.file-select-label {
    font-size: 0.85rem;
    color: var(--text-secondary);
}

.file-btn {
    display: inline-block;
    padding: 6px 16px;
    background: var(--bg-mid);
    color: var(--text);
    border: 1px solid var(--border-mid);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.82rem;
    font-family: inherit;
    transition: background 0.15s;
    white-space: nowrap;
}

.file-btn:hover {
    background: var(--bg-raised);
    border-color: var(--border-hover);
}

.file-btn input[type='file'] {
    display: none;
}

.divider-or {
    text-align: center;
    font-size: 0.75rem;
    color: var(--border-strong);
    text-transform: uppercase;
    letter-spacing: 1px;
}

/* Footer */
.home-footer {
    padding: 14px 32px;
    border-top: 1px solid var(--border);
    text-align: center;
    font-size: 0.8rem;
    color: var(--text-dim);
    background: var(--bg-darkest);
}

.home-footer a {
    color: var(--text-accent);
    text-decoration: none;
    margin-left: 4px;
}

.home-footer a:hover {
    color: var(--text-emphasis);
    text-decoration: underline;
}

.home-disclaimer {
    margin-top: 8px;
    font-size: 0.7rem;
    color: var(--text-faint);
    font-style: italic;
}
</style>
