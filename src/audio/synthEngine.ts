import { SynthTimbre } from '../types/dsp';
import { midiToFreq } from '../utils/musicTheory';

interface ActiveVoice {
  midi: number;
  oscs: OscillatorNode[];
  gain: GainNode;
  filter: BiquadFilterNode;
  baseFreq: number;
}

export class MonitorSynthEngine {
  private ctx: AudioContext;
  private masterGain: GainNode;
  private voices = new Map<number, ActiveVoice>();
  private timbre: SynthTimbre = 'rhodes';
  private pitchBendRange = 2;
  private currentBendSemitones = 0;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.45;
    this.masterGain.connect(ctx.destination);
  }

  setMix(mix: number) {
    this.masterGain.gain.setTargetAtTime(Math.max(0, Math.min(1, mix)) * 0.65, this.ctx.currentTime, 0.008);
  }

  setTimbre(timbre: SynthTimbre) {
    if (timbre === 'mute') {
      this.allNotesOff();
    }
    this.timbre = timbre;
  }

  setPitchBendRange(range: number) {
    this.pitchBendRange = range;
  }

  noteOn(midi: number, velocity: number) {
    if (this.timbre === 'mute') return;
    if (this.voices.has(midi)) {
      this.noteOff(midi);
    }

    const now = this.ctx.currentTime;
    const baseFreq = midiToFreq(midi);
    const velGain = Math.max(0.08, Math.min(1, velocity / 127));

    const voiceGain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    voiceGain.connect(filter);
    filter.connect(this.masterGain);

    const oscs: OscillatorNode[] = [];

    if (this.timbre === 'rhodes') {
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      osc1.type = 'sine';
      osc2.type = 'triangle';
      osc1.frequency.setValueAtTime(baseFreq, now);
      osc2.frequency.setValueAtTime(baseFreq * 2, now);
      const subGain = this.ctx.createGain();
      subGain.gain.setValueAtTime(0.18, now);
      subGain.gain.exponentialRampToValueAtTime(0.02, now + 0.35);
      osc1.connect(voiceGain);
      osc2.connect(subGain);
      subGain.connect(voiceGain);
      filter.frequency.setValueAtTime(Math.min(6000, baseFreq * 8), now);
      voiceGain.gain.setValueAtTime(0.0001, now);
      voiceGain.gain.linearRampToValueAtTime(velGain * 0.42, now + 0.004);
      voiceGain.gain.exponentialRampToValueAtTime(velGain * 0.24, now + 0.28);
      osc1.start(now);
      osc2.start(now);
      oscs.push(osc1, osc2);
    } else if (this.timbre === 'analog_lead') {
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc2.type = 'sawtooth';
      osc1.frequency.setValueAtTime(baseFreq, now);
      osc2.frequency.setValueAtTime(baseFreq, now);
      osc1.detune.setValueAtTime(-7, now);
      osc2.detune.setValueAtTime(7, now);
      osc1.connect(voiceGain);
      osc2.connect(voiceGain);
      filter.frequency.setValueAtTime(Math.min(8000, baseFreq * 5 + 1400 * velGain), now);
      filter.Q.setValueAtTime(2.5, now);
      voiceGain.gain.setValueAtTime(0.0001, now);
      voiceGain.gain.linearRampToValueAtTime(velGain * 0.28, now + 0.003);
      osc1.start(now);
      osc2.start(now);
      oscs.push(osc1, osc2);
    } else if (this.timbre === 'sub_sine') {
      const osc1 = this.ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(baseFreq, now);
      osc1.connect(voiceGain);
      filter.frequency.setValueAtTime(2400, now);
      voiceGain.gain.setValueAtTime(0.0001, now);
      voiceGain.gain.linearRampToValueAtTime(velGain * 0.55, now + 0.004);
      osc1.start(now);
      oscs.push(osc1);
    } else if (this.timbre === 'pluck') {
      const osc1 = this.ctx.createOscillator();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(baseFreq, now);
      osc1.connect(voiceGain);
      filter.frequency.setValueAtTime(Math.min(9000, baseFreq * 10), now);
      filter.frequency.exponentialRampToValueAtTime(Math.max(250, baseFreq * 1.8), now + 0.22);
      voiceGain.gain.setValueAtTime(0.0001, now);
      voiceGain.gain.linearRampToValueAtTime(velGain * 0.45, now + 0.002);
      voiceGain.gain.exponentialRampToValueAtTime(0.06 * velGain, now + 0.35);
      osc1.start(now);
      oscs.push(osc1);
    }

    if (this.currentBendSemitones !== 0) {
      oscs.forEach((osc) => osc.detune.setValueAtTime(this.currentBendSemitones * 100, now));
    }

    this.voices.set(midi, { midi, oscs, gain: voiceGain, filter, baseFreq });
  }

  noteOff(midi: number) {
    const voice = this.voices.get(midi);
    if (!voice) return;
    this.voices.delete(midi);

    const now = this.ctx.currentTime;
    try {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), now);
      voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
      voice.oscs.forEach((osc) => osc.stop(now + 0.055));
    } catch {
      // Voice already stopped
    }
  }

  setPitchBend(normalized: number) {
    this.currentBendSemitones = normalized * this.pitchBendRange;
    const now = this.ctx.currentTime;
    const cents = this.currentBendSemitones * 100;
    this.voices.forEach((voice) => {
      voice.oscs.forEach((osc, idx) => {
        const baseDetune = this.timbre === 'analog_lead' ? (idx === 0 ? -7 : 7) : 0;
        osc.detune.setTargetAtTime(baseDetune + cents, now, 0.004);
      });
    });
  }

  allNotesOff() {
    for (const midi of Array.from(this.voices.keys())) {
      this.noteOff(midi);
    }
  }
}

export interface TestPhraseStep {
  midi: number;
  durationSec: number;
  glideToNext?: boolean;
  vibrato?: boolean;
}

export const TEST_PHRASES: Record<string, { label: string; steps: TestPhraseStep[] }> = {
  vocal_melody: {
    label: 'Pop Vocal Phrase (C Major)',
    steps: [
      { midi: 60, durationSec: 0.36, vibrato: true },
      { midi: 62, durationSec: 0.24 },
      { midi: 64, durationSec: 0.42, vibrato: true },
      { midi: 67, durationSec: 0.34 },
      { midi: 69, durationSec: 0.48, vibrato: true },
      { midi: 67, durationSec: 0.28 },
      { midi: 64, durationSec: 0.30 },
      { midi: 62, durationSec: 0.28 },
      { midi: 60, durationSec: 0.65, vibrato: true },
    ],
  },
  raga_yaman: {
    label: 'Sargam Vocal Run (Yaman)',
    steps: [
      { midi: 59, durationSec: 0.28 },
      { midi: 62, durationSec: 0.26 },
      { midi: 66, durationSec: 0.32, glideToNext: true },
      { midi: 67, durationSec: 0.40, vibrato: true },
      { midi: 69, durationSec: 0.28 },
      { midi: 71, durationSec: 0.32 },
      { midi: 72, durationSec: 0.60, vibrato: true },
      { midi: 71, durationSec: 0.25 },
      { midi: 69, durationSec: 0.25 },
      { midi: 67, durationSec: 0.30 },
      { midi: 66, durationSec: 0.28 },
      { midi: 64, durationSec: 0.30 },
      { midi: 62, durationSec: 0.28 },
      { midi: 60, durationSec: 0.65, vibrato: true },
    ],
  },
  bass_hum: {
    label: 'Baritone Bassline Hum',
    steps: [
      { midi: 45, durationSec: 0.45 },
      { midi: 45, durationSec: 0.25 },
      { midi: 48, durationSec: 0.35 },
      { midi: 50, durationSec: 0.40 },
      { midi: 52, durationSec: 0.45, vibrato: true },
      { midi: 50, durationSec: 0.30 },
      { midi: 48, durationSec: 0.30 },
      { midi: 45, durationSec: 0.65 },
    ],
  },
};

/**
 * Synthesizes a realistic human-like formant vocal signal directly into an AudioNode
 * so users can test VOX 2 MIDI conversion accurately even without a microphone.
 */
export function playTestVocalPhrase(
  ctx: AudioContext,
  phraseKey: string,
  destination: AudioNode,
  onComplete: () => void
): () => void {
  const phrase = TEST_PHRASES[phraseKey] ?? TEST_PHRASES.vocal_melody;
  const now = ctx.currentTime + 0.02;

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';

  // Formant filter bank simulating human "Ah" / "Oh" vowel resonance
  const formant1 = ctx.createBiquadFilter();
  formant1.type = 'bandpass';
  formant1.frequency.value = 720;
  formant1.Q.value = 4.2;

  const formant2 = ctx.createBiquadFilter();
  formant2.type = 'bandpass';
  formant2.frequency.value = 1220;
  formant2.Q.value = 5.5;

  const bodyLowpass = ctx.createBiquadFilter();
  bodyLowpass.type = 'lowpass';
  bodyLowpass.frequency.value = 2600;

  const vibratoLfo = ctx.createOscillator();
  vibratoLfo.frequency.value = 5.6;
  const vibratoGain = ctx.createGain();
  vibratoGain.gain.value = 0;

  vibratoLfo.connect(vibratoGain);
  vibratoGain.connect(osc.detune);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, now);

  osc.connect(formant1);
  osc.connect(formant2);
  formant1.connect(bodyLowpass);
  formant2.connect(bodyLowpass);
  bodyLowpass.connect(env);
  env.connect(destination);

  let t = now;
  phrase.steps.forEach((step, idx) => {
    const freq = midiToFreq(step.midi);
    const nextStep = phrase.steps[idx + 1];

    osc.frequency.setValueAtTime(freq, t);
    if (step.glideToNext && nextStep) {
      osc.frequency.linearRampToValueAtTime(midiToFreq(nextStep.midi), t + step.durationSec);
    }

    // Articulation envelope between syllables
    env.gain.setValueAtTime(0.001, t);
    env.gain.linearRampToValueAtTime(0.65, t + 0.025);
    env.gain.setValueAtTime(0.58, t + step.durationSec - 0.045);
    env.gain.linearRampToValueAtTime(0.002, t + step.durationSec - 0.005);

    if (step.vibrato) {
      vibratoGain.gain.setValueAtTime(0, t);
      vibratoGain.gain.linearRampToValueAtTime(28, t + 0.14);
      vibratoGain.gain.setValueAtTime(0, t + step.durationSec - 0.02);
    } else {
      vibratoGain.gain.setValueAtTime(0, t);
    }

    t += step.durationSec;
  });

  osc.start(now);
  vibratoLfo.start(now);
  osc.stop(t + 0.04);
  vibratoLfo.stop(t + 0.04);

  const timeoutId = window.setTimeout(() => {
    onComplete();
  }, Math.ceil((t - now) * 1000) + 60);

  return () => {
    window.clearTimeout(timeoutId);
    try {
      osc.stop();
      vibratoLfo.stop();
      env.disconnect();
    } catch {
      // Already stopped
    }
  };
}
