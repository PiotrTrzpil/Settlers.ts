import { BaseInputMode, HANDLED, UNHANDLED, type InputContext, type InputResult } from '../input-mode';
import { InputAction, MouseButton, type PointerData } from '../input-actions';
import type { InputConfig } from '../input-config';
import { CursorType, type ModeRenderState } from '../render-state';
import type { IViewPoint } from '@/game/renderer/i-view-point';
import { gameSettings } from '@/game/game-settings';

/**
 * Camera mode - handles camera panning and zooming.
 * This is a "background" mode that runs alongside other modes.
 *
 * Works directly with ViewPoint to avoid duplicate state.
 */
export class CameraMode extends BaseInputMode {
    readonly name = 'camera';
    readonly displayName = 'Camera';

    private config: InputConfig;
    private viewPoint: IViewPoint | null = null;

    // Drag state - we store the context, position is computed at render time
    private isDraggingCamera = false;
    private dragButton: MouseButton | null = null;
    /** Screen position where drag started */
    private dragStartScreenX = 0;
    private dragStartScreenY = 0;
    /** Camera position where drag started */
    private dragStartCameraX = 0;
    private dragStartCameraY = 0;
    /** Current mouse screen position (updated by pointer events) */
    private currentScreenX = 0;
    private currentScreenY = 0;
    /** Track if actual camera movement occurred during drag */
    private didMoveCamera = false;

    constructor(config: InputConfig) {
        super();
        this.config = config;
    }

    /**
     * Set the ViewPoint to control.
     * Must be called before camera controls will work.
     */
    setViewPoint(viewPoint: IViewPoint): void {
        this.viewPoint = viewPoint;
    }

    /**
     * Get current camera X position.
     */
    get x(): number {
        return this.viewPoint?.x ?? 0;
    }

    /**
     * Get current camera Y position.
     */
    get y(): number {
        return this.viewPoint?.y ?? 0;
    }

    /**
     * Get current zoom level.
     */
    get zoom(): number {
        return this.viewPoint?.zoomValue ?? 1;
    }

    /**
     * Set camera position directly.
     */
    setPosition(x: number, y: number): void {
        this.viewPoint?.setRawPosition(x, y);
    }

    /**
     * Set zoom level directly.
     */
    setZoom(zoom: number): void {
        if (this.viewPoint) {
            this.viewPoint.zoomValue = Math.max(this.config.minZoom, Math.min(this.config.maxZoom, zoom));
        }
    }

    onAction(_action: InputAction, _context: InputContext): InputResult {
        return UNHANDLED;
    }

    onPointerDown(data: PointerData, _context: InputContext): InputResult {
        if (!this.viewPoint) return UNHANDLED;

        // Middle or right mouse button starts camera drag
        if (data.button === MouseButton.Middle || data.button === MouseButton.Right) {
            this.isDraggingCamera = true;
            this.dragButton = data.button;
            // Store the starting context - position will be computed at render time
            this.dragStartScreenX = data.screenX;
            this.dragStartScreenY = data.screenY;
            this.dragStartCameraX = this.viewPoint.x;
            this.dragStartCameraY = this.viewPoint.y;
            this.currentScreenX = data.screenX;
            this.currentScreenY = data.screenY;
            this.didMoveCamera = false;
            return HANDLED;
        }
        return UNHANDLED;
    }

    onPointerUp(data: PointerData, _context: InputContext): InputResult {
        if (this.isDraggingCamera && data.button === this.dragButton) {
            const wasMoving = this.didMoveCamera;
            this.isDraggingCamera = false;
            this.dragButton = null;
            this.didMoveCamera = false;
            // If no actual movement occurred, let other modes handle the click
            // (e.g., select mode uses right-click to move units)
            return wasMoving ? HANDLED : UNHANDLED;
        }
        return UNHANDLED;
    }

    onPointerMove(data: PointerData, _context: InputContext): InputResult {
        if (!this.isDraggingCamera) return UNHANDLED;

        // Just store the current mouse position - camera position is computed in onUpdate
        this.currentScreenX = data.screenX;
        this.currentScreenY = data.screenY;

        // Check if we've exceeded threshold for "real" movement
        const dpx = data.screenX - this.dragStartScreenX;
        const dpy = data.screenY - this.dragStartScreenY;
        const moveThreshold = 3;
        if (Math.abs(dpx) >= moveThreshold || Math.abs(dpy) >= moveThreshold) {
            this.didMoveCamera = true;
        }

        return HANDLED;
    }

    onWheel(data: PointerData, _context: InputContext): InputResult {
        if (!this.viewPoint || data.wheelDelta === undefined) return UNHANDLED;

        const delta = this.config.invertZoom ? -data.wheelDelta : data.wheelDelta;
        const zoomSpeed = gameSettings.state.zoomSpeed;
        const zoomFactor = delta > 0 ? (1 + zoomSpeed) : (1 - zoomSpeed);

        // Calculate new zoom
        const newZoom = Math.max(
            this.config.minZoom,
            Math.min(this.config.maxZoom, this.viewPoint.zoomValue * zoomFactor)
        );

        if (newZoom !== this.viewPoint.zoomValue) {
            this.viewPoint.zoomValue = newZoom;
        }

        return HANDLED;
    }

    onUpdate(deltaTime: number, context: InputContext): void {
        if (!this.viewPoint) return;

        // MOUSE DRAG: Compute camera position from current mouse position (frame-synchronized)
        if (this.isDraggingCamera) {
            const dpx = this.currentScreenX - this.dragStartScreenX;
            const dpy = this.currentScreenY - this.dragStartScreenY;

            // Scale factor converts pixel movement to viewPoint units
            const height = this.viewPoint.canvasHeight;
            const scale = 20 * this.viewPoint.zoomValue / height;
            const invertFactor = this.config.invertPan ? -1 : 1;

            // For isometric projection: moving vertically in screen space
            // moves both viewPointX and viewPointY
            const deltaX = -scale * (dpx + dpy) * invertFactor;
            const deltaY = -scale * 2 * dpy * invertFactor;

            // Set position directly - computed fresh each frame from mouse position
            this.viewPoint.setRawPosition(
                this.dragStartCameraX + deltaX,
                this.dragStartCameraY + deltaY
            );
            return; // Don't process keyboard while dragging
        }

        // KEYBOARD PAN: Velocity-based, inherently smooth
        const speed = gameSettings.state.panSpeed * this.viewPoint.zoomValue * deltaTime;

        let dx = 0;
        let dy = 0;

        if (context.state.isKeyPressed('KeyW') || context.state.isKeyPressed('ArrowUp')) {
            dy -= speed * 2;
            dx -= speed;
        }
        if (context.state.isKeyPressed('KeyS') || context.state.isKeyPressed('ArrowDown')) {
            dy += speed * 2;
            dx += speed;
        }
        if (context.state.isKeyPressed('KeyA') || context.state.isKeyPressed('ArrowLeft')) {
            dx -= speed;
        }
        if (context.state.isKeyPressed('KeyD') || context.state.isKeyPressed('ArrowRight')) {
            dx += speed;
        }

        if (dx !== 0 || dy !== 0) {
            const factor = this.config.invertPan ? -1 : 1;
            this.viewPoint.moveTarget(dx * factor, dy * factor);
        }
    }

    override getRenderState(_context: InputContext): ModeRenderState {
        return {
            cursor: this.isDraggingCamera ? CursorType.Grabbing : CursorType.Default,
        };
    }
}
