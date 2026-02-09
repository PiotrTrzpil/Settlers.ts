export enum SoundType {
    Music = 'Music',
    SFX = 'SFX',
    UI = 'UI'
}

import { Howl } from 'howler';

export interface IAudioManager {
    loadSound(config: SoundConfig): Howl | null;
    getMusicVolumeMultiplier(): number;
}

export interface SoundConfig {
    id: string;
    path: string;
    type: SoundType;
    volume?: number;
    loop?: boolean;
}

/**
 * Registry of available sounds.
 * In a full implementation, this could be loaded from JSON.
 */
export const SOUND_LIBRARY: SoundConfig[] = [
    // Roman Music
    { id: 'MUSIC_ROMAN_01', path: '/Siedler4/Snd/romans_settle_01.MP3', type: SoundType.Music, volume: 0.6, loop: false },
    { id: 'MUSIC_ROMAN_02', path: '/Siedler4/Snd/romans_settle_02.MP3', type: SoundType.Music, volume: 0.6, loop: false },
    { id: 'MUSIC_ROMAN_FIGHT_01', path: '/Siedler4/Snd/romans_fight_01.MP3', type: SoundType.Music, volume: 0.6, loop: false },
    { id: 'MUSIC_ROMAN_FIGHT_02', path: '/Siedler4/Snd/romans_fight_02.MP3', type: SoundType.Music, volume: 0.6, loop: false },
    { id: 'MUSIC_ROMAN_SEA_01', path: '/Siedler4/Snd/romans_sea_01.MP3', type: SoundType.Music, volume: 0.6, loop: false },
    { id: 'MUSIC_ROMAN_SEA_02', path: '/Siedler4/Snd/romans_sea_02.MP3', type: SoundType.Music, volume: 0.6, loop: false },

    // Viking Music
    { id: 'MUSIC_VIKING_01', path: '/Siedler4/Snd/vikings_settle_01.mp3', type: SoundType.Music, volume: 0.6, loop: false },
    { id: 'MUSIC_VIKING_02', path: '/Siedler4/Snd/vikings_settle_02.mp3', type: SoundType.Music, volume: 0.6, loop: false },
    { id: 'MUSIC_VIKING_FIGHT_01', path: '/Siedler4/Snd/vikings_fight_01.mp3', type: SoundType.Music, volume: 0.6, loop: false },
    { id: 'MUSIC_VIKING_FIGHT_02', path: '/Siedler4/Snd/vikings_fight_02.MP3', type: SoundType.Music, volume: 0.6, loop: false },
    { id: 'MUSIC_VIKING_SEA_01', path: '/Siedler4/Snd/vikings_sea_01.mp3', type: SoundType.Music, volume: 0.6, loop: false },
    { id: 'MUSIC_VIKING_SEA_02', path: '/Siedler4/Snd/vikings_sea_02.MP3', type: SoundType.Music, volume: 0.6, loop: false },

    // Mayan Music
    { id: 'MUSIC_MAYAN_01', path: '/Siedler4/Snd/mayan_settle_01.mp3', type: SoundType.Music, volume: 0.6, loop: false },
    { id: 'MUSIC_MAYAN_02', path: '/Siedler4/Snd/mayan_settle_02.mp3', type: SoundType.Music, volume: 0.6, loop: false },
    { id: 'MUSIC_MAYAN_FIGHT_01', path: '/Siedler4/Snd/mayan_fight_01.mp3', type: SoundType.Music, volume: 0.6, loop: false },
    { id: 'MUSIC_MAYAN_FIGHT_02', path: '/Siedler4/Snd/mayan_fight_02.mp3', type: SoundType.Music, volume: 0.6, loop: false },
    { id: 'MUSIC_MAYAN_SEA_01', path: '/Siedler4/Snd/mayan_sea_01.mp3', type: SoundType.Music, volume: 0.6, loop: false },
    { id: 'MUSIC_MAYAN_SEA_02', path: '/Siedler4/Snd/mayan_sea_02.mp3', type: SoundType.Music, volume: 0.6, loop: false },

    // Trojan Music
    { id: 'MUSIC_TROJAN_01', path: '/Siedler4/Snd/trojans_settle_02.mp3', type: SoundType.Music, volume: 0.6, loop: false }, // Only 02 found
    { id: 'MUSIC_TROJAN_FIGHT_01', path: '/Siedler4/Snd/trojans_fight_01.mp3', type: SoundType.Music, volume: 0.6, loop: false },
    { id: 'MUSIC_TROJAN_FIGHT_02', path: '/Siedler4/Snd/trojans_fight_02.mp3', type: SoundType.Music, volume: 0.6, loop: false },
    { id: 'MUSIC_TROJAN_SEA_01', path: '/Siedler4/Snd/trojans_sea_01.mp3', type: SoundType.Music, volume: 0.6, loop: false },
    { id: 'MUSIC_TROJAN_SEA_02', path: '/Siedler4/Snd/trojans_sea_02.mp3', type: SoundType.Music, volume: 0.6, loop: false },

    // Dark Tribe Music
    { id: 'MUSIC_DARK_01', path: '/Siedler4/Snd/dark_tribe_01.MP3', type: SoundType.Music, volume: 0.6, loop: false },
    { id: 'MUSIC_DARK_02', path: '/Siedler4/Snd/dark_tribe_02.mp3', type: SoundType.Music, volume: 0.6, loop: false },

    // Placeholder SFX reusing MP3
    {
        id: 'SFX_TEST', // Placeholder
        path: '/Siedler4/Snd/romans_settle_01.MP3',
        type: SoundType.SFX,
        volume: 1.0,
        loop: false
    },
    // Real SFX from 0.snd (Index 0)
    {
        id: 'SFX_TEST_SND',
        path: 'Snd:0',
        type: SoundType.SFX,
        volume: 1.0,
        loop: false
    }
];
