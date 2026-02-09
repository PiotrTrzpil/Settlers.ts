<template>
  <label class="control-row">
    <input
      type="checkbox"
      :checked="modelValue"
      tabindex="-1"
      @change="onChange"
    />
    <span>{{ label }}</span>
  </label>
</template>

<script setup lang="ts">
defineProps<{
  label: string;
  modelValue: boolean;
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
.control-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
  cursor: pointer;
  color: #a08050;
}

.control-row:hover {
  color: #c8a96e;
}

.control-row input[type="checkbox"] {
  accent-color: #d4a030;
  cursor: pointer;
}
</style>
