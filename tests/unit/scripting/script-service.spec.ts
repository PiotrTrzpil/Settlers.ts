import { describe, it, expect } from 'vitest';
import { deriveScriptPath } from '@/game/scripting/script-service';

describe('ScriptService', () => {
    describe('deriveScriptPath', () => {
        it('should derive script path from .map file', () => {
            expect(deriveScriptPath('roman01.map')).toBe('Script/roman01.txt');
            expect(deriveScriptPath('Tutorial01.map')).toBe('Script/Tutorial01.txt');
        });

        it('should derive script path from .edm file', () => {
            expect(deriveScriptPath('MCD2_maya1.edm')).toBe('Script/MCD2_maya1.txt');
        });

        it('should derive script path from .exe savegame', () => {
            expect(deriveScriptPath('savegame.exe')).toBe('Script/savegame.txt');
        });

        it('should handle paths with directories', () => {
            expect(deriveScriptPath('Maps/roman01.map')).toBe('Script/roman01.txt');
            expect(deriveScriptPath('C:\\Games\\Maps\\roman01.map')).toBe('Script/roman01.txt');
        });

        it('should return null for invalid inputs', () => {
            expect(deriveScriptPath('')).toBe(null);
            expect(deriveScriptPath('noextension')).toBe(null);
            expect(deriveScriptPath('file.txt')).toBe(null);
        });

        it('should be case-insensitive for extensions', () => {
            expect(deriveScriptPath('roman01.MAP')).toBe('Script/roman01.txt');
            expect(deriveScriptPath('roman01.Map')).toBe('Script/roman01.txt');
            expect(deriveScriptPath('roman01.EDM')).toBe('Script/roman01.txt');
        });
    });
});
