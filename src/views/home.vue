<template>
  <div class="home">
    <h1>Wellcome to Settlers.ts</h1>

    <div v-if="isValidSettlers">
      <button class="play-btn" @click="$router.push('/map-view')">Play</button>
    </div>
    <div v-else>
      ❌ Please select your Settlers 4 directory!

      <br /><br />

      To start you need to provide the directory of your Settlers 4 copy.<br />
      Please use the file selector to select it:<br />
      (Files are only accessed by your browser and are not uploaded)<br />
      <br />

      Open via directory access:<br />
      <input type="file" directory webkitdirectory multiple @change="selectFiles" />
      <br />
      or<br />

      Open via multi file select:<br />
      <input type="file" multiple name="files[]" @change="selectFiles" />
    </div>

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

    // Classic editions have game.lib; History Edition has unpacked files
    isValidSettlers.value =
        props.fileManager.findFile('game.lib', false) != null ||
        props.fileManager.findFile('2.gh6', false) != null;
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

<style scoped>
.play-btn {
  font-size: 1.5em;
  padding: 12px 48px;
  margin: 20px 0;
  cursor: pointer;
  background: #4CAF50;
  color: white;
  border: none;
  border-radius: 6px;
}

.play-btn:hover {
  background: #388E3C;
}
</style>
