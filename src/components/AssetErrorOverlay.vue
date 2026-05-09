<template>
    <div v-if="errors.length" class="asset-error-overlay" role="alert">
        <div class="asset-error-box">
            <header class="asset-error-header">
                <h2>Missing or corrupted game assets</h2>
                <p>
                    Settlers.ts could not load some original game files. Follow the
                    <a :href="readmeUrl" target="_blank" rel="noreferrer">"Set up game files"</a>
                    section of the README to copy assets from your legal copy of The Settlers 4.
                </p>
            </header>
            <ul class="asset-error-list">
                <li v-for="err in displayed" :key="err.path">
                    <code>{{ err.path }}</code>
                    <span class="reason" :class="reasonClass(err.reason)">{{ reasonLabel(err.reason) }}</span>
                    <span v-if="err.detail" class="detail">{{ err.detail }}</span>
                </li>
            </ul>
            <p v-if="errors.length > displayed.length" class="more">+ {{ errors.length - displayed.length }} more</p>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { assetErrors, type AssetErrorReason } from '@/utilities/asset-error-reporter';

const README_URL = 'https://github.com/PiotrTrzpil/Settlers.ts#set-up-game-files';
const DISPLAY_LIMIT = 12;

const errors = computed(() => assetErrors.errors);
const displayed = computed(() => errors.value.slice(0, DISPLAY_LIMIT));
const readmeUrl = README_URL;

function reasonLabel(reason: AssetErrorReason): string {
    switch (reason) {
        case 'missing':
            return 'missing';
        case 'parse':
            return 'parse error';
        case 'corrupted':
            return 'corrupted';
    }
}

function reasonClass(reason: AssetErrorReason): string {
    return `reason-${reason}`;
}
</script>

<style scoped>
.asset-error-overlay {
    position: fixed;
    top: 12px;
    right: 12px;
    z-index: 9999;
    max-width: 480px;
    pointer-events: auto;
}

.asset-error-box {
    background: rgba(13, 10, 5, 0.96);
    border: 1px solid var(--status-bad);
    border-radius: 4px;
    padding: 12px 14px;
    color: var(--text);
    font-family: monospace;
    font-size: 12px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.6);
}

.asset-error-header h2 {
    margin: 0 0 6px;
    font-size: 13px;
    color: var(--status-bad);
    letter-spacing: 0.5px;
    text-transform: uppercase;
}

.asset-error-header p {
    margin: 0 0 8px;
    color: var(--text-bright);
    line-height: 1.4;
}

.asset-error-header a {
    color: var(--text-accent);
    text-decoration: underline;
}

.asset-error-list {
    list-style: none;
    margin: 0;
    padding: 6px 0 0;
    border-top: 1px solid var(--border-soft);
    max-height: 240px;
    overflow-y: auto;
}

.asset-error-list li {
    padding: 3px 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
}

.asset-error-list code {
    color: var(--text-emphasis);
    word-break: break-all;
    font-size: 11px;
}

.reason {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.reason-missing {
    color: var(--status-bad);
}

.reason-parse,
.reason-corrupted {
    color: var(--status-warn);
}

.detail {
    color: var(--text-muted);
    font-size: 10px;
}

.more {
    margin: 6px 0 0;
    color: var(--text-muted);
    font-size: 11px;
}
</style>
