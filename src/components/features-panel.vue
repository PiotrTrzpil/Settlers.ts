<template>
    <OverlayPanel v-model:open="open" label="Features" title="Feature Toggles" min-width="240px">
        <section class="feature-list">
            <template v-for="group in groups" :key="group.name">
                <div class="group-header">{{ group.name }}</div>
                <label
                    v-for="sys in group.items"
                    :key="sys.name"
                    class="feature-row"
                    :class="{ dirty: isDirty(sys), disabled: !sys.enabled && hasMissingDeps(sys) }"
                >
                    <input type="checkbox" v-model="sys.enabled" @change="onToggle(sys)" />
                    <span class="feature-name">{{ sys.name }}</span>
                    <span v-if="hasMissingDeps(sys) && !sys.enabled" class="dep-hint">
                        needs {{ missingDeps(sys).join(', ') }}
                    </span>
                </label>
            </template>
            <div v-if="draft.length === 0" class="empty-msg">No systems registered</div>
        </section>

        <section class="actions">
            <button class="action-btn" @click="setAll(true)">Enable All</button>
            <button class="action-btn action-btn--danger" @click="setAll(false)">Disable All</button>
        </section>

        <section v-if="dirty" class="actions commit-actions">
            <button class="action-btn action-btn--save" @click="apply">Apply</button>
            <button class="action-btn" @click="cancel">Cancel</button>
        </section>
    </OverlayPanel>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { Game } from '@/game/game';
import OverlayPanel from './OverlayPanel.vue';

const props = defineProps<{
    game: Game;
}>();

const open = ref(true);

interface SystemState {
    name: string;
    group: string;
    enabled: boolean;
    requires: string[];
}

/** Snapshot of last-applied state */
const committed = ref<SystemState[]>([]);
/** Working copy the user edits */
const draft = ref<SystemState[]>([]);

const dirty = computed(() => draft.value.some((d, i) => d.enabled !== committed.value[i]?.enabled));

/** Group order — listed groups appear in this order, unlisted ones go to the end */
const GROUP_ORDER = ['Units', 'Buildings', 'Logistics', 'World', 'Scripting', 'Other'];

const groups = computed(() => {
    const map = new Map<string, SystemState[]>();
    for (const sys of draft.value) {
        let items = map.get(sys.group);
        if (!items) {
            items = [];
            map.set(sys.group, items);
        }
        items.push(sys);
    }
    return [...map.entries()]
        .sort(([a], [b]) => {
            const ai = GROUP_ORDER.indexOf(a);
            const bi = GROUP_ORDER.indexOf(b);
            return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        })
        .map(([name, items]) => ({ name, items }));
});

function isDirty(sys: SystemState): boolean {
    const orig = committed.value.find(c => c.name === sys.name);
    return orig !== undefined && orig.enabled !== sys.enabled;
}

/** Get the draft entry by name */
function getDraft(name: string): SystemState | undefined {
    return draft.value.find(s => s.name === name);
}

/** Names of required features that are currently disabled in the draft */
function missingDeps(sys: SystemState): string[] {
    return sys.requires.filter(name => !getDraft(name)?.enabled);
}

function hasMissingDeps(sys: SystemState): boolean {
    return sys.requires.some(name => !getDraft(name)?.enabled);
}

/** Find all features that directly or transitively require the given name */
function getDependents(name: string): SystemState[] {
    return draft.value.filter(s => s.requires.includes(name));
}

/**
 * When enabling a feature, auto-enable its dependencies (recursively).
 * When disabling a feature, auto-disable features that depend on it.
 */
function onToggle(sys: SystemState): void {
    if (sys.enabled) {
        enableWithDeps(sys);
    } else {
        disableWithDependents(sys);
    }
}

function enableWithDeps(sys: SystemState): void {
    for (const depName of sys.requires) {
        const dep = getDraft(depName);
        if (dep && !dep.enabled) {
            dep.enabled = true;
            enableWithDeps(dep);
        }
    }
}

function disableWithDependents(sys: SystemState): void {
    for (const dependent of getDependents(sys.name)) {
        if (dependent.enabled) {
            dependent.enabled = false;
            disableWithDependents(dependent);
        }
    }
}

const STORAGE_KEY = 'settlers-feature-toggles';

function saveToStorage(): void {
    const map: Record<string, boolean> = {};
    for (const sys of committed.value) {
        map[sys.name] = sys.enabled;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

function loadFromGame(): void {
    const states = props.game.getSystemStates();

    // Restore saved toggles from localStorage
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
        const saved = JSON.parse(raw) as Record<string, boolean>;
        for (const sys of states) {
            if (sys.name in saved) {
                sys.enabled = saved[sys.name]!;
                props.game.setSystemEnabled(sys.name, sys.enabled);
            }
        }
    }

    committed.value = states.map(s => ({ ...s }));
    draft.value = states.map(s => ({ ...s }));
}

function setAll(enabled: boolean): void {
    for (const sys of draft.value) {
        sys.enabled = enabled;
    }
}

function apply(): void {
    for (const sys of draft.value) {
        props.game.setSystemEnabled(sys.name, sys.enabled);
    }
    committed.value = draft.value.map(s => ({ ...s }));
    saveToStorage();
}

function cancel(): void {
    draft.value = committed.value.map(s => ({ ...s }));
}

onMounted(loadFromGame);
</script>

<style scoped>
.feature-list {
    padding: 4px 10px;
}

.group-header {
    font-size: 9px;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    padding: 6px 0 2px;
    border-bottom: 1px solid var(--border-faint);
    margin-bottom: 2px;
}

.group-header:first-child {
    padding-top: 2px;
}

.feature-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 0 3px 4px;
    cursor: pointer;
    color: var(--text-secondary);
}

.feature-row:hover {
    color: var(--text);
}

.feature-row.dirty .feature-name {
    color: var(--text-accent, #d4a030);
}

.feature-row.disabled {
    opacity: 0.5;
}

.feature-row input[type='checkbox'] {
    accent-color: var(--text-accent);
    cursor: pointer;
}

.feature-name {
    font-size: 11px;
}

.dep-hint {
    font-size: 9px;
    color: var(--text-muted);
    font-style: italic;
    margin-left: auto;
}

.empty-msg {
    color: var(--text-muted);
    padding: 8px 0;
    font-style: italic;
}

.actions {
    display: flex;
    gap: 6px;
    padding: 6px 10px;
    border-top: 1px solid var(--border-faint);
}

.commit-actions {
    border-top: 1px solid var(--border-soft);
}

.action-btn {
    flex: 1;
    padding: 4px 8px;
    background: var(--bg-mid);
    color: var(--text-secondary);
    border: 1px solid var(--border-soft);
    border-radius: 3px;
    cursor: pointer;
    font-size: 10px;
    font-family: monospace;
    font-weight: bold;
    text-transform: uppercase;
}

.action-btn:hover {
    background: var(--bg-raised);
    color: var(--text-bright);
}

.action-btn--save {
    background: #1a3a1a;
    color: #80d080;
    border-color: #2a5a2a;
}

.action-btn--save:hover {
    background: #204a20;
    border-color: #3a7a3a;
}

.action-btn--danger {
    background: #3a1a1a;
    color: #d08080;
    border-color: #5a2a2a;
}

.action-btn--danger:hover {
    background: #4a2020;
    border-color: #7a3a3a;
}
</style>
