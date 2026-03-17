import { test, expect } from './fixtures';
import { BuildingType } from '@/game/buildings/building-type';
import { E2eTimeline } from './e2e-timeline';

/**
 * E2E test for building flag overlays.
 * Places a completed building with real game assets and verifies flag overlay data.
 * Timeline is recorded to SQLite for post-failure investigation:
 *   pnpm timeline -- --db output/timeline/e2e/<file>.db --test building-flags
 *
 * Requires game assets (skips in CI if assets unavailable).
 */

test.describe('Building Flags', () => {
    test('completed building has flag overlay data', async ({ gpAssets: gp }) => {
        const tl = await E2eTimeline.start(gp.page, 'building-flags');

        try {
            const tile = await gp.actions.findBuildableTile();
            expect(tile).not.toBeNull();

            const building = await gp.actions.placeBuilding(BuildingType.WoodcutterHut, tile!.x, tile!.y, 0, {
                completed: true,
            });
            expect(building).not.toBeNull();

            await gp.wait.waitForTicks(10);

            const info = await gp.page.evaluate(
                ({ id, bt, player }) => {
                    const game = window.__settlers__?.game;
                    if (!game) return null;

                    const race = game.playerRaces.get(player);
                    const defs = race !== undefined ? game.services.overlayRegistry.getOverlays(bt, race) : [];
                    const overlays = game.services.buildingOverlayManager.getOverlays(id);
                    const entity = game.state.getEntity(id);

                    const flagDef = defs.find((d: any) => d.isFlag);

                    return {
                        operational: entity?.operational ?? false,
                        hasOverlays: !!overlays,
                        flagCount: overlays?.filter((i: any) => i.def.isFlag).length ?? 0,
                        flagTileOffsetX: flagDef?.tileOffsetX ?? null,
                        flagTileOffsetY: flagDef?.tileOffsetY ?? null,
                    };
                },
                { id: building!.id, bt: building!.subType as BuildingType, player: building!.player }
            );

            expect(info).not.toBeNull();
            expect(info!.operational).toBe(true);
            expect(info!.hasOverlays).toBe(true);
            expect(info!.flagCount).toBeGreaterThanOrEqual(1);
            // Flag must use XML-defined tile position, not (0, 0)
            const hasOffset = info!.flagTileOffsetX !== 0 || info!.flagTileOffsetY !== 0;
            expect(
                hasOffset,
                `Flag tile offset must be non-zero from XML, got (${info!.flagTileOffsetX}, ${info!.flagTileOffsetY})`
            ).toBe(true);

            // Verify the resolved world offset is non-zero (isometric conversion applied)
            const positions = await gp.page.evaluate(id => {
                const er = window.__settlers__?.entityRenderer;
                const ctx = (er as any).renderContext;
                if (!ctx) return null;
                const overlays = ctx.getBuildingOverlays(id);
                const flagOverlay = overlays?.find((o: any) => o.layer === 2); // OverlayRenderLayer.Flag = 2
                return {
                    worldOffsetX: flagOverlay?.worldOffsetX ?? null,
                    worldOffsetY: flagOverlay?.worldOffsetY ?? null,
                };
            }, building!.id);

            expect(positions).not.toBeNull();
            const flagAtAnchor = positions!.worldOffsetX === 0 && positions!.worldOffsetY === 0;
            expect(
                flagAtAnchor,
                `Flag world offset must not be (0,0), got (${positions!.worldOffsetX}, ${positions!.worldOffsetY})`
            ).toBe(false);

            // Center camera on building and zoom in
            await gp.moveCamera(tile!.x, tile!.y);
            await gp.zoomCamera(15);

            // Clip 400x400 from the center of the viewport
            const vp = gp.page.viewportSize()!;
            await gp.page.screenshot({
                path: 'tests/e2e/.results/building-flag-overlay.png',
                clip: {
                    x: (vp.width - 400) / 2,
                    y: (vp.height - 400) / 2,
                    width: 400,
                    height: 400,
                },
            });

            await tl.stop('passed');
        } catch (e) {
            await tl.stop('failed');
            throw e;
        }
    });
});
