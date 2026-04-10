<template>
    <div class="stats-chart">
        <div class="stats-chart-title">{{ title }}</div>
        <svg ref="svgRef" :width="width" :height="height" />
    </div>
</template>

<script setup lang="ts">
import { onMounted, useTemplateRef } from 'vue';
import * as d3 from 'd3';
import type { PlayerTimeSeries } from '@/game/state/game-mode-stats-tracker';
import { TICK_RATE } from '@/game/core/tick-rate';

const PLAYER_COLORS = ['#4a9aca', '#c06060', '#60c060', '#c0a040', '#a060c0', '#c08040', '#60c0c0', '#c060a0'];

const props = defineProps<{
    title: string;
    series: PlayerTimeSeries[];
    width?: number;
    height?: number;
}>();

// eslint-disable-next-line no-restricted-syntax -- optional props with intentional defaults
const width = props.width ?? 420;
// eslint-disable-next-line no-restricted-syntax -- optional props with intentional defaults
const height = props.height ?? 160;

const svgRef = useTemplateRef<SVGSVGElement>('svgRef');

function tickToMinutes(tick: number): number {
    return tick / TICK_RATE / 60;
}

onMounted(() => {
    const svg = d3.select(svgRef.value!);
    const margin = { top: 8, right: 12, bottom: 24, left: 36 };
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    if (props.series.length === 0 || props.series[0]!.data.length === 0) {
        g.append('text')
            .attr('x', w / 2)
            .attr('y', h / 2)
            .attr('text-anchor', 'middle')
            .attr('fill', '#6a5030')
            .attr('font-size', '12px')
            .text('No data');
        return;
    }

    // Compute scales
    const allData = props.series.flatMap(s => s.data);
    const xMax = d3.max(allData, d => tickToMinutes(d.tick))!;
    const yMax = d3.max(allData, d => d.count)!;

    const x = d3.scaleLinear().domain([0, xMax]).range([0, w]);
    const y = d3
        .scaleLinear()
        .domain([0, yMax * 1.1])
        .range([h, 0])
        .nice();

    // Axes
    const xAxis = d3
        .axisBottom(x)
        .ticks(5)
        .tickFormat(d => `${Math.round(d as number)}m`);
    const yAxis = d3.axisLeft(y).ticks(4);

    g.append('g')
        .attr('transform', `translate(0,${h})`)
        .call(xAxis)
        .selectAll('text,line,path')
        .attr('stroke', '#4a3218')
        .attr('fill', '#6a5030')
        .attr('font-size', '9px');

    g.append('g')
        .call(yAxis)
        .selectAll('text,line,path')
        .attr('stroke', '#4a3218')
        .attr('fill', '#6a5030')
        .attr('font-size', '9px');

    // Grid lines
    g.append('g')
        .attr('class', 'grid')
        .selectAll('line')
        .data(y.ticks(4))
        .join('line')
        .attr('x1', 0)
        .attr('x2', w)
        .attr('y1', d => y(d))
        .attr('y2', d => y(d))
        .attr('stroke', '#2a1e0e')
        .attr('stroke-dasharray', '2,3');

    // Lines
    const line = d3
        .line<{ tick: number; count: number }>()
        .x(d => x(tickToMinutes(d.tick)))
        .y(d => y(d.count))
        .curve(d3.curveMonotoneX);

    for (const s of props.series) {
        const color = PLAYER_COLORS[s.player % PLAYER_COLORS.length]!;
        g.append('path')
            .datum(s.data)
            .attr('fill', 'none')
            .attr('stroke', color)
            .attr('stroke-width', 1.5)
            .attr('d', line);
    }

    // Legend
    const legend = g.append('g').attr('transform', `translate(${w - 60}, 0)`);
    for (let i = 0; i < props.series.length; i++) {
        const s = props.series[i]!;
        const color = PLAYER_COLORS[s.player % PLAYER_COLORS.length]!;
        const ly = i * 14;
        legend
            .append('line')
            .attr('x1', 0)
            .attr('x2', 12)
            .attr('y1', ly + 5)
            .attr('y2', ly + 5)
            .attr('stroke', color)
            .attr('stroke-width', 2);
        legend
            .append('text')
            .attr('x', 16)
            .attr('y', ly + 9)
            .attr('fill', '#8a7040')
            .attr('font-size', '9px')
            .text(`P${s.player + 1}`);
    }
});
</script>

<style scoped>
.stats-chart {
    background: #0d0a05;
    border: 1px solid #3a2810;
    border-radius: 4px;
    padding: 8px;
}

.stats-chart-title {
    font-size: 11px;
    font-weight: 600;
    color: #8a7040;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
    text-align: center;
}
</style>
