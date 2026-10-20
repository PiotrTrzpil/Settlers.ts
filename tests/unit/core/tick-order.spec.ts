/**
 * Pins the full tick order of a standard game setup.
 *
 * Tick order determines simulation results (determinism, replays). If this test fails,
 * the order changed — make sure that was intended (see TickPhase in src/game/core/tick-phase.ts)
 * and update the expected list.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSimulation, cleanupSimulation } from '../helpers/test-simulation';
import { insertByTickPhase, tickPhaseLabel, TickPhase } from '@/game/core/tick-phase';

afterEach(() => cleanupSimulation());

/** Expected `SystemClassName @ Phase` sequence. Scripting (registered later by Game) is not included. */
const EXPECTED_TICK_ORDER = [
    'TickScheduler @ Scheduler',
    'MovementSystem @ Movement',
    'BuildingOverlayManager @ BuildingOverlays',
    'BuildingConstructionSystem @ Construction',
    'ResidenceSpawnerSystem @ Construction',
    'ConstructionRequestSystem @ Construction',
    'CombatSystem @ Combat',
    'DeathAngelSystem @ Combat',
    'SettlerTaskSystem @ SettlerTasks',
    'TreeSystem @ Nature',
    'CropSystem @ Nature',
    'ResourceSignSystem @ ResourceSigns',
    'RecruitSystem @ Recruitment',
    'MaterialRequestSystem @ MaterialRequests',
    'LogisticsDispatcher @ Logistics',
    'BarracksTrainingManager @ Military',
    'AutoGarrisonSystem @ Military',
    'TowerCombatSystem @ Military',
    'BuildingSiegeSystem @ Military',
    'TowerAssaultSystem @ Military',
    'BuildingDemandSystem @ Demand',
    'ConstructionSiteDemandSystem @ Demand',
    'VictoryConditionsSystem @ Victory',
    'AiPlayerSystemImpl @ AI',
];

describe('tick order', () => {
    it('runs the standard game systems in the declared phase order', () => {
        const sim = createSimulation();
        const actual = sim.services
            .getTickSystems()
            .map(({ system, phase }) => `${system.constructor.name} @ ${tickPhaseLabel(phase)}`);
        sim.destroy();

        expect(actual).toEqual(EXPECTED_TICK_ORDER);
    });

    it('insertByTickPhase sorts by phase and keeps registration order within a phase', () => {
        const list: { phase: TickPhase; id: string }[] = [];
        insertByTickPhase(list, {
            phase: TickPhase.Logistics,
            id: 'logistics-a',
        });
        insertByTickPhase(list, {
            phase: TickPhase.Scheduler,
            id: 'scheduler',
        });
        insertByTickPhase(list, {
            phase: TickPhase.Logistics,
            id: 'logistics-b',
        });
        insertByTickPhase(list, { phase: TickPhase.Movement, id: 'movement' });
        insertByTickPhase(list, {
            phase: TickPhase.Scripting,
            id: 'scripting',
        });

        expect(list.map(e => e.id)).toEqual(['scheduler', 'movement', 'logistics-a', 'logistics-b', 'scripting']);
    });
});
