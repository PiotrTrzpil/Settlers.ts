/**
 * CLI map renderer — builds a text grid from game state using rich ASCII symbols.
 */

import type { GameCore } from '@/game/game-core';
import type { ValidPositionGrid } from '@/game/systems/placement/valid-position-grid';
import type { GameState } from '@/game/game-state';
import type { TerrainData } from '@/game/terrain/terrain-data';
import type { MapLayerFilter, MapViewport } from './map-symbols';
import { renderTileSymbol, buildLegend } from './map-symbols';

export interface MapRenderOptions {
    layers: MapLayerFilter;
    /** When set, overlay placement validity from the precomputed grid. */
    placementGrid?: ValidPositionGrid | null;
}

interface GridBounds {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    cx: number;
    cy: number;
}

/** Render the map viewport to a multi-line string (header + grid + legend). */
export function renderMapText(game: GameCore, viewport: MapViewport, options: MapRenderOptions): string {
    const { cx, cy, radius } = viewport;
    const { placementGrid } = options;

    const bounds: GridBounds = {
        minX: Math.max(0, cx - radius),
        maxX: Math.min(game.terrain.width - 1, cx + radius),
        minY: Math.max(0, cy - radius),
        maxY: Math.min(game.terrain.height - 1, cy + radius),
        cx,
        cy,
    };

    if (placementGrid) {
        return renderPlacementGrid(placementGrid, bounds);
    }
    return renderNormalGrid(game.terrain, game.state, options.layers, bounds);
}

function renderGridHeader(bounds: GridBounds): { yLabelWidth: number; headerLines: string[] } {
    const yLabelWidth = String(bounds.maxY).length;
    const pad = ' '.repeat(yLabelWidth + 1);

    const units: string[] = [];
    const tens: string[] = [];
    const hundreds: string[] = [];

    for (let x = bounds.minX; x <= bounds.maxX; x++) {
        if (x === bounds.cx) {
            units.push('*');
            tens.push('*');
            hundreds.push('*');
        } else {
            units.push(String(x % 10));
            tens.push(x % 10 === 0 ? String(Math.floor(x / 10) % 10) : ' ');
            hundreds.push(x % 10 === 0 && x >= 100 ? String(Math.floor(x / 100) % 10) : ' ');
        }
    }

    const lines: string[] = [];
    if (bounds.maxX >= 100) {
        lines.push(pad + hundreds.join(''));
    }
    lines.push(pad + tens.join(''));
    lines.push(pad + units.join(''));
    return { yLabelWidth, headerLines: lines };
}

function renderNormalGrid(terrain: TerrainData, state: GameState, layers: MapLayerFilter, bounds: GridBounds): string {
    const { yLabelWidth, headerLines } = renderGridHeader(bounds);
    const lines: string[] = [...headerLines];
    const usedSymbols = new Set<string>();

    for (let y = bounds.minY; y <= bounds.maxY; y++) {
        let row = '';
        for (let x = bounds.minX; x <= bounds.maxX; x++) {
            if (x === bounds.cx && y === bounds.cy) {
                row += '+';
                continue;
            }
            const tile = { x, y };
            const unit = state.getUnitAt(tile);
            const ground = state.getGroundEntityAt(tile);
            const sym = renderTileSymbol(unit, ground, terrain.getType(tile), terrain.getHeight(tile), layers);
            usedSymbols.add(sym);
            row += sym;
        }
        lines.push(`${String(y).padStart(yLabelWidth)} ${row}`);
    }

    const legend = buildLegend(usedSymbols);
    if (legend) {
        lines.push('', legend);
    }
    return lines.join('\n');
}

function renderPlacementGrid(grid: ValidPositionGrid, bounds: GridBounds): string {
    const { yLabelWidth, headerLines } = renderGridHeader(bounds);
    const lines: string[] = [...headerLines];

    for (let y = bounds.minY; y <= bounds.maxY; y++) {
        let row = '';
        for (let x = bounds.minX; x <= bounds.maxX; x++) {
            if (x === bounds.cx && y === bounds.cy) {
                row += '+';
            } else {
                row += grid.isValid({ x, y }) ? 'o' : '.';
            }
        }
        lines.push(`${String(y).padStart(yLabelWidth)} ${row}`);
    }

    lines.push('', 'o=can place .=cannot place');
    return lines.join('\n');
}
