import { IViewPoint } from './i-view-point';

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
    private readonly PAN_SPEED = 8;

    /** callback on mouse move */
    public onMove: (() => void) | null = null;

    public get zoom(): number {
        return 0.1 / this.zoomValue;
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

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;

        // disable touch scroll
        canvas.style.touchAction = 'none';

        canvas.addEventListener('pointerdown', this.handlePointerDown);
        canvas.addEventListener('pointermove', this.handlePointerMove);
        window.addEventListener('pointerup', this.handlePointerUp);
        canvas.addEventListener('contextmenu', this.handleContextmenu);
        canvas.addEventListener('wheel', this.handleWheel);

        window.addEventListener('keydown', this.handleKeyDown);
        window.addEventListener('keyup', this.handleKeyUp);

        Object.seal(this);
    }

    public destroy(): void {
        this.onMove = null;

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

        const dX = (e.offsetX - this.downX) * this.zoomValue * 0.03;
        const dY = (e.offsetY - this.downY) * this.zoomValue * 0.03;
        this.deltaX = -(dX + dY / 2);
        this.deltaY = -dY;

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

        const speed = this.PAN_SPEED * this.zoomValue * dt;
        let dx = 0;
        let dy = 0;

        if (this.keysDown.has('d')) dx += speed;
        if (this.keysDown.has('a')) dx -= speed;
        if (this.keysDown.has('s')) { dy += speed * 2; dx += speed; }
        if (this.keysDown.has('w')) { dy -= speed * 2; dx -= speed; }

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
