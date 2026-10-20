/**
 * Tracks construction worker commitments via construction:workerAssigned /
 * construction:workerReleased and records invariant violations:
 * - a unit is never committed twice without a release in between
 * - a release always matches the unit's current commitment
 * - concurrent workers per (site, role) never exceed the site's required count
 */

import type { Simulation } from './test-simulation';

type Role = 'digger' | 'builder';

interface Commitment {
    siteId: number;
    role: Role;
}

export class ConstructionAssignmentTracker {
    readonly violations: string[] = [];
    /** Total commitments seen per site and role (`${siteId}:${role}`). */
    private readonly totals = new Map<string, number>();
    private readonly current = new Map<number, Commitment>();

    constructor(private readonly sim: Simulation) {
        sim.eventBus.on('construction:workerAssigned', ({ buildingId, unitId, role }) =>
            this.onAssigned(buildingId, unitId, role)
        );
        sim.eventBus.on('construction:workerReleased', ({ buildingId, unitId, role }) =>
            this.onReleased(buildingId, unitId, role)
        );
    }

    /** Workers currently committed to `siteId` in `role`. */
    activeWorkers(siteId: number, role: Role): number {
        let count = 0;
        for (const c of this.current.values()) {
            if (c.siteId === siteId && c.role === role) {
                count++;
            }
        }
        return count;
    }

    /** Total commitments seen for `siteId` in `role` since tracking started. */
    totalAssignments(siteId: number, role: Role): number {
        return this.totals.get(`${siteId}:${role}`) ?? 0;
    }

    private onAssigned(siteId: number, unitId: number, role: Role): void {
        const existing = this.current.get(unitId);
        if (existing) {
            this.violations.push(
                `unit ${unitId} assigned to ${siteId}/${role} while committed to ${existing.siteId}/${existing.role}`
            );
        }
        this.current.set(unitId, { siteId, role });
        const key = `${siteId}:${role}`;
        this.totals.set(key, this.totalAssignments(siteId, role) + 1);

        const site = this.sim.services.constructionSiteManager.getSiteOrThrow(siteId, 'AssignmentTracker');
        const required = role === 'digger' ? site.terrain.slots.required : site.building.slots.required;
        const active = this.activeWorkers(siteId, role);
        if (active > required) {
            this.violations.push(`site ${siteId} has ${active} ${role}s (required ${required})`);
        }
    }

    private onReleased(siteId: number, unitId: number, role: Role): void {
        const existing = this.current.get(unitId);
        if (!existing || existing.siteId !== siteId || existing.role !== role) {
            this.violations.push(`unit ${unitId} released from ${siteId}/${role} without matching commitment`);
        }
        this.current.delete(unitId);
    }
}
