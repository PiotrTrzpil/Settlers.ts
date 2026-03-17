#!/usr/bin/env tsx
/**
 * Architecture diagram generator for Settlers.ts.
 *   pnpm tsx docs/generate-arch-diagram.ts [--style flat|line|mono|dark]
 *   rsvg-convert -o /tmp/arch.png --width 2800 docs/architecture-diagram.svg
 */
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { themes, type Theme } from './arch-themes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── SVG Collision Validator ───────────────────────────────────────
// Parses the generated SVG and checks that no free-floating text label
// overlaps with or gets too close to any box rect.

interface BBox {
    x: number;
    y: number;
    w: number;
    h: number;
}

function attr(tag: string, name: string): string | undefined {
    const m = tag.match(new RegExp(`\\b${name}="([^"]+)"`));
    return m?.[1];
}

function parseRects(svg: string): (BBox & { label: string })[] {
    const rects: (BBox & { label: string })[] = [];
    for (const m of svg.matchAll(/<rect\b[^>]+>/g)) {
        const t = m[0];
        const x = +(attr(t, 'x') ?? '0');
        const y = +(attr(t, 'y') ?? '0');
        const w = +(attr(t, 'width') ?? '0');
        const h = +(attr(t, 'height') ?? '0');
        if (w > 0 && w <= 600 && h > 0) rects.push({ x, y, w, h, label: `${w}x${h}@${x},${y}` });
    }
    return rects;
}

function anchorOffsetX(anchor: string, tw: number): number {
    if (anchor === 'end') return -tw;
    if (anchor === 'middle') return -tw / 2;
    return 0;
}

function parseTexts(svg: string): (BBox & { content: string })[] {
    const texts: (BBox & { content: string })[] = [];
    for (const m of svg.matchAll(/<text\b([^>]+)>([^<]+)<\/text>/g)) {
        const a = m[1],
            content = m[2];
        const x = +(attr(a, 'x') ?? '0');
        const y = +(attr(a, 'y') ?? '0');
        const anchor = attr(a, 'text-anchor') ?? 'start';
        const fontSize = +(attr(a, 'font-size') ?? '12');
        const bold = a.includes('font-weight="bold"');
        const charW = fontSize * (bold ? 0.67 : 0.62);
        const tw = content.length * charW;
        const th = fontSize;
        const bx = x + anchorOffsetX(anchor, tw);
        const by = y - fontSize * 0.78;
        texts.push({ x: bx, y: by, w: tw, h: th, content });
    }
    return texts;
}

function checkCollision(t: BBox & { content: string }, r: BBox & { label: string }, minClearance: number): boolean {
    const INS = 2;
    const insideRect =
        t.x >= r.x - INS && t.x + t.w <= r.x + r.w + INS && t.y >= r.y - INS && t.y + t.h <= r.y + r.h + INS;
    if (insideRect) return false;

    const xGap = Math.max(r.x - (t.x + t.w), t.x - (r.x + r.w));
    const yGap = Math.max(r.y - (t.y + t.h), t.y - (r.y + r.h));

    if (xGap < minClearance && yGap < minClearance) {
        const severity = xGap < 0 && yGap < 0 ? 'OVERLAP' : 'TOO CLOSE';
        const gap = Math.max(xGap, yGap);
        console.warn(`  ${severity}: "${t.content}" (${Math.round(gap)}px) ↔ rect ${r.label}`);
        return true;
    }
    return false;
}

function validate(svg: string, minClearance = 5): number {
    const rects = parseRects(svg);
    const texts = parseTexts(svg);

    let issues = 0;
    for (const t of texts) {
        for (const r of rects) {
            if (checkCollision(t, r, minClearance)) issues++;
        }
    }
    return issues;
}

// ─── CLI ───────────────────────────────────────────────────────────
const styleIdx = process.argv.indexOf('--style');
const styleName = styleIdx >= 0 ? process.argv[styleIdx + 1] : 'flat';
if (!themes[styleName]) {
    console.error(`Unknown style "${styleName}". Available: ${Object.keys(themes).join(', ')}`);
    process.exit(1);
}
const suffix = styleName === 'flat' ? '' : `-${styleName}`;
const OUTPUT = resolve(__dirname, `architecture-diagram${suffix}.svg`);
const T: Theme = themes[styleName];

// ─── Canvas & Layout ───────────────────────────────────────────────
const W = 1400;
const M = 80;
const CW = W - 2 * M;

const LAYER_DEFS = [
    ['ui', 65],
    ['io', 90],
    ['orch', 90],
    ['feat', 270],
    ['state', 80],
    ['infra', 70],
    ['data', 60],
] as const;

const Y: Record<string, number> = {};
let _y = 80;
for (const [key, h] of LAYER_DEFS) {
    Y[key] = _y;
    _y += h + 15;
}
Y.legend = _y + 5;
const H = _y + 75;

// ─── SVG Primitives ────────────────────────────────────────────────
function rect(x: number, y: number, w: number, h: number, fill: string, stroke: string, rx = 8, extra = '') {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"${extra ? ' ' + extra : ''}/>`;
}

function txt(x: number, y: number, s: string, fill: string, size = 12, bold = false, anchor = 'middle') {
    const fw = bold ? ' font-weight="bold"' : '';
    return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="sans-serif" font-size="${size}"${fw} fill="${fill}">${s}</text>`;
}

function ital(x: number, y: number, s: string, fill: string, size = 9, anchor = 'start') {
    return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="sans-serif" font-size="${size}" font-style="italic" fill="${fill}">${s}</text>`;
}

function ln(x1: number, y1: number, x2: number, y2: number, stroke: string, mk: string, dash = false, w = 1.5) {
    const d = dash ? ' stroke-dasharray="6 3"' : '';
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${w}"${d} marker-end="url(#${mk})"/>`;
}

// ─── Composites ────────────────────────────────────────────────────
function mkr(id: string, color: string) {
    return `<marker id="${id}" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,3.5 L0,7 Z" fill="${color}"/></marker>`;
}

function band(key: string, h: number, label: string, bg: string, bd: string, lc: string) {
    return `<rect x="${M}" y="${Y[key]}" width="${CW}" height="${h}" rx="10" fill="${bg}" stroke="${bd}" stroke-width="1.5"/>
    ${txt(M + 20, Y[key] + 17, label, lc, 10, true, 'start')}`;
}

function bigBox(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    fill: string,
    stroke: string,
    tc: string,
    sub?: string,
    sc?: string,
    extra = ''
) {
    const ly = sub ? Math.round(y + h * 0.38) : Math.round(y + h * 0.52);
    const parts = [rect(x, y, w, h, fill, stroke, 8, extra), txt(x + w / 2, ly, label, tc, 13, true)];
    if (sub) parts.push(txt(x + w / 2, Math.round(y + h * 0.72), sub, sc ?? tc, 9));
    return parts.join('\n    ');
}

function mod(x: number, y: number, w: number, h: number, label: string, fl: string, st: string, tc: string) {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="${fl}" stroke="${st}" stroke-width="1"/>
    ${txt(x + w / 2, Math.round(y + h * 0.65), label, tc, 10)}`;
}

function modGrid(
    ox: number,
    oy: number,
    cw: number,
    cg: number,
    rh: number,
    rg: number,
    rows: string[][],
    fl: string,
    st: string,
    tc: string
) {
    return rows
        .flatMap((row, ri) =>
            row.map((label, ci) => mod(ox + ci * (cw + cg), oy + ri * (rh + rg), cw, rh, label, fl, st, tc))
        )
        .join('\n    ');
}

// ─── Layers ────────────────────────────────────────────────────────
const defs = [
    mkr('cmd', T.arr.cmd),
    mkr('evt', T.arr.evt),
    mkr('qry', T.arr.qry),
    mkr('lp', T.arr.loop),
    mkr('ai', T.arr.ai),
].join('\n    ');

const titleSvg = [
    txt(W / 2, 38, 'Settlers.ts — System Architecture', T.title, 26, true),
    txt(W / 2, 60, 'Layered architecture with event-driven domain features', T.subtitle, 13),
].join('\n  ');

// Layer 7 — UI
const uiY = Y.ui + 27;
const layer7 = [
    band('ui', 65, 'LAYER 7 — PRESENTATION', T.ui.bg, T.ui.bd, T.ui.lb),
    mod(160, uiY, 155, 30, 'Vue Components', T.ui.fl, T.ui.st, T.ui.tx),
    mod(330, uiY, 145, 30, 'Composables', T.ui.fl, T.ui.st, T.ui.tx),
    mod(490, uiY, 170, 30, 'GameViewState', T.ui.fl, T.ui.st, T.ui.tx),
    mod(675, uiY, 145, 30, 'Debug Panel', T.ui.fl, T.ui.st, T.ui.tx),
].join('\n    ');

// Layer 6 — I/O
const ioY = Y.io + 30;
const layer6 = [
    band('io', 90, 'LAYER 6 — I/O', T.io.bg, T.io.bd, T.io.lb),
    bigBox(
        110,
        ioY,
        360,
        50,
        'InputManager',
        T.io.fl,
        T.io.st,
        T.io.tx,
        'Select · PlaceBuilding · Camera · Adjust',
        T.io.sub
    ),
    bigBox(
        500,
        ioY,
        420,
        50,
        'Renderer (WebGL2)',
        T.io.fl,
        T.io.st,
        T.io.tx,
        'Landscape · Entities · Overlays · SpriteCache',
        T.io.sub
    ),
    bigBox(950, ioY, 160, 50, 'Audio', T.io.fl, T.io.st, T.io.tx),
    bigBox(
        1140,
        ioY,
        150,
        50,
        'Lua Scripting',
        T.io.fl,
        T.io.st,
        T.luaTx,
        undefined,
        undefined,
        'stroke-dasharray="4 3"'
    ),
].join('\n    ');

// Layer 5 — Orchestration
const orY = Y.orch + 30;
const layer5 = [
    band('orch', 90, 'LAYER 5 — ORCHESTRATION', T.orch.bg, T.orch.bd, T.orch.lb),
    bigBox(
        110,
        orY,
        300,
        50,
        'GameLoop (30 Hz)',
        T.orch.fl,
        T.orch.st,
        T.orch.tx,
        'Logic → Anim → Update → Render',
        T.orch.sub
    ),
    bigBox(
        440,
        orY,
        320,
        50,
        'Command Pipeline',
        T.orch.fl,
        T.orch.st,
        T.orch.tx,
        'Registry · Handlers · DI',
        T.orch.sub
    ),
    bigBox(790, orY, 240, 50, 'GameServices', T.orch.fl, T.orch.st, T.orch.tx, 'Composition Root', T.orch.sub),
    bigBox(
        1060,
        orY,
        230,
        50,
        'Persistence',
        T.orch.fl,
        T.orch.st,
        T.orch.tx,
        'Snapshots · Command Journal',
        T.orch.sub
    ),
].join('\n    ');

// Layer 4 — Features
const FY = Y.feat;
const clT = FY + 28;
const clP = 15;

const eX = 100,
    eW = 295;
const economy = [
    rect(eX, clT, eW, 225, T.eco.bg, T.eco.bd),
    txt(eX + eW / 2, clT + 16, 'ECONOMY', T.eco.ti, 11, true),
    modGrid(
        eX + clP,
        clT + 26,
        125,
        10,
        26,
        6,
        [
            ['Logistics', 'Carriers'],
            ['Inventory', 'Production'],
            ['Material Req', 'Mat Transfer'],
        ],
        T.eco.fl,
        T.eco.st,
        T.eco.tx
    ),
    ital(eX + clP + 5, clT + 138, 'Demand → Match → Dispatch → Deliver', T.eco.an),
    mod(eX + clP, clT + 150, eW - 2 * clP, 24, 'Work Areas', T.eco.fl, T.eco.st, T.eco.tx),
    mod(eX + clP, clT + 180, eW - 2 * clP, 24, 'Building Demand · Overlays', T.eco.fl, T.eco.st, T.eco.tx),
].join('\n    ');

const sX = 410,
    sW = 250;
const settlers = [
    rect(sX, clT, sW, 225, T.set.bg, T.set.bd),
    txt(sX + sW / 2, clT + 16, 'SETTLERS', T.set.ti, 11, true),
    mod(sX + clP, clT + 26, sW - 2 * clP, 26, 'Settler Tasks', T.set.fl, T.set.st, T.set.tx),
    mod(sX + clP, clT + 58, sW - 2 * clP, 26, 'Building Construction', T.set.fl, T.set.st, T.set.tx),
    mod(sX + clP, clT + 90, sW - 2 * clP, 26, 'Recruit / Transform', T.set.fl, T.set.st, T.set.tx),
    mod(sX + clP, clT + 122, sW - 2 * clP, 26, 'Settler Location', T.set.fl, T.set.st, T.set.tx),
    ital(sX + clP + 5, clT + 168, 'Recruit → Task → Navigate → Work', T.set.an),
    mod(sX + clP, clT + 180, sW - 2 * clP, 24, 'Settler Lifecycle', T.set.fl, T.set.st, T.set.tx),
].join('\n    ');

const wX = 675,
    wW = 250;
const worldC = [
    rect(wX, clT, wW, 225, T.wld.bg, T.wld.bd),
    txt(wX + wW / 2, clT + 16, 'WORLD', T.wld.ti, 11, true),
    modGrid(
        wX + clP,
        clT + 26,
        105,
        10,
        26,
        6,
        [
            ['Trees', 'Stones'],
            ['Crops', 'Ore Veins'],
        ],
        T.wld.fl,
        T.wld.st,
        T.wld.tx
    ),
    mod(wX + clP, clT + 96, wW - 2 * clP, 26, 'Territory', T.wld.fl, T.wld.st, T.wld.tx),
    ital(wX + clP + 5, clT + 140, 'Growth · Depletion · Influence', T.wld.an),
].join('\n    ');

const mX = 940,
    mW = 250;
const military = [
    rect(mX, clT, mW, 155, T.mil.bg, T.mil.bd),
    txt(mX + mW / 2, clT + 16, 'MILITARY', T.mil.ti, 11, true),
    modGrid(
        mX + clP,
        clT + 26,
        105,
        10,
        26,
        6,
        [
            ['Combat', 'Garrison'],
            ['Siege', 'Barracks'],
        ],
        T.mil.fl,
        T.mil.st,
        T.mil.tx
    ),
    mod(mX + clP, clT + 96, mW - 2 * clP, 26, 'Victory Conditions', T.mil.fl, T.mil.st, T.mil.tx),
].join('\n    ');

const aiY = clT + 165;
const aiC = [
    rect(mX, aiY, mW, 55, T.ai.bg, T.ai.bd),
    txt(mX + mW / 2, aiY + 17, 'AI PLAYER', T.ai.tx, 11, true),
    txt(mX + mW / 2, aiY + 34, 'Behavior Tree · Economy · Military', T.ai.sub, 9),
    ital(mX + mW / 2, aiY + 47, 'Issues commands like a human player', T.ai.an, 9, 'middle'),
].join('\n    ');

const layer4 = [
    `<rect x="${M}" y="${FY}" width="${CW}" height="270" rx="10" fill="${T.feat.bg}" stroke="${T.feat.bd}" stroke-width="1.5"/>`,
    txt(M + 20, FY + 17, 'LAYER 4 — DOMAIN FEATURES (23 modules)', T.feat.tx, 10, true, 'start'),
    economy,
    settlers,
    worldC,
    military,
    aiC,
].join('\n    ');

// Layer 3 — Core State
const stBY = Y.state + 25;
const layer3 = [
    band('state', 80, 'LAYER 3 — CORE STATE', T.st.bg, T.st.bd, T.st.lb),
    bigBox(
        110,
        stBY,
        520,
        45,
        'GameState',
        T.st.fl,
        T.st.st,
        T.st.tx,
        'Entity Store · Occupancy Maps · Spatial Index',
        T.st.sub
    ),
    bigBox(
        660,
        stBY,
        420,
        45,
        'EventBus',
        T.st.fl,
        T.st.st,
        T.st.tx,
        'entity:created · building:placed · unit:died · ...',
        T.st.sub
    ),
    bigBox(1110, stBY, 180, 45, 'Settings', T.st.fl, T.st.st, T.st.tx),
].join('\n    ');

// Layer 2 — Infrastructure
const infBY = Y.infra + 27;
const INF = ['Movement', 'Pathfinding', 'Placement', 'Spatial Search', 'Choreography', 'Coord System'];
const layer2 = [
    band('infra', 70, 'LAYER 2 — INFRASTRUCTURE (never imports features)', T.inf.bg, T.inf.bd, T.inf.lb),
    ...INF.map((l, i) => mod(110 + i * 190, infBY, 170, 32, l, T.inf.fl, T.inf.st, T.inf.tx)),
].join('\n    ');

// Layers 0-1 — Data
const datBY = Y.data + 27;
const DAT = [
    'A* Algorithm',
    'Seeded RNG',
    'Building Types',
    'Unit Types',
    'Materials',
    'Recipes',
    'Footprints',
    'Behavior Tree',
];
const layer01 = [
    band('data', 60, 'LAYERS 0–1 — PURE DATA &amp; ALGORITHMS', T.dat.bg, T.dat.bd, T.dat.lb),
    ...DAT.map((l, i) => mod(110 + i * 143, datBY, 130, 22, l, T.dat.fl, T.dat.st, T.dat.tx)),
].join('\n    ');

// ─── Arrows ────────────────────────────────────────────────────────
const clBot = clT + 225;
// Route lines through gaps between clusters to avoid overlapping content.
// Gap between Settlers (x=660) and World (x=675) → query line at x=668.
// Command arrow routed left of Economy cluster (x<100) to avoid crossing features.
const qryX = 668; // between Settlers right edge and World left edge
const cmdRouteX = 93; // left of Economy cluster (x=100), inside feat band (x=80)
const arrows = [
    // UI → Input
    ln(400, Y.ui + 57, 290, ioY - 2, T.arr.cmd, 'cmd'),
    // Input → Commands
    ln(290, ioY + 50, 530, orY - 2, T.arr.cmd, 'cmd'),
    txt(310, ioY + 64, 'execute(cmd)', T.label, 9, false, 'start'),
    // Commands → GameState (routed left of clusters to avoid crossing them)
    `<path d="M440,${orY + 50} L${cmdRouteX},${clT + 8} L${cmdRouteX},${stBY + 22} L${110},${stBY + 22}" fill="none" stroke="${T.arr.cmd}" stroke-width="1.5" marker-end="url(#cmd)"/>`,
    txt(cmdRouteX - 3, FY + 145, 'mutate state', T.label, 9, false, 'end'),

    // EventBus → Feature clusters (events fan out)
    ln(770, stBY, eX + eW / 2, clBot + 2, T.arr.evt, 'evt', true),
    ln(800, stBY, sX + sW / 2, clBot + 2, T.arr.evt, 'evt', true),
    ln(840, stBY, wX + wW / 2, clBot + 2, T.arr.evt, 'evt', true),
    ln(870, stBY, mX + mW / 2, clBot + 2, T.arr.evt, 'evt', true),
    // Label in gap between features band bottom (FY+270) and state band top (Y.state)
    txt(CW + M - 10, FY + 270 + 8, 'Events (pub/sub)', T.arr.evt, 9, true, 'end'),

    // Renderer queries GameState (routed through gap between Settlers and World clusters)
    `<line x1="${qryX}" y1="${ioY + 50}" x2="${qryX}" y2="${stBY}" stroke="${T.arr.qry}" stroke-width="1.5" stroke-dasharray="4 4" marker-start="url(#qry)"/>`,
    txt(qryX + 8, ioY + 64, 'queries via RenderContext', T.arr.qry, 9, false, 'start'),

    // AI → Commands
    `<path d="M${mX},${aiY + 27} Q${mX - 140},${aiY + 27} ${600},${orY + 50}" fill="none" stroke="${T.arr.ai}" stroke-width="1.5" stroke-dasharray="5 3" marker-end="url(#ai)"/>`,
    txt(mX + mW + 8, aiY + 30, 'execute(cmd)', T.arr.ai, 9, false, 'start'),

    `<path d="M1325,${orY} L1340,${orY} L1340,${Y.infra + 70} L1325,${Y.infra + 70}" fill="none" stroke="${T.arr.loop}" stroke-width="1.5"/>`,
    ln(1325, FY + 135, 1200, FY + 135, T.arr.loop, 'lp', true, 1),
    ln(1325, stBY + 22, 1295, stBY + 22, T.arr.loop, 'lp', true, 1),
    ln(1325, infBY + 16, 1240, infBY + 16, T.arr.loop, 'lp', true, 1),
    `<text x="1348" y="${(orY + Y.infra + 70) / 2}" text-anchor="middle" font-family="sans-serif" font-size="10" font-weight="bold" fill="${T.arr.loop}" transform="rotate(90, 1348, ${(orY + Y.infra + 70) / 2})">GameLoop ticks all systems (30 Hz)</text>`,
].join('\n    ');

// ─── Legend ─────────────────────────────────────────────────────────
const LY = Y.legend;
const legend = [
    `<rect x="${M}" y="${LY}" width="${CW}" height="55" rx="8" fill="${T.legend.bg}" stroke="${T.legend.bd}" stroke-width="1"/>`,
    txt(M + 20, LY + 16, 'Legend', T.legend.tx, 11, true, 'start'),
    ln(M + 20, LY + 33, M + 60, LY + 33, T.arr.cmd, 'cmd'),
    txt(M + 70, LY + 37, 'Direct call', T.legend.item, 10, false, 'start'),
    ln(M + 210, LY + 33, M + 250, LY + 33, T.arr.evt, 'evt', true),
    txt(M + 260, LY + 37, 'Event reaction', T.legend.item, 10, false, 'start'),
    ln(M + 420, LY + 33, M + 460, LY + 33, T.arr.qry, 'qry', true, 1.5),
    txt(M + 470, LY + 37, 'Read-only query', T.legend.item, 10, false, 'start'),
    `<rect x="${M + 640}" y="${LY + 26}" width="12" height="12" rx="2" fill="${T.eco.fl}" stroke="${T.eco.st}" stroke-width="1"/>`,
    txt(M + 658, LY + 37, 'Economy', T.legend.item, 9, false, 'start'),
    `<rect x="${M + 720}" y="${LY + 26}" width="12" height="12" rx="2" fill="${T.set.fl}" stroke="${T.set.st}" stroke-width="1"/>`,
    txt(M + 738, LY + 37, 'Settlers', T.legend.item, 9, false, 'start'),
    `<rect x="${M + 800}" y="${LY + 26}" width="12" height="12" rx="2" fill="${T.wld.fl}" stroke="${T.wld.st}" stroke-width="1"/>`,
    txt(M + 818, LY + 37, 'World', T.legend.item, 9, false, 'start'),
    `<rect x="${M + 870}" y="${LY + 26}" width="12" height="12" rx="2" fill="${T.mil.fl}" stroke="${T.mil.st}" stroke-width="1"/>`,
    txt(M + 888, LY + 37, 'Military', T.legend.item, 9, false, 'start'),
    `<rect x="${M + 950}" y="${LY + 26}" width="12" height="12" rx="2" fill="${T.ui.fl}" stroke="${T.ai.bd}" stroke-width="1"/>`,
    txt(M + 968, LY + 37, 'AI', T.legend.item, 9, false, 'start'),
    txt(
        M + 20,
        LY + 50,
        'Infra never imports features. Features communicate via EventBus. Deterministic: seeded RNG, fixed-point math.',
        T.muted,
        9,
        false,
        'start'
    ),
].join('\n    ');

// ─── Assemble ──────────────────────────────────────────────────────
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
  <defs>${defs}</defs>
  <rect width="${W}" height="${H}" fill="${T.canvas}"/>
  ${titleSvg}
  <g id="layer-7">${layer7}</g>
  <g id="layer-6">${layer6}</g>
  <g id="layer-5">${layer5}</g>
  <g id="layer-4">${layer4}</g>
  <g id="layer-3">${layer3}</g>
  <g id="layer-2">${layer2}</g>
  <g id="layer-01">${layer01}</g>
  <g id="arrows">${arrows}</g>
  <g id="legend">${legend}</g>
</svg>`;

writeFileSync(OUTPUT, svg);
const issues = validate(svg);
if (issues > 0) {
    console.error(`[${styleName}] → ${OUTPUT}  (${issues} collision${issues > 1 ? 's' : ''} detected!)`);
    process.exit(1);
} else {
    console.log(`[${styleName}] → ${OUTPUT}  (0 collisions)`);
}
