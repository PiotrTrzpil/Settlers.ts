<template>
    <OverlayPanel label="Settings" title="Settings Panel" min-width="180px" persist-key="settings">
        <CollapseSection title="Game" persist-key="settings-game">
            <Checkbox label="Paused" v-model="settings.paused" />
            <Checkbox label="Autosave" v-model="settings.autosaveEnabled" />
            <SettingsSlider
                label="Game speed"
                v-model="settings.gameSpeed"
                :min="0.5"
                :max="10"
                :step="0.5"
                :disabled="settings.paused"
            />
        </CollapseSection>

        <CollapseSection title="Camera" persist-key="settings-camera">
            <SettingsSlider label="Zoom speed" v-model="settings.zoomSpeed" :min="0.01" :max="0.1" :step="0.01" />
            <SettingsSlider label="Pan speed" v-model="settings.panSpeed" :min="5" :max="100" :step="5" />
        </CollapseSection>

        <CollapseSection title="Audio" persist-key="settings-audio">
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

        <CollapseSection title="Combat" persist-key="settings-combat">
            <Checkbox label="Units controllable in combat" v-model="settings.combatControllable" />
        </CollapseSection>

        <CollapseSection title="Display" persist-key="settings-display">
            <Checkbox label="Debug grid" v-model="settings.showDebugGrid" />
            <Checkbox label="Disable player tinting" v-model="settings.disablePlayerTinting" />
        </CollapseSection>

        <CollapseSection title="Graphics" persist-key="settings-graphics">
            <Checkbox label="Anti-aliasing (MSAA)" v-model="settings.antialias" />
        </CollapseSection>

        <section class="reset-section">
            <SettingsButton danger block @click="resetSettings">Reset to Defaults</SettingsButton>
        </section>
    </OverlayPanel>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import type { Game } from '@/game/game';
import SettingsSlider from './settings/SettingsSlider.vue';
import SettingsButton from './settings/SettingsButton.vue';
import Checkbox from './Checkbox.vue';
import CollapseSection from './CollapseSection.vue';
import OverlayPanel from './OverlayPanel.vue';

const props = defineProps<{
    game: Game;
}>();

const settings = props.game.settings.state;

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
</style>
