/**
 * Headless game core — all game logic without browser/Vue dependencies.
 *
 * Instantiable in Node.js (Vitest integration tests) and in the browser.
 * The browser-facing `Game` class extends this with GameLoop, SoundManager,
 * Vue reactivity, and other UI concerns.
 */

import { IMapLoader } from '@/resources/map/imap-loader';
import { GameState } from './game-state';
import { GameServices } from './game-services';
import { type Command, type CommandResult, CommandHandlerRegistry, registerAllHandlers } from './commands';
import { TerrainData } from './terrain';
import { populateMapObjectsFromEntityData } from './systems/map-objects';
import { expandTrees } from './features/trees/tree-expansion';
import { populateMapBuildings, type MapBuildingEntry } from './features/building-construction';
import { populateMapSettlers } from './systems/map-settlers';
import { populateMapStacks } from './systems/map-stacks';
import { Race, s4TribeToRace } from './core/race';
import { EventBus } from './event-bus';
import { GameSettingsManager } from './game-settings';
import { setDirectionRunLength } from './systems/pathfinding';
import type { MapObjectData } from '@/resources/map/map-entity-data';
import type { PlacementFilter } from './systems/placement';
import {
    createTerritoryPlacementFilter,
    createTerritoryMatchFilter,
    createTerritoryCarrierFilter,
} from './features/territory';

/** Headless game core — usable in tests without a browser. */
export class GameCore {
    /** Terrain data — single owner for ground type, ground height, and map dimensions */
    public readonly terrain: TerrainData;
    public readonly mapLoader: IMapLoader;
    public state: GameState;
    public readonly eventBus: EventBus;

    /** Game settings — user preferences (camera, audio, graphics, debug) */
    public readonly settings: GameSettingsManager;

    /** All game managers and domain systems (composition root) */
    public readonly services: GameServices;

    /** Command handler registry — handlers bound with specific deps at init */
    protected readonly commandRegistry: CommandHandlerRegistry;

    /** Territory-based placement filter — created after terrain data is available */
    private _placementFilter: PlacementFilter | null = null;

    /** Whether territory enforcement is active */
    private _territoryEnabled = false;

    /** Public accessor for the current placement filter (used by renderer/UI) */
    get placementFilter(): PlacementFilter | null {
        return this._placementFilter;
    }

    /** Current player index */
    public currentPlayer = 0;

    /** Per-player race mapping (player index → Race enum value), populated from map data */
    public readonly playerRaces: Map<number, Race> = new Map();

    /**
     * Setup phases — order matters:
     *  1. WIRE      — create services, register command handlers
     *  2. POPULATE  — create all entities as raw data, no lifecycle events
     *  3. RECONCILE — assign workers to buildings (tile-exact + proximity)
     *  4. ACTIVATE  — emit lifecycle events; listeners see correct occupancy
     */
    public constructor(mapLoader: IMapLoader) {
        this.mapLoader = mapLoader;
        this.terrain = new TerrainData(
            mapLoader.landscape.getGroundType(),
            mapLoader.landscape.getGroundHeight(),
            mapLoader.mapSize
        );

        this.eventBus = new EventBus();
        this.state = new GameState(this.eventBus);
        this.settings = new GameSettingsManager();

        setDirectionRunLength(this.settings.state.pathStraightness);

        this.commandRegistry = new CommandHandlerRegistry();
        this.services = new GameServices(this.state, this.eventBus, cmd => this.commandRegistry.execute(cmd));

        this.wireCommandHandlers(mapLoader);
        const mapBuildings = this.populate(mapLoader);
        this.reconcile();
        this.activate(mapBuildings);
    }

    // ─── Setup phases ─────────────────────────────────────────

    /** WIRE — register terrain data, feature command handlers, and central handlers. */
    private wireCommandHandlers(mapLoader: IMapLoader): void {
        this.services.setTerrainData(this.terrain, mapLoader.landscape.getResourceData?.());

        for (const [type, handler] of this.services.getFeatureCommandHandlers()) {
            this.commandRegistry.register(type, handler);
        }
        registerAllHandlers(this.commandRegistry, {
            state: this.state,
            terrain: this.terrain,
            eventBus: this.eventBus,
            settings: this.settings.state,
            settlerTaskSystem: this.services.settlerTaskSystem,
            constructionSiteManager: this.services.constructionSiteManager,
            combatSystem: this.services.combatSystem,
            storageFilterManager: this.services.storageFilterManager,
            inventoryManager: this.services.inventoryManager,
            unitReservation: this.services.unitReservation,
            getPlacementFilter: () => this._placementFilter,
            recruitSystem: this.services.recruitSystem,
            unitTransformer: this.services.unitTransformer,
        });
    }

    /** POPULATE — create all entities (buildings, settlers, stacks) as raw data. No lifecycle events. */
    private populate(mapLoader: IMapLoader): MapBuildingEntry[] {
        const entityData = mapLoader.entityData;
        if (!entityData) {
            return [];
        }

        // Build per-player race mapping
        for (const p of entityData.players) {
            this.playerRaces.set(p.playerIndex, s4TribeToRace(p.tribe));
        }
        this.state.playerRaces = this.playerRaces;

        if (entityData.players.length > 0) {
            this.currentPlayer = entityData.players[0]!.playerIndex;
        }

        if (entityData.objects.length) {
            this.populateMapTrees(entityData.objects);
        }

        let mapBuildings: MapBuildingEntry[] = [];
        if (entityData.buildings.length) {
            mapBuildings = populateMapBuildings(this.state, entityData.buildings, {
                terrain: this.terrain,
            });
        }

        if (entityData.settlers.length) {
            populateMapSettlers(this.state, entityData.settlers, this.eventBus);
        }

        if (entityData.stacks.length) {
            populateMapStacks(this.state, entityData.stacks, this.eventBus);
        }

        return mapBuildings;
    }

    /** RECONCILE — assign workers to buildings before lifecycle events fire. */
    private reconcile(): void {
        this.services.settlerTaskSystem.assignInitialBuildingWorkers();
    }

    /** ACTIVATE — emit building:completed for each map building. Listeners see correct occupancy. */
    private activate(mapBuildings: MapBuildingEntry[]): void {
        for (const { buildingId, buildingType, race } of mapBuildings) {
            this.eventBus.emit('building:completed', { buildingId, buildingType, race });
        }
        this.services.victorySystem.setLocalPlayer(this.currentPlayer);
    }

    /** Load trees/decorations from map objects and optionally expand forests. */
    private populateMapTrees(objects: MapObjectData[]): void {
        const seedCount = populateMapObjectsFromEntityData(this.state, objects, this.terrain);

        if (seedCount > 0) {
            expandTrees(this.state, this.terrain, {
                radius: 10,
                density: 0.04,
                minSpacing: 1,
            });
        }
    }

    // ─── Commands ───────────────────────────────────────────────

    /** Execute a command against the game state */
    public execute(cmd: Command): CommandResult {
        return this.commandRegistry.execute(cmd);
    }

    // ─── Tick ───────────────────────────────────────────────────

    /** Get the list of tick systems for manual ticking. */
    public getTickSystems() {
        return this.services.getTickSystems();
    }

    /** Advance the simulation by one tick. */
    public tick(dt: number): void {
        for (const { system } of this.services.getTickSystems()) {
            system.tick(dt);
        }
    }

    // ─── Territory ──────────────────────────────────────────────

    /** Enable or disable territory enforcement. */
    public setTerritoryEnabled(enabled: boolean): void {
        this._territoryEnabled = enabled;
        const tm = this.services.territoryManager;
        const dispatcher = this.services.logisticsDispatcher;
        this._placementFilter = enabled ? createTerritoryPlacementFilter(tm) : null;
        dispatcher.setMatchFilter(enabled ? createTerritoryMatchFilter(tm) : null);
        dispatcher.setCarrierFilter(enabled ? createTerritoryCarrierFilter(tm) : null);
    }

    public get territoryEnabled(): boolean {
        return this._territoryEnabled;
    }

    // ─── Queries ────────────────────────────────────────────────

    /** Find the starting position for the current player from map data */
    public findPlayerStartPosition(): { x: number; y: number } | null {
        const playerInfo = this.mapLoader.entityData?.players.find(p => p.playerIndex === this.currentPlayer);
        if (playerInfo?.startX != null && playerInfo.startY != null) {
            return { x: playerInfo.startX, y: playerInfo.startY };
        }
        return null;
    }

    /** Find the first buildable land tile, spiraling out from map center */
    // eslint-disable-next-line sonarjs/cognitive-complexity -- spiral search with per-tile boundary checks
    public findLandTile(): { x: number; y: number } | null {
        const { width: w, height: h } = this.terrain;
        const cx = Math.floor(w / 2);
        const cy = Math.floor(h / 2);

        for (let r = 0; r < Math.max(w, h) / 2; r++) {
            for (let dx = -r; dx <= r; dx++) {
                for (let dy = -r; dy <= r; dy++) {
                    if (Math.abs(dx) !== r && Math.abs(dy) !== r) {
                        continue;
                    }
                    const tx = cx + dx;
                    const ty = cy + dy;
                    if (tx < 0 || ty < 0 || tx >= w || ty >= h) {
                        continue;
                    }
                    if (this.terrain.isBuildable(tx, ty)) {
                        return { x: tx, y: ty };
                    }
                }
            }
        }
        return null;
    }

    // ─── Lifecycle ──────────────────────────────────────────────

    /** Destroy the game core and clean up all resources */
    public destroy(): void {
        this.settings.destroy();
        this.services.destroy();
    }
}
