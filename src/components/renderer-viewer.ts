import { Game } from '@/game/game';
import { LandscapeRenderer } from '@/game/renderer/landscape/landscape-renderer';
import { EntityRenderer } from '@/game/renderer/entity-renderer';
import { Renderer } from '@/game/renderer/renderer';
import { TilePicker } from '@/game/input/tile-picker';
import { EntityType, BuildingType } from '@/game/entity';
import { canPlaceBuildingWithTerritory } from '@/game/systems/placement';

import { Options, Vue } from 'vue-class-component';

const DRAG_THRESHOLD = 5; // pixels before drag-box activates

/** Formation offsets for group move: center, then ring 1, then ring 2 */
const FORMATION_OFFSETS: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [1, 0], [0, 1], [-1, 0], [0, -1],
    [1, 1], [-1, 1], [1, -1], [-1, -1],
    [2, 0], [0, 2], [-2, 0], [0, -2],
    [2, 1], [1, 2], [-1, 2], [-2, 1],
    [-2, -1], [-1, -2], [1, -2], [2, -1],
    [2, 2], [-2, 2], [2, -2], [-2, -2]
];

@Options({
    name: 'RendererViewer',
    components: {
    },
    props: {
        game: Object,
        debugGrid: Boolean
    },
    emits: ['tileClick']
})
export default class RendererViewer extends Vue {
    public renderer: Renderer | null = null;
    public game!: Game;
    protected debugGrid!: boolean;

    private tilePicker: TilePicker | null = null;
    private entityRenderer: EntityRenderer | null = null;

    // Drag-box selection state
    private dragStart: { x: number; y: number } | null = null;
    private isDragging = false;

    public async mounted(): Promise<void> {
        const cav = this.$refs.cav as HTMLCanvasElement;
        this.renderer = new Renderer(cav);
        this.tilePicker = new TilePicker(cav);

        this.initRenderer();

        this.$watch('game', () => {
            this.initRenderer();
        });

        // Set up input handlers
        cav.addEventListener('mousedown', this.handleMouseDown);
        cav.addEventListener('mouseup', this.handleMouseUp);
        cav.addEventListener('contextmenu', this.handleRightClick);
        cav.addEventListener('mousemove', this.handleMouseMove);
    }

    private initRenderer() {
        if ((this.game == null) || (this.renderer == null)) {
            return;
        }

        this.renderer.add(
            new LandscapeRenderer(
                this.game.fileManager,
                this.renderer.textureManager,
                this.game.mapSize,
                this.game.groundType,
                this.game.groundHeight,
                this.debugGrid
            )
        );

        // Add entity renderer
        this.entityRenderer = new EntityRenderer(
            this.game.mapSize,
            this.game.groundHeight
        );
        this.renderer.add(this.entityRenderer);

        void this.renderer.init();

        // Start game loop with render callback
        const renderer = this.renderer;
        this.game.gameLoop.setRenderCallback(() => {
            if (this.entityRenderer && this.game) {
                this.entityRenderer.entities = this.game.state.entities;
                this.entityRenderer.selectedEntityId = this.game.state.selectedEntityId;
                this.entityRenderer.selectedEntityIds = this.game.state.selectedEntityIds;
                this.entityRenderer.unitStates = this.game.state.unitStates;
                this.entityRenderer.territoryMap = this.game.territory;
                this.entityRenderer.territoryVersion = this.game.territoryVersion;
            }
            renderer.drawOnce();
        });
        this.game.start();
    }

    private handleMouseDown = (e: MouseEvent) => {
        if (e.button !== 0) return; // left button only
        this.dragStart = { x: e.offsetX, y: e.offsetY };
        this.isDragging = false;
    }

    private handleMouseUp = (e: MouseEvent) => {
        if (e.button !== 0 || !this.dragStart) return;

        const dx = e.offsetX - this.dragStart.x;
        const dy = e.offsetY - this.dragStart.y;
        const wasDrag = Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD;

        if (wasDrag && this.game?.mode === 'select') {
            this.handleDragSelect(this.dragStart.x, this.dragStart.y, e.offsetX, e.offsetY);
        } else {
            this.handleClick(e);
        }

        this.dragStart = null;
        this.isDragging = false;
    }

    private handleDragSelect(x1: number, y1: number, x2: number, y2: number): void {
        if (!this.game || !this.tilePicker || !this.renderer) return;

        const tile1 = this.tilePicker.screenToTile(
            x1, y1,
            this.renderer.viewPoint,
            this.game.mapSize,
            this.game.groundHeight
        );
        const tile2 = this.tilePicker.screenToTile(
            x2, y2,
            this.renderer.viewPoint,
            this.game.mapSize,
            this.game.groundHeight
        );

        if (!tile1 || !tile2) return;

        this.game.execute({
            type: 'select_area',
            x1: tile1.x,
            y1: tile1.y,
            x2: tile2.x,
            y2: tile2.y
        });
    }

    private handleClick = (e: MouseEvent) => {
        if (!this.game || !this.tilePicker || !this.renderer) return;

        const tile = this.tilePicker.screenToTile(
            e.offsetX, e.offsetY,
            this.renderer.viewPoint,
            this.game.mapSize,
            this.game.groundHeight
        );

        if (!tile) return;

        // Emit tile coordinate for info display
        this.$emit('tileClick', tile);

        if (this.game.mode === 'place_building') {
            this.game.execute({
                type: 'place_building',
                buildingType: this.game.placeBuildingType as BuildingType,
                x: tile.x,
                y: tile.y,
                player: this.game.currentPlayer
            });
        } else if (this.game.mode === 'select') {
            // Try to select entity at tile
            const entity = this.game.state.getEntityAt(tile.x, tile.y);
            this.game.execute({
                type: 'select',
                entityId: entity ? entity.id : null
            });
        }
    }

    private handleRightClick = (e: MouseEvent) => {
        e.preventDefault();
        if (!this.game || !this.tilePicker || !this.renderer) return;

        const tile = this.tilePicker.screenToTile(
            e.offsetX, e.offsetY,
            this.renderer.viewPoint,
            this.game.mapSize,
            this.game.groundHeight
        );

        if (!tile) return;

        // Collect all selected units
        const units: number[] = [];
        for (const entityId of this.game.state.selectedEntityIds) {
            const entity = this.game.state.getEntity(entityId);
            if (entity && entity.type === EntityType.Unit) {
                units.push(entity.id);
            }
        }

        // Spread units around the target in a formation
        for (let i = 0; i < units.length; i++) {
            const offset = FORMATION_OFFSETS[Math.min(i, FORMATION_OFFSETS.length - 1)];
            this.game.execute({
                type: 'move_unit',
                entityId: units[i],
                targetX: tile.x + offset[0],
                targetY: tile.y + offset[1]
            });
        }
    }

    /** Show placement preview ghost building as the mouse moves */
    private handleMouseMove = (e: MouseEvent) => {
        if (!this.game || !this.tilePicker || !this.renderer || !this.entityRenderer) return;

        // Track dragging state
        if (this.dragStart) {
            const dx = e.offsetX - this.dragStart.x;
            const dy = e.offsetY - this.dragStart.y;
            if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
                this.isDragging = true;
            }
        }

        // Only show placement preview in place_building mode
        if (this.game.mode !== 'place_building') {
            this.entityRenderer.previewTile = null;
            return;
        }

        const tile = this.tilePicker.screenToTile(
            e.offsetX, e.offsetY,
            this.renderer.viewPoint,
            this.game.mapSize,
            this.game.groundHeight
        );

        if (!tile) {
            this.entityRenderer.previewTile = null;
            return;
        }

        this.entityRenderer.previewTile = tile;
        const hasBuildings = this.game.state.entities.some(
            ent => ent.type === EntityType.Building && ent.player === this.game.currentPlayer
        );
        this.entityRenderer.previewValid = canPlaceBuildingWithTerritory(
            this.game.groundType,
            this.game.groundHeight,
            this.game.mapSize,
            this.game.state.tileOccupancy,
            this.game.territory,
            tile.x,
            tile.y,
            this.game.currentPlayer,
            hasBuildings
        );
    }

    public unmounted(): void {
        if (this.game) {
            this.game.stop();
        }

        if (this.renderer) {
            const cav = this.renderer.canvas;
            cav.removeEventListener('mousedown', this.handleMouseDown);
            cav.removeEventListener('mouseup', this.handleMouseUp);
            cav.removeEventListener('contextmenu', this.handleRightClick);
            cav.removeEventListener('mousemove', this.handleMouseMove);
            this.renderer.destroy();
        }
    }
}
