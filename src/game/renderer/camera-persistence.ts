const CAMERA_KEY_PREFIX = 'settlers_camera_';

export interface SavedCamera {
    x: number;
    y: number;
    zoom: number;
}

export function saveCameraState(mapId: string, camera: SavedCamera): void {
    if (!mapId) {
        return;
    }
    try {
        localStorage.setItem(CAMERA_KEY_PREFIX + mapId, JSON.stringify(camera));
    } catch {
        // Ignore quota errors
    }
}

export function clearCameraState(mapId: string): void {
    if (!mapId) {
        return;
    }
    try {
        localStorage.removeItem(CAMERA_KEY_PREFIX + mapId);
    } catch {
        // Ignore
    }
}

export function loadCameraState(mapId: string): SavedCamera | null {
    if (!mapId) {
        return null;
    }
    try {
        const raw = localStorage.getItem(CAMERA_KEY_PREFIX + mapId);
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown; zoom?: unknown };
        if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number' || typeof parsed.zoom !== 'number') {
            return null;
        }
        return { x: parsed.x, y: parsed.y, zoom: parsed.zoom };
    } catch {
        return null;
    }
}
