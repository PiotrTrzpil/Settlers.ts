<template>
  <div class="setting-row">
    <span class="setting-label">{{ label }}</span>
    <span class="slider-value">
      <input
        type="range"
        :min="min"
        :max="max"
        :step="step"
        :value="modelValue"
        :disabled="disabled"
        tabindex="-1"
        @input="$emit('update:modelValue', parseFloat(($event.target as HTMLInputElement).value))"
        @change="($event.target as HTMLInputElement).blur()"
      />
      <span class="slider-value-display">{{ displayValue }}</span>
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  label: string;
  modelValue: number;
  min: number;
  max: number;
  step: number;
  decimals?: number;
  disabled?: boolean;
}>();

defineEmits<{
  (e: 'update:modelValue', value: number): void;
}>();

const displayValue = computed(() => {
    const decimals = props.decimals ?? (props.step < 1 ? String(props.step).split('.')[1]?.length ?? 1 : 0);
    return decimals > 0 ? props.modelValue.toFixed(decimals) : String(props.modelValue);
});
</script>

<style scoped>
.setting-row {
  display: flex;
  align-items: center;
  padding: 1px 0;
  gap: 8px;
}

.setting-label {
  color: #7a6a4a;
  width: 80px;
  flex-shrink: 0;
}

.slider-value {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
}

.slider-value input[type="range"] {
  flex: 1;
  height: 4px;
  accent-color: #d4a030;
  cursor: pointer;
}

.slider-value input[type="range"]:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.slider-value-display {
  color: #d4b27a;
  min-width: 28px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
