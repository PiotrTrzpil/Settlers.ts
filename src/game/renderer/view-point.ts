import { IViewPoint } from './i-view-point';

/**
 * ViewPoint options for configuration.
 */
export interface ViewPointOptions {
    /**
     * If true, ViewPoint will NOT attach its own event listeners.
     * Use this when integrating with InputManager.
     */
    externalInput?: boolean;
}

/**
 * Handles mouse events and gesture and generates
 * the view-coordinates (x,y,zoom)
 */
const PAN_KEYS = new Set(['w', 'a', 's', 'd']);

export class ViewPoint implements IViewPoint {
    private posX = 0;
    private posY = 0;
    private deltaX = 0;
    private deltaY = 0;
    private downX = 0;
    private downY = 0;
    public zoomValue = 1;
    public zoomSpeed = 0.05;
    private mouseIsMoving = false;
    private canvas: HTMLCanvasElement;
    private keysDown = new Set<string>();
    public panSpeed = 40;
    private externalInput: boolean;

    /** callback on mouse move */
    public onMove: (() => void) | null = null;

    public get zoom(): number {
        return 0.1 / this.zoomValue;
    }

    public get canvasHeight(): number {
        return this.canvas.clientHeight;
    }

    public get aspectRatio(): number {
        const h = this.canvas.clientHeight;
        return h > 0 ? this.canvas.clientWidth / h : 1.0;
    }

    /** Center the camera on a tile coordinate */
    public setPosition(tileX: number, tileY: number): void {
        // The shader maps tile (x, y) to instancePos (x + floor(y/2), y),
        // then offsets by (-posX, -posY).  The projection puts screen-center
        // at world (aspect, 1) which corresponds to pixelCoord (aspect+1, 2).
        // So to center tile (tileX, tileY) we need:
        const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
        this.posX = tileX + Math.floor(tileY / 2) - aspect - 1;
        this.posY = tileY - 2;
        this.deltaX = 0;
        this.deltaY = 0;
    }

    public get x(): number {
        return this.posX + this.deltaX;
    }

    public get y(): number {
        return this.posY + this.deltaY;
    }

    /**
     * Set position and delta directly (for external input control).
     */
    public setRawPosition(posX: number, posY: number, deltaX = 0, deltaY = 0): void {
        this.posX = posX;
        this.posY = posY;
        this.deltaX = deltaX;
        this.deltaY = deltaY;
    }

    /**
     * Set zoom directly (for external input control).
     */
    public setZoom(zoom: number): void {
        // Convert from shader zoom (0.1/zoomValue) to zoomValue
        this.zoomValue = 0.1 / zoom;
    }

    constructor(canvas: HTMLCanvasElement, options?: ViewPointOptions) {
        this.canvas = canvas;
        this.externalInput = options?.externalInput ?? false;

        // disable touch scroll
        canvas.style.touchAction = 'none';

        // Only attach event listeners if not using external input
        if (!this.externalInput) {
            canvas.addEventListener('pointerdown', this.handlePointerDown);
            canvas.addEventListener('pointermove', this.handlePointerMove);
            window.addEventListener('pointerup', this.handlePointerUp);
            canvas.addEventListener('contextmenu', this.handleContextmenu);
            canvas.addEventListener('wheel', this.handleWheel);

            window.addEventListener('keydown', this.handleKeyDown);
            window.addEventListener('keyup', this.handleKeyUp);
        }

        Object.seal(this);
    }

    public destroy(): void {
        this.onMove = null;

        // Only remove listeners if we attached them
        if (this.externalInput) return;

        window.removeEventListener('pointerup', this.handlePointerUp);
        window.removeEventListener('keydown', this.handleKeyDown);
        window.removeEventListener('keyup', this.handleKeyUp);

        if (this.canvas == null) {
            return;
        }

        this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
        this.canvas.removeEventListener('pointermove', this.handlePointerMove);
        this.canvas.removeEventListener('contextmenu', this.handleContextmenu);
        this.canvas.removeEventListener('wheel', this.handleWheel);
    }

    private handlePointerDown = (e: PointerEvent) => {
        e.preventDefault();

        this.downX = e.offsetX;
        this.downY = e.offsetY;
        this.mouseIsMoving = true;
    };

    private handlePointerMove = (e: PointerEvent) => {
        e.preventDefault();

        if (!this.mouseIsMoving) {
            return;
        }

        // Scale factor converts pixel movement to viewPoint units
        // Derived from the isometric projection to keep tiles "sticky" under cursor
        const height = this.canvas.clientHeight;
        const scale = 20 * this.zoomValue / height;

        const dpx = e.offsetX - this.downX;
        const dpy = e.offsetY - this.downY;

        // For isometric projection: moving vertically in screen space
        // moves both viewPointX and viewPointY
        this.deltaX = -scale * (dpx + dpy);
        this.deltaY = -scale * 2 * dpy;

        if (this.onMove) {
            this.onMove();
        }
    };

    private handlePointerUp = () => {
        if (!this.mouseIsMoving) {
            return;
        }

        this.mouseIsMoving = false;
        // update the pos values
        this.posX = this.x;
        this.posY = this.y;

        this.deltaX = 0;
        this.deltaY = 0;

        if (this.onMove) {
            this.onMove();
        }
    };

    private handleKeyDown = (e: KeyboardEvent) => {
        const key = e.key.toLowerCase();
        if (PAN_KEYS.has(key)) {
            this.keysDown.add(key);
        }
    };

    private handleKeyUp = (e: KeyboardEvent) => {
        this.keysDown.delete(e.key.toLowerCase());
    };

    /** Advance keyboard-driven panning by dt seconds. Call once per frame. */
    public update(dt: number): void {
        if (this.keysDown.size === 0) return;

        const speed = this.panSpeed * this.zoomValue * dt;
        let dx = 0;
        let dy = 0;

        if (this.keysDown.has('d')) dx += speed;
        if (this.keysDown.has('a')) dx -= speed;
        if (this.keysDown.has('s')) { dy += speed * 2; dx += speed }
        if (this.keysDown.has('w')) { dy -= speed * 2; dx -= speed }

        if (dx === 0 && dy === 0) return;

        this.posX += dx;
        this.posY += dy;

        if (this.onMove) {
            this.onMove();
        }
    }

    private handleContextmenu = (e: MouseEvent) => {
        e.preventDefault();
    };

    private handleWheel = (e: WheelEvent) => {
        e.preventDefault();

        const direction = Math.sign(e.deltaY);
        if (direction === 0) return;

        const canvas = this.canvas;
        const aspect = canvas.clientWidth / canvas.clientHeight;

        // Mouse position in NDC (-1 to 1)
        const ndcX = (e.offsetX / canvas.clientWidth) * 2 - 1;
        const ndcY = 1 - (e.offsetY / canvas.clientHeight) * 2;

        const oldZoomValue = this.zoomValue;

        // Multiplicative zoom for uniform feel at all zoom levels
        const factor = direction > 0
            ? (1 + this.zoomSpeed)
            : (1 / (1 + this.zoomSpeed));
        this.zoomValue = Math.max(0.5, Math.min(30, this.zoomValue * factor));

        // Adjust camera so the world point under the cursor stays fixed.
        // Derived from the orthographic projection and tile-picker inverse:
        //   d = 10 * (newZoomValue - oldZoomValue)   [since 1/zoom = 10*zoomValue]
        //   Δvp.x = -(ndcX * aspect - ndcY) * d
        //   Δvp.y =  2 * ndcY * d
        const d = 10 * (this.zoomValue - oldZoomValue);
        this.posX -= (ndcX * aspect - ndcY) * d;
        this.posY += 2 * ndcY * d;

        if (this.onMove) {
            this.onMove();
        }
    };
}
