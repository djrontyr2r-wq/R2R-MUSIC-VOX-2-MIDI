import React, { useEffect, useRef } from 'react';
import { PitchTracePoint, RecordedMidiNote, ScaleId } from '../types/dsp';
import { buildAllowedPitchClasses, midiToNoteName } from '../utils/musicTheory';

interface PianoRollCanvasProps {
  notes: RecordedMidiNote[];
  pitchTrace: PitchTracePoint[];
  activeMidi: number;
  scaleId: ScaleId;
  rootNote: number;
  accentHex?: string;
  onAuditionNote: (midi: number) => void;
}

const MIN_MIDI = 36; // C2
const MAX_MIDI = 84; // C6
const KEY_WIDTH = 44;

export const PianoRollCanvas: React.FC<PianoRollCanvasProps> = ({
  notes,
  pitchTrace,
  activeMidi,
  scaleId,
  rootNote,
  accentHex = '#EF233C',
  onAuditionNote,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hitZonesRef = useRef<{ x: number; y: number; w: number; h: number; midi: number }[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(480, Math.floor(rect.width));
    const h = Math.max(260, Math.floor(rect.height));

    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#09070B';
    ctx.fillRect(0, 0, w, h);

    const numRows = MAX_MIDI - MIN_MIDI + 1;
    const rowH = h / numRows;
    const allowed = buildAllowedPitchClasses(scaleId, rootNote);

    const noteEndMax = notes.reduce(
      (acc, n) => Math.max(acc, n.endSec ?? n.startSec + 0.3),
      0
    );
    const traceEndMax = pitchTrace.length > 0 ? pitchTrace[pitchTrace.length - 1].timeSec : 0;
    const maxTime = Math.max(6, Math.max(noteEndMax, traceEndMax) + 0.4);
    const windowSec = Math.max(6, Math.min(18, maxTime));
    const viewStart = Math.max(0, maxTime - windowSec);
    const timelineW = w - KEY_WIDTH;

    const timeToX = (t: number) => KEY_WIDTH + ((t - viewStart) / windowSec) * timelineW;
    const midiToY = (m: number) => (MAX_MIDI - m) * rowH;

    // 1. Horizontal lanes & Piano Keys
    const newHitZones: { x: number; y: number; w: number; h: number; midi: number }[] = [];

    for (let m = MIN_MIDI; m <= MAX_MIDI; m++) {
      const y = midiToY(m);
      const pc = m % 12;
      const isBlack = [1, 3, 6, 8, 10].includes(pc);
      const inScale = allowed[pc];
      const isActive = m === activeMidi;

      if (isActive) {
        ctx.fillStyle = `${accentHex}29`;
      } else if (isBlack) {
        ctx.fillStyle = '#0C090F';
      } else {
        ctx.fillStyle = inScale ? '#141017' : '#0E0B11';
      }
      ctx.fillRect(KEY_WIDTH, y, timelineW, rowH);

      ctx.fillStyle = pc === 0 ? '#2D222C' : '#18121B';
      ctx.fillRect(KEY_WIDTH, y + rowH - 0.5, timelineW, 0.5);

      if (isActive) {
        ctx.fillStyle = accentHex;
      } else if (isBlack) {
        ctx.fillStyle = '#19131C';
      } else {
        ctx.fillStyle = '#E2E8F0';
      }
      ctx.fillRect(0, y + 0.5, KEY_WIDTH - 2, Math.max(2, rowH - 1));

      if (pc === 0 || isActive) {
        ctx.fillStyle = isActive ? '#FFFFFF' : '#271E26';
        ctx.font = '600 9px "IBM Plex Mono", monospace';
        ctx.textBaseline = 'middle';
        ctx.fillText(midiToNoteName(m), 5, y + rowH / 2);
      }

      newHitZones.push({ x: 0, y, w: KEY_WIDTH, h: rowH, midi: m });
    }

    // 2. Vertical time gridlines
    const firstSec = Math.ceil(viewStart);
    for (let sec = firstSec; sec <= maxTime; sec += 0.5) {
      const x = timeToX(sec);
      if (x < KEY_WIDTH) continue;
      const isWhole = Math.abs(sec - Math.round(sec)) < 0.01;
      ctx.fillStyle = isWhole ? '#2B2029' : '#171119';
      ctx.fillRect(x, 0, 1, h);
      if (isWhole) {
        ctx.fillStyle = '#857180';
        ctx.font = '400 10px "IBM Plex Mono", monospace';
        ctx.fillText(`${sec.toFixed(0)}s`, x + 4, 12);
      }
    }

    // 3. Recorded MIDI Note Blocks
    for (const n of notes) {
      const end = n.endSec ?? maxTime - 0.2;
      if (end < viewStart || n.startSec > maxTime) continue;
      if (n.midi < MIN_MIDI || n.midi > MAX_MIDI) continue;

      const x1 = Math.max(KEY_WIDTH, timeToX(n.startSec));
      const x2 = Math.min(w, timeToX(end));
      const bw = Math.max(4, x2 - x1);
      const y = midiToY(n.midi) + 1;
      const bh = Math.max(4, rowH - 2);

      const isLive = n.endSec === null;
      ctx.fillStyle = isLive ? accentHex : `${accentHex}CC`;
      ctx.fillRect(x1, y, bw, bh);

      // Velocity highlight stripe
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.fillRect(x1, y, bw, Math.max(1.5, bh * 0.22));

      ctx.strokeStyle = '#FFFFFF33';
      ctx.lineWidth = 1;
      ctx.strokeRect(x1 + 0.5, y + 0.5, bw - 1, bh - 1);

      if (bw > 24) {
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '600 9px "IBM Plex Mono", monospace';
        ctx.textBaseline = 'middle';
        ctx.fillText(midiToNoteName(n.midi), x1 + 4, y + bh / 2);
      }

      newHitZones.push({ x: x1, y, w: bw, h: bh, midi: n.midi });
    }

    // 4. Continuous Vocal Pitch Curve Overlay
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.88)';
    ctx.lineWidth = 1.5;
    let tracing = false;
    for (const pt of pitchTrace) {
      if (pt.timeSec < viewStart || !pt.voiced || pt.midiFloat < MIN_MIDI || pt.midiFloat > MAX_MIDI) {
        tracing = false;
        continue;
      }
      const x = timeToX(pt.timeSec);
      const y = midiToY(pt.midiFloat) + rowH / 2;
      if (!tracing) {
        ctx.moveTo(x, y);
        tracing = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Key divider line
    ctx.fillStyle = '#2F242D';
    ctx.fillRect(KEY_WIDTH - 1, 0, 1.5, h);

    hitZonesRef.current = newHitZones;
    ctx.restore();
  }, [notes, pitchTrace, activeMidi, scaleId, rootNote, accentHex]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    for (let i = hitZonesRef.current.length - 1; i >= 0; i--) {
      const z = hitZonesRef.current[i];
      if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) {
        onAuditionNote(z.midi);
        break;
      }
    }
  };

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      className="w-full h-[300px] rounded border studio-well cursor-pointer block"
      title="Click any piano key or MIDI note block to audition"
    />
  );
};
