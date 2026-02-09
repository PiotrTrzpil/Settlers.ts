import { MapSize } from '@/utilities/map-size';
import { GeneralMapInformation } from './general-map-information';
import { IMapLandscape } from './imap-landscape';
import type { MapEntityData } from './map-entity-data';

/** Interface for map loaders */
export interface IMapLoader {
        landscape: IMapLandscape;

        /** General information about the map */
        general: GeneralMapInformation;

        /** return the size of the map */
        mapSize : MapSize;

        /** Optional entity data parsed from map chunks (players, buildings, settlers, stacks) */
        entityData?: MapEntityData;
}
