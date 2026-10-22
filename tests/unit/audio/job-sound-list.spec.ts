/**
 * Unit tests for the jobSoundList.xml parser and sound id helpers.
 */

import { describe, it, expect } from 'vitest';
import { parseJobSoundList, toSoundName } from '@/game/audio';

const XML = `<?xml version="1.0"?>
<!-- edited by hand -->
<jobsoundlist>
  <job id="WC_CUT_TREE">
      <sound id="SOUND_WORK_AXE">
          <frame>6</frame>
      </sound>
  </job>
  <job id="BA_WORK_DOUGH">
  </job>
  <job id="FA_FEED">
      <sound id="SOUND_WORK_FARMERFEED"><frame>4</frame></sound>
  </job>
  <!-- <job id="COMMENTED"><sound id="SOUND_WORK_AXE"><frame>1</frame></sound></job> -->
</jobsoundlist>`;

describe('parseJobSoundList', () => {
    it('maps jobParts to sound + frame, skipping empty jobs and comments', () => {
        const jobs = parseJobSoundList(XML);
        expect([...jobs.keys()]).toEqual(['WC_CUT_TREE', 'FA_FEED']);
        expect(jobs.get('WC_CUT_TREE')).toEqual([{ sound: 'WORK_AXE', frame: 6 }]);
        expect(jobs.get('FA_FEED')).toEqual([{ sound: 'WORK_FARMERFEED', frame: 4 }]);
    });
});

describe('toSoundName', () => {
    it('strips the SOUND_ prefix used by the original data files', () => {
        expect(toSoundName('SOUND_WORK_AXE')).toBe('WORK_AXE');
        expect(toSoundName('WORK_AXE')).toBe('WORK_AXE');
    });
});
