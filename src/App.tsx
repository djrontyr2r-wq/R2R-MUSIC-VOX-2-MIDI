import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Download,
  FileAudio,
  Mic,
  MicOff,
  Play,
  RefreshCw,
  Square,
  Trash2,
  VolumeX,
} from 'lucide-react';
import { Vox2MidiAudioEngine } from './audio/AudioEngine';
import { TEST_PHRASES } from './audio/synthEngine';
import { PianoRollCanvas } from './components/PianoRollCanvas';
import { PitchMonitorCanvas } from './components/PitchMonitorCanvas';
import { RotaryKnob } from './components/RotaryKnob';
import { VstExportView } from './components/VstExportView';
import { DEFAULT_DSP_PARAMS, FACTORY_PRESETS } from './constants/presets';
import {
  DspParams,
  InputSourceType,
  LiveTelemetry,
  MidiDeviceInfo,
  PitchCorrectionMode,
  PitchTracePoint,
  PitchTrackingMode,
  RecordedMidiNote,
  ScaleId,
  SynthTimbre,
} from './types/dsp';
import { encodeStandardMidiFile } from './utils/midiExport';
import { formatCents, midiToNoteName, NOTE_NAMES, SCALES } from './utils/musicTheory';

type ActiveTab = 'converter' | 'pianoroll' | 'vst3';
type StudioThemeId = 'rzr-crimson' | 'bronze-carbon' | 'velvet-indigo' | 'obsidian-teal';

interface StudioThemeConfig {
  id: StudioThemeId;
  label: string;
  className: string;
  accentHex: string;
}

const STUDIO_THEMES: StudioThemeConfig[] = [
  {
    id: 'rzr-crimson',
    label: 'RZR Crimson',
    className: 'theme-rzr-crimson',
    accentHex: '#EF233C',
  },
  {
    id: 'bronze-carbon',
    label: 'Bronze Carbon',
    className: 'theme-bronze-carbon',
    accentHex: '#F59E0B',
  },
  {
    id: 'velvet-indigo',
    label: 'Velvet Indigo',
    className: 'theme-velvet-indigo',
    accentHex: '#A855F7',
  },
  {
    id: 'obsidian-teal',
    label: 'Obsidian Teal',
    className: 'theme-obsidian-teal',
    accentHex: '#06B6D4',
  },
];

const INITIAL_TELEMETRY: LiveTelemetry = {
  rmsDb: -96,
  frequencyHz: 0,
  midiNote: -1,
  centsOffset: 0,
  confidence: 0,
  pitchBendNormalized: 0,
  velocity: 0,
  isVoiced: false,
  sampleRate: 48000,
  blockLatencyMs: 2.67,
  waveform: new Float32Array(128),
};

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('converter');
  const [themeId, setThemeId] = useState<StudioThemeId>('rzr-crimson');
  const [params, setParams] = useState<DspParams>(DEFAULT_DSP_PARAMS);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('zero_latency_lead');
  const [inputSource, setInputSource] = useState<InputSourceType>('idle');
  const [sourceLabel, setSourceLabel] = useState<string>('Standby');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [recordedNotes, setRecordedNotes] = useState<RecordedMidiNote[]>([]);
  const [pitchTrace, setPitchTrace] = useState<PitchTracePoint[]>([]);
  const [isRecording, setIsRecording] = useState<boolean>(true);
  const [isPlayingBack, setIsPlayingBack] = useState<boolean>(false);
  const [exportBpm, setExportBpm] = useState<number>(120);

  const [midiDevices, setMidiDevices] = useState<MidiDeviceInfo[]>([]);
  const [selectedMidiId, setSelectedMidiId] = useState<string>('');
  const [webMidiSupported, setWebMidiSupported] = useState<boolean>(false);

  const activeTheme = STUDIO_THEMES.find((t) => t.id === themeId) ?? STUDIO_THEMES[0];

  const telemetryRef = useRef<LiveTelemetry>(INITIAL_TELEMETRY);
  const [hudState, setHudState] = useState<{
    midiNote: number;
    frequencyHz: number;
    centsOffset: number;
    rmsDb: number;
    confidence: number;
    velocity: number;
    isVoiced: boolean;
    sampleRate: number;
    blockLatencyMs: number;
    hardwareLatencyMs: number;
  }>({
    midiNote: -1,
    frequencyHz: 0,
    centsOffset: 0,
    rmsDb: -96,
    confidence: 0,
    velocity: 0,
    isVoiced: false,
    sampleRate: 48000,
    blockLatencyMs: 2.67,
    hardwareLatencyMs: 0,
  });

  const engineRef = useRef<Vox2MidiAudioEngine | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const engine = new Vox2MidiAudioEngine(DEFAULT_DSP_PARAMS, {
      onTelemetry: (t) => {
        telemetryRef.current = t;
      },
      onNoteEvent: () => {
        // Handled immediately inside AudioEngine
      },
      onRecordedChange: (notes, trace) => {
        setRecordedNotes(notes);
        setPitchTrace(trace);
      },
      onSourceChange: (src, label) => {
        setInputSource(src);
        setSourceLabel(label);
      },
      onError: (msg) => {
        setErrorMsg(msg);
      },
    });

    engineRef.current = engine;
    setWebMidiSupported(engine.isWebMidiSupported());

    void engine.initWebMidi().then((devices) => {
      setMidiDevices(devices);
      engine.onMidiDevicesChange((updated) => setMidiDevices(updated));
    });

    const hudInterval = window.setInterval(() => {
      const t = telemetryRef.current;
      setHudState({
        midiNote: t.midiNote,
        frequencyHz: t.frequencyHz,
        centsOffset: t.centsOffset,
        rmsDb: t.rmsDb,
        confidence: t.confidence,
        velocity: t.velocity,
        isVoiced: t.isVoiced,
        sampleRate: t.sampleRate,
        blockLatencyMs: t.blockLatencyMs,
        hardwareLatencyMs: engine.getAudioLatencyMs(),
      });
    }, 45);

    return () => {
      window.clearInterval(hudInterval);
      engine.destroy();
    };
  }, []);

  const updateParam = useCallback(<K extends keyof DspParams>(key: K, value: DspParams[K]) => {
    setParams((prev) => {
      const next = { ...prev, [key]: value };
      engineRef.current?.updateParams(next);
      return next;
    });
  }, []);

  const applyPreset = (presetId: string) => {
    const preset = FACTORY_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setSelectedPresetId(presetId);
    setParams((prev) => {
      const next = { ...prev, ...preset.params };
      engineRef.current?.updateParams(next);
      return next;
    });
  };

  const handleToggleMic = async () => {
    setErrorMsg(null);
    if (inputSource === 'microphone') {
      engineRef.current?.stopCurrentInput();
    } else if (inputSource !== 'idle') {
      engineRef.current?.stopCurrentInput();
      await engineRef.current?.startMicrophone();
    } else {
      await engineRef.current?.startMicrophone();
    }
  };

  const handleStopAnyInput = () => {
    engineRef.current?.stopCurrentInput();
  };

  const handleTestPhrase = async (key: string) => {
    setErrorMsg(null);
    const phrase = TEST_PHRASES[key];
    await engineRef.current?.startTestPhrase(key, phrase?.label ?? 'Test Phrase');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    await engineRef.current?.playAudioFile(file);
    e.target.value = '';
  };

  const handleRefreshMidi = async () => {
    if (!engineRef.current) return;
    const devices = await engineRef.current.initWebMidi();
    setMidiDevices(devices);
  };

  const handleSelectMidiPort = (id: string) => {
    setSelectedMidiId(id);
    engineRef.current?.selectMidiOutput(id || null);
  };

  const handleToggleRecord = () => {
    const next = !isRecording;
    setIsRecording(next);
    engineRef.current?.setRecording(next);
  };

  const handlePlayback = async () => {
    if (isPlayingBack) {
      engineRef.current?.stopPlayback();
      setIsPlayingBack(false);
      return;
    }
    setIsPlayingBack(true);
    await engineRef.current?.playbackRecordedNotes(() => setIsPlayingBack(false));
  };

  const handleExportMidi = () => {
    const closed = recordedNotes.filter((n) => n.endSec !== null);
    if (closed.length === 0) return;
    const midiBytes = encodeStandardMidiFile(closed, exportBpm, params.midiChannel);
    const blob = new Blob([midiBytes.buffer as ArrayBuffer], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rzr-vox2midi-${Date.now()}.mid`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleQuantizeNotes = () => {
    const stepSec = 60 / Math.max(40, Math.min(240, exportBpm)) / 4;
    setRecordedNotes((prev) =>
      prev.map((n) => {
        if (n.endSec === null) return n;
        const qStart = Math.round(n.startSec / stepSec) * stepSec;
        const qDur = Math.max(stepSec, Math.round((n.endSec - n.startSec) / stepSec) * stepSec);
        return { ...n, startSec: qStart, endSec: qStart + qDur };
      })
    );
  };

  const closedNotesCount = recordedNotes.filter((n) => n.endSec !== null).length;

  return (
    <div className={`min-h-screen studio-backdrop ${activeTheme.className} text-slate-100 flex flex-col`}>
      {/* Top Bar: 3-zone contract */}
      <header className="border-b border-[var(--studio-border)] bg-[#0D0A0F]/90 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-[1440px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: RZR Music Logo + VOX 2 MIDI Wordmark */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('converter');
            }}
            className="flex items-center gap-3 whitespace-nowrap shrink-0"
          >
            <img
              src="/assets/aistudio/kh_a61a0305.png"
              alt="RZR Music"
              className="h-11 w-auto object-contain shrink-0"
            />
            <span className="font-display text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0">
              VOX 2 MIDI
            </span>
          </a>

          {/* Zone 2: Clean single-line navigation links */}
          <nav className="flex items-center gap-6 text-sm font-medium">
            <button
              onClick={() => setActiveTab('converter')}
              style={activeTab === 'converter' ? { borderColor: activeTheme.accentHex } : undefined}
              className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'converter'
                  ? 'text-slate-100'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Live Converter
            </button>
            <button
              onClick={() => setActiveTab('pianoroll')}
              style={activeTab === 'pianoroll' ? { borderColor: activeTheme.accentHex } : undefined}
              className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'pianoroll'
                  ? 'text-slate-100'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Piano Roll ({closedNotesCount})
            </button>
            <button
              onClick={() => setActiveTab('vst3')}
              style={activeTab === 'vst3' ? { borderColor: activeTheme.accentHex } : undefined}
              className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'vst3'
                  ? 'text-slate-100'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              VST3 C++ Export
            </button>
          </nav>

          {/* Zone 3: Primary Action */}
          <div className="flex items-center shrink-0">
            <button
              onClick={handleToggleMic}
              style={
                inputSource !== 'microphone'
                  ? { backgroundColor: activeTheme.accentHex }
                  : undefined
              }
              className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-md transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                inputSource === 'microphone'
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                  : 'hover:brightness-110 text-white'
              }`}
            >
              {inputSource === 'microphone' ? (
                <>
                  <MicOff className="w-3.5 h-3.5" />
                  Stop Microphone
                </>
              ) : (
                <>
                  <Mic className="w-3.5 h-3.5" />
                  Enable Microphone
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1440px] w-full mx-auto px-6 py-6 space-y-6">
        {errorMsg && (
          <div className="flex items-center justify-between gap-4 border border-amber-500/40 bg-amber-500/10 rounded-md px-4 py-3 text-sm text-amber-200">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button
              onClick={() => setErrorMsg(null)}
              className="text-xs font-medium text-amber-300 hover:text-white whitespace-nowrap cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {activeTab === 'vst3' ? (
          <VstExportView params={params} accentHex={activeTheme.accentHex} />
        ) : (
          <>
            {/* Workspace Control Strip: Presets, Chassis Finish, Test Signals & File Input */}
            <section className="flex flex-wrap items-center justify-between gap-4 border studio-panel rounded-lg px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="whitespace-nowrap">Preset</span>
                  <select
                    value={selectedPresetId}
                    onChange={(e) => applyPreset(e.target.value)}
                    className="studio-well border text-slate-100 text-xs rounded px-2.5 py-1.5 focus-visible:outline-none"
                  >
                    {FACTORY_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="whitespace-nowrap">Studio Finish</span>
                  <select
                    value={themeId}
                    onChange={(e) => setThemeId(e.target.value as StudioThemeId)}
                    className="studio-well border text-slate-100 text-xs rounded px-2.5 py-1.5 focus-visible:outline-none"
                  >
                    {STUDIO_THEMES.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>

                <span className="text-slate-700" aria-hidden="true">|</span>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-400 whitespace-nowrap">Test Signal:</span>
                  {Object.entries(TEST_PHRASES).map(([key, item]) => (
                    <button
                      key={key}
                      onClick={() => handleTestPhrase(key)}
                      className="px-2.5 py-1.5 text-xs font-medium bg-white/5 hover:bg-white/10 text-slate-200 border border-[var(--studio-border)] rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white/5 hover:bg-white/10 text-slate-200 border border-[var(--studio-border)] rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <FileAudio className="w-3.5 h-3.5" style={{ color: activeTheme.accentHex }} />
                  Load Vocal Audio
                </button>

                {inputSource !== 'idle' && (
                  <button
                    onClick={handleStopAnyInput}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/35 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Square className="w-3 h-3" />
                    Stop Source
                  </button>
                )}

                <button
                  onClick={() => engineRef.current?.panicAllNotesOff()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white/5 hover:bg-white/10 text-slate-300 border border-[var(--studio-border)] rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  title="Send All Notes Off (CC 123) to synth and WebMIDI"
                >
                  <VolumeX className="w-3.5 h-3.5 text-amber-400" />
                  Panic
                </button>
              </div>
            </section>

            {/* Primary Focal Anchor: RZR Music Faceplate + Real-Time Pitch Telemetry & Oscilloscope */}
            <section className="border studio-panel rounded-lg p-5 space-y-4">
              <div className="grid grid-cols-2 lg:grid-cols-6 gap-4 items-center">
                {/* Brand Faceplate Emblem */}
                <div className="flex items-center gap-3 pr-3 border-r border-[var(--studio-border)]">
                  <img
                    src="/assets/aistudio/kh_a61a0305.png"
                    alt="RZR Music Logo"
                    className="h-14 w-auto object-contain shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="font-display text-xs font-bold tracking-wider text-slate-100 truncate">
                      VOX 2 MIDI
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">
                      Zero-Latency DSP
                    </div>
                  </div>
                </div>

                {/* Active Note */}
                <div className="space-y-0.5">
                  <div className="text-xs text-slate-400">Detected Note</div>
                  <div className="flex items-baseline gap-2.5">
                    <span
                      className="font-mono text-3xl font-bold tabular-nums"
                      style={{ color: hudState.isVoiced ? activeTheme.accentHex : '#E2E8F0' }}
                    >
                      {hudState.isVoiced && hudState.midiNote >= 0
                        ? midiToNoteName(hudState.midiNote)
                        : '---'}
                    </span>
                    <span className="font-mono text-xs text-slate-400 tabular-nums">
                      {hudState.isVoiced && hudState.midiNote >= 0
                        ? `MIDI ${hudState.midiNote}`
                        : 'No Pitch'}
                    </span>
                  </div>
                </div>

                {/* Frequency & Cents */}
                <div className="space-y-0.5">
                  <div className="text-xs text-slate-400">Fundamental / Deviation</div>
                  <div className="flex items-baseline gap-2.5">
                    <span className="font-mono text-xl font-semibold text-slate-100 tabular-nums">
                      {hudState.isVoiced && hudState.frequencyHz > 0
                        ? `${hudState.frequencyHz.toFixed(2)} Hz`
                        : '0.00 Hz'}
                    </span>
                    <span
                      className={`font-mono text-xs tabular-nums ${
                        !hudState.isVoiced
                          ? 'text-slate-500'
                          : Math.abs(hudState.centsOffset) <= 12
                          ? 'text-emerald-400'
                          : 'text-amber-400'
                      }`}
                    >
                      {hudState.isVoiced ? formatCents(hudState.centsOffset) : '0c'}
                    </span>
                  </div>
                </div>

                {/* Velocity & Confidence */}
                <div className="space-y-0.5">
                  <div className="text-xs text-slate-400">Velocity / Confidence</div>
                  <div className="flex items-baseline gap-2.5">
                    <span className="font-mono text-xl font-semibold text-slate-100 tabular-nums">
                      {hudState.isVoiced ? hudState.velocity : 0}
                    </span>
                    <span className="font-mono text-xs text-slate-400 tabular-nums">
                      {Math.round(hudState.confidence * 100)}% lock
                    </span>
                  </div>
                </div>

                {/* Zero-Latency DSP Telemetry */}
                <div className="space-y-0.5">
                  <div className="text-xs text-slate-400">DSP Lookahead / Quantum</div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-xl font-semibold text-emerald-400 tabular-nums">
                      0.00 ms
                    </span>
                    <span className="font-mono text-xs text-slate-400 tabular-nums">
                      {hudState.blockLatencyMs.toFixed(2)} ms block
                    </span>
                  </div>
                </div>

                {/* Active Input State */}
                <div className="space-y-0.5 lg:text-right">
                  <div className="text-xs text-slate-400">Input Engine</div>
                  <div className="text-sm font-medium text-slate-200 truncate">
                    <span
                      className="mr-1.5"
                      style={{
                        color:
                          inputSource !== 'idle'
                            ? hudState.isVoiced
                              ? '#10B981'
                              : activeTheme.accentHex
                            : '#64748B',
                      }}
                    >
                      {inputSource !== 'idle' ? '●' : '○'}
                    </span>
                    {sourceLabel}
                  </div>
                  <div className="font-mono text-[11px] text-slate-400 tabular-nums">
                    {hudState.sampleRate} Hz ·{' '}
                    {hudState.rmsDb > -90 ? `${hudState.rmsDb.toFixed(1)} dBFS` : '-∞ dBFS'}
                  </div>
                </div>
              </div>

              <PitchMonitorCanvas
                telemetryRef={telemetryRef}
                gateThresholdDb={params.gateThresholdDb}
                accentHex={activeTheme.accentHex}
              />
            </section>

            {/* VST Parameter Rack */}
            {activeTab === 'converter' && (
              <section className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-stretch">
                {/* Module 1: Detector & Gate */}
                <div className="border studio-panel rounded-lg p-5 flex flex-col justify-between gap-5">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between border-b border-[var(--studio-border)] pb-2.5">
                      <h2 className="text-sm font-semibold text-slate-100">
                        01. Pitch Detector & Gate
                      </h2>
                      <span className="font-mono text-[11px] text-slate-400">Causal YIN</span>
                    </div>

                    <div className="space-y-1.5">
                      <span className="text-xs text-slate-400 block">Analysis Window</span>
                      <div className="grid grid-cols-3 gap-1 p-1 studio-well border rounded-md">
                        {(
                          [
                            ['zero_latency', 'Zero 384'],
                            ['balanced', 'Bal 512'],
                            ['deep_bass', 'Bass 768'],
                          ] as [PitchTrackingMode, string][]
                        ).map(([mode, label]) => {
                          const active = params.trackingMode === mode;
                          return (
                            <button
                              key={mode}
                              onClick={() => updateParam('trackingMode', mode)}
                              style={active ? { backgroundColor: activeTheme.accentHex } : undefined}
                              className={`py-1.5 px-2 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                                active
                                  ? 'text-white font-semibold'
                                  : 'text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-2 py-1">
                    <RotaryKnob
                      label="Gate"
                      value={params.gateThresholdDb}
                      min={-60}
                      max={-12}
                      step={1}
                      defaultValue={-44}
                      unit=" dB"
                      onChange={(v) => updateParam('gateThresholdDb', v)}
                      accent="amber"
                      accentHex={activeTheme.accentHex}
                    />
                    <RotaryKnob
                      label="Strictness"
                      value={params.yinConfidence}
                      min={0.08}
                      max={0.3}
                      step={0.01}
                      defaultValue={0.16}
                      formatValue={(v) => `${Math.round((1 - v) * 100)}%`}
                      onChange={(v) => updateParam('yinConfidence', v)}
                      accentHex={activeTheme.accentHex}
                    />
                    <RotaryKnob
                      label="Attack Sens"
                      value={params.transientSensitivity}
                      min={0}
                      max={1}
                      step={0.05}
                      defaultValue={0.6}
                      formatValue={(v) => `${Math.round(v * 100)}%`}
                      onChange={(v) => updateParam('transientSensitivity', v)}
                      accentHex={activeTheme.accentHex}
                    />
                    <RotaryKnob
                      label="Hold Delay"
                      value={params.minHoldMs}
                      min={0}
                      max={40}
                      step={1}
                      defaultValue={0}
                      unit=" ms"
                      onChange={(v) => updateParam('minHoldMs', v)}
                      accentHex={activeTheme.accentHex}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[var(--studio-border)]">
                    <label className="space-y-1">
                      <span className="text-[11px] text-slate-400 flex justify-between">
                        <span>Min Freq</span>
                        <span className="font-mono text-slate-200">{params.minFreqHz} Hz</span>
                      </span>
                      <input
                        type="range"
                        min={55}
                        max={220}
                        step={5}
                        value={params.minFreqHz}
                        onChange={(e) => updateParam('minFreqHz', Number(e.target.value))}
                        style={{ accentColor: activeTheme.accentHex }}
                        className="w-full"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11px] text-slate-400 flex justify-between">
                        <span>Max Freq</span>
                        <span className="font-mono text-slate-200">{params.maxFreqHz} Hz</span>
                      </span>
                      <input
                        type="range"
                        min={450}
                        max={1600}
                        step={25}
                        value={params.maxFreqHz}
                        onChange={(e) => updateParam('maxFreqHz', Number(e.target.value))}
                        style={{ accentColor: activeTheme.accentHex }}
                        className="w-full"
                      />
                    </label>
                  </div>
                </div>

                {/* Module 2: Scale Quantizer & Expression */}
                <div className="border studio-panel rounded-lg p-5 flex flex-col justify-between gap-5">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between border-b border-[var(--studio-border)] pb-2.5">
                      <h2 className="text-sm font-semibold text-slate-100">
                        02. Scale Quantizer & Bend
                      </h2>
                      <span className="font-mono text-[11px] text-slate-400">14-bit PB</span>
                    </div>

                    <div className="space-y-1.5">
                      <span className="text-xs text-slate-400 block">Pitch Tracking Mode</span>
                      <div className="grid grid-cols-3 gap-1 p-1 studio-well border rounded-md">
                        {(
                          [
                            ['live_bend', 'Live Bend'],
                            ['hard_snap', 'Hard Snap'],
                            ['legato_glide', 'Legato'],
                          ] as [PitchCorrectionMode, string][]
                        ).map(([mode, label]) => {
                          const active = params.correctionMode === mode;
                          return (
                            <button
                              key={mode}
                              onClick={() => updateParam('correctionMode', mode)}
                              style={active ? { backgroundColor: activeTheme.accentHex } : undefined}
                              className={`py-1.5 px-2 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                                active
                                  ? 'text-white font-semibold'
                                  : 'text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 py-1">
                    <RotaryKnob
                      label="Transpose"
                      value={params.transposeSemitones}
                      min={-24}
                      max={24}
                      step={1}
                      defaultValue={0}
                      formatValue={(v) => (v > 0 ? `+${v} st` : `${v} st`)}
                      onChange={(v) => updateParam('transposeSemitones', v)}
                      accentHex={activeTheme.accentHex}
                    />
                    <RotaryKnob
                      label="Bend Range"
                      value={params.pitchBendRange}
                      min={2}
                      max={48}
                      step={2}
                      defaultValue={2}
                      formatValue={(v) => `±${v} st`}
                      onChange={(v) => updateParam('pitchBendRange', v)}
                      accentHex={activeTheme.accentHex}
                    />
                    <RotaryKnob
                      label="Vel Curve"
                      value={params.velocityCurve}
                      min={0.5}
                      max={2.0}
                      step={0.05}
                      defaultValue={1.0}
                      onChange={(v) => updateParam('velocityCurve', v)}
                      accentHex={activeTheme.accentHex}
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2.5 pt-2 border-t border-[var(--studio-border)]">
                    <label className="space-y-1 col-span-1">
                      <span className="text-[11px] text-slate-400 block">Key Root</span>
                      <select
                        value={params.rootNote}
                        onChange={(e) => updateParam('rootNote', Number(e.target.value))}
                        className="w-full studio-well border text-slate-100 text-xs rounded px-2 py-1.5"
                      >
                        {NOTE_NAMES.map((name, idx) => (
                          <option key={name} value={idx}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1 col-span-2">
                      <span className="text-[11px] text-slate-400 block">Scale / Raga Lock</span>
                      <select
                        value={params.scaleId}
                        onChange={(e) => updateParam('scaleId', e.target.value as ScaleId)}
                        className="w-full studio-well border text-slate-100 text-xs rounded px-2 py-1.5"
                      >
                        {SCALES.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>

                {/* Module 3: Internal Synth & WebMIDI DAW Router */}
                <div className="border studio-panel rounded-lg p-5 flex flex-col justify-between gap-5">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between border-b border-[var(--studio-border)] pb-2.5">
                      <h2 className="text-sm font-semibold text-slate-100">
                        03. Synth & WebMIDI Out
                      </h2>
                      <span className="font-mono text-[11px] text-slate-400">
                        Ch {params.midiChannel + 1}
                      </span>
                    </div>

                    <label className="space-y-1.5 block">
                      <span className="text-xs text-slate-400 block">Monitor Instrument</span>
                      <select
                        value={params.synthTimbre}
                        onChange={(e) => updateParam('synthTimbre', e.target.value as SynthTimbre)}
                        className="w-full studio-well border text-slate-100 text-xs rounded px-2.5 py-1.5"
                      >
                        <option value="rhodes">Warm Electric Rhodes</option>
                        <option value="analog_lead">Analog Dual Saw Lead</option>
                        <option value="sub_sine">Studio Sub Sine</option>
                        <option value="pluck">Plucked Acoustic Harp</option>
                        <option value="mute">Mute Monitor (MIDI Only)</option>
                      </select>
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-4 py-1">
                    <RotaryKnob
                      label="MIDI Synth"
                      value={params.synthMix}
                      min={0}
                      max={1}
                      step={0.02}
                      defaultValue={0.72}
                      formatValue={(v) => `${Math.round(v * 100)}%`}
                      onChange={(v) => updateParam('synthMix', v)}
                      accentHex={activeTheme.accentHex}
                    />
                    <RotaryKnob
                      label="Dry Voice"
                      value={params.dryMix}
                      min={0}
                      max={1}
                      step={0.02}
                      defaultValue={0}
                      formatValue={(v) => `${Math.round(v * 100)}%`}
                      onChange={(v) => updateParam('dryMix', v)}
                      accent="amber"
                      accentHex={activeTheme.accentHex}
                    />
                  </div>

                  <div className="space-y-2 pt-2 border-t border-[var(--studio-border)]">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-slate-400">
                        DAW / Hardware MIDI Port
                      </span>
                      <button
                        onClick={handleRefreshMidi}
                        style={{ color: activeTheme.accentHex }}
                        className="inline-flex items-center gap-1 text-[11px] hover:brightness-125 cursor-pointer"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Scan
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <select
                        value={selectedMidiId}
                        onChange={(e) => handleSelectMidiPort(e.target.value)}
                        disabled={!webMidiSupported}
                        className="col-span-2 studio-well border text-slate-100 text-xs rounded px-2 py-1.5 disabled:opacity-50"
                      >
                        <option value="">
                          {!webMidiSupported
                            ? 'WebMIDI unavailable'
                            : midiDevices.length === 0
                            ? 'Internal Synth Only (No DAW Port)'
                            : 'Select MIDI Output...'}
                        </option>
                        {midiDevices.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>

                      <select
                        value={params.midiChannel}
                        onChange={(e) => updateParam('midiChannel', Number(e.target.value))}
                        className="col-span-1 studio-well border text-slate-100 text-xs rounded px-2 py-1.5"
                      >
                        {Array.from({ length: 16 }, (_, i) => (
                          <option key={i} value={i}>
                            Ch {i + 1}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* Interactive Piano Roll & Standard MIDI File Export */}
            <section className="border studio-panel rounded-lg p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <h2 className="text-sm font-semibold text-slate-100">
                    MIDI Capture Piano Roll
                  </h2>
                  <p className="text-xs text-slate-400">
                    Highlighted bars show converted MIDI notes · Amber trace shows raw vocal pitch · Click any key or note to audition
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    onClick={handleToggleRecord}
                    className={`px-3 py-1.5 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      isRecording
                        ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                        : 'bg-white/5 border-[var(--studio-border)] text-slate-400'
                    }`}
                  >
                    {isRecording ? 'Capture: Armed' : 'Capture: Paused'}
                  </button>

                  <button
                    onClick={handlePlayback}
                    disabled={closedNotesCount === 0}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white/5 hover:bg-white/10 disabled:opacity-40 text-slate-200 border border-[var(--studio-border)] rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {isPlayingBack ? (
                      <>
                        <Square className="w-3 h-3 text-amber-400" />
                        Stop Play
                      </>
                    ) : (
                      <>
                        <Play className="w-3 h-3" style={{ color: activeTheme.accentHex }} />
                        Play MIDI
                      </>
                    )}
                  </button>

                  <button
                    onClick={handleQuantizeNotes}
                    disabled={closedNotesCount === 0}
                    className="px-3 py-1.5 text-xs font-medium bg-white/5 hover:bg-white/10 disabled:opacity-40 text-slate-200 border border-[var(--studio-border)] rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Quantize 1/16
                  </button>

                  <button
                    onClick={() => engineRef.current?.clearRecording()}
                    disabled={recordedNotes.length === 0}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white/5 hover:bg-white/10 disabled:opacity-40 text-slate-300 border border-[var(--studio-border)] rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Clear
                  </button>

                  <label className="flex items-center gap-1.5 text-xs text-slate-400 pl-1">
                    <span>BPM</span>
                    <input
                      type="number"
                      min={40}
                      max={240}
                      value={exportBpm}
                      onChange={(e) => setExportBpm(Number(e.target.value) || 120)}
                      className="w-14 studio-well border rounded px-2 py-1 font-mono text-xs text-slate-100 tabular-nums"
                    />
                  </label>

                  <button
                    onClick={handleExportMidi}
                    disabled={closedNotesCount === 0}
                    style={{ backgroundColor: activeTheme.accentHex }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold hover:brightness-110 disabled:opacity-40 text-white rounded transition-all whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export .MID
                  </button>
                </div>
              </div>

              <PianoRollCanvas
                notes={recordedNotes}
                pitchTrace={pitchTrace}
                activeMidi={hudState.isVoiced ? hudState.midiNote : -1}
                scaleId={params.scaleId}
                rootNote={params.rootNote}
                accentHex={activeTheme.accentHex}
                onAuditionNote={(m) => void engineRef.current?.auditionNote(m)}
              />

              {activeTab === 'pianoroll' && (
                <div className="pt-2">
                  {closedNotesCount === 0 ? (
                    <div className="border border-dashed border-[var(--studio-border)] rounded-md py-8 text-center text-sm text-slate-400">
                      No MIDI notes captured yet. Enable your microphone or click a Test Signal above to record live vocal notes.
                    </div>
                  ) : (
                    <div className="overflow-x-auto border border-[var(--studio-border)] rounded-md">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="studio-well border-b border-[var(--studio-border)] text-slate-400">
                            <th className="py-2 px-3 font-medium">Note</th>
                            <th className="py-2 px-3 font-medium text-right">MIDI</th>
                            <th className="py-2 px-3 font-medium text-right">Freq (Hz)</th>
                            <th className="py-2 px-3 font-medium text-right">Velocity</th>
                            <th className="py-2 px-3 font-medium text-right">Start (s)</th>
                            <th className="py-2 px-3 font-medium text-right">Duration (ms)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--studio-border)] font-mono tabular-nums">
                          {recordedNotes
                            .filter((n) => n.endSec !== null)
                            .slice(-24)
                            .reverse()
                            .map((n) => (
                              <tr
                                key={n.id}
                                onClick={() => void engineRef.current?.auditionNote(n.midi, n.velocity)}
                                className="hover:bg-white/5 cursor-pointer transition-colors"
                              >
                                <td className="py-2 px-3 font-semibold" style={{ color: activeTheme.accentHex }}>
                                  {midiToNoteName(n.midi)}
                                </td>
                                <td className="py-2 px-3 text-right text-slate-300">{n.midi}</td>
                                <td className="py-2 px-3 text-right text-slate-300">
                                  {n.peakFreqHz.toFixed(2)}
                                </td>
                                <td className="py-2 px-3 text-right text-slate-300">{n.velocity}</td>
                                <td className="py-2 px-3 text-right text-slate-400">
                                  {n.startSec.toFixed(3)}
                                </td>
                                <td className="py-2 px-3 text-right text-slate-200">
                                  {Math.round(((n.endSec ?? n.startSec) - n.startSec) * 1000)}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
