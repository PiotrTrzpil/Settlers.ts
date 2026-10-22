/**
 * Random number in [0, 1) for audio presentation choices (which variant, where an
 * ambient sound comes from). Audio never feeds back into game state, so this does not
 * need the seeded game RNG (design rule 8.3 is about game logic).
 */
export function randomUnit(): number {
    // eslint-disable-next-line sonarjs/pseudo-random -- presentation only, see above
    return Math.random();
}
