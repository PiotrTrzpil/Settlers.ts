import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { JSDOM } from 'jsdom';

// Set up DOMParser for Node environment
const dom = new JSDOM('');
(global as any).DOMParser = dom.window.DOMParser;

import { parseBuildingInfo } from '@/resources/game-data/building-info-parser';
import { parseJobInfo } from '@/resources/game-data/job-info-parser';
import { parseObjectInfo } from '@/resources/game-data/object-info-parser';

const GAME_DATA_PATH = join(__dirname, '../../public/Siedler4/GameData');

describe('Game Data XML Parsers', () => {
    describe('buildingInfo.xml parser', () => {
        let xmlContent: string;
        let parsed: ReturnType<typeof parseBuildingInfo>;

        beforeAll(() => {
            xmlContent = readFileSync(join(GAME_DATA_PATH, 'buildingInfo.xml'), 'utf-8');
            parsed = parseBuildingInfo(xmlContent);
        });

        it('should parse all races', () => {
            expect(parsed.size).toBeGreaterThanOrEqual(5);
            expect(parsed.has('RACE_ROMAN')).toBe(true);
            expect(parsed.has('RACE_VIKING')).toBe(true);
            expect(parsed.has('RACE_MAYA')).toBe(true);
            expect(parsed.has('RACE_DARK')).toBe(true);
            expect(parsed.has('RACE_TROJAN')).toBe(true);
        });

        it('should parse Roman buildings', () => {
            const roman = parsed.get('RACE_ROMAN');
            expect(roman).toBeDefined();
            expect(roman!.buildings.size).toBeGreaterThan(10);
        });

        it('should parse BUILDING_AMMOMAKERHUT correctly', () => {
            const roman = parsed.get('RACE_ROMAN');
            const ammoMaker = roman?.buildings.get('BUILDING_AMMOMAKERHUT');

            expect(ammoMaker).toBeDefined();
            expect(ammoMaker!.id).toBe('BUILDING_AMMOMAKERHUT');
            expect(ammoMaker!.hotSpotX).toBe(3);
            expect(ammoMaker!.hotSpotY).toBe(4);
            expect(ammoMaker!.stone).toBe(3);
            expect(ammoMaker!.boards).toBe(3);
            expect(ammoMaker!.gold).toBe(0);
            expect(ammoMaker!.builderNumber).toBe(3);
            expect(ammoMaker!.kind).toBe('HOUSE_KIND_WORKUP');
            expect(ammoMaker!.inhabitant).toBe('SETTLER_AMMOMAKER');
            expect(ammoMaker!.tool).toBe('GOOD_PICKAXE');
            expect(ammoMaker!.productionDelay).toBe(2);
        });

        it('should parse building position bitmask lines', () => {
            const roman = parsed.get('RACE_ROMAN');
            const ammoMaker = roman?.buildings.get('BUILDING_AMMOMAKERHUT');

            expect(ammoMaker!.lines).toBe(10);
            expect(ammoMaker!.buildingPosLines).toHaveLength(10);
            expect(ammoMaker!.buildingPosLines[0]).toBe(1879048192);
        });

        it('should parse bounding rect', () => {
            const roman = parsed.get('RACE_ROMAN');
            const ammoMaker = roman?.buildings.get('BUILDING_AMMOMAKERHUT');

            expect(ammoMaker!.boundingRect.minX).toBe(-3);
            expect(ammoMaker!.boundingRect.maxX).toBe(5);
            expect(ammoMaker!.boundingRect.minY).toBe(-4);
            expect(ammoMaker!.boundingRect.maxY).toBe(5);
        });

        it('should parse position offsets (flag, door, workingPos)', () => {
            const roman = parsed.get('RACE_ROMAN');
            const ammoMaker = roman?.buildings.get('BUILDING_AMMOMAKERHUT');

            expect(ammoMaker!.flag.xOffset).toBe(2);
            expect(ammoMaker!.flag.yOffset).toBe(5);
            expect(ammoMaker!.door.xOffset).toBe(3);
            expect(ammoMaker!.door.yOffset).toBe(1);
        });

        it('should parse resource piles', () => {
            const roman = parsed.get('RACE_ROMAN');
            const ammoMaker = roman?.buildings.get('BUILDING_AMMOMAKERHUT');

            expect(ammoMaker!.pileNumber).toBe(2);
            expect(ammoMaker!.piles).toHaveLength(2);

            const stonePile = ammoMaker!.piles[0];
            expect(stonePile.good).toBe('GOOD_STONE');
            expect(stonePile.xOffset).toBe(3);
            expect(stonePile.yOffset).toBe(3);

            const ammoPile = ammoMaker!.piles[1];
            expect(ammoPile.good).toBe('GOOD_AMMO');
        });

        it('should parse builder infos', () => {
            const roman = parsed.get('RACE_ROMAN');
            const ammoMaker = roman?.buildings.get('BUILDING_AMMOMAKERHUT');

            expect(ammoMaker!.builderInfos).toHaveLength(3);
            expect(ammoMaker!.builderInfos[0].xOffset).toBe(3);
            expect(ammoMaker!.builderInfos[0].yOffset).toBe(1);
            expect(ammoMaker!.builderInfos[0].dir).toBe(4);
        });

        it('should parse animLists', () => {
            const roman = parsed.get('RACE_ROMAN');
            const ammoMaker = roman?.buildings.get('BUILDING_AMMOMAKERHUT');

            expect(ammoMaker!.animLists).toContain('JOB_AMMOMAKER_WORK');
        });
    });

    describe('jobInfo.xml parser', () => {
        let xmlContent: string;
        let parsed: ReturnType<typeof parseJobInfo>;

        beforeAll(() => {
            xmlContent = readFileSync(join(GAME_DATA_PATH, 'jobInfo.xml'), 'utf-8');
            parsed = parseJobInfo(xmlContent);
        });

        it('should parse all races', () => {
            expect(parsed.size).toBeGreaterThanOrEqual(5);
            expect(parsed.has('RACE_ROMAN')).toBe(true);
        });

        it('should parse Roman jobs', () => {
            const roman = parsed.get('RACE_ROMAN');
            expect(roman).toBeDefined();
            expect(roman!.jobs.size).toBeGreaterThan(50);
        });

        it('should parse JOB_CARRIER_IDLE1 correctly', () => {
            const roman = parsed.get('RACE_ROMAN');
            const job = roman?.jobs.get('JOB_CARRIER_IDLE1');

            expect(job).toBeDefined();
            expect(job!.id).toBe('JOB_CARRIER_IDLE1');
            expect(job!.nodes).toHaveLength(2);

            const firstNode = job!.nodes[0];
            expect(firstNode.task).toBe('CEntityTask::WORK');
            expect(firstNode.jobPart).toBe('C_IDLE1');
            expect(firstNode.duration).toBe(0);
            expect(firstNode.dir).toBe(-1);
            expect(firstNode.forward).toBe(1);
            expect(firstNode.visible).toBe(1);

            const secondNode = job!.nodes[1];
            expect(secondNode.task).toBe('CEntityTask::WAIT');
            expect(secondNode.jobPart).toBe('C_WALK');
        });

        it('should parse strike jobs', () => {
            const roman = parsed.get('RACE_ROMAN');
            const goIntoStrike = roman?.jobs.get('JOB_CARRIER_GOINTO_STRIKE');
            const quitStrike = roman?.jobs.get('JOB_CARRIER_QUIT_STRIKE');

            expect(goIntoStrike).toBeDefined();
            expect(quitStrike).toBeDefined();
            expect(goIntoStrike!.nodes[0].jobPart).toBe('C_STRIKE1');
        });
    });

    describe('objectInfo.xml parser', () => {
        let xmlContent: string;
        let parsed: ReturnType<typeof parseObjectInfo>;

        beforeAll(() => {
            xmlContent = readFileSync(join(GAME_DATA_PATH, 'objectInfo.xml'), 'utf-8');
            parsed = parseObjectInfo(xmlContent);
        });

        it('should parse many objects', () => {
            expect(parsed.size).toBeGreaterThan(50);
        });

        it('should parse OBJECT_AGAVE correctly', () => {
            const agave = parsed.get('OBJECT_AGAVE');

            expect(agave).toBeDefined();
            expect(agave!.id).toBe('OBJECT_AGAVE');
            expect(agave!.blocking).toBe(0);
            expect(agave!.building).toBe(0);
            expect(agave!.repellent).toBe(1);
            expect(agave!.animType).toBe(0);
            expect(agave!.layer).toBe(0);
            expect(agave!.version).toBe(3);
        });

        it('should parse building objects', () => {
            const alchemist = parsed.get('OBJECT_ALCHEMIST');

            expect(alchemist).toBeDefined();
            expect(alchemist!.blocking).toBe(3);
            expect(alchemist!.building).toBe(1);
            expect(alchemist!.animType).toBe(1);
            expect(alchemist!.pingPong).toBe(1);
        });

        it('should parse bush objects', () => {
            const bush1 = parsed.get('OBJECT_BUSH1');

            expect(bush1).toBeDefined();
            expect(bush1!.blocking).toBe(0);
            expect(bush1!.building).toBe(0);
            expect(bush1!.version).toBe(1);
        });

        it('should parse cactus objects (blocking)', () => {
            const cactus1 = parsed.get('OBJECT_CACTUS1');

            expect(cactus1).toBeDefined();
            expect(cactus1!.blocking).toBe(1);
            expect(cactus1!.building).toBe(1);
        });
    });
});
