import { RecordedMidiNote } from '../types/dsp';

function writeVarLen(value: number): number[] {
  let v = Math.max(0, Math.floor(value));
  const buffer = [v & 0x7f];
  while ((v >>= 7) > 0) {
    buffer.push((v & 0x7f) | 0x80);
  }
  return buffer.reverse();
}

function writeUint32BE(val: number): number[] {
  return [
    (val >>> 24) & 0xff,
    (val >>> 16) & 0xff,
    (val >>> 8) & 0xff,
    val & 0xff,
  ];
}

function writeUint16BE(val: number): number[] {
  return [(val >>> 8) & 0xff, val & 0xff];
}

/**
 * Generates a valid Standard MIDI File (.mid, Format 0) from recorded notes.
 * Compatible with FL Studio, Ableton Live, Logic Pro, Cubase, and Reaper.
 */
export function encodeStandardMidiFile(
  notes: RecordedMidiNote[],
  bpm = 120,
  channel = 0
): Uint8Array {
  const ticksPerQuarter = 480;
  const microsecondsPerQuarter = Math.round(60_000_000 / Math.max(40, Math.min(240, bpm)));
  const ticksPerSecond = (ticksPerQuarter * bpm) / 60;

  // Normalize start times so recording starts cleanly at beat 0
  const closedNotes = notes.filter((n) => n.endSec !== null && n.endSec > n.startSec);
  const minStart = closedNotes.length > 0 ? Math.min(...closedNotes.map((n) => n.startSec)) : 0;

  interface MidiEvent {
    tick: number;
    status: number;
    data1: number;
    data2: number;
  }

  const events: MidiEvent[] = [];
  const ch = channel & 0x0f;

  for (const n of closedNotes) {
    const startTick = Math.max(0, Math.round((n.startSec - minStart) * ticksPerSecond));
    const endTick = Math.max(
      startTick + 12,
      Math.round(((n.endSec ?? n.startSec + 0.25) - minStart) * ticksPerSecond)
    );
    const noteNum = Math.max(0, Math.min(127, Math.round(n.midi)));
    const vel = Math.max(1, Math.min(127, Math.round(n.velocity)));

    events.push({ tick: startTick, status: 0x90 | ch, data1: noteNum, data2: vel });
    events.push({ tick: endTick, status: 0x80 | ch, data1: noteNum, data2: 0 });
  }

  // Sort chronologically; Note-Off before Note-On on identical ticks to avoid stuck notes
  events.sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    return (a.status & 0xf0) - (b.status & 0xf0);
  });

  const trackBytes: number[] = [];

  // Meta Event: Set Tempo (FF 51 03 tt tt tt)
  trackBytes.push(
    0x00,
    0xff,
    0x51,
    0x03,
    (microsecondsPerQuarter >>> 16) & 0xff,
    (microsecondsPerQuarter >>> 8) & 0xff,
    microsecondsPerQuarter & 0xff
  );

  // Meta Event: Track Name ("VOX 2 MIDI")
  const trackName = 'VOX 2 MIDI';
  trackBytes.push(0x00, 0xff, 0x03, trackName.length);
  for (let i = 0; i < trackName.length; i++) {
    trackBytes.push(trackName.charCodeAt(i));
  }

  let prevTick = 0;
  for (const ev of events) {
    const delta = Math.max(0, ev.tick - prevTick);
    prevTick = ev.tick;
    trackBytes.push(...writeVarLen(delta), ev.status, ev.data1, ev.data2);
  }

  // Meta Event: End of Track (FF 2F 00)
  trackBytes.push(0x00, 0xff, 0x2f, 0x00);

  const header: number[] = [
    // "MThd"
    0x4d, 0x54, 0x68, 0x64,
    ...writeUint32BE(6),
    ...writeUint16BE(0), // Format 0
    ...writeUint16BE(1), // 1 Track
    ...writeUint16BE(ticksPerQuarter),
    // "MTrk"
    0x4d, 0x54, 0x72, 0x6b,
    ...writeUint32BE(trackBytes.length),
    ...trackBytes,
  ];

  return new Uint8Array(header);
}
