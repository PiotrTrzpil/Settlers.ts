<template>
    <div class="app-shell">
        <div id="nav">
            <router-link to="/">Start</router-link>
            <router-link to="/map-view">Map View</router-link>
            <router-link to="/map-file-view">Map File View</router-link>
            <router-link to="/lib-view">Lib View</router-link>
            <router-link to="/gh-view">Gh View</router-link>
            <router-link to="/gfx-view">Gfx View</router-link>
            <router-link to="/jil-view">Jil View</router-link>
            <router-link to="/logging-view">Logging</router-link>
        </div>

        <router-view v-if="fileManager" :fileManager="fileManager" class="app-content" />
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { FileManager } from './utilities/file-manager';
import { FileListProvider } from './utilities/file-list-provider';
import { LibFileProvider } from './utilities/lib-file-provider';
import { LogHandler } from './utilities/log-handler';
import { getGameDataLoader } from './resources/game-data';

const log = new LogHandler('App');
const fileManager = ref<FileManager | null>(null);

onMounted(async() => {
    log.debug('Starting...');

    try {
        const fm = new FileManager();

        await fm.addSource(new FileListProvider());
        await fm.registerProxy(new LibFileProvider());

        fileManager.value = fm;

        log.debug('Read FileManager sources done!');

        // Load game data XML files (non-blocking, logs on failure)
        getGameDataLoader()
            .load()
            .catch(e => {
                log.warn('Failed to load game data (non-critical): ' + e);
            });
    } catch (e) {
        log.error('Failed to initialize file manager', e instanceof Error ? e : new Error(String(e)));
    }
});
</script>

<style>
:root {
    /* Backgrounds */
    --bg-darkest: #0d0a05;
    --bg-dark: #1a1209;
    --bg-mid: #2c1e0e;
    --bg-raised: #3a2810;

    /* Borders */
    --border-faint: #2a1e0e;
    --border-soft: #3a2a10;
    --border: #3a2810;
    --border-mid: #4a3218;
    --border-strong: #5c3d1a;
    --border-hover: #6a4a20;
    --border-active: #d4a030;

    /* Text */
    --text-ghost: #4a3a2a;
    --text-faint: #5a4a3a;
    --text-dim: #6a5030;
    --text-muted: #7a6a4a;
    --text-secondary: #8a7040;
    --text: #c8a96e;
    --text-bright: #d4b27a;
    --text-emphasis: #e8c87e;
    --text-accent: #d4a030;

    /* Status */
    --status-good: #80c080;
    --status-warn: #e0c060;
    --status-alert: #e0a040;
    --status-bad: #d04040;
}

html,
body {
    margin: 0;
    padding: 0;
    height: 100%;
    overflow: hidden;
    background: var(--bg-darkest);
}

#app {
    font-family: Avenir, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-align: left;
    color: var(--text);
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg-darkest);
}

#nav {
    display: flex;
    gap: 2px;
    padding: 0;
    background: var(--bg-darkest);
    border-bottom: 2px solid var(--border-strong);
    flex-shrink: 0;
}

#nav a {
    display: inline-block;
    padding: 6px 14px;
    font-weight: bold;
    font-size: 12px;
    color: var(--text-secondary);
    text-decoration: none;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 2px solid transparent;
    transition:
        color 0.15s,
        background 0.15s;
}

#nav a:hover {
    color: var(--text);
    background: var(--bg-dark);
}

#nav a.router-link-exact-active {
    color: var(--text-emphasis);
    background: var(--bg-dark);
    border-bottom-color: var(--text-accent);
}

.app-shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
}

.app-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
}

/* Global dark-themed form controls */
select {
    background: var(--bg-dark);
    color: var(--text);
    border: 1px solid var(--border-mid);
    border-radius: 3px;
    padding: 4px 8px;
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    outline: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%238a7040'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 8px center;
    padding-right: 24px;
}

select:hover {
    border-color: var(--border-hover);
    background-color: var(--bg-mid);
}

select:focus {
    border-color: var(--border-active);
}

select option {
    background: var(--bg-dark);
    color: var(--text);
}

/* Custom checkbox */
input[type='checkbox'] {
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    background: var(--bg-dark);
    border: 1px solid var(--border-mid);
    border-radius: 2px;
    cursor: pointer;
    vertical-align: middle;
    position: relative;
    flex-shrink: 0;
}

input[type='checkbox']:hover {
    border-color: var(--border-hover);
    background: var(--bg-mid);
}

input[type='checkbox']:checked {
    background: var(--bg-raised);
    border-color: var(--border-active);
}

input[type='checkbox']:checked::after {
    content: '';
    position: absolute;
    left: 3px;
    top: 0px;
    width: 4px;
    height: 8px;
    border: solid var(--text-emphasis);
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
}

/* Global button focus styles - remove browser outline */
button:focus {
    outline: none;
}

button:focus-visible {
    outline: none;
}
</style>
