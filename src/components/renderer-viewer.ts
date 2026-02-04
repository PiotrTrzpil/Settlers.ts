import { Game } from '@/game/game';
import { LandscapeRenderer } from '@/game/renderer/landscape/landscape-renderer';
import { EntityRenderer } from '@/game/renderer/entity-renderer';
import { Renderer } from '@/game/renderer/renderer';
import { TilePicker } from '@/game/input/tile-picker';
import { EntityType, BuildingType } from '@/game/entity';

import { Options, Vue } from 'vue-class-component';

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

    public async mounted(): Promise<void> {
        const cav = this.$refs.cav as HTMLCanvasElement;
        this.renderer = new Renderer(cav);
        this.tilePicker = new TilePicker(cav);

        this.initRenderer();

        this.$watch('game', () => {
            this.initRenderer();
        });

        // Set up click handlers
        cav.addEventListener('click', this.handleClick);
        cav.addEventListener('contextmenu', this.handleRightClick);
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
            }
            renderer.drawOnce();
        });
        this.game.start();
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

        // Right-click: move selected unit to target tile
        if (this.game.state.selectedEntityId !== null) {
            const entity = this.game.state.getEntity(this.game.state.selectedEntityId);
            if (entity && entity.type === EntityType.Unit) {
                this.game.execute({
                    type: 'move_unit',
                    entityId: entity.id,
                    targetX: tile.x,
                    targetY: tile.y
                });
            }
        }
    }

    public unmounted(): void {
        if (this.game) {
            this.game.stop();
        }

        if (this.renderer) {
            const cav = this.renderer.canvas;
            cav.removeEventListener('click', this.handleClick);
            cav.removeEventListener('contextmenu', this.handleRightClick);
            this.renderer.destroy();
        }
    }
}
