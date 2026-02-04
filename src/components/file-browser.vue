<template>
  <select @change="selectFile" v-model="selectedFile">
    <option v-for="file of files" :key="file.path" :value="file">
      {{file.path}}
    </option>
  </select>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { FileManager, IFileSource } from '@/utilities/file-manager';

const props = defineProps<{
    filter: string;
    fileManager: FileManager;
}>();

const emit = defineEmits<{
    (e: 'select', selectedFile: IFileSource): void;
}>();

const selectedFile = ref<IFileSource | null>(null);
const files = ref<IFileSource[]>([]);

function doFilter() {
    if (!props.fileManager) {
        return;
    }

    files.value = props.fileManager.filter(props.filter);
}

function selectFile() {
    if (!selectedFile.value) {
        return;
    }

    emit('select', selectedFile.value);
}

watch(() => props.filter, () => doFilter());
watch(() => props.fileManager, () => doFilter());
doFilter();
</script>
