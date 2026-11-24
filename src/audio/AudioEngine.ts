import {
  DspParams,
  InputSourceType,
  LiveTelemetry,
  MidiDeviceInfo,
  PitchTracePoint,
  RecordedMidiNote,
} from '../types/dsp';
import { buildAllowedPitchClasses, freqToMidiFloat } from '../utils/musicTheory';
import { WebMidiRouter } from './midiOutput';
import { MonitorSynthEngine, playTestVocalPhrase } from './synthEngine';
import { VOX2MIDI_WORKLET_CODE } from './workletSource';

export interface EngineCallbacks {
  onTelemetry: (telemetry: LiveTelemetry) => void;
  onNoteEvent: (type: 'noteOn' | 'noteOff', midi: number, velocity: number) => void;
  onRecordedChange: (notes: RecordedMidiNote[], trace: PitchTracePoint[]) => void;
  onSourceChange: (source: InputSourceType, label: string) => void;
  onError: (message: string) => void;
}

export class Vox2MidiAudioEngine {
  private ctx: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private dryGainNode: GainNode | null = null;
  private synth: MonitorSynthEngine | null = null;
  private midiRouter = new WebMidiRouter();

  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private fileSource: AudioBufferSourceNode | null = null;
  private stopTestPhraseFn: (() => void) | null = null;

  private params: DspParams;
  private callbacks: EngineCallbacks;

  private isRecording = true;
  private sessionStartTime = 0;
  private recordedNotes: RecordedMidiNote[] = [];
  private pitchTrace: PitchTracePoint[] = [];
  private openNoteId: string | null = null;
  private activeSource: InputSourceType = 'idle';
  private playbackTimers: number[] = [];

  constructor(initialParams: DspParams, callbacks: EngineCallbacks) {
    this.params = initialParams;
    this.callbacks = callbacks;
  }

  private async ensureContext(): Promise<AudioContext> {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx({ latencyHint: 'interactive' });
      this.synth = new MonitorSynthEngine(this.ctx);
      this.synth.setMix(this.params.synthMix);
      this.synth.setTimbre(this.params.synthTimbre);
      this.synth.setPitchBendRange(this.params.pitchBendRange);

      this.dryGainNode = this.ctx.createGain();
      this.dryGainNode.gain.value = this.params.dryMix;
      this.dryGainNode.connect(this.ctx.destination);

      const blob = new Blob([VOX2MIDI_WORKLET_CODE], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      try {
        await this.ctx.audioWorklet.addModule(blobUrl);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }

      this.workletNode = new AudioWorkletNode(this.ctx, 'vox2midi-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });

      this.workletNode.connect(this.dryGainNode);
      this.workletNode.port.onmessage = (e) => this.handleWorkletMessage(e.data);
      this.sessionStartTime = this.ctx.currentTime;
      this.pushParamsToWorklet();
    }

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    return this.ctx;
  }

  private handleWorkletMessage(msg: Record<string, unknown>) {
    if (!this.ctx) return;
    const nowSec = Math.max(0, this.ctx.currentTime - this.sessionStartTime);

    if (msg.type === 'noteOn') {
      const midi = msg.midi as number;
      const velocity = msg.velocity as number;
      const freqHz = msg.freqHz as number;
      const centsOffset = msg.centsOffset as number;

      this.synth?.noteOn(midi, velocity);
      this.midiRouter.sendNoteOn(this.params.midiChannel, midi, velocity);
      this.callbacks.onNoteEvent('noteOn', midi, velocity);

      if (this.isRecording) {
        if (this.openNoteId) {
          const prev = this.recordedNotes.find((n) => n.id === this.openNoteId);
          if (prev && prev.endSec === null) prev.endSec = nowSec;
        }
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        this.openNoteId = id;
        this.recordedNotes.push({
          id,
          midi,
          velocity,
          startSec: nowSec,
          endSec: null,
          avgCents: centsOffset,
          peakFreqHz: freqHz,
        });
        this.callbacks.onRecordedChange([...this.recordedNotes], this.pitchTrace);
      }
    } else if (msg.type === 'noteOff') {
      const midi = msg.midi as number;
      this.synth?.noteOff(midi);
      this.midiRouter.sendNoteOff(this.params.midiChannel, midi);
      this.callbacks.onNoteEvent('noteOff', midi, 0);

      if (this.isRecording && this.openNoteId) {
        const prev = this.recordedNotes.find((n) => n.id === this.openNoteId);
        if (prev && prev.endSec === null) {
          prev.endSec = Math.max(prev.startSec + 0.015, nowSec);
        }
        this.openNoteId = null;
        this.callbacks.onRecordedChange([...this.recordedNotes], this.pitchTrace);
      }
    } else if (msg.type === 'pitchBend') {
      const norm = msg.normalized as number;
      const expr = msg.expression as number;
      if (this.params.correctionMode === 'live_bend') {
        this.synth?.setPitchBend(norm);
        this.midiRouter.sendPitchBend(this.params.midiChannel, norm);
      }
      this.midiRouter.sendExpression(this.params.midiChannel, expr);
    } else if (msg.type === 'telemetry') {
      const telemetry = msg as unknown as LiveTelemetry;
      this.callbacks.onTelemetry(telemetry);

      if (this.isRecording && this.activeSource !== 'idle') {
        const midiFloat =
          telemetry.isVoiced && telemetry.frequencyHz > 0
            ? freqToMidiFloat(telemetry.frequencyHz) + this.params.transposeSemitones
            : -1;
        this.pitchTrace.push({
          timeSec: nowSec,
          midiFloat,
          voiced: telemetry.isVoiced && midiFloat > 0,
        });
        if (this.pitchTrace.length > 4000) {
          this.pitchTrace.splice(0, this.pitchTrace.length - 4000);
        }
      }
    }
  }

  updateParams(next: DspParams) {
    this.params = next;
    if (this.dryGainNode && this.ctx) {
      this.dryGainNode.gain.setTargetAtTime(next.dryMix, this.ctx.currentTime, 0.01);
    }
    this.synth?.setMix(next.synthMix);
    this.synth?.setTimbre(next.synthTimbre);
    this.synth?.setPitchBendRange(next.pitchBendRange);
    this.pushParamsToWorklet();
  }

  private pushParamsToWorklet() {
    if (!this.workletNode) return;
    const allowed = buildAllowedPitchClasses(this.params.scaleId, this.params.rootNote).map((b) =>
      b ? 1 : 0
    );
    this.workletNode.port.postMessage({
      type: 'params',
      payload: {
        trackingMode: this.params.trackingMode,
        correctionMode: this.params.correctionMode,
        gateThresholdDb: this.params.gateThresholdDb,
        yinConfidence: this.params.yinConfidence,
        minHoldMs: this.params.minHoldMs,
        transientSensitivity: this.params.transientSensitivity,
        minFreqHz: this.params.minFreqHz,
        maxFreqHz: this.params.maxFreqHz,
        transposeSemitones: this.params.transposeSemitones,
        pitchBendRange: this.params.pitchBendRange,
        velocityCurve: this.params.velocityCurve,
        allowedPitchClasses: allowed,
      },
    });
  }

  async initWebMidi(): Promise<MidiDeviceInfo[]> {
    return this.midiRouter.init();
  }

  isWebMidiSupported(): boolean {
    return this.midiRouter.isSupported();
  }

  selectMidiOutput(deviceId: string | null) {
    this.midiRouter.selectOutput(deviceId);
  }

  onMidiDevicesChange(cb: (devices: MidiDeviceInfo[]) => void) {
    this.midiRouter.onStateChange(cb);
  }

  async startMicrophone(): Promise<void> {
    this.stopCurrentInput();
    try {
      const ctx = await this.ensureContext();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });
      this.micStream = stream;
      this.micSource = ctx.createMediaStreamSource(stream);
      if (this.workletNode) {
        this.micSource.connect(this.workletNode);
      }
      this.activeSource = 'microphone';
      this.callbacks.onSourceChange('microphone', 'Live Microphone Input');
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Microphone access denied or unavailable.';
      this.callbacks.onError(message);
      this.activeSource = 'idle';
      this.callbacks.onSourceChange('idle', 'Stopped');
    }
  }

  async startTestPhrase(phraseKey: string, label: string): Promise<void> {
    this.stopCurrentInput();
    const ctx = await this.ensureContext();
    if (!this.workletNode) return;

    this.activeSource = 'test_phrase';
    this.callbacks.onSourceChange('test_phrase', label);

    this.stopTestPhraseFn = playTestVocalPhrase(ctx, phraseKey, this.workletNode, () => {
      if (this.activeSource === 'test_phrase') {
        this.stopCurrentInput();
      }
    });
  }

  async playAudioFile(file: File): Promise<void> {
    this.stopCurrentInput();
    try {
      const ctx = await this.ensureContext();
      if (!this.workletNode) return;
      const arrayBuf = await file.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arrayBuf);
      const src = ctx.createBufferSource();
      src.buffer = decoded;
      src.connect(this.workletNode);
      src.onended = () => {
        if (this.fileSource === src) {
          this.stopCurrentInput();
        }
      };
      this.fileSource = src;
      this.activeSource = 'audio_file';
      this.callbacks.onSourceChange('audio_file', file.name);
      src.start();
    } catch {
      this.callbacks.onError('Could not decode audio file. Please try WAV, MP3, or OGG.');
      this.stopCurrentInput();
    }
  }

  stopCurrentInput() {
    if (this.stopTestPhraseFn) {
      this.stopTestPhraseFn();
      this.stopTestPhraseFn = null;
    }
    if (this.fileSource) {
      try {
        this.fileSource.stop();
        this.fileSource.disconnect();
      } catch {
        // Ignore
      }
      this.fileSource = null;
    }
    if (this.micSource) {
      this.micSource.disconnect();
      this.micSource = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    this.workletNode?.port.postMessage({ type: 'reset' });
    this.synth?.allNotesOff();
    this.midiRouter.panic(this.params.midiChannel);
    this.activeSource = 'idle';
    this.callbacks.onSourceChange('idle', 'Standby');
  }

  setRecording(enabled: boolean) {
    this.isRecording = enabled;
  }

  clearRecording() {
    this.recordedNotes = [];
    this.pitchTrace = [];
    this.openNoteId = null;
    if (this.ctx) {
      this.sessionStartTime = this.ctx.currentTime;
    }
    this.callbacks.onRecordedChange([], []);
  }

  async auditionNote(midi: number, velocity = 100, durationMs = 240) {
    await this.ensureContext();
    this.synth?.noteOn(midi, velocity);
    this.midiRouter.sendNoteOn(this.params.midiChannel, midi, velocity);
    window.setTimeout(() => {
      this.synth?.noteOff(midi);
      this.midiRouter.sendNoteOff(this.params.midiChannel, midi);
    }, durationMs);
  }

  async playbackRecordedNotes(onComplete?: () => void) {
    this.stopPlayback();
    await this.ensureContext();
    const closed = this.recordedNotes.filter((n) => n.endSec !== null);
    if (closed.length === 0) {
      onComplete?.();
      return;
    }
    const minStart = Math.min(...closed.map((n) => n.startSec));
    let maxEnd = 0;

    for (const note of closed) {
      const startMs = Math.max(0, (note.startSec - minStart) * 1000);
      const endMs = Math.max(startMs + 30, ((note.endSec ?? note.startSec + 0.2) - minStart) * 1000);
      maxEnd = Math.max(maxEnd, endMs);

      const t1 = window.setTimeout(() => {
        this.synth?.noteOn(note.midi, note.velocity);
        this.midiRouter.sendNoteOn(this.params.midiChannel, note.midi, note.velocity);
      }, startMs);

      const t2 = window.setTimeout(() => {
        this.synth?.noteOff(note.midi);
        this.midiRouter.sendNoteOff(this.params.midiChannel, note.midi);
      }, endMs);

      this.playbackTimers.push(t1, t2);
    }

    const doneTimer = window.setTimeout(() => {
      onComplete?.();
    }, maxEnd + 80);
    this.playbackTimers.push(doneTimer);
  }

  stopPlayback() {
    for (const id of this.playbackTimers) {
      window.clearTimeout(id);
    }
    this.playbackTimers = [];
    this.synth?.allNotesOff();
    this.midiRouter.panic(this.params.midiChannel);
  }

  panicAllNotesOff() {
    this.stopPlayback();
    this.workletNode?.port.postMessage({ type: 'reset' });
    this.synth?.allNotesOff();
    this.midiRouter.panic(this.params.midiChannel);
  }

  getAudioLatencyMs(): number {
    if (!this.ctx) return 0;
    const base = (this.ctx.baseLatency ?? 0) * 1000;
    const out = (this.ctx.outputLatency ?? 0) * 1000;
    return base + out;
  }

  destroy() {
    this.stopCurrentInput();
    this.stopPlayback();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
