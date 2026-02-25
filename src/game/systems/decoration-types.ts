/**
 * Decoration object type observations.
 *
 * Raw byte values > 18 from the map objects chunk that are NOT trees.
 * Collected by visually inspecting where each type appears on the map
 * and matching to known Settlers 4 decoration objects.
 *
 * Once enough types are identified, these will be integrated into
 * MapObjectType enum and RAW_TO_OBJECT_TYPE registry.
 */

/** Description of a decoration object type observed on the map */
export interface DecorationTypeInfo {
    /** Raw byte value from map file */
    raw: number;
    /** Best guess at what this is */
    label: string;
    /** Category: 'stone', 'bush', 'flower', 'mushroom', 'building_ruin', 'unknown', etc. */
    category: string;
    /** Where it was observed on the map */
    notes: string;
}

/**
 * Observed decoration types — fill in as we identify them.
 *
 * Raw values 1-18 = trees (already mapped in RAW_TO_OBJECT_TYPE).
 * Values below are > 18.
 */
export const DECORATION_TYPES: DecorationTypeInfo[] = [
    // 56: Mountain edge
    { raw: 56, label: 'MountainEdge56', category: 'stone', notes: 'Near mountain edge' },

    // 57: Mountain decoration
    { raw: 57, label: 'Mountain57', category: 'stone', notes: 'On mountain' },
    { raw: 58, label: 'Mountain58', category: 'stone', notes: 'On mountain (inferred from 57)' },

    // 59-75: Mountain edge decorations — rocks/rubble near mountain-grass transitions
    {
        raw: 59,
        label: 'MountainEdge59',
        category: 'stone',
        notes: 'Near mountain edges, mostly on mountain but some on grass',
    },
    { raw: 60, label: 'MountainEdge60', category: 'stone', notes: 'Near mountain edges' },
    { raw: 61, label: 'MountainEdge61', category: 'stone', notes: 'Near mountain edges' },
    { raw: 62, label: 'MountainEdge62', category: 'stone', notes: 'Near mountain edges' },
    { raw: 63, label: 'MountainEdge63', category: 'stone', notes: 'Near mountain edges' },
    { raw: 64, label: 'MountainEdge64', category: 'stone', notes: 'Near mountain edges' },
    { raw: 65, label: 'MountainEdge65', category: 'stone', notes: 'Near mountain edges' },
    { raw: 66, label: 'MountainEdge66', category: 'stone', notes: 'Near mountain edges' },
    { raw: 67, label: 'MountainEdge67', category: 'stone', notes: 'Near mountain edges' },
    { raw: 68, label: 'MountainEdge68', category: 'stone', notes: 'Near mountain edges' },
    { raw: 69, label: 'MountainEdge69', category: 'stone', notes: 'Near mountain edges' },
    { raw: 70, label: 'MountainEdge70', category: 'stone', notes: 'Near mountain edges' },
    { raw: 71, label: 'MountainEdge71', category: 'stone', notes: 'Near mountain edges' },
    { raw: 72, label: 'MountainEdge72', category: 'stone', notes: 'Near mountain edges' },
    { raw: 73, label: 'MountainEdge73', category: 'stone', notes: 'Near mountain edges' },
    { raw: 74, label: 'MountainEdge74', category: 'stone', notes: 'Near mountain edges' },
    { raw: 75, label: 'MountainEdge75', category: 'stone', notes: 'Near mountain edges' },
    // 43: River decoration
    { raw: 43, label: 'River43', category: 'river', notes: 'Near rivers' },

    // 44-49: Rare grass decorations — larger/special objects on grass
    { raw: 44, label: 'GrassRare44', category: 'plants', notes: 'On grass, rarer than 124-136' },
    { raw: 45, label: 'GrassRare45', category: 'plants', notes: 'On grass, rarer than 124-136' },
    { raw: 46, label: 'GrassRare46', category: 'plants', notes: 'On grass, rarer than 124-136' },
    { raw: 47, label: 'GrassRare47', category: 'plants', notes: 'On grass, rarer than 124-136' },
    { raw: 48, label: 'GrassRare48', category: 'plants', notes: 'On grass, rarer than 124-136' },
    { raw: 49, label: 'GrassRare49', category: 'plants', notes: 'On grass, rarer than 124-136' },

    // 76: Rare grass decoration
    { raw: 76, label: 'GrassRare76', category: 'plants', notes: 'On grass, relatively rare' },

    // 77-84: River decorations — reeds, river stones, etc.
    { raw: 77, label: 'River77', category: 'river', notes: 'Mostly near rivers' },
    { raw: 78, label: 'River78', category: 'river', notes: 'Mostly near rivers' },
    { raw: 79, label: 'River79', category: 'river', notes: 'Mostly near rivers' },
    { raw: 80, label: 'River80', category: 'river', notes: 'Mostly near rivers' },
    { raw: 81, label: 'River81', category: 'river', notes: 'Mostly near rivers' },
    { raw: 82, label: 'River82', category: 'river', notes: 'Mostly near rivers' },
    { raw: 83, label: 'River83', category: 'river', notes: 'Mostly near rivers' },
    { raw: 84, label: 'River84', category: 'river', notes: 'Mostly near rivers' },

    // 85-87: Rare grass decorations
    { raw: 85, label: 'GrassRare85', category: 'plants', notes: 'On grass, rare' },
    { raw: 86, label: 'GrassRare86', category: 'plants', notes: 'On grass, rare' },
    { raw: 87, label: 'GrassRare87', category: 'plants', notes: 'On grass, rare' },

    // 50-53: Desert decorations
    { raw: 50, label: 'Desert50', category: 'desert', notes: 'On desert terrain' },
    { raw: 51, label: 'Desert51', category: 'desert', notes: 'On desert terrain (possibly)' },
    { raw: 52, label: 'Desert52', category: 'desert', notes: 'On desert terrain' },
    { raw: 53, label: 'Desert53', category: 'desert', notes: 'On desert terrain' },
    { raw: 54, label: 'Desert54', category: 'desert', notes: 'Near desert, very rare' },
    { raw: 55, label: 'Shore55', category: 'sea', notes: 'Near sea / on sea near shore, rare — possibly map data bug' },
    { raw: 120, label: 'Desert120', category: 'desert', notes: 'On desert or desert edge' },
    { raw: 121, label: 'Desert121', category: 'desert', notes: 'On desert or desert edge' },
    { raw: 122, label: 'Desert122', category: 'desert', notes: 'On desert' },
    { raw: 179, label: 'Desert179', category: 'desert', notes: 'On desert' },
    { raw: 180, label: 'Desert180', category: 'desert', notes: 'On desert' },

    // 116: Rare grass decoration
    { raw: 116, label: 'GrassRare116', category: 'plants', notes: 'On grass, rare' },

    // 123: Not seen on test map, may exist on other maps
    // { raw: 123, label: 'Unknown123', category: 'unknown', notes: 'Not present on test map' },

    // 124-136: Grass decorations — bushes, flowers, mushrooms, etc.
    { raw: 124, label: 'Grass124', category: 'plants', notes: 'On grass' },
    { raw: 125, label: 'Grass125', category: 'plants', notes: 'On grass' },
    { raw: 126, label: 'Grass126', category: 'plants', notes: 'On grass' },
    { raw: 127, label: 'Grass127', category: 'plants', notes: 'On grass' },
    { raw: 128, label: 'Grass128', category: 'plants', notes: 'On grass' },
    { raw: 129, label: 'Grass129', category: 'plants', notes: 'On grass' },
    { raw: 130, label: 'Grass130', category: 'plants', notes: 'On grass' },
    { raw: 131, label: 'Grass131', category: 'plants', notes: 'On grass' },
    { raw: 132, label: 'Grass132', category: 'plants', notes: 'On grass' },
    { raw: 133, label: 'Grass133', category: 'plants', notes: 'On grass' },
    { raw: 134, label: 'Grass134', category: 'plants', notes: 'On grass' },
    { raw: 135, label: 'Grass135', category: 'plants', notes: 'On grass' },
    { raw: 136, label: 'Grass136', category: 'plants', notes: 'On grass' },

    // 107-110, 119: Sea decorations — on water tiles
    { raw: 107, label: 'Sea107', category: 'sea', notes: 'On sea' },
    { raw: 108, label: 'Sea108', category: 'sea', notes: 'On sea' },
    { raw: 109, label: 'Sea109', category: 'sea', notes: 'On sea' },
    { raw: 110, label: 'Sea110', category: 'sea', notes: 'On sea' },
    { raw: 119, label: 'Sea119', category: 'sea', notes: 'On sea' },
    { raw: 163, label: 'Sea163', category: 'sea', notes: 'On sea, possibly shallow only' },
    { raw: 164, label: 'Sea164', category: 'sea', notes: 'On sea, possibly shallow only' },
    // 165-168: River decorations
    { raw: 165, label: 'River165', category: 'river', notes: 'Near rivers' },
    { raw: 166, label: 'River166', category: 'river', notes: 'Near rivers' },
    { raw: 167, label: 'River167', category: 'river', notes: 'Near rivers' },
    { raw: 168, label: 'River168', category: 'river', notes: 'Near rivers' },

    // 169: Beach decoration
    { raw: 169, label: 'Beach169', category: 'sea', notes: 'On beach' },

    // 178: Possibly mountain edge, very rare
    { raw: 178, label: 'MountainEdge178', category: 'stone', notes: 'Very rare, seems near mountain edge' },

    // 181-182: Mixed
    { raw: 181, label: 'Grass181', category: 'plants', notes: 'On grass' },
    { raw: 182, label: 'MountainEdge182', category: 'stone', notes: 'On some mountain edges' },
    { raw: 183, label: 'MountainEdge183', category: 'stone', notes: 'On mountain edges, similar to 182' },

    // 184-188: River decorations
    { raw: 184, label: 'River184', category: 'river', notes: 'Mostly near rivers' },
    { raw: 185, label: 'River185', category: 'river', notes: 'Mostly near rivers' },
    { raw: 186, label: 'River186', category: 'river', notes: 'Mostly near rivers' },
    { raw: 187, label: 'River187', category: 'river', notes: 'Mostly near rivers' },
    { raw: 188, label: 'River188', category: 'river', notes: 'Mostly near rivers' },
];
