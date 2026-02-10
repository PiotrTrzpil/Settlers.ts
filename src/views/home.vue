<template>
  <div class="home">
    <h1>Wellcome to Settlers.ts</h1>

    <div v-if="isValidSettlers">
      <button class="play-btn" @click="$router.push('/map-view')">Play</button>

      <div class="options">
        <label class="checkbox-label">
          <input type="checkbox" v-model="luaEnabled" @change="saveLuaSetting" />
          Enable Lua scripting (experimental)
        </label>

        <label class="checkbox-label">
          <input type="checkbox" v-model="gameSettings.state.cacheDisabled" />
          Disable sprite cache (slower loading)
        </label>

        <div class="cache-controls">
          <button
            class="clear-cache-btn"
            @click="handleClearCache"
            :disabled="isClearing"
          >
            {{ isClearing ? 'Clearing...' : 'Clear Cache' }}
          </button>
          <span class="hint">Clears all cached sprite data</span>
        </div>
      </div>
    </div>
    <div v-else>
      ❌ Please select your Settlers 4 directory!

      <br /><br />

      To start you need to provide the directory of your Settlers 4 copy.<br />
      Please use the file selector to select it:<br />
      (Files are only accessed by your browser and are not uploaded)<br />
      <br />

      Open via directory access:<br />
      <input type="file" directory webkitdirectory multiple @change="selectFiles" />
      <br />
      or<br />

      Open via multi file select:<br />
      <input type="file" multiple name="files[]" @change="selectFiles" />
    </div>

    <h3>You found a bug / you like to contribute?</h3>
    Find the source at <a href="https://github.com/tomsoftware/Settlers.ts">github</a>
  </div>

</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { FileManager } from '@/utilities/file-manager';
import { LocalFileProvider } from '@/utilities/local-file-provider';
import { gameSettings } from '@/game/game-settings';
import { clearAllCaches } from '@/game/renderer/sprite-atlas-cache';

const props = defineProps<{
    fileManager: FileManager;
}>();

const isValidSettlers = ref(false);
const luaEnabled = ref(loadLuaSetting());
const isClearing = ref(false);

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
    } finally {
        isClearing.value = false;
    }
}

function checkIsValidSettlers() {
    if (!props.fileManager) {
        isValidSettlers.value = false;
        return;
    }

    // Classic editions have game.lib; History Edition has unpacked files
    isValidSettlers.value =
        props.fileManager.findFile('game.lib', false) != null ||
        props.fileManager.findFile('2.gh6', false) != null;
}

async function selectFiles(e: Event) {
    if ((!e) || (!e.target)) {
        return;
    }

    const files = (e.target as HTMLInputElement).files;
    if ((!files)) {
        return;
    }

    await props.fileManager.addSource(new LocalFileProvider(files));

    checkIsValidSettlers();
}

watch(() => props.fileManager, () => {
    checkIsValidSettlers();
});

checkIsValidSettlers();
</script>

<style scoped>
.play-btn {
  font-size: 1.5em;
  padding: 12px 48px;
  margin: 20px 0;
  cursor: pointer;
  background: #4CAF50;
  color: white;
  border: none;
  border-radius: 6px;
}

.play-btn:hover {
  background: #388E3C;
}

.options {
  margin-top: 16px;
  padding: 12px;
  background: #2a2a2a;
  border-radius: 6px;
  display: inline-block;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  color: #aaa;
  font-size: 0.9em;
  margin-bottom: 8px;
}

.checkbox-label:last-of-type {
  margin-bottom: 0;
}

.checkbox-label input {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.cache-controls {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #444;
  display: flex;
  align-items: center;
  gap: 12px;
}

.clear-cache-btn {
  padding: 6px 16px;
  background: #555;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85em;
}

.clear-cache-btn:hover:not(:disabled) {
  background: #666;
}

.clear-cache-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.hint {
  color: #777;
  font-size: 0.8em;
}
</style>
