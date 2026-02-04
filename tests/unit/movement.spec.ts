import { expect } from 'chai';
import { GameState } from '@/game/game-state';
import { EntityType } from '@/game/entity';
import { updateMovement } from '@/game/systems/movement';

describe('Movement System', () => {
    let state: GameState;

    beforeEach(() => {
        state = new GameState();
    });

    it('should advance unit along path based on speed', () => {
        const unit = state.addEntity(EntityType.Unit, 0, 0, 0, 0);
        const unitState = state.unitStates.get(unit.id);
        expect(unitState).to.not.equal(undefined);
        if (!unitState) { return }
        unitState.path = [
            { x: 1, y: 0 },
            { x: 2, y: 0 },
            { x: 3, y: 0 }
        ];
        unitState.speed = 2; // 2 tiles/sec

        // 0.5 seconds at speed 2 = 1 tile
        updateMovement(state, 0.5);

        expect(unit.x).to.equal(1);
        expect(unit.y).to.equal(0);
        expect(unitState.pathIndex).to.equal(1);
    });

    it('should complete path and reset state', () => {
        const unit = state.addEntity(EntityType.Unit, 0, 0, 0, 0);
        const unitState = state.unitStates.get(unit.id);
        expect(unitState).to.not.equal(undefined);
        if (!unitState) { return }
        unitState.path = [
            { x: 1, y: 0 },
            { x: 2, y: 0 }
        ];
        unitState.speed = 10; // fast

        // Move enough to complete entire path
        updateMovement(state, 1.0);

        expect(unit.x).to.equal(2);
        expect(unit.y).to.equal(0);
        expect(unitState.path).to.have.length(0);
        expect(unitState.pathIndex).to.equal(0);
        expect(unitState.moveProgress).to.equal(0);
    });

    it('should not move units with empty path', () => {
        const unit = state.addEntity(EntityType.Unit, 0, 5, 5, 0);
        const unitState = state.unitStates.get(unit.id);
        expect(unitState).to.not.equal(undefined);

        updateMovement(state, 1.0);

        expect(unit.x).to.equal(5);
        expect(unit.y).to.equal(5);
    });

    it('should handle multiple units independently', () => {
        const u1 = state.addEntity(EntityType.Unit, 0, 0, 0, 0);
        const u2 = state.addEntity(EntityType.Unit, 0, 10, 10, 0);

        const us1 = state.unitStates.get(u1.id);
        expect(us1).to.not.equal(undefined);
        if (!us1) { return }
        us1.path = [{ x: 1, y: 0 }];
        us1.speed = 2;

        const us2 = state.unitStates.get(u2.id);
        expect(us2).to.not.equal(undefined);
        if (!us2) { return }
        us2.path = [{ x: 11, y: 10 }, { x: 12, y: 10 }];
        us2.speed = 4;

        updateMovement(state, 0.5);

        expect(u1.x).to.equal(1); // moved 1 tile at speed 2 * 0.5s
        expect(u2.x).to.equal(12); // moved 2 tiles at speed 4 * 0.5s
    });

    it('should update tile occupancy when moving', () => {
        const unit = state.addEntity(EntityType.Unit, 0, 5, 5, 0);
        const unitState = state.unitStates.get(unit.id);
        expect(unitState).to.not.equal(undefined);
        if (!unitState) { return }
        unitState.path = [{ x: 6, y: 5 }];
        unitState.speed = 2;

        updateMovement(state, 0.5);

        expect(state.getEntityAt(5, 5)).to.equal(undefined);
        expect(state.getEntityAt(6, 5)).to.not.equal(undefined);
        const movedEntity = state.getEntityAt(6, 5);
        expect(movedEntity?.id).to.equal(unit.id);
    });

    describe('smooth interpolation tracking', () => {
        it('should initialize prevX/prevY to spawn position', () => {
            const unit = state.addEntity(EntityType.Unit, 0, 7, 3, 0);
            const unitState = state.unitStates.get(unit.id);
            expect(unitState).to.not.equal(undefined);
            if (!unitState) { return }
            expect(unitState.prevX).to.equal(7);
            expect(unitState.prevY).to.equal(3);
        });

        it('should update prevX/prevY to previous tile when advancing', () => {
            const unit = state.addEntity(EntityType.Unit, 0, 5, 5, 0);
            const unitState = state.unitStates.get(unit.id);
            expect(unitState).to.not.equal(undefined);
            if (!unitState) { return }
            unitState.path = [
                { x: 6, y: 5 },
                { x: 7, y: 5 }
            ];
            unitState.speed = 2;

            // Move one tile (0.5s at speed 2)
            updateMovement(state, 0.5);

            expect(unit.x).to.equal(6);
            expect(unitState.prevX).to.equal(5);
            expect(unitState.prevY).to.equal(5);
        });

        it('should sync prevX/prevY on path completion', () => {
            const unit = state.addEntity(EntityType.Unit, 0, 0, 0, 0);
            const unitState = state.unitStates.get(unit.id);
            expect(unitState).to.not.equal(undefined);
            if (!unitState) { return }
            unitState.path = [{ x: 1, y: 0 }];
            unitState.speed = 10;

            updateMovement(state, 1.0);

            expect(unit.x).to.equal(1);
            expect(unitState.prevX).to.equal(1);
            expect(unitState.prevY).to.equal(0);
        });
    });
});
