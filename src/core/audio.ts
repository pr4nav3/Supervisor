

/**
 * Every recording and line plays at one level. A voice's recording is about 6 dB louder than
 * its generated lines (measured on the starter voices: speech near -19 dBFS against -25), so the
 * voice card's play button was much louder than a nudge. Each file's speech loudness is measured
 * once (20 ms blocks above -45 dBFS, so pauses don't count) and anything louder than the level
 * is turned down to it; quieter files play as they are. Volume only lowers, so nothing clips.
 */
const PLAY_LEVEL_DB = -25;
const playVolumes = new Map<string, Promise<number>>();

export function playVolume(url: string): Promise<number> {
  let volume = playVolumes.get(url);
  if (!volume) {
    volume = measureVolume(url);
    playVolumes.set(url, volume);
  }
  return volume;
}

async function measureVolume(url: string): Promise<number> {
  try {
    const bytes = await (await fetch(url)).arrayBuffer();
    const audio = await new OfflineAudioContext(1, 1, 44_100).decodeAudioData(bytes);
    const samples = audio.getChannelData(0);
    const block = Math.max(1, Math.round(audio.sampleRate * 0.02));
    const floor = 10 ** (-45 / 10);
    let total = 0;
    let blocks = 0;
    for (let start = 0; start + block <= samples.length; start += block) {
      let power = 0;
      for (let index = start; index < start + block; index += 1) {
        power += samples[index] * samples[index];
      }
      power /= block;
      if (power > floor) {
        total += power;
        blocks += 1;
      }
    }
    if (!blocks) {
      return 1;
    }
    const level = 10 * Math.log10(total / blocks);
    return Math.min(1, 10 ** ((PLAY_LEVEL_DB - level) / 20));
  } catch {
    return 1;
  }
}
