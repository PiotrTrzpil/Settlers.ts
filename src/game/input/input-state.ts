import { ref, computed, type Ref, type ComputedRef } from 'vue';
import { useMouse, useMousePressed, type UseMouseOptions } from '@vueuse/core';
import { MouseButton, type DragData } from './input-actions';
import type { InputConfig } from './input-config';

/**
 * Reactive input state tracking using VueUse.
 * Provides a clean API for querying current input state.
 */
export interface InputState {
    /** Current mouse X position on screen */
    readonly mouseX: Ref<number>;
    /** Current mouse Y position on screen */
    readonly mouseY: Ref<number>;
    /** Whether left mouse button is pressed */
    readonly leftPressed: Ref<boolean>;
    /** Whether right mouse button is pressed */
    readonly rightPressed: Ref<boolean>;
    /** Whether middle mouse button is pressed */
    readonly middlePressed: Ref<boolean>;
    /** Set of currently pressed key codes */
    readonly pressedKeys: Ref<Set<string>>;
    /** Current drag state (null if not dragging) */
    readonly drag: Ref<DragData | null>;
    /** Whether shift key is held */
    readonly shiftHeld: ComputedRef<boolean>;
    /** Whether ctrl/cmd key is held */
    readonly ctrlHeld: ComputedRef<boolean>;
    /** Whether alt key is held */
    readonly altHeld: ComputedRef<boolean>;

    /** Check if a specific key is currently pressed */
    isKeyPressed(code: string): boolean;
    /** Check if a specific mouse button is pressed */
    isMousePressed(button: MouseButton): boolean;
    /** Start tracking a drag operation */
    startDrag(x: number, y: number, button: MouseButton, tileX?: number, tileY?: number): void;
    /** Update drag position */
    updateDrag(x: number, y: number, tileX?: number, tileY?: number): void;
    /** End drag operation */
    endDrag(): DragData | null;
    /** Cancel drag without completing */
    cancelDrag(): void;
    /** Get current drag state (readonly snapshot) */
    getDragState(): DragData | null;
}

/**
 * Create input state tracker.
 */
export function createInputState(
    target: Ref<HTMLElement | null>,
    config: InputConfig
): InputState {
    // Mouse position tracking via VueUse
    const mouseOptions: UseMouseOptions = {
        target,
        type: 'client',
        touch: false,
    };

    const { x: mouseX, y: mouseY } = useMouse(mouseOptions);

    // Mouse button state
    const leftPressed = ref(false);
    const rightPressed = ref(false);
    const middlePressed = ref(false);

    // Keyboard state
    const pressedKeys = ref(new Set<string>());

    // Modifier keys (computed from pressedKeys)
    const shiftHeld = computed(() =>
        pressedKeys.value.has('ShiftLeft') || pressedKeys.value.has('ShiftRight')
    );
    const ctrlHeld = computed(() =>
        pressedKeys.value.has('ControlLeft') || pressedKeys.value.has('ControlRight') ||
        pressedKeys.value.has('MetaLeft') || pressedKeys.value.has('MetaRight')
    );
    const altHeld = computed(() =>
        pressedKeys.value.has('AltLeft') || pressedKeys.value.has('AltRight')
    );

    // Drag state
    const drag = ref<DragData | null>(null);

    function isKeyPressed(code: string): boolean {
        return pressedKeys.value.has(code);
    }

    function isMousePressed(button: MouseButton): boolean {
        switch (button) {
            case MouseButton.Left: return leftPressed.value;
            case MouseButton.Right: return rightPressed.value;
            case MouseButton.Middle: return middlePressed.value;
            default: return false;
        }
    }

    function startDrag(
        x: number,
        y: number,
        button: MouseButton,
        tileX?: number,
        tileY?: number
    ): void {
        drag.value = {
            startX: x,
            startY: y,
            currentX: x,
            currentY: y,
            startTileX: tileX,
            startTileY: tileY,
            currentTileX: tileX,
            currentTileY: tileY,
            button,
            isDragging: false,
        };
    }

    function updateDrag(x: number, y: number, tileX?: number, tileY?: number): void {
        if (!drag.value) return;

        drag.value.currentX = x;
        drag.value.currentY = y;
        drag.value.currentTileX = tileX;
        drag.value.currentTileY = tileY;

        // Check if we've exceeded the drag threshold
        const dx = Math.abs(x - drag.value.startX);
        const dy = Math.abs(y - drag.value.startY);
        if (dx > config.dragThreshold || dy > config.dragThreshold) {
            drag.value.isDragging = true;
        }
    }

    function endDrag(): DragData | null {
        const result = drag.value;
        drag.value = null;
        return result;
    }

    function cancelDrag(): void {
        drag.value = null;
    }

    function getDragState(): DragData | null {
        return drag.value;
    }

    return {
        mouseX,
        mouseY,
        leftPressed,
        rightPressed,
        middlePressed,
        pressedKeys,
        drag,
        shiftHeld,
        ctrlHeld,
        altHeld,
        isKeyPressed,
        isMousePressed,
        startDrag,
        updateDrag,
        endDrag,
        cancelDrag,
        getDragState,
    };
}

/**
 * Update keyboard state from a key event.
 */
export function handleKeyDown(state: InputState, code: string): void {
    state.pressedKeys.value.add(code);
}

/**
 * Update keyboard state from a key up event.
 */
export function handleKeyUp(state: InputState, code: string): void {
    state.pressedKeys.value.delete(code);
}

/**
 * Update mouse button state from a pointer event.
 */
export function handlePointerDown(state: InputState, button: number): void {
    switch (button) {
        case MouseButton.Left:
            state.leftPressed.value = true;
            break;
        case MouseButton.Right:
            state.rightPressed.value = true;
            break;
        case MouseButton.Middle:
            state.middlePressed.value = true;
            break;
    }
}

/**
 * Update mouse button state from a pointer up event.
 */
export function handlePointerUp(state: InputState, button: number): void {
    switch (button) {
        case MouseButton.Left:
            state.leftPressed.value = false;
            break;
        case MouseButton.Right:
            state.rightPressed.value = false;
            break;
        case MouseButton.Middle:
            state.middlePressed.value = false;
            break;
    }
}

/**
 * Clear all keyboard state (useful when window loses focus).
 */
export function clearKeyboardState(state: InputState): void {
    state.pressedKeys.value.clear();
}

/**
 * Clear all mouse button state.
 */
export function clearMouseState(state: InputState): void {
    state.leftPressed.value = false;
    state.rightPressed.value = false;
    state.middlePressed.value = false;
    state.cancelDrag();
}
