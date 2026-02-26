<template>
    <div ref="scrollEl" class="virtual-grid-scroll" @scroll="onScroll">
        <div :style="{ height: `${totalHeight}px`, position: 'relative' }">
            <div
                v-for="vRow in virtualRows"
                :key="vRow.index"
                class="virtual-grid-row"
                :style="{
                    position: 'absolute',
                    top: `${vRow.start}px`,
                    left: 0,
                    right: 0,
                    height: `${vRow.size}px`,
                    display: 'grid',
                    gridTemplateColumns: `repeat(${columns}, 1fr)`,
                    gap: `${gap}px`,
                    padding: `0 ${padding}px`,
                }"
            >
                <template v-for="col in columnsForRow(vRow.index)" :key="col.itemIndex">
                    <slot :item="col.item" :index="col.itemIndex" />
                </template>
                <!-- Fill empty cells in last row to maintain grid alignment -->
                <div v-for="_ in emptyCellsForRow(vRow.index)" :key="'empty-' + _" class="virtual-grid-empty" />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts" generic="T">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useVirtualizer } from '@tanstack/vue-virtual';

const props = withDefaults(
    defineProps<{
        items: T[];
        minColumnWidth?: number;
        rowHeight?: number;
        gap?: number;
        padding?: number;
    }>(),
    {
        minColumnWidth: 220,
        rowHeight: 280,
        gap: 10,
        padding: 12,
    }
);

const emit = defineEmits<{
    (e: 'visible', startIndex: number, endIndex: number): void;
}>();

const scrollEl = ref<HTMLElement | null>(null);
const containerWidth = ref(800);

const columns = computed(() => {
    const available = containerWidth.value - props.padding * 2 + props.gap;
    return Math.max(1, Math.floor(available / (props.minColumnWidth + props.gap)));
});

const rowCount = computed(() => Math.ceil(props.items.length / columns.value));

const virtualizer = useVirtualizer(
    computed(() => ({
        count: rowCount.value,
        getScrollElement: () => scrollEl.value,
        estimateSize: () => props.rowHeight,
        overscan: 2,
    }))
);

const virtualRows = computed(() => virtualizer.value.getVirtualItems());
const totalHeight = computed(() => virtualizer.value.getTotalSize());

function columnsForRow(rowIndex: number): { itemIndex: number; item: T }[] {
    const start = rowIndex * columns.value;
    const end = Math.min(start + columns.value, props.items.length);
    const result: { itemIndex: number; item: T }[] = [];
    for (let i = start; i < end; i++) {
        result.push({ itemIndex: i, item: props.items[i]! });
    }
    return result;
}

function emptyCellsForRow(rowIndex: number): number[] {
    const start = rowIndex * columns.value;
    const end = Math.min(start + columns.value, props.items.length);
    const filledCols = end - start;
    const empty = columns.value - filledCols;
    return empty > 0 ? Array.from({ length: empty }, (_, i) => i) : [];
}

function emitVisible() {
    const rows = virtualRows.value;
    if (rows.length === 0) return;
    const startRow = rows[0]!.index;
    const endRow = rows[rows.length - 1]!.index;
    const startIndex = startRow * columns.value;
    const endIndex = Math.min((endRow + 1) * columns.value, props.items.length);
    emit('visible', startIndex, endIndex);
}

function onScroll() {
    emitVisible();
}

// Observe container resizes
let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
    if (scrollEl.value) {
        containerWidth.value = scrollEl.value.clientWidth;
        resizeObserver = new ResizeObserver(entries => {
            for (const entry of entries) {
                containerWidth.value = entry.contentRect.width;
            }
        });
        resizeObserver.observe(scrollEl.value);
    }
});

onUnmounted(() => {
    resizeObserver?.disconnect();
});

// Emit visible range whenever the virtualizer's visible rows change.
// flush: 'post' ensures the DOM (slot canvases) is updated before parents render into them.
watch(virtualRows, () => emitVisible(), { flush: 'post' });

defineExpose({
    scrollToIndex(itemIndex: number) {
        const rowIndex = Math.floor(itemIndex / columns.value);
        virtualizer.value.scrollToIndex(rowIndex, { align: 'start' });
    },
});
</script>

<style scoped>
.virtual-grid-scroll {
    overflow-y: auto;
    flex: 1;
}

.virtual-grid-empty {
    visibility: hidden;
}
</style>
