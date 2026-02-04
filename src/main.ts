import { createApp } from 'vue';
import App from './app.vue';
import router from './router';
import { LogHandler } from './utilities/log-handler';

const log = new LogHandler('Global');

window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    log.error('Unhandled promise rejection: ' + event.reason);
    event.preventDefault();
});

window.addEventListener('error', (event: ErrorEvent) => {
    log.error(event.message, event.error instanceof Error ? event.error : undefined);
});

const app = createApp(App);
app.config.errorHandler = (err, _vm, info) => {
    log.error('Vue error (' + info + '): ' + err, err instanceof Error ? err : undefined);
};
app.use(router).mount('#app');
