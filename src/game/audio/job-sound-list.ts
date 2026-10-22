/**
 * Parser for GameData/jobSoundList.xml — which animation (jobPart) plays which
 * sound, and on which animation frame (e.g. WC_CUT_TREE → WORK_AXE on frame 6).
 */

import { RemoteFile } from '@/utilities/remote-file';
import { toSoundName, type SoundName } from './sound-manifest';

export interface JobSound {
    sound: SoundName;
    /** Animation frame (0-based) on which the sound plays. */
    frame: number;
}

const JOB_RE = /<job\s+id="([^"]+)"\s*>([\s\S]*?)<\/job>/g;
const SOUND_RE = /<sound\s+id="([^"]+)"\s*>([\s\S]*?)<\/sound>/g;
const FRAME_RE = /<frame>\s*(\d+)\s*<\/frame>/g;

/**
 * Parse jobSoundList.xml into jobPart → sounds.
 * Sounds missing from the extracted set (e.g. WORK_FARMERFEED) simply don't play.
 */
export function parseJobSoundList(xml: string): Map<string, JobSound[]> {
    const result = new Map<string, JobSound[]>();
    const withoutComments = xml.replace(/<!--[\s\S]*?-->/g, '');

    for (const [, jobPart, jobBody] of withoutComments.matchAll(JOB_RE)) {
        const sounds: JobSound[] = [];
        for (const [, soundId, soundBody] of jobBody!.matchAll(SOUND_RE)) {
            const sound = toSoundName(soundId!);
            for (const [, frame] of soundBody!.matchAll(FRAME_RE)) {
                sounds.push({ sound, frame: parseInt(frame!, 10) });
            }
        }
        if (sounds.length > 0) {
            result.set(jobPart!, sounds);
        }
    }
    return result;
}

const JOB_SOUND_LIST_URL = '/Siedler4/GameData/jobSoundList.xml';

/** Fetch and parse jobSoundList.xml from the game assets. */
export async function loadJobSoundList(): Promise<Map<string, JobSound[]>> {
    const remoteFile = new RemoteFile();
    remoteFile.cacheEnabled = false; // tiny file
    return parseJobSoundList(await remoteFile.loadString(JOB_SOUND_LIST_URL));
}
