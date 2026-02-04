import { TileCoord, CARDINAL_OFFSETS, tileKey } from '../entity';
import { isPassable } from './placement';

interface PathNode {
    x: number;
    y: number;
    g: number; // cost from start
    h: number; // heuristic to goal
    f: number; // g + h
    parent: PathNode | null;
}

const MAX_SEARCH_NODES = 2000;

/**
 * A* pathfinding on the tile grid.
 *
 * Uses 4-directional movement (up/down/left/right).
 * Cost = 1 + abs(heightDiff). Impassable tiles block movement.
 *
 * Returns array of waypoints from start (exclusive) to goal (inclusive),
 * or null if no path found.
 */
export function findPath(
    startX: number,
    startY: number,
    goalX: number,
    goalY: number,
    groundType: Uint8Array,
    groundHeight: Uint8Array,
    mapWidth: number,
    mapHeight: number,
    tileOccupancy: Map<string, number>
): TileCoord[] | null {
    if (startX === goalX && startY === goalY) {
        return [];
    }

    // Check goal is passable
    const goalIdx = goalX + goalY * mapWidth;
    if (!isPassable(groundType[goalIdx])) {
        return null;
    }

    const openSet: PathNode[] = [];
    const closedSet = new Set<number>();

    const startH = heuristic(startX, startY, goalX, goalY);
    const startNode: PathNode = {
        x: startX,
        y: startY,
        g: 0,
        h: startH,
        f: startH,
        parent: null
    };
    openSet.push(startNode);

    let nodesSearched = 0;

    while (openSet.length > 0 && nodesSearched < MAX_SEARCH_NODES) {
        // Find node with lowest f
        let bestIdx = 0;
        for (let i = 1; i < openSet.length; i++) {
            if (openSet[i].f < openSet[bestIdx].f) {
                bestIdx = i;
            }
        }

        const current = openSet[bestIdx];
        openSet.splice(bestIdx, 1);

        if (current.x === goalX && current.y === goalY) {
            return reconstructPath(current);
        }

        const closedKey = current.x + current.y * mapWidth;
        if (closedSet.has(closedKey)) continue;
        closedSet.add(closedKey);
        nodesSearched++;

        for (const [dx, dy] of CARDINAL_OFFSETS) {
            const nx = current.x + dx;
            const ny = current.y + dy;

            // Bounds check
            if (nx < 0 || nx >= mapWidth || ny < 0 || ny >= mapHeight) {
                continue;
            }

            const nKey = nx + ny * mapWidth;
            if (closedSet.has(nKey)) continue;

            // Check passability
            if (!isPassable(groundType[nKey])) continue;

            // Don't path through occupied tiles (except the goal)
            if (nx !== goalX || ny !== goalY) {
                if (tileOccupancy.has(tileKey(nx, ny))) {
                    continue;
                }
            }

            // Cost: base 1 + height difference penalty
            const currentHeight = groundHeight[current.x + current.y * mapWidth];
            const neighborHeight = groundHeight[nKey];
            const heightDiff = Math.abs(currentHeight - neighborHeight);
            const moveCost = 1 + heightDiff;

            const tentativeG = current.g + moveCost;

            // Check if already in open set with better g
            const existingIdx = openSet.findIndex(n => n.x === nx && n.y === ny);
            if (existingIdx >= 0 && openSet[existingIdx].g <= tentativeG) {
                continue;
            }

            const h = heuristic(nx, ny, goalX, goalY);
            const newNode: PathNode = {
                x: nx,
                y: ny,
                g: tentativeG,
                h,
                f: tentativeG + h,
                parent: current
            };

            if (existingIdx >= 0) {
                openSet[existingIdx] = newNode;
            } else {
                openSet.push(newNode);
            }
        }
    }

    return null; // No path found
}

function heuristic(ax: number, ay: number, bx: number, by: number): number {
    return Math.abs(ax - bx) + Math.abs(ay - by);
}

function reconstructPath(node: PathNode): TileCoord[] {
    const path: TileCoord[] = [];
    let current: PathNode | null = node;

    while (current !== null && current.parent !== null) {
        path.push({ x: current.x, y: current.y });
        current = current.parent;
    }

    path.reverse();
    return path;
}
