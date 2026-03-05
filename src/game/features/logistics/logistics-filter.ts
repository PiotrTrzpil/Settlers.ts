/**
 * Logistics filter types for pluggable policy enforcement.
 * Filters are optional callbacks injected into RequestMatcher and CarrierAssigner.
 */

import type { Entity } from '../../entity';

/**
 * Optional filter applied after supply matching, before carrier assignment.
 * Returns true if the match is allowed, false to reject it.
 */
export type LogisticsMatchFilter = (sourceBuilding: Entity, destBuilding: Entity, playerId: number) => boolean;

/**
 * Optional filter for carrier eligibility beyond basic idle/player checks.
 * Returns true if the carrier can be assigned.
 */
export type CarrierFilter = (carrier: Entity, playerId: number) => boolean;
