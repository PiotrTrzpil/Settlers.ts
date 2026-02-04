<template>
  <div class="home">
    <h1>Wellcome to Settlers.ts</h1>

    <div v-if="isValidSettlers">
      ✔️ Settlers 4 directory selected
    </div>
    <div v-else>
      ❌ Please select your Settlers 4 directory!
    </div>

    <br />

    To start you need to provide the directory of you Settlers 4 copy.<br />
    Please use the file selector to select it:<br />
    (Files are only accessed by your browser and are not uploaded)<br />
    <br />

    Open via. directory access:<br />
    <input type="file" directory webkitdirectory multiple @change="selectFiles" />
    <br />
    or<br />

    Open via. multi file select:<br />
    <input type="file" multiple name="files[]" @change="selectFiles" />

    <h3>You found a bug / you like to contribute?</h3>
    Find the source at <a href="https://github.com/tomsoftware/Settlers.ts">github</a>
  </div>

</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { FileManager } from '@/utilities/file-manager';
import { LocalFileProvider } from '@/utilities/local-file-provider';

const props = defineProps<{
    fileManager: FileManager;
}>();

const isValidSettlers = ref(false);

function checkIsValidSettlers() {
    if (!props.fileManager) {
        isValidSettlers.value = false;
        return;
    }

    isValidSettlers.value = props.fileManager.findFile('game.lib', false) != null;
}

async function selectFiles(e: Event) {
    if ((!e) || (!e.target)) {
        return;
    }

    const files = (e.target as HTMLInputElement).files;
    if ((!files)) {
        return;
    }

    await props.fileManager.addSource(new LocalFileProvider(files));

    checkIsValidSettlers();
}

watch(() => props.fileManager, () => {
    checkIsValidSettlers();
});

checkIsValidSettlers();
</script>
