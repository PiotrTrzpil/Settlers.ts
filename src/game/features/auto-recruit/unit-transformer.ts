import type { GameState } from '../../game-state';
import type { CoreDeps } from '../feature';
import type { EventBus } from '../../event-bus';
import { UnitType } from '../../unit-types';
import type { CarrierRegistry } from '../carriers';
import { LogHandler } from '@/utilities/log-handler';

export interface UnitTransformerConfig extends CoreDeps {
    carrierRegistry: CarrierRegistry;
}

export class UnitTransformer {
    private static log = new LogHandler('UnitTransformer');
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly carrierRegistry: CarrierRegistry;

    constructor(config: UnitTransformerConfig) {
        this.gameState = config.gameState;
        this.eventBus = config.eventBus;
        this.carrierRegistry = config.carrierRegistry;
    }

    transform(entityId: number, targetUnitType: UnitType): void {
        const entity = this.gameState.getEntityOrThrow(entityId, 'UnitTransformer.transform');
        const fromType = entity.subType as UnitType;

        entity.subType = targetUnitType;
        this.carrierRegistry.remove(entityId);
        entity.carrying = undefined;

        this.eventBus.emit('unit:transformed', { entityId, fromType, toType: targetUnitType });
        UnitTransformer.log.debug(
            `Transformed entity ${entityId} from ${UnitType[fromType]} to ${UnitType[targetUnitType]}`
        );
    }
}
