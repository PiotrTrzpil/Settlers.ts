import { Entity, EntityType, getBuildingFootprint, BuildingType, tileKey, Tile } from '../../entity';
import { getBuildingDoorPos } from '../../data/game-data-access';
import { getBuildingBlockArea } from '../../buildings/types';
import type { TileHighlight } from '../../input/render-state';
import { tileToWorld, heightToWorld, TILE_CENTER_X, TILE_CENTER_Y } from '../../systems/coordinate-system';
import {
    FOOTPRINT_TILE_COLOR,
    FOOTPRINT_EDGE_COLOR,
    FOOTPRINT_DOOR_COLOR,
    UNIT_POSITION_TILE_COLOR,
    UNIT_DIRECTION_ARROW_COLOR,
    SHADER_VERTEX_SCALE,
} from '../entity-renderer-constants';
import type { OverlaySession } from './overlay-session';

/** Shift a world position from tile center to tile vertex (matching building sprite anchor). */
function shiftBuildingWorldPos(pos: { worldX: number; worldY: number }): { worldX: number; worldY: number } {
    return { worldX: pos.worldX - TILE_CENTER_X, worldY: pos.worldY - TILE_CENTER_Y * 0.5 };
}

/** Parse '#rrggbb' hex string to [r, g, b] in 0-1 range. */
function parseHexColor(hex: string): [number, number, number] {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

/**
 * Screen-space direction vectors for each EDirection.
 * Derived from the isometric tile-to-world transform (worldDx = tileDx - tileDy*0.5, worldDy = tileDy*0.5).
 * Normalized to unit length for consistent arrow rendering.
 */
const DIRECTION_SCREEN_VECTORS: ReadonlyArray<readonly [number, number]> = (() => {
    const raw: Array<[number, number]> = [
        [0.5, 0.5], // SOUTH_EAST
        [1.0, 0.0], // EAST
        [-0.5, 0.5], // SOUTH_WEST
        [-0.5, -0.5], // NORTH_WEST
        [-1.0, 0.0], // WEST
        [0.5, -0.5], // NORTH_EAST
    ];
    return raw.map(([x, y]) => {
        const len = Math.sqrt(x * x + y * y);
        return [x / len, y / len] as const;
    });
})();

/**
 * Renders diamond-shaped tile overlays: building footprints and tile highlights.
 * Handles isometric diamond geometry and the shader vertex-scale factor.
 */
export class TileDiamondRenderer {
    // Pre-allocated buffer for diamond vertices (6 vertices * 2 coords)
    private readonly diamondVerts = new Float32Array(12);

    /** Draw footprint tile highlights for all buildings. */
    public drawBuildingFootprints(s: OverlaySession, sortedEntities: Entity[]): void {
        let hasBuildings = false;
        for (const e of sortedEntities) {
            if (e.type === EntityType.Building) {
                hasBuildings = true;
                break;
            }
        }
        if (!hasBuildings) {
            return;
        }

        s.gl.bindBuffer(s.gl.ARRAY_BUFFER, s.buffer);

        for (const entity of sortedEntities) {
            if (entity.type !== EntityType.Building) {
                continue;
            }
            const buildingType = entity.subType as BuildingType;
            const footprint = getBuildingFootprint(entity.x, entity.y, buildingType, entity.race);
            const doorPos = getBuildingDoorPos(entity.x, entity.y, entity.race, buildingType);

            const blockKeys = new Set<string>();
            try {
                const blockArea = getBuildingBlockArea(entity.x, entity.y, buildingType, entity.race);
                for (const t of blockArea) {
                    blockKeys.add(tileKey(t.x, t.y));
                }
            } catch {
                /* no block data — treat all as block area */
            }

            for (const tile of footprint) {
                const color = getFootprintTileColor(tile, doorPos, blockKeys);
                s.gl.vertexAttrib4f(s.aColor, color[0]!, color[1]!, color[2]!, color[3]!);

                const idx = s.ctx.mapSize.toIndex(tile.x, tile.y);
                const hWorld = heightToWorld(s.ctx.groundHeight[idx]!);

                const top = shiftBuildingWorldPos(
                    tileToWorld(tile.x, tile.y, hWorld, s.ctx.viewPoint.x, s.ctx.viewPoint.y)
                );
                const right = shiftBuildingWorldPos(
                    tileToWorld(tile.x + 1, tile.y, hWorld, s.ctx.viewPoint.x, s.ctx.viewPoint.y)
                );
                const bottom = shiftBuildingWorldPos(
                    tileToWorld(tile.x + 1, tile.y + 1, hWorld, s.ctx.viewPoint.x, s.ctx.viewPoint.y)
                );
                const left = shiftBuildingWorldPos(
                    tileToWorld(tile.x, tile.y + 1, hWorld, s.ctx.viewPoint.x, s.ctx.viewPoint.y)
                );

                const center = this.fillDiamondFromWorldPositions(top, right, bottom, left);
                s.gl.vertexAttrib2f(s.aEntityPos, center.centerX, center.centerY);

                s.gl.bufferData(s.gl.ARRAY_BUFFER, this.diamondVerts, s.gl.DYNAMIC_DRAW);
                s.gl.drawArrays(s.gl.TRIANGLES, 0, 6);
            }
        }
    }

    /** Draw diamond highlights at tile positions (matching isometric tile shape). */
    public drawTileHighlights(s: OverlaySession, highlights: TileHighlight[]): void {
        if (highlights.length === 0) {
            return;
        }
        s.gl.bindBuffer(s.gl.ARRAY_BUFFER, s.buffer);

        for (const h of highlights) {
            const tx = Math.round(h.x);
            const ty = Math.round(h.y);
            const idx = s.ctx.mapSize.toIndex(tx, ty);
            const hWorld = heightToWorld(s.ctx.groundHeight[idx]!);
            // eslint-disable-next-line no-restricted-syntax -- optional value with sensible numeric default
            const alpha = h.alpha ?? 0.5;
            const [r, g, b] = parseHexColor(h.color);

            s.gl.vertexAttrib4f(s.aColor, r, g, b, alpha);

            const top = shiftBuildingWorldPos(tileToWorld(tx, ty, hWorld, s.ctx.viewPoint.x, s.ctx.viewPoint.y));
            const right = shiftBuildingWorldPos(tileToWorld(tx + 1, ty, hWorld, s.ctx.viewPoint.x, s.ctx.viewPoint.y));
            const bottom = shiftBuildingWorldPos(
                tileToWorld(tx + 1, ty + 1, hWorld, s.ctx.viewPoint.x, s.ctx.viewPoint.y)
            );
            const left = shiftBuildingWorldPos(tileToWorld(tx, ty + 1, hWorld, s.ctx.viewPoint.x, s.ctx.viewPoint.y));

            const center = this.fillDiamondFromWorldPositions(top, right, bottom, left);
            s.gl.vertexAttrib2f(s.aEntityPos, center.centerX, center.centerY);

            s.gl.bufferData(s.gl.ARRAY_BUFFER, this.diamondVerts, s.gl.DYNAMIC_DRAW);
            s.gl.drawArrays(s.gl.TRIANGLES, 0, 6);
        }
    }

    /** Draw tile highlight + direction arrow for all unit entities. */
    public drawUnitPositions(s: OverlaySession, sortedEntities: Entity[]): void {
        let hasUnits = false;
        for (const e of sortedEntities) {
            if (e.type === EntityType.Unit) {
                hasUnits = true;
                break;
            }
        }
        if (!hasUnits) {
            return;
        }

        s.gl.bindBuffer(s.gl.ARRAY_BUFFER, s.buffer);

        for (const entity of sortedEntities) {
            if (entity.type !== EntityType.Unit) {
                continue;
            }

            // Skip units without movement controllers (e.g. death angels — visual-only entities)
            const unitState = s.ctx.unitStates.get(entity.id);
            if (!unitState) {
                continue;
            }

            // Draw tile diamond
            s.gl.vertexAttrib4f(
                s.aColor,
                UNIT_POSITION_TILE_COLOR[0]!,
                UNIT_POSITION_TILE_COLOR[1]!,
                UNIT_POSITION_TILE_COLOR[2]!,
                UNIT_POSITION_TILE_COLOR[3]!
            );

            const tx = entity.x;
            const ty = entity.y;
            const idx = s.ctx.mapSize.toIndex(tx, ty);
            const hWorld = heightToWorld(s.ctx.groundHeight[idx]!);

            const top = shiftBuildingWorldPos(tileToWorld(tx, ty, hWorld, s.ctx.viewPoint.x, s.ctx.viewPoint.y));
            const right = shiftBuildingWorldPos(tileToWorld(tx + 1, ty, hWorld, s.ctx.viewPoint.x, s.ctx.viewPoint.y));
            const bottom = shiftBuildingWorldPos(
                tileToWorld(tx + 1, ty + 1, hWorld, s.ctx.viewPoint.x, s.ctx.viewPoint.y)
            );
            const left = shiftBuildingWorldPos(tileToWorld(tx, ty + 1, hWorld, s.ctx.viewPoint.x, s.ctx.viewPoint.y));

            const center = this.fillDiamondFromWorldPositions(top, right, bottom, left);
            s.gl.vertexAttrib2f(s.aEntityPos, center.centerX, center.centerY);

            s.gl.bufferData(s.gl.ARRAY_BUFFER, this.diamondVerts, s.gl.DYNAMIC_DRAW);
            s.gl.drawArrays(s.gl.TRIANGLES, 0, 6);

            // Draw direction arrow from movement controller's canonical direction
            this.drawDirectionArrow(s, center.centerX, center.centerY, unitState.direction);
        }
    }

    /** Draw a small triangle arrow from tile center in the given EDirection. */
    private drawDirectionArrow(s: OverlaySession, centerX: number, centerY: number, direction: number): void {
        s.gl.vertexAttrib4f(
            s.aColor,
            UNIT_DIRECTION_ARROW_COLOR[0]!,
            UNIT_DIRECTION_ARROW_COLOR[1]!,
            UNIT_DIRECTION_ARROW_COLOR[2]!,
            UNIT_DIRECTION_ARROW_COLOR[3]!
        );
        s.gl.vertexAttrib2f(s.aEntityPos, centerX, centerY);

        const [dx, dy] = DIRECTION_SCREEN_VECTORS[direction]!;
        const arrowLen = 0.35;
        const arrowWidth = 0.12;
        const invScale = 1 / SHADER_VERTEX_SCALE;

        // Arrow tip
        const tipX = dx * arrowLen * invScale;
        const tipY = dy * arrowLen * invScale;
        // Perpendicular for arrow base width
        const perpX = -dy * arrowWidth * invScale;
        const perpY = dx * arrowWidth * invScale;
        // Arrow base (slightly back from center)
        const baseX = dx * 0.05 * invScale;
        const baseY = dy * 0.05 * invScale;

        const verts = this.diamondVerts;
        // Triangle: tip, base-left, base-right
        verts[0] = tipX;
        verts[1] = tipY;
        verts[2] = baseX + perpX;
        verts[3] = baseY + perpY;
        verts[4] = baseX - perpX;
        verts[5] = baseY - perpY;

        s.gl.bufferData(s.gl.ARRAY_BUFFER, verts.subarray(0, 6), s.gl.DYNAMIC_DRAW);
        s.gl.drawArrays(s.gl.TRIANGLES, 0, 3);
    }

    /** Fill vertex data for a diamond shape from 4 absolute world positions. */
    private fillDiamondFromWorldPositions(
        top: { worldX: number; worldY: number },
        right: { worldX: number; worldY: number },
        bottom: { worldX: number; worldY: number },
        left: { worldX: number; worldY: number }
    ): { centerX: number; centerY: number } {
        const verts = this.diamondVerts;
        const centerX = (top.worldX + right.worldX + bottom.worldX + left.worldX) / 4;
        const centerY = (top.worldY + right.worldY + bottom.worldY + left.worldY) / 4;

        const invScale = 1 / SHADER_VERTEX_SCALE;

        verts[0] = (top.worldX - centerX) * invScale;
        verts[1] = (top.worldY - centerY) * invScale;
        verts[2] = (right.worldX - centerX) * invScale;
        verts[3] = (right.worldY - centerY) * invScale;
        verts[4] = (bottom.worldX - centerX) * invScale;
        verts[5] = (bottom.worldY - centerY) * invScale;

        verts[6] = (top.worldX - centerX) * invScale;
        verts[7] = (top.worldY - centerY) * invScale;
        verts[8] = (bottom.worldX - centerX) * invScale;
        verts[9] = (bottom.worldY - centerY) * invScale;
        verts[10] = (left.worldX - centerX) * invScale;
        verts[11] = (left.worldY - centerY) * invScale;

        return { centerX, centerY };
    }
}

/** Pick tile color: door=orange-red, block area=cyan, placement-only zone=purple. */
function getFootprintTileColor(tile: Tile, doorPos: Tile, blockKeys: Set<string>): readonly number[] {
    if (tile.x === doorPos.x && tile.y === doorPos.y) {
        return FOOTPRINT_DOOR_COLOR;
    }
    if (blockKeys.size === 0 || blockKeys.has(tileKey(tile.x, tile.y))) {
        return FOOTPRINT_TILE_COLOR;
    }
    return FOOTPRINT_EDGE_COLOR;
}
