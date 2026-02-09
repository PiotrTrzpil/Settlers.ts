<template>
  <button
    class="settings-btn"
    :class="{ active, small }"
    :disabled="disabled"
    :title="title"
    tabindex="-1"
    @click="onClick"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
defineProps<{
  active?: boolean;
  disabled?: boolean;
  title?: string;
  small?: boolean;
}>();

const emit = defineEmits<{
  (e: 'click'): void;
}>();

function onClick(e: MouseEvent) {
    emit('click');
    (e.target as HTMLButtonElement).blur();
}
</script>

<style scoped>
.settings-btn {
  padding: 4px 8px;
  background: #2c1e0e;
  color: #c8a96e;
  border: 1px solid #4a3218;
  border-radius: 3px;
  cursor: pointer;
  font-size: 10px;
  font-family: monospace;
  font-weight: bold;
  text-transform: uppercase;
  transition: background 0.15s, border-color 0.15s;
}

.settings-btn:hover:not(:disabled) {
  background: #3a2810;
  border-color: #6a4a20;
}

.settings-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.settings-btn.active {
  background: #4a3218;
  border-color: #8a6a30;
  color: #e8c88e;
}

.settings-btn.small {
  padding: 2px 6px;
  font-size: 9px;
}
</style>
