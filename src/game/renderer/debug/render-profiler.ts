/**
 * RenderProfiler - Per-frame rendering performance metrics.
 *
 * Designed for minimal overhead when disabled, detailed insights when enabled.
 * All timing uses performance.now() for microsecond precision.
 *
 * Usage:
 *   RenderProfiler.setLevel('detailed');
 *   profiler.beginFrame();
 *   profiler.beginPhase('cull');
 *   // ... culling logic
 *   profiler.endPhase('cull');
 *   profiler.endFrame();
 *
 * Logging levels:
 *   - 'none': No logging, minimal overhead
 *   - 'summary': FPS, total frame time, draw calls (every N frames)
 *   - 'detailed': Per-phase timing breakdown
 *   - 'trace': Per-entity decisions (dev only, high overhead)
 */

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type LogLevel = 'none' | 'summary' | 'detailed' | 'trace';

/**
 * Metrics for a single frame.
 */
export interface FrameMetrics {
    // Timing (microseconds)
    frameTimeUs: number;
    cullTimeUs: number;
    sortTimeUs: number;
    drawTimeUs: number;

    // Draw call analysis
    drawCallCount: number;
    triangleCount: number;
    batchFlushCount: number;

    // Entity breakdown
    totalEntities: number;
    visibleEntities: number;
    culledEntities: number;
    transitioningUnits: number;

    // Memory (bytes, approximate)
    positionCacheSize: number;
}

/**
 * Rolling statistics over multiple frames.
 */
export interface RollingStats {
    avgFrameTimeUs: number;
    minFrameTimeUs: number;
    maxFrameTimeUs: number;
    avgFps: number;
    avgCullTimeUs: number;
    avgSortTimeUs: number;
    avgDrawTimeUs: number;
    avgDrawCalls: number;
    avgVisibleEntities: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

/** How many frames to average for rolling stats */
const ROLLING_WINDOW = 60;

/** How often to log summary (in frames) */
const SUMMARY_LOG_INTERVAL = 60;

/** LocalStorage key for log level */
const LOG_LEVEL_KEY = 'debug.render.level';

// ═══════════════════════════════════════════════════════════════════════════
// IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Render profiler singleton.
 * Access via RenderProfiler.instance or the exported `profiler` constant.
 */
export class RenderProfiler {
    private static _instance: RenderProfiler | null = null;

    public static get instance(): RenderProfiler {
        if (!RenderProfiler._instance) {
            RenderProfiler._instance = new RenderProfiler();
        }
        return RenderProfiler._instance;
    }

    // Current log level
    private level: LogLevel = 'none';

    // Current frame state
    private frameStart = 0;
    private phaseStarts: Map<string, number> = new Map();
    private currentMetrics: FrameMetrics = this.createEmptyMetrics();

    // Rolling history for statistics
    private frameHistory: FrameMetrics[] = [];
    private frameCount = 0;

    // Trace logging buffer (to avoid console spam)
    private traceBuffer: string[] = [];

    private constructor() {
        // Load saved log level
        if (typeof localStorage !== 'undefined') {
            const saved = localStorage.getItem(LOG_LEVEL_KEY);
            if (saved && this.isValidLevel(saved)) {
                this.level = saved as LogLevel;
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PUBLIC API
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Set the logging level.
     */
    public setLevel(level: LogLevel): void {
        this.level = level;
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(LOG_LEVEL_KEY, level);
        }
    }

    /**
     * Get the current logging level.
     */
    public getLevel(): LogLevel {
        return this.level;
    }

    /**
     * Check if profiling is enabled (any level above 'none').
     */
    public get enabled(): boolean {
        return this.level !== 'none';
    }

    /**
     * Begin a new frame. Call at the start of draw().
     */
    public beginFrame(): void {
        if (this.level === 'none') return;

        this.frameStart = performance.now();
        this.currentMetrics = this.createEmptyMetrics();
        this.phaseStarts.clear();
        this.traceBuffer.length = 0;
    }

    /**
     * End the current frame. Call at the end of draw().
     */
    public endFrame(): void {
        if (this.level === 'none') return;

        this.currentMetrics.frameTimeUs = (performance.now() - this.frameStart) * 1000;

        // Add to history
        this.frameHistory.push({ ...this.currentMetrics });
        if (this.frameHistory.length > ROLLING_WINDOW) {
            this.frameHistory.shift();
        }

        this.frameCount++;

        // Log based on level
        if (this.level === 'summary' && this.frameCount % SUMMARY_LOG_INTERVAL === 0) {
            this.logSummary();
        } else if (this.level === 'detailed') {
            this.logDetailed();
        } else if (this.level === 'trace') {
            this.logTrace();
        }
    }

    /**
     * Begin timing a named phase.
     */
    public beginPhase(name: string): void {
        if (this.level === 'none') return;
        this.phaseStarts.set(name, performance.now());
    }

    /**
     * End timing a named phase.
     */
    public endPhase(name: string): void {
        if (this.level === 'none') return;

        const start = this.phaseStarts.get(name);
        if (start === undefined) return;

        const durationUs = (performance.now() - start) * 1000;

        // Map phase names to metrics
        switch (name) {
        case 'cull':
            this.currentMetrics.cullTimeUs = durationUs;
            break;
        case 'sort':
            this.currentMetrics.sortTimeUs = durationUs;
            break;
        case 'draw':
            this.currentMetrics.drawTimeUs = durationUs;
            break;
        }
    }

    /**
     * Record entity counts.
     */
    public recordEntities(total: number, visible: number, culled: number): void {
        if (this.level === 'none') return;

        this.currentMetrics.totalEntities = total;
        this.currentMetrics.visibleEntities = visible;
        this.currentMetrics.culledEntities = culled;
    }

    /**
     * Record a draw call.
     */
    public recordDrawCall(triangles: number): void {
        if (this.level === 'none') return;

        this.currentMetrics.drawCallCount++;
        this.currentMetrics.triangleCount += triangles;
    }

    /**
     * Record a batch flush.
     */
    public recordBatchFlush(spriteCount: number): void {
        if (this.level === 'none') return;

        this.currentMetrics.batchFlushCount++;
        this.trace(`batch flush: ${spriteCount} sprites`);
    }

    /**
     * Record transitioning units count.
     */
    public recordTransitioningUnits(count: number): void {
        if (this.level === 'none') return;
        this.currentMetrics.transitioningUnits = count;
    }

    /**
     * Record position cache size.
     */
    public recordCacheSize(size: number): void {
        if (this.level === 'none') return;
        this.currentMetrics.positionCacheSize = size;
    }

    /**
     * Add a trace message (only logged in trace mode).
     */
    public trace(message: string): void {
        if (this.level !== 'trace') return;
        this.traceBuffer.push(message);
    }

    /**
     * Get current frame metrics (for debug panel integration).
     */
    public getCurrentMetrics(): FrameMetrics {
        return { ...this.currentMetrics };
    }

    /**
     * Get rolling statistics.
     */
    public getRollingStats(): RollingStats {
        if (this.frameHistory.length === 0) {
            return this.createEmptyStats();
        }

        const count = this.frameHistory.length;
        let totalFrameTime = 0;
        let minFrameTime = Infinity;
        let maxFrameTime = 0;
        let totalCull = 0;
        let totalSort = 0;
        let totalDraw = 0;
        let totalDrawCalls = 0;
        let totalVisible = 0;

        for (const m of this.frameHistory) {
            totalFrameTime += m.frameTimeUs;
            minFrameTime = Math.min(minFrameTime, m.frameTimeUs);
            maxFrameTime = Math.max(maxFrameTime, m.frameTimeUs);
            totalCull += m.cullTimeUs;
            totalSort += m.sortTimeUs;
            totalDraw += m.drawTimeUs;
            totalDrawCalls += m.drawCallCount;
            totalVisible += m.visibleEntities;
        }

        const avgFrameTimeUs = totalFrameTime / count;

        return {
            avgFrameTimeUs,
            minFrameTimeUs: minFrameTime === Infinity ? 0 : minFrameTime,
            maxFrameTimeUs: maxFrameTime,
            avgFps: avgFrameTimeUs > 0 ? 1_000_000 / avgFrameTimeUs : 0,
            avgCullTimeUs: totalCull / count,
            avgSortTimeUs: totalSort / count,
            avgDrawTimeUs: totalDraw / count,
            avgDrawCalls: totalDrawCalls / count,
            avgVisibleEntities: totalVisible / count,
        };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PRIVATE HELPERS
    // ═══════════════════════════════════════════════════════════════════════

    private createEmptyMetrics(): FrameMetrics {
        return {
            frameTimeUs: 0,
            cullTimeUs: 0,
            sortTimeUs: 0,
            drawTimeUs: 0,
            drawCallCount: 0,
            triangleCount: 0,
            batchFlushCount: 0,
            totalEntities: 0,
            visibleEntities: 0,
            culledEntities: 0,
            transitioningUnits: 0,
            positionCacheSize: 0,
        };
    }

    private createEmptyStats(): RollingStats {
        return {
            avgFrameTimeUs: 0,
            minFrameTimeUs: 0,
            maxFrameTimeUs: 0,
            avgFps: 0,
            avgCullTimeUs: 0,
            avgSortTimeUs: 0,
            avgDrawTimeUs: 0,
            avgDrawCalls: 0,
            avgVisibleEntities: 0,
        };
    }

    private isValidLevel(s: string): s is LogLevel {
        return s === 'none' || s === 'summary' || s === 'detailed' || s === 'trace';
    }

    private logSummary(): void {
        const stats = this.getRollingStats();
        const budget = stats.avgFrameTimeUs / 16666.67 * 100; // % of 60fps budget
        console.log(
            `[RENDER] ${stats.avgFps.toFixed(1)} FPS | ` +
            `${(stats.avgFrameTimeUs / 1000).toFixed(2)}ms (${budget.toFixed(0)}% budget) | ` +
            `${stats.avgDrawCalls.toFixed(0)} draws | ` +
            `${stats.avgVisibleEntities.toFixed(0)} entities`
        );
    }

    private logDetailed(): void {
        const m = this.currentMetrics;
        console.log(
            `[RENDER] frame: ${(m.frameTimeUs / 1000).toFixed(2)}ms | ` +
            `cull: ${(m.cullTimeUs / 1000).toFixed(2)}ms | ` +
            `sort: ${(m.sortTimeUs / 1000).toFixed(2)}ms | ` +
            `draw: ${(m.drawTimeUs / 1000).toFixed(2)}ms | ` +
            `${m.visibleEntities}/${m.totalEntities} entities | ` +
            `${m.drawCallCount} draws | ` +
            `${m.batchFlushCount} flushes`
        );
    }

    private logTrace(): void {
        this.logDetailed();
        if (this.traceBuffer.length > 0) {
            console.log(`[RENDER TRACE] ${this.traceBuffer.join(' | ')}`);
        }
    }
}

// Export singleton instance for convenience
export const profiler = RenderProfiler.instance;
