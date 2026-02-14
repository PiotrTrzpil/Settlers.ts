import { createApp } from 'vue';
import Toast from 'vue-toastification';
import 'vue-toastification/dist/index.css';
import App from './app.vue';
import router from './router';
import { LogHandler } from './utilities/log-handler';

const log = new LogHandler('Global');

// Force full page reload when HMR fails (prevents stale code issues)
if (import.meta.hot) {
    import.meta.hot.on('vite:error', () => {
        log.debug('HMR error detected, reloading page...');
        window.location.reload();
    });

    // Force reload for renderer files - instances don't auto-update on HMR
    import.meta.hot.on('vite:beforeUpdate', (payload) => {
        const rendererPaths = [
            '/src/game/renderer/entity-renderer.ts',
            '/src/game/renderer/landscape/landscape-renderer.ts',
            '/src/game/renderer/sprite-batch-renderer.ts',
            '/src/game/renderer/renderer.ts',
        ];
        const needsReload = payload.updates?.some((update: { path: string }) =>
            rendererPaths.some(p => update.path.endsWith(p))
        );
        if (needsReload) {
            log.debug('Renderer file changed, forcing full reload...');
            window.location.reload();
        }
    });
}

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
app.use(Toast, {
    position: 'bottom-right' as const,
    timeout: 8000,
    maxToasts: 5,
    newestOnTop: true,
    pauseOnHover: true,
    pauseOnFocusLoss: false,
    hideProgressBar: false,
    closeOnClick: true,
    draggable: false,
    filterBeforeCreate(toast: any, toasts: any[]) {
        // Deduplicate: suppress if identical toast already visible
        if (toasts.filter(t => t.content === toast.content).length > 0) {
            return false;
        }
        return toast;
    },
});
app.use(router).mount('#app');
