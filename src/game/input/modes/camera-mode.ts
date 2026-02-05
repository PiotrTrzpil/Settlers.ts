import { BaseInputMode, HANDLED, UNHANDLED, type InputContext, type InputResult } from '../input-mode';
import { InputAction, MouseButton, type PointerData, type DragData } from '../input-actions';
import type { InputConfig } from '../input-config';
import { CursorType, type ModeRenderState } from '../render-state';

/**
 * Camera control data.
 */
export interface CameraState {
    /** Camera X position */
    x: number;
    /** Camera Y position */
    y: number;
    /** Camera zoom level */
    zoom: number;
    /** Target zoom (for smooth zooming) */
    targetZoom: number;
    /** Temporary offset during drag */
    dragOffsetX: number;
    dragOffsetY: number;
}

/**
 * Camera mode - handles camera panning and zooming.
 * This is a "background" mode that runs alongside other modes.
 */
export class CameraMode extends BaseInputMode {
    readonly name = 'camera';
    readonly displayName = 'Camera';

    private config: InputConfig;
    private cameraState: CameraState;
    private isDraggingCamera = false;
    private dragStartX = 0;
    private dragStartY = 0;

    constructor(config: InputConfig, initialState?: Partial<CameraState>) {
        super();
        this.config = config;
        this.cameraState = {
            x: initialState?.x ?? 0,
            y: initialState?.y ?? 0,
            zoom: initialState?.zoom ?? 1,
            targetZoom: initialState?.targetZoom ?? 1,
            dragOffsetX: 0,
            dragOffsetY: 0,
        };
    }

    /**
     * Get current camera state.
     */
    getState(): Readonly<CameraState> {
        return this.cameraState;
    }

    /**
     * Get effective camera X (including drag offset).
     */
    get x(): number {
        return this.cameraState.x + this.cameraState.dragOffsetX;
    }

    /**
     * Get effective camera Y (including drag offset).
     */
    get y(): number {
        return this.cameraState.y + this.cameraState.dragOffsetY;
    }

    /**
     * Get current zoom level.
     */
    get zoom(): number {
        return this.cameraState.zoom;
    }

    /**
     * Set camera position directly.
     */
    setPosition(x: number, y: number): void {
        this.cameraState.x = x;
        this.cameraState.y = y;
        this.cameraState.dragOffsetX = 0;
        this.cameraState.dragOffsetY = 0;
    }

    /**
     * Set zoom level directly.
     */
    setZoom(zoom: number): void {
        this.cameraState.zoom = Math.max(this.config.minZoom, Math.min(this.config.maxZoom, zoom));
        this.cameraState.targetZoom = this.cameraState.zoom;
    }

    onAction(action: InputAction, context: InputContext): InputResult {
        // Camera actions are handled in onUpdate for smooth movement
        return UNHANDLED;
    }

    onPointerDown(data: PointerData, context: InputContext): InputResult {
        // Middle mouse button starts camera drag
        if (data.button === MouseButton.Middle) {
            this.isDraggingCamera = true;
            this.dragStartX = data.screenX;
            this.dragStartY = data.screenY;
            return HANDLED;
        }
        return UNHANDLED;
    }

    onPointerUp(data: PointerData, context: InputContext): InputResult {
        if (data.button === MouseButton.Middle && this.isDraggingCamera) {
            // Finalize camera position
            this.cameraState.x += this.cameraState.dragOffsetX;
            this.cameraState.y += this.cameraState.dragOffsetY;
            this.cameraState.dragOffsetX = 0;
            this.cameraState.dragOffsetY = 0;
            this.isDraggingCamera = false;
            return HANDLED;
        }
        return UNHANDLED;
    }

    onPointerMove(data: PointerData, context: InputContext): InputResult {
        if (this.isDraggingCamera) {
            // Calculate drag offset
            const dx = data.screenX - this.dragStartX;
            const dy = data.screenY - this.dragStartY;

            // Convert screen movement to world movement
            // The factor 0.01 and the y*2 come from the isometric projection
            const scale = 0.01 / this.cameraState.zoom;
            const invertFactor = this.config.invertPan ? -1 : 1;

            this.cameraState.dragOffsetX = -dx * scale * invertFactor;
            this.cameraState.dragOffsetY = -dy * scale * 2 * invertFactor;

            return HANDLED;
        }
        return UNHANDLED;
    }

    onWheel(data: PointerData, context: InputContext): InputResult {
        if (data.wheelDelta === undefined) return UNHANDLED;

        const delta = this.config.invertZoom ? -data.wheelDelta : data.wheelDelta;
        const zoomFactor = delta > 0 ? (1 + this.config.cameraZoomSpeed) : (1 - this.config.cameraZoomSpeed);

        // Calculate new zoom
        const newZoom = Math.max(
            this.config.minZoom,
            Math.min(this.config.maxZoom, this.cameraState.zoom * zoomFactor)
        );

        // Zoom towards cursor position
        // This keeps the point under the cursor stationary
        if (newZoom !== this.cameraState.zoom) {
            // Get cursor position in world coordinates before zoom
            // (This would need the canvas dimensions and aspect ratio)
            // For now, just set the zoom without cursor-lock
            this.cameraState.zoom = newZoom;
            this.cameraState.targetZoom = newZoom;
        }

        return HANDLED;
    }

    onUpdate(deltaTime: number, context: InputContext): void {
        const speed = this.config.cameraPanSpeed * deltaTime;

        // Handle WASD/Arrow keys for camera pan
        if (context.state.isKeyPressed('KeyW') || context.state.isKeyPressed('ArrowUp')) {
            const factor = this.config.invertPan ? 1 : -1;
            this.cameraState.x += speed * factor;
            this.cameraState.y += speed * 2 * factor;
        }
        if (context.state.isKeyPressed('KeyS') || context.state.isKeyPressed('ArrowDown')) {
            const factor = this.config.invertPan ? -1 : 1;
            this.cameraState.x += speed * factor;
            this.cameraState.y += speed * 2 * factor;
        }
        if (context.state.isKeyPressed('KeyA') || context.state.isKeyPressed('ArrowLeft')) {
            const factor = this.config.invertPan ? 1 : -1;
            this.cameraState.x += speed * factor;
        }
        if (context.state.isKeyPressed('KeyD') || context.state.isKeyPressed('ArrowRight')) {
            const factor = this.config.invertPan ? -1 : 1;
            this.cameraState.x += speed * factor;
        }

        // Smooth zoom interpolation (optional)
        // if (this.cameraState.zoom !== this.cameraState.targetZoom) {
        //     const t = Math.min(1, deltaTime * 10);
        //     this.cameraState.zoom += (this.cameraState.targetZoom - this.cameraState.zoom) * t;
        // }
    }

    override getRenderState(_context: InputContext): ModeRenderState {
        // Camera mode changes cursor during drag
        return {
            cursor: this.isDraggingCamera ? CursorType.Grabbing : CursorType.Default,
        };
    }
}
