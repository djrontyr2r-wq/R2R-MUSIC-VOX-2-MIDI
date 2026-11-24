export type ScaleId =
  | 'chromatic'
  | 'major'
  | 'natural_minor'
  | 'harmonic_minor'
  | 'melodic_minor'
  | 'dorian'
  | 'mixolydian'
  | 'pentatonic_major'
  | 'pentatonic_minor'
  | 'blues'
  | 'raga_yaman'
  | 'raga_bhairav';

export type PitchTrackingMode = 'zero_latency' | 'balanced' | 'deep_bass';

export type PitchCorrectionMode = 'live_bend' | 'hard_snap' | 'legato_glide';

export type SynthTimbre = 'rhodes' | 'analog_lead' | 'sub_sine' | 'pluck' | 'mute';

export type InputSourceType = 'microphone' | 'test_phrase' | 'audio_file' | 'idle';

export interface DspParams {
  trackingMode: PitchTrackingMode;
  correctionMode: PitchCorrectionMode;
  gateThresholdDb: number;       // -60 to -12 dB
  yinConfidence: number;         // 0.08 to 0.30 (lower = stricter)
  minHoldMs: number;             // 0 to 40 ms hysteresis (0 = ultra zero latency)
  transientSensitivity: number;  // 0.0 to 1.0
  minFreqHz: number;             // 65 to 220 Hz
  maxFreqHz: number;             // 600 to 1600 Hz
  scaleId: ScaleId;
  rootNote: number;              // 0 = C .. 11 = B
  transposeSemitones: number;    // -24 to +24
  pitchBendRange: number;        // 2, 12, 24, 48
  velocityCurve: number;         // 0.5 to 2.0 (gamma)
  dryMix: number;                // 0.0 to 1.0
  synthMix: number;              // 0.0 to 1.0
  synthTimbre: SynthTimbre;
  midiChannel: number;           // 0 to 15
}

export interface LiveTelemetry {
  rmsDb: number;
  frequencyHz: number;
  midiNote: number;              // -1 if unvoiced
  centsOffset: number;           // -50 to +50
  confidence: number;            // 0.0 to 1.0
  pitchBendNormalized: number;   // -1.0 to +1.0
  velocity: number;              // 0 to 127
  isVoiced: boolean;
  sampleRate: number;
  blockLatencyMs: number;
  waveform: Float32Array;
}

export interface RecordedMidiNote {
  id: string;
  midi: number;
  velocity: number;
  startSec: number;
  endSec: number | null;         // null while currently held
  avgCents: number;
  peakFreqHz: number;
}

export interface PitchTracePoint {
  timeSec: number;
  midiFloat: number;             // Continuous fractional MIDI note (e.g. 60.42)
  voiced: boolean;
}

export interface MidiDeviceInfo {
  id: string;
  name: string;
  manufacturer: string;
}

export interface DspPreset {
  id: string;
  name: string;
  description: string;
  params: Partial<DspParams>;
}
