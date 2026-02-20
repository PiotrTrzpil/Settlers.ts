<template>
    <OverlayPanel v-model:open="open" label="Settings" title="Settings Panel" min-width="180px">
        <CollapseSection title="Game">
            <Checkbox label="Paused" v-model="settings.paused" />
            <SettingsSlider
                label="Game speed"
                v-model="settings.gameSpeed"
                :min="0.25"
                :max="4"
                :step="0.25"
                :disabled="settings.paused"
            />
        </CollapseSection>

        <CollapseSection title="Camera">
            <SettingsSlider label="Zoom speed" v-model="settings.zoomSpeed" :min="0.01" :max="0.1" :step="0.01" />
            <SettingsSlider label="Pan speed" v-model="settings.panSpeed" :min="5" :max="100" :step="5" />
        </CollapseSection>

        <CollapseSection title="Audio">
            <Checkbox label="Enable Music" v-model="settings.musicEnabled" @update:modelValue="onMusicToggle" />
            <SettingsSlider
                label="Music volume"
                v-model="settings.musicVolume"
                :min="0"
                :max="1"
                :step="0.1"
                :disabled="!settings.musicEnabled"
                @update:modelValue="onMusicVolumeChange"
            />
            <Checkbox label="Enable SFX" v-model="settings.sfxEnabled" />
            <SettingsSlider
                label="SFX volume"
                v-model="settings.sfxVolume"
                :min="0"
                :max="1"
                :step="0.1"
                :disabled="!settings.sfxEnabled"
            />
        </CollapseSection>

        <CollapseSection title="Display">
            <Checkbox label="Debug grid" v-model="settings.showDebugGrid" />
            <Checkbox label="Disable player tinting" v-model="settings.disablePlayerTinting" />
        </CollapseSection>

        <CollapseSection title="Graphics">
            <Checkbox label="Anti-aliasing (MSAA)" v-model="settings.antialias" />
        </CollapseSection>

        <!-- Reset button -->
        <section class="reset-section">
            <button class="reset-btn" @click="resetSettings">Reset to Defaults</button>
        </section>
    </OverlayPanel>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import type { Game } from '@/game/game';
import SettingsSlider from './settings/SettingsSlider.vue';
import Checkbox from './Checkbox.vue';
import CollapseSection from './CollapseSection.vue';
import OverlayPanel from './OverlayPanel.vue';

const props = defineProps<{
    game: Game;
}>();

const settings = props.game.settings.state;

const open = computed({
    get: () => settings.settingsPanelOpen,
    set: (value: boolean) => {
        settings.settingsPanelOpen = value;
    },
});

// Apply audio settings to game systems
function onMusicToggle(enabled: boolean) {
    props.game.soundManager.toggleMusic(enabled);
}

function onMusicVolumeChange(vol: number) {
    props.game.soundManager.setMusicVolume(vol);
}

function resetSettings() {
    props.game.settings.resetToDefaults();
    // Re-apply audio settings after reset
    props.game.soundManager.toggleMusic(settings.musicEnabled);
    props.game.soundManager.setMusicVolume(settings.musicVolume);
}

// Apply initial audio settings when component mounts (in case game is already loaded)
// Note: Camera settings are applied through use-renderer.ts watchers
onMounted(() => {
    props.game.soundManager.toggleMusic(settings.musicEnabled);
    props.game.soundManager.setMusicVolume(settings.musicVolume);
});
</script>

<style scoped>
.reset-section {
    padding: 6px 10px;
    border-top: 1px solid var(--border-faint);
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
</style>
