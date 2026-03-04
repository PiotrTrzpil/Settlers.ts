/**
 * Crops Feature Module
 *
 * Manages crop lifecycle: growth, harvesting, and decay.
 * Covers grain, sunflower, agave, and beehive.
 */

export { CropFeature, type CropFeatureExports } from './crop-feature';
export {
    CropSystem,
    CropStage,
    type CropState,
    type CropTypeConfig,
    type CropSpriteConfig,
    type CropSystemConfig,
} from './crop-system';
export { CROP_SPRITE_CONFIGS, getCropTypeConfig } from './crop-system';
