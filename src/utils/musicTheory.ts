import { ScaleId } from '../types/dsp';

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export interface ScaleDefinition {
  id: ScaleId;
  label: string;
  intervals: number[];
}

export const SCALES: ScaleDefinition[] = [
  { id: 'chromatic', label: 'Chromatic (Exact)', intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { id: 'major', label: 'Major (Ionian)', intervals: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'natural_minor', label: 'Natural Minor (Aeolian)', intervals: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'harmonic_minor', label: 'Harmonic Minor', intervals: [0, 2, 3, 5, 7, 8, 11] },
  { id: 'melodic_minor', label: 'Melodic Minor', intervals: [0, 2, 3, 5, 7, 9, 11] },
  { id: 'dorian', label: 'Dorian Mode', intervals: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'mixolydian', label: 'Mixolydian Mode', intervals: [0, 2, 4, 5, 7, 9, 10] },
  { id: 'pentatonic_major', label: 'Pentatonic Major', intervals: [0, 2, 4, 7, 9] },
  { id: 'pentatonic_minor', label: 'Pentatonic Minor', intervals: [0, 3, 5, 7, 10] },
  { id: 'blues', label: 'Blues Scale', intervals: [0, 3, 5, 6, 7, 10] },
  { id: 'raga_yaman', label: 'Raga Yaman (Kalyan)', intervals: [0, 2, 4, 6, 7, 9, 11] },
  { id: 'raga_bhairav', label: 'Raga Bhairav', intervals: [0, 1, 4, 5, 7, 8, 11] },
];

export function freqToMidiFloat(freqHz: number): number {
  if (freqHz <= 0) return -1;
  return 69 + 12 * Math.log2(freqHz / 440);
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function midiToNoteName(midi: number): string {
  if (midi < 0 || midi > 127) return '---';
  const rounded = Math.round(midi);
  const name = NOTE_NAMES[((rounded % 12) + 12) % 12];
  const octave = Math.floor(rounded / 12) - 1;
  return `${name}${octave}`;
}

export function buildAllowedPitchClasses(scaleId: ScaleId, rootNote: number): boolean[] {
  const scale = SCALES.find((s) => s.id === scaleId) ?? SCALES[0];
  const allowed = new Array<boolean>(12).fill(false);
  for (const interval of scale.intervals) {
    allowed[(rootNote + interval) % 12] = true;
  }
  return allowed;
}

export function quantizeMidiToScale(
  midiFloat: number,
  scaleId: ScaleId,
  rootNote: number
): { midi: number; centsOffset: number } {
  if (scaleId === 'chromatic') {
    const rounded = Math.max(0, Math.min(127, Math.round(midiFloat)));
    return {
      midi: rounded,
      centsOffset: (midiFloat - rounded) * 100,
    };
  }

  const allowed = buildAllowedPitchClasses(scaleId, rootNote);
  const base = Math.round(midiFloat);
  let bestMidi = base;
  let minDistance = Infinity;

  for (let offset = -6; offset <= 6; offset++) {
    const candidate = base + offset;
    if (candidate < 0 || candidate > 127) continue;
    const pc = ((candidate % 12) + 12) % 12;
    if (!allowed[pc]) continue;
    const dist = Math.abs(midiFloat - candidate);
    if (dist < minDistance) {
      minDistance = dist;
      bestMidi = candidate;
    }
  }

  return {
    midi: bestMidi,
    centsOffset: (midiFloat - bestMidi) * 100,
  };
}

export function formatCents(cents: number): string {
  const rounded = Math.round(cents);
  if (rounded > 0) return `+${rounded}c`;
  return `${rounded}c`;
}
