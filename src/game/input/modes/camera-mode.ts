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

    // Drag state
    private isDraggingCamera = false;
    private dragButton: MouseButton | null = null;
    private dragStartX = 0;
    private dragStartY = 0;
    private dragStartPosX = 0;
    private dragStartPosY = 0;
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
            this.dragStartX = data.screenX;
            this.dragStartY = data.screenY;
            this.dragStartPosX = this.viewPoint.x;
            this.dragStartPosY = this.viewPoint.y;
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
        if (!this.viewPoint || !this.isDraggingCamera) return UNHANDLED;

        // Calculate drag offset from start position
        const dpx = data.screenX - this.dragStartX;
        const dpy = data.screenY - this.dragStartY;

        // Only move if we've exceeded a small threshold to avoid accidental micro-movements
        const moveThreshold = 3;
        if (Math.abs(dpx) < moveThreshold && Math.abs(dpy) < moveThreshold) {
            return HANDLED;
        }

        // Mark that actual camera movement occurred
        this.didMoveCamera = true;

        // Scale factor converts pixel movement to viewPoint units
        // Derived from the isometric projection to keep tiles "sticky" under cursor
        // This matches ViewPoint's original formula
        const height = this.viewPoint.canvasHeight;
        const scale = 20 * this.viewPoint.zoomValue / height;
        const invertFactor = this.config.invertPan ? -1 : 1;

        // For isometric projection: moving vertically in screen space
        // moves both viewPointX and viewPointY
        const deltaX = -scale * (dpx + dpy) * invertFactor;
        const deltaY = -scale * 2 * dpy * invertFactor;

        this.viewPoint.setRawPosition(
            this.dragStartPosX + deltaX,
            this.dragStartPosY + deltaY
        );
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

        const speed = gameSettings.state.panSpeed * this.viewPoint.zoomValue * deltaTime;

        let dx = 0;
        let dy = 0;

        // Handle WASD/Arrow keys for camera pan
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
            // Use moveTarget for consistent velocity independent of interpolation state
            this.viewPoint.moveTarget(dx * factor, dy * factor);
        }
    }

    override getRenderState(_context: InputContext): ModeRenderState {
        return {
            cursor: this.isDraggingCamera ? CursorType.Grabbing : CursorType.Default,
        };
    }
}
