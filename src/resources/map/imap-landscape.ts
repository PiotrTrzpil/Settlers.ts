/** Interface for map landscape */
export interface IMapLandscape {
        getGroundType(): Uint8Array;
        getGroundHeight(): Uint8Array;
        /** Returns object type data (byte 2 of each tile). Optional - test maps may not have this. */
        getObjectType?(): Uint8Array;
}
