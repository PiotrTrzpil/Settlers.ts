/**
 * Read-only view of camera position and zoom.
 * Used by TilePicker and other consumers that only need to read camera state.
 */
export interface IViewPointReadonly {
    /** Current X position (including any drag offset) */
    readonly x: number;
    /** Current Y position (including any drag offset) */
    readonly y: number;
    /** Zoom level for shader (0.1/zoomValue) */
    readonly zoom: number;
    /** Aspect ratio (width / height) */
    readonly aspectRatio: number;
}

/**
 * Full ViewPoint interface with read-write access.
 * Used by CameraMode and other components that need to control the camera.
 */
export interface IViewPoint extends IViewPointReadonly {
    /** Raw zoom value (can be set directly) */
    zoomValue: number;
    /** Canvas height for scale calculations */
    readonly canvasHeight: number;
    /** Set position directly (for external input control) */
    setRawPosition(posX: number, posY: number, deltaX?: number, deltaY?: number): void;
}
