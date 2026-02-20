<template>
    <div class="selector-group">
        <label>{{ label }}</label>
        <slot />
    </div>
</template>

<script setup lang="ts">
defineProps<{
    label: string;
}>();
</script>

<style src="@/styles/file-viewer.css"></style>
