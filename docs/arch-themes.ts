/** Color themes for the architecture diagram generator. */

// Each layer/cluster palette follows the same shape:
//   bg=band background, bd=border, fl=box fill, st=box stroke, tx=text, lb=label, sub=subtitle, ti=title, an=annotation

export interface Theme {
    canvas: string;
    title: string;
    subtitle: string;
    label: string;
    muted: string;
    feat: { bg: string; bd: string; tx: string };
    legend: { bg: string; bd: string; tx: string; item: string };
    luaTx: string;
    ui: { bg: string; bd: string; fl: string; st: string; tx: string; lb: string };
    io: { bg: string; bd: string; fl: string; st: string; tx: string; sub: string; lb: string };
    orch: { bg: string; bd: string; fl: string; st: string; tx: string; sub: string; lb: string };
    eco: { bg: string; bd: string; fl: string; st: string; tx: string; ti: string; an: string };
    set: { bg: string; bd: string; fl: string; st: string; tx: string; ti: string; an: string };
    wld: { bg: string; bd: string; fl: string; st: string; tx: string; ti: string; an: string };
    mil: { bg: string; bd: string; fl: string; st: string; tx: string; ti: string };
    ai: { bg: string; bd: string; tx: string; sub: string; an: string };
    st: { bg: string; bd: string; fl: string; st: string; tx: string; sub: string; lb: string };
    inf: { bg: string; bd: string; fl: string; st: string; tx: string; lb: string };
    dat: { bg: string; bd: string; fl: string; st: string; tx: string; lb: string };
    arr: { cmd: string; evt: string; qry: string; loop: string; ai: string };
}

// ─── Flat: solid fills, no gradients, clean modern ──────────────────
export const flat: Theme = {
    canvas: '#f7fafc',
    title: '#1a202c',
    subtitle: '#718096',
    label: '#718096',
    muted: '#a0aec0',
    feat: { bg: '#fefefe', bd: '#cbd5e0', tx: '#4a5568' },
    legend: { bg: '#ffffff', bd: '#e2e8f0', tx: '#2d3748', item: '#4a5568' },
    luaTx: '#4a5568',
    ui: { bg: '#faf5ff', bd: '#d6bcfa', fl: '#e9d8fd', st: '#b794f4', tx: '#553c9a', lb: '#9f7aea' },
    io: { bg: '#ebf8ff', bd: '#90cdf4', fl: '#bee3f8', st: '#63b3ed', tx: '#2a4365', sub: '#4a5568', lb: '#3182ce' },
    orch: { bg: '#eff6ff', bd: '#a3bffa', fl: '#c3dafe', st: '#7f9cf5', tx: '#3c366b', sub: '#4a5568', lb: '#5a67d8' },
    eco: { bg: '#f0fff4', bd: '#9ae6b4', fl: '#c6f6d5', st: '#68d391', tx: '#22543d', ti: '#276749', an: '#68d391' },
    set: { bg: '#ebf4ff', bd: '#90cdf4', fl: '#bee3f8', st: '#63b3ed', tx: '#2a4365', ti: '#2a4365', an: '#63b3ed' },
    wld: { bg: '#fffff0', bd: '#ecc94b', fl: '#fefcbf', st: '#ecc94b', tx: '#744210', ti: '#744210', an: '#d69e2e' },
    mil: { bg: '#fff5f5', bd: '#fc8181', fl: '#fed7d7', st: '#fc8181', tx: '#9b2c2c', ti: '#9b2c2c' },
    ai: { bg: '#faf5ff', bd: '#d6bcfa', tx: '#6b46c1', sub: '#9f7aea', an: '#b794f4' },
    st: { bg: '#fefce8', bd: '#fbd38d', fl: '#fef3c7', st: '#f6ad55', tx: '#744210', sub: '#975a16', lb: '#975a16' },
    inf: { bg: '#f7fafc', bd: '#cbd5e0', fl: '#e2e8f0', st: '#a0aec0', tx: '#2d3748', lb: '#4a5568' },
    dat: { bg: '#f7fafc', bd: '#e2e8f0', fl: '#edf2f7', st: '#cbd5e0', tx: '#4a5568', lb: '#718096' },
    arr: { cmd: '#4a5568', evt: '#d69e2e', qry: '#3182ce', loop: '#805ad5', ai: '#9f7aea' },
};

// ─── Line: stroke-only, no fills, technical/editorial ───────────────
export const line: Theme = {
    canvas: '#ffffff',
    title: '#1a202c',
    subtitle: '#6b7280',
    label: '#6b7280',
    muted: '#9ca3af',
    feat: { bg: 'none', bd: '#9ca3af', tx: '#4b5563' },
    legend: { bg: 'none', bd: '#d1d5db', tx: '#1f2937', item: '#4b5563' },
    luaTx: '#6b7280',
    ui: { bg: 'none', bd: '#b794f4', fl: 'none', st: '#b794f4', tx: '#553c9a', lb: '#9f7aea' },
    io: { bg: 'none', bd: '#63b3ed', fl: 'none', st: '#63b3ed', tx: '#2a4365', sub: '#4a5568', lb: '#3182ce' },
    orch: { bg: 'none', bd: '#7f9cf5', fl: 'none', st: '#7f9cf5', tx: '#3c366b', sub: '#4a5568', lb: '#5a67d8' },
    eco: { bg: 'none', bd: '#68d391', fl: 'none', st: '#9ae6b4', tx: '#276749', ti: '#276749', an: '#68d391' },
    set: { bg: 'none', bd: '#63b3ed', fl: 'none', st: '#90cdf4', tx: '#2a4365', ti: '#2a4365', an: '#63b3ed' },
    wld: { bg: 'none', bd: '#ecc94b', fl: 'none', st: '#f6e05e', tx: '#744210', ti: '#744210', an: '#d69e2e' },
    mil: { bg: 'none', bd: '#fc8181', fl: 'none', st: '#feb2b2', tx: '#9b2c2c', ti: '#9b2c2c' },
    ai: { bg: 'none', bd: '#d6bcfa', tx: '#6b46c1', sub: '#9f7aea', an: '#b794f4' },
    st: { bg: 'none', bd: '#f6ad55', fl: 'none', st: '#f6ad55', tx: '#744210', sub: '#975a16', lb: '#975a16' },
    inf: { bg: 'none', bd: '#a0aec0', fl: 'none', st: '#a0aec0', tx: '#2d3748', lb: '#4a5568' },
    dat: { bg: 'none', bd: '#cbd5e0', fl: 'none', st: '#cbd5e0', tx: '#4a5568', lb: '#718096' },
    arr: { cmd: '#2d3748', evt: '#d69e2e', qry: '#3182ce', loop: '#805ad5', ai: '#9f7aea' },
};

// ─── Mono: single blue color family, elegant & printable ───────────
const B = { d: '#1a365d', m: '#2a4365', b: '#2b6cb0', l: '#4299e1', xl: '#63b3ed', xxl: '#bee3f8', bg: '#ebf8ff' };
export const mono: Theme = {
    canvas: '#ffffff',
    title: '#1a365d',
    subtitle: '#4a5568',
    label: '#4a5568',
    muted: '#a0aec0',
    feat: { bg: '#f7fafc', bd: '#a0aec0', tx: '#2d3748' },
    legend: { bg: '#ffffff', bd: '#e2e8f0', tx: '#1a365d', item: '#2d3748' },
    luaTx: B.xxl,
    ui: { bg: B.d, bd: B.d, fl: B.m, st: B.m, tx: B.xxl, lb: '#ffffff' },
    io: { bg: B.m, bd: B.m, fl: B.b, st: B.b, tx: '#ffffff', sub: B.xxl, lb: B.xxl },
    orch: { bg: B.b, bd: B.b, fl: B.l, st: B.l, tx: '#ffffff', sub: B.xxl, lb: '#ffffff' },
    eco: { bg: B.bg, bd: B.l, fl: B.xxl, st: B.xl, tx: B.d, ti: B.d, an: B.l },
    set: { bg: B.bg, bd: B.l, fl: '#90cdf4', st: B.xl, tx: B.d, ti: B.d, an: B.xl },
    wld: { bg: B.bg, bd: B.l, fl: B.xl, st: B.l, tx: '#ffffff', ti: B.d, an: B.l },
    mil: { bg: B.bg, bd: B.l, fl: B.l, st: B.b, tx: '#ffffff', ti: B.d },
    ai: { bg: B.bg, bd: B.xl, tx: B.d, sub: B.b, an: B.l },
    st: { bg: '#edf2f7', bd: '#a0aec0', fl: '#e2e8f0', st: '#a0aec0', tx: B.d, sub: '#4a5568', lb: '#4a5568' },
    inf: { bg: '#f7fafc', bd: '#cbd5e0', fl: '#edf2f7', st: '#cbd5e0', tx: '#2d3748', lb: '#4a5568' },
    dat: { bg: '#f7fafc', bd: '#e2e8f0', fl: '#f7fafc', st: '#e2e8f0', tx: '#4a5568', lb: '#718096' },
    arr: { cmd: B.d, evt: B.l, qry: B.b, loop: B.xl, ai: B.l },
};

// ─── Dark: dark backgrounds, light text, vibrant accents ────────────
export const dark: Theme = {
    canvas: '#0f172a',
    title: '#e2e8f0',
    subtitle: '#94a3b8',
    label: '#94a3b8',
    muted: '#64748b',
    feat: { bg: '#1e293b', bd: '#475569', tx: '#94a3b8' },
    legend: { bg: '#1e293b', bd: '#334155', tx: '#e2e8f0', item: '#cbd5e1' },
    luaTx: '#94a3b8',
    ui: { bg: '#2d1f54', bd: '#7c3aed', fl: '#3b2670', st: '#8b5cf6', tx: '#ddd6fe', lb: '#c4b5fd' },
    io: { bg: '#172554', bd: '#3b82f6', fl: '#1e3a5f', st: '#60a5fa', tx: '#bfdbfe', sub: '#93c5fd', lb: '#60a5fa' },
    orch: { bg: '#1e1b4b', bd: '#6366f1', fl: '#272463', st: '#818cf8', tx: '#c7d2fe', sub: '#a5b4fc', lb: '#818cf8' },
    eco: { bg: '#052e16', bd: '#22c55e', fl: '#14532d', st: '#4ade80', tx: '#bbf7d0', ti: '#86efac', an: '#4ade80' },
    set: { bg: '#172554', bd: '#3b82f6', fl: '#1e3a5f', st: '#60a5fa', tx: '#bfdbfe', ti: '#93c5fd', an: '#60a5fa' },
    wld: { bg: '#422006', bd: '#f59e0b', fl: '#78350f', st: '#fbbf24', tx: '#fef3c7', ti: '#fcd34d', an: '#f59e0b' },
    mil: { bg: '#450a0a', bd: '#ef4444', fl: '#7f1d1d', st: '#f87171', tx: '#fecaca', ti: '#fca5a5' },
    ai: { bg: '#2d1f54', bd: '#a78bfa', tx: '#ddd6fe', sub: '#c4b5fd', an: '#a78bfa' },
    st: { bg: '#292524', bd: '#f59e0b', fl: '#3f3a36', st: '#fbbf24', tx: '#fef3c7', sub: '#fcd34d', lb: '#fbbf24' },
    inf: { bg: '#1e293b', bd: '#475569', fl: '#334155', st: '#64748b', tx: '#e2e8f0', lb: '#94a3b8' },
    dat: { bg: '#1e293b', bd: '#334155', fl: '#1e293b', st: '#475569', tx: '#cbd5e1', lb: '#94a3b8' },
    arr: { cmd: '#94a3b8', evt: '#fbbf24', qry: '#60a5fa', loop: '#a78bfa', ai: '#c4b5fd' },
};

export const themes = { flat, line, mono, dark } satisfies Record<string, Theme>;
