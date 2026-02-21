declare module '*.vue' {
    import type { DefineComponent } from 'vue';
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- shim generics
    const component: DefineComponent<{}, {}, any>;
    export default component;
}
