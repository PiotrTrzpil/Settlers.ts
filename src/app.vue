<template>
  <div id="nav">
    <router-link to="/">Start</router-link> |
    <router-link to="/map-view">Map View</router-link> |
    <router-link to="/map-file-view">Map File View</router-link> |
    <router-link to="/lib-view">Lib View</router-link> |
    <router-link to="/gh-view">Gh View</router-link> |
    <router-link to="/gfx-view">Gfx View</router-link> |
    <router-link to="/jil-view">Jil View</router-link> |
    <router-link to="/logging-view">Logging</router-link>
  </div>

  <router-view :fileManager="fileManager" />

</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { FileManager } from './utilities/file-manager';
import { FileListProvider } from './utilities/file-list-provider';
import { LibFileProvider } from './utilities/lib-file-provider';
import { LogHandler } from './utilities/log-handler';

const log = new LogHandler('App');
const fileManager = ref<FileManager | null>(null);

onMounted(async () => {
    log.debug('Starting...');

    try {
        const fm = new FileManager();

        await fm.addSource(new FileListProvider());
        await fm.registerProxy(new LibFileProvider());

        fileManager.value = fm;

        log.debug('Read FileManager sources done!');
    } catch (e) {
        log.error('Failed to initialize file manager', e instanceof Error ? e : new Error(String(e)));
    }
});
</script>

<style>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
}

#nav {
  padding: 30px;
}

#nav a {
  font-weight: bold;
  color: #2c3e50;
}

#nav a.router-link-exact-active {
  color: #42b983;
}

</style>
