/** Interface for map landscape */
export interface IMapLandscape {
        getGroundType(): Uint8Array;
        getGroundHeight(): Uint8Array;
        /**
         * Returns terrain attributes data (byte 2 of each tile).
         * Contains: dark land flag, pond flag, sun level (not tree/object data!).
         * Trees are stored in MapObjects chunk (type 6), not in the landscape.
         * Optional - test maps may not have this.
         */
        getTerrainAttributes?(): Uint8Array;
        /**
         * Returns gameplay attributes data (byte 3 of each tile).
         * Contains: founding stone flag, fog of war level (not resource data!).
         * Resources are stored in separate resource layer.
         * Optional - test maps may not have this.
         */
        getGameplayAttributes?(): Uint8Array;
}
