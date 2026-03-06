/**
 * Auto-Recruit Feature Module
 *
 * Automatically recruits idle carriers as builders/diggers when construction sites need workers.
 *
 * Public API:
 * - System: AutoRecruitSystem
 * - Feature: AutoRecruitFeature
 * - Jobs: createRecruitmentJob, executeTransformRecruit
 * - Resolver: ToolSourceResolver
 * - Transformer: UnitTransformer
 */

export { AutoRecruitSystem } from './auto-recruit-system';
export { AutoRecruitFeature, type AutoRecruitExports } from './auto-recruit-feature';
export { ToolSourceResolver, type ToolSource } from './tool-source-resolver';
export { UnitTransformer, type UnitTransformerConfig } from './unit-transformer';
export { createRecruitmentJob, executeTransformRecruit } from './recruitment-job';
