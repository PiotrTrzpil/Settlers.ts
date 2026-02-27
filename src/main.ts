import { createApp } from 'vue';
import Toast from 'vue-toastification';
import type { ToastOptionsAndRequiredContent } from 'vue-toastification/dist/types/types';
import 'vue-toastification/dist/index.css';
import App from './app.vue';
import router from './router';
import { LogHandler } from './utilities/log-handler';

declare const __SOURCE_HASH__: string;

/** Expose source hash for stale server detection by e2e tests */
if (typeof __SOURCE_HASH__ !== 'undefined') {
    window.__source_hash__ = __SOURCE_HASH__;
}

const log = new LogHandler('Global');

// Force full page reload when HMR fails (prevents stale code issues)
if (import.meta.hot) {
    import.meta.hot.on('vite:error', (payload: unknown) => {
        log.warn(`HMR error detected (auto-reload disabled): ${payload}`);
    });

    // Force reload for renderer files - instances don't auto-update on HMR
    import.meta.hot.on('vite:beforeUpdate', payload => {
        const rendererPaths = [
            '/src/game/renderer/entity-renderer.ts',
            '/src/game/renderer/landscape/landscape-renderer.ts',
            '/src/game/renderer/sprite-batch-renderer.ts',
            '/src/game/renderer/renderer.ts',
        ];
        const needsReload = payload.updates.some((update: { path: string }) =>
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
    // eslint-disable-next-line sonarjs/function-return-type -- API requires false|toast union
    filterBeforeCreate(
        toast: ToastOptionsAndRequiredContent,
        toasts: ToastOptionsAndRequiredContent[]
    ): ToastOptionsAndRequiredContent | false {
        // Deduplicate: suppress if identical toast already visible
        if (toasts.filter(t => t.content === toast.content).length > 0) {
            return false;
        }
        return toast;
    },
});
app.use(router).mount('#app');
