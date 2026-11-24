import React, { useEffect, useRef } from 'react';
import { LiveTelemetry } from '../types/dsp';

interface PitchMonitorCanvasProps {
  telemetryRef: React.MutableRefObject<LiveTelemetry>;
  gateThresholdDb: number;
  accentHex?: string;
}

export const PitchMonitorCanvas: React.FC<PitchMonitorCanvasProps> = ({
  telemetryRef,
  gateThresholdDb,
  accentHex = '#EF233C',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let rafId = 0;
    const freqHistory: number[] = new Array(160).fill(0);

    const render = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const w = Math.max(300, Math.floor(rect.width));
        const h = Math.max(120, Math.floor(rect.height));

        if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
          canvas.width = Math.floor(w * dpr);
          canvas.height = Math.floor(h * dpr);
        }

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.save();
          ctx.scale(dpr, dpr);

          // Recessed obsidian studio well
          ctx.fillStyle = '#09070B';
          ctx.fillRect(0, 0, w, h);

          // Subtle coordinate grid
          ctx.strokeStyle = '#1B141D';
          ctx.lineWidth = 1;
          for (let gx = 0; gx < w; gx += 48) {
            ctx.beginPath();
            ctx.moveTo(gx + 0.5, 0);
            ctx.lineTo(gx + 0.5, h);
            ctx.stroke();
          }
          const midY = Math.floor(h * 0.52);
          ctx.beginPath();
          ctx.moveTo(0, midY + 0.5);
          ctx.lineTo(w, midY + 0.5);
          ctx.stroke();

          const t = telemetryRef.current;
          freqHistory.push(t.isVoiced && t.frequencyHz > 0 ? t.frequencyHz : 0);
          if (freqHistory.length > 160) freqHistory.shift();

          // Draw live oscilloscope waveform
          const wf = t.waveform;
          if (wf && wf.length > 0) {
            ctx.beginPath();
            ctx.strokeStyle = t.isVoiced ? accentHex : 'rgba(148, 130, 144, 0.42)';
            ctx.lineWidth = 1.8;
            const stepX = w / Math.max(1, wf.length - 1);
            for (let i = 0; i < wf.length; i++) {
              const x = i * stepX;
              const y = midY - Math.max(-1, Math.min(1, wf[i] * 2.4)) * (h * 0.34);
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.stroke();
          }

          // Draw pitch stability contour
          ctx.beginPath();
          ctx.strokeStyle = 'rgba(245, 158, 11, 0.8)';
          ctx.lineWidth = 1.4;
          let started = false;
          for (let i = 0; i < freqHistory.length; i++) {
            const f = freqHistory[i];
            if (f <= 0) {
              started = false;
              continue;
            }
            const x = (i / (freqHistory.length - 1)) * w;
            const logNorm = Math.max(0, Math.min(1, (Math.log2(f) - Math.log2(65)) / 4.2));
            const y = h - 18 - logNorm * (h - 36);
            if (!started) {
              ctx.moveTo(x, y);
              started = true;
            } else {
              ctx.lineTo(x, y);
            }
          }
          ctx.stroke();

          // Precision Tuning Bar (-50c .. 0 .. +50c)
          const barY = h - 10;
          ctx.fillStyle = '#1B141D';
          ctx.fillRect(16, barY, w - 32, 4);

          const centerX = w / 2;
          ctx.fillStyle = '#473644';
          ctx.fillRect(centerX - 1, barY - 2, 2, 8);

          if (t.isVoiced) {
            const clampedCents = Math.max(-50, Math.min(50, t.centsOffset));
            const needleX = centerX + (clampedCents / 50) * ((w - 40) / 2);
            const inTune = Math.abs(clampedCents) <= 12;
            ctx.fillStyle = inTune ? '#10B981' : '#F59E0B';
            ctx.fillRect(needleX - 4, barY - 2, 8, 8);
          }

          // Input Level Meter on right edge
          const dbNorm = Math.max(0, Math.min(1, (t.rmsDb + 64) / 64));
          const gateNorm = Math.max(0, Math.min(1, (gateThresholdDb + 64) / 64));
          const meterX = w - 12;
          ctx.fillStyle = '#171119';
          ctx.fillRect(meterX, 8, 6, h - 24);
          const meterH = (h - 24) * dbNorm;
          ctx.fillStyle = t.rmsDb >= gateThresholdDb ? accentHex : '#524450';
          ctx.fillRect(meterX, 8 + (h - 24) - meterH, 6, meterH);

          // Gate marker line
          const gateY = 8 + (h - 24) * (1 - gateNorm);
          ctx.fillStyle = '#F59E0B';
          ctx.fillRect(meterX - 2, gateY, 10, 1.5);

          ctx.restore();
        }
      }
      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [telemetryRef, gateThresholdDb, accentHex]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-36 rounded border studio-well block"
    />
  );
};
