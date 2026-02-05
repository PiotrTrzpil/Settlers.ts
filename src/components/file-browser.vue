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

/**
 * Natural sort comparator that handles numbers within strings.
 * e.g., "2.jil" < "10.jil" instead of "10.jil" < "2.jil"
 */
function naturalSort(a: IFileSource, b: IFileSource): number {
    return a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' });
}

function doFilter() {
    if (!props.fileManager) {
        return;
    }

    files.value = props.fileManager.filter(props.filter).sort(naturalSort);

    // Auto-select first file if available and nothing selected
    if (files.value.length > 0 && !selectedFile.value) {
        selectedFile.value = files.value[0];
        emit('select', selectedFile.value);
    }
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
