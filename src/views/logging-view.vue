<template>

  <table class="loging">
    <tr>
      <th>Source:</th>
      <th>Message:</th>
    </tr>
    <tr
      v-for="msg of logs"
      :key="msg.index"
      :class="'logType' + msg.type"
    >
      <td>{{msg.source}}</td>
      <td>{{msg.msg}}</td>
    </tr>
  </table>

</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { LogHandler } from '@/utilities/log-handler';
import { ILogMessage } from '@/utilities/log-manager';

const logs = ref<ILogMessage[]>([]);

onMounted(() => {
    LogHandler.getLogManager().onLogMessage((msg) => {
        if (logs.value.length > 40) {
            logs.value.shift();
        }

        logs.value.push(msg);
    });
});

onBeforeUnmount(() => {
    LogHandler.getLogManager().onLogMessage(null);
});
</script>

<style scoped>
.loging {
  border-top: 1px solid black;
  border-bottom: 1px solid black;
  padding-top: 20px;
  text-align: left;
  overflow: scroll;
  display: block;
}

.logType0 {
  color: red;
}

.logType1 {
  color: gray;
}

</style>
