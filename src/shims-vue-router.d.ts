/* eslint-disable */
// vue-router v4.6.4 ships types as .d.mts which moduleResolution:"node" can't resolve.
// Re-export the types we use from the .mts declaration.
declare module 'vue-router' {
    export { createRouter, createWebHistory, RouteRecordRaw, RouterHistory } from 'vue-router/dist/vue-router.d.mts';
}
