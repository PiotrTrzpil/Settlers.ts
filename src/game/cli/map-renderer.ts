/**
 * CLI map renderer — builds a text grid from game state using rich ASCII symbols.
 */

import type { GameCore } from '@/game/game-core';
import type { MapLayerFilter, MapViewport } from './map-symbols';
import { renderTileSymbol, buildLegend } from './map-symbols';

/** Render the map viewport to a multi-line string (header + grid + legend). */
export function renderMapText(game: GameCore, viewport: MapViewport, layers: MapLayerFilter): string {
    const { terrain, state } = game;
    const { cx, cy, radius } = viewport;

    const minX = Math.max(0, cx - radius);
    const maxX = Math.min(terrain.width - 1, cx + radius);
    const minY = Math.max(0, cy - radius);
    const maxY = Math.min(terrain.height - 1, cy + radius);

    const yLabelWidth = String(maxY).length;
    const lines: string[] = [];
    const usedSymbols = new Set<string>();

    // X-axis header
    const xNums: string[] = [];
    for (let x = minX; x <= maxX; x++) {
        xNums.push(x === cx ? '*' : String(x % 10));
    }
    lines.push(' '.repeat(yLabelWidth + 1) + xNums.join(''));

    // Grid rows
    for (let y = minY; y <= maxY; y++) {
        let row = '';
        for (let x = minX; x <= maxX; x++) {
            if (x === cx && y === cy) {
                row += '+';
                continue;
            }
            const unit = state.getUnitAt(x, y);
            const ground = state.getGroundEntityAt(x, y);
            const sym = renderTileSymbol(unit, ground, terrain.getType(x, y), terrain.getHeight(x, y), layers);
            usedSymbols.add(sym);
            row += sym;
        }
        const label = String(y).padStart(yLabelWidth);
        lines.push(`${label} ${row}`);
    }

    // Legend
    const legend = buildLegend(usedSymbols);
    if (legend) {
        lines.push('', legend);
    }

    return lines.join('\n');
}
