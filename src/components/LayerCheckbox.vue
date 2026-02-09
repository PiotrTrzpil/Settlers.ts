<template>
  <label class="layer-row" :class="{ 'master-toggle': master, 'sub-layer': sub }">
    <input
      type="checkbox"
      tabindex="-1"
      :checked="modelValue"
      :disabled="disabled"
      :indeterminate="indeterminate"
      @change="onChange"
    />
    <span class="layer-emoji">{{ emoji }}</span>
    <span>{{ label }}</span>
    <span class="layer-count" v-if="count !== undefined">{{ count }}</span>
  </label>
</template>

<script setup lang="ts">
defineProps<{
  label: string;
  emoji: string;
  modelValue: boolean;
  count?: number;
  disabled?: boolean;
  indeterminate?: boolean;
  master?: boolean;
  sub?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
}>();

function onChange(e: Event) {
    const target = e.target as HTMLInputElement;
    emit('update:modelValue', target.checked);
    target.blur();
}
</script>

<style scoped>
.layer-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  cursor: pointer;
  color: #a08050;
  transition: color 0.15s;
}

.layer-row:hover {
  color: #c8a96e;
}

.layer-emoji {
  font-size: 12px;
  width: 16px;
  text-align: center;
  flex-shrink: 0;
}

.layer-count {
  margin-left: auto;
  padding: 1px 5px;
  background: #1a1a2a;
  border: 1px solid #2a2a4a;
  border-radius: 2px;
  color: #8080c0;
  font-size: 9px;
  min-width: 20px;
  text-align: center;
}

.layer-row input[type="checkbox"] {
  accent-color: #d4a030;
  cursor: pointer;
}

.layer-row input[type="checkbox"]:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.master-toggle {
  font-weight: bold;
  color: #b09060;
  border-bottom: 1px solid #2a1e0e;
  padding-bottom: 5px;
  margin-bottom: 2px;
}

.sub-layer {
  font-size: 10px;
}
</style>
