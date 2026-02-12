<template>
  <div class="settings-panel" :class="{ collapsed: !open }">
    <button class="settings-toggle-btn" @click="open = !open" title="Settings Panel">
      <span class="toggle-icon">{{ open ? '&#x25BC;' : '&#x25B6;' }}</span>
      <span class="toggle-label">Settings</span>
    </button>

    <div v-if="open" class="settings-sections">
      <!-- Game Settings -->
      <section class="settings-section">
        <h3 class="section-header" @click="sections.game = !sections.game">
          <span class="caret">{{ sections.game ? '&#x25BC;' : '&#x25B6;' }}</span>
          Game
        </h3>
        <div v-if="sections.game" class="section-body">
          <SettingsCheckbox label="Paused" v-model="settings.paused" />
          <SettingsSlider
            label="Game speed"
            v-model="settings.gameSpeed"
            :min="0.25" :max="4" :step="0.25"
            :disabled="settings.paused"
          />
        </div>
      </section>

      <!-- Camera Settings -->
      <section class="settings-section">
        <h3 class="section-header" @click="sections.camera = !sections.camera">
          <span class="caret">{{ sections.camera ? '&#x25BC;' : '&#x25B6;' }}</span>
          Camera
        </h3>
        <div v-if="sections.camera" class="section-body">
          <SettingsSlider
            label="Zoom speed"
            v-model="settings.zoomSpeed"
            :min="0.01" :max="0.10" :step="0.01"
          />
          <SettingsSlider
            label="Pan speed"
            v-model="settings.panSpeed"
            :min="5" :max="100" :step="5"
          />
        </div>
      </section>

      <!-- Audio Settings -->
      <section class="settings-section">
        <h3 class="section-header" @click="sections.audio = !sections.audio">
          <span class="caret">{{ sections.audio ? '&#x25BC;' : '&#x25B6;' }}</span>
          Audio
        </h3>
        <div v-if="sections.audio" class="section-body">
          <SettingsCheckbox
            label="Enable Music"
            v-model="settings.musicEnabled"
            @update:modelValue="onMusicToggle"
          />
          <SettingsSlider
            label="Music volume"
            v-model="settings.musicVolume"
            :min="0" :max="1" :step="0.1"
            :disabled="!settings.musicEnabled"
            @update:modelValue="onMusicVolumeChange"
          />
          <SettingsCheckbox
            label="Enable SFX"
            v-model="settings.sfxEnabled"
          />
          <SettingsSlider
            label="SFX volume"
            v-model="settings.sfxVolume"
            :min="0" :max="1" :step="0.1"
            :disabled="!settings.sfxEnabled"
          />
        </div>
      </section>

      <!-- Display Settings -->
      <section class="settings-section">
        <h3 class="section-header" @click="sections.display = !sections.display">
          <span class="caret">{{ sections.display ? '&#x25BC;' : '&#x25B6;' }}</span>
          Display
        </h3>
        <div v-if="sections.display" class="section-body">
          <SettingsCheckbox label="Debug grid" v-model="settings.showDebugGrid" />
          <SettingsCheckbox label="Disable player tinting" v-model="settings.disablePlayerTinting" />
        </div>
      </section>

      <!-- Graphics Settings -->
      <section class="settings-section">
        <h3 class="section-header" @click="sections.graphics = !sections.graphics">
          <span class="caret">{{ sections.graphics ? '&#x25BC;' : '&#x25B6;' }}</span>
          Graphics
        </h3>
        <div v-if="sections.graphics" class="section-body">
          <SettingsCheckbox
            label="Anti-aliasing (MSAA)"
            v-model="settings.antialias"
          />
        </div>
      </section>

      <!-- Reset button -->
      <section class="settings-section">
        <div class="reset-section">
          <button class="reset-btn" @click="resetSettings">
            Reset to Defaults
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, computed, onMounted } from 'vue';
import { gameSettings } from '@/game/game-settings';
import type { Game } from '@/game/game';
import SettingsSlider from './settings/SettingsSlider.vue';
import SettingsCheckbox from './settings/SettingsCheckbox.vue';

const settings = gameSettings.state;

const open = computed({
    get: () => settings.settingsPanelOpen,
    set: (value: boolean) => { settings.settingsPanelOpen = value }
});

const sections = reactive({
    game: true,
    camera: true,
    audio: true,
    display: true,
    graphics: true,
});

// Helper to get game instance
const getGame = (): Game | null => (window as any).__settlers_game__ ?? null;

// Apply audio settings to game systems
function onMusicToggle(enabled: boolean) {
    getGame()?.soundManager.toggleMusic(enabled);
}

function onMusicVolumeChange(vol: number) {
    getGame()?.soundManager.setMusicVolume(vol);
}

function resetSettings() {
    gameSettings.resetToDefaults();
    // Re-apply audio settings after reset
    const game = getGame();
    if (game) {
        game.soundManager.toggleMusic(settings.musicEnabled);
        game.soundManager.setMusicVolume(settings.musicVolume);
    }
}

// Apply initial audio settings when component mounts (in case game is already loaded)
// Note: Camera settings are applied through use-renderer.ts watchers
onMounted(() => {
    const game = getGame();
    if (game) {
        game.soundManager.toggleMusic(settings.musicEnabled);
        game.soundManager.setMusicVolume(settings.musicVolume);
    }
});
</script>

<style scoped>
.settings-panel {
  background: rgba(13, 10, 5, 0.92);
  border: 1px solid #5c3d1a;
  border-radius: 4px;
  color: #c8a96e;
  font-size: 11px;
  font-family: monospace;
  min-width: 180px;
  max-height: 100%;
  overflow-y: auto;
  pointer-events: auto;
}

.settings-panel.collapsed {
  min-width: 0;
}

.settings-toggle-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 10px;
  background: #2c1e0e;
  color: #d4b27a;
  border: none;
  border-bottom: 1px solid #3a2a10;
  cursor: pointer;
  font-size: 11px;
  font-family: monospace;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.settings-toggle-btn:hover {
  background: #3a2810;
}

.toggle-icon {
  font-size: 8px;
  width: 10px;
}

.settings-sections {
  padding: 2px 0;
}

.settings-section {
  border-bottom: 1px solid #2a1e0e;
}

.settings-section:last-child {
  border-bottom: none;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  margin: 0;
  font-size: 10px;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #8a7040;
  cursor: pointer;
  user-select: none;
}

.section-header:hover {
  color: #c8a96e;
  background: rgba(60, 40, 16, 0.3);
}

.caret {
  font-size: 7px;
  width: 10px;
}

.section-body {
  padding: 2px 10px 6px;
}

.reset-section {
  padding: 6px 10px;
}

.reset-btn {
  width: 100%;
  padding: 5px 8px;
  background: #3a1a1a;
  color: #d08080;
  border: 1px solid #5a2a2a;
  border-radius: 3px;
  cursor: pointer;
  font-size: 10px;
  font-family: monospace;
  font-weight: bold;
  text-transform: uppercase;
}

.reset-btn:hover {
  background: #4a2020;
  border-color: #7a3a3a;
}

/* Scrollbar */
.settings-panel::-webkit-scrollbar {
  width: 4px;
}

.settings-panel::-webkit-scrollbar-track {
  background: #0d0a05;
}

.settings-panel::-webkit-scrollbar-thumb {
  background: #4a3218;
  border-radius: 2px;
}
</style>
