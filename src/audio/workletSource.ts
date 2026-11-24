/**
 * Self-contained AudioWorkletProcessor implementing a causal, zero-lookahead
 * YIN/CMNDF hybrid pitch detector with parabolic interpolation, octave
 * continuity lock, spectral-flux onset detection, and sample-immediate MIDI events.
 */
export const VOX2MIDI_WORKLET_CODE = `
class Vox2MidiProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ringSize = 2048;
    this.ring = new Float32Array(this.ringSize);
    this.linear = new Float32Array(this.ringSize);
    this.diff = new Float32Array(1200);
    this.cmndf = new Float32Array(1200);
    this.writeIndex = 0;
    this.prevSample = 0;
    this.prevRms = 0;

    // Default DSP parameters
    this.params = {
      trackingMode: 'zero_latency',
      correctionMode: 'live_bend',
      gateThresholdDb: -44,
      yinConfidence: 0.16,
      minHoldMs: 0,
      transientSensitivity: 0.55,
      minFreqHz: 75,
      maxFreqHz: 1200,
      transposeSemitones: 0,
      pitchBendRange: 2,
      velocityCurve: 1.0,
      allowedPitchClasses: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
    };

    // Note state machine
    this.activeMidi = -1;
    this.pendingMidi = -1;
    this.pendingFrames = 0;
    this.lastFreqHz = 0;
    this.lastPitchBend = 0;
    this.unvoicedFrames = 0;
    this.telemetryCounter = 0;

    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'params') {
        Object.assign(this.params, event.data.payload);
      } else if (event.data && event.data.type === 'reset') {
        if (this.activeMidi !== -1) {
          this.port.postMessage({ type: 'noteOff', midi: this.activeMidi, time: currentTime });
        }
        this.activeMidi = -1;
        this.pendingMidi = -1;
        this.pendingFrames = 0;
        this.lastFreqHz = 0;
        this.unvoicedFrames = 0;
      }
    };
  }

  quantizeMidi(midiFloat) {
    const allowed = this.params.allowedPitchClasses;
    const base = Math.round(midiFloat);
    let bestMidi = base;
    let minDistance = 1e9;
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
      centsOffset: (midiFloat - bestMidi) * 100
    };
  }

  computeVelocity(rmsDb) {
    const minDb = this.params.gateThresholdDb;
    const norm = Math.max(0, Math.min(1, (rmsDb - minDb) / Math.max(6, -minDb)));
    const curved = Math.pow(norm, this.params.velocityCurve);
    return Math.max(18, Math.min(127, Math.round(18 + curved * 109)));
  }

  process(inputs, outputs) {
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0]) {
      return true;
    }

    const ch0 = input[0];
    const ch1 = input.length > 1 ? input[1] : null;
    const blockLen = ch0.length;

    let sumSq = 0;
    let flux = 0;

    for (let i = 0; i < blockLen; i++) {
      const s = ch1 ? 0.5 * (ch0[i] + ch1[i]) : ch0[i];
      this.ring[this.writeIndex] = s;
      this.writeIndex = (this.writeIndex + 1) % this.ringSize;

      sumSq += s * s;
      const diffSample = Math.abs(s - this.prevSample);
      flux += diffSample;
      this.prevSample = s;
    }

    // Pass dry audio through to output if connected (zero-sample passthrough)
    if (outputs[0] && outputs[0].length > 0) {
      for (let c = 0; c < outputs[0].length; c++) {
        const src = input[Math.min(c, input.length - 1)];
        outputs[0][c].set(src);
      }
    }

    const rms = Math.sqrt(sumSq / blockLen);
    const rmsDb = 20 * Math.log10(rms + 1e-9);
    const avgFlux = flux / blockLen;
    const rmsJump = rms - this.prevRms;
    this.prevRms = rms;

    const isTransient =
      this.params.transientSensitivity > 0.05 &&
      rmsJump > (0.015 * (1.25 - this.params.transientSensitivity)) &&
      avgFlux > 0.006;

    // Gate check
    if (rmsDb < this.params.gateThresholdDb) {
      this.unvoicedFrames++;
      // Release quickly (1 block in zero-latency, 2 blocks otherwise)
      const releaseLimit = this.params.trackingMode === 'zero_latency' ? 1 : 2;
      if (this.activeMidi !== -1 && this.unvoicedFrames >= releaseLimit) {
        this.port.postMessage({ type: 'noteOff', midi: this.activeMidi, time: currentTime });
        this.activeMidi = -1;
        this.lastFreqHz = 0;
        this.pendingMidi = -1;
        this.pendingFrames = 0;
      }

      this.telemetryCounter++;
      if (this.telemetryCounter % 2 === 0) {
        this.port.postMessage({
          type: 'telemetry',
          rmsDb,
          frequencyHz: 0,
          midiNote: -1,
          centsOffset: 0,
          confidence: 0,
          pitchBendNormalized: 0,
          velocity: 0,
          isVoiced: false,
          sampleRate,
          blockLatencyMs: (blockLen / sampleRate) * 1000,
          waveform: ch0.slice(0)
        });
      }
      return true;
    }

    this.unvoicedFrames = 0;

    // Linearize causal ring buffer ending at most recent sample
    const tailLen = this.ringSize - this.writeIndex;
    this.linear.set(this.ring.subarray(this.writeIndex), 0);
    this.linear.set(this.ring.subarray(0, this.writeIndex), tailLen);

    // Causal integration window anchored at bufEnd - 1 (0 lookahead)
    const N =
      this.params.trackingMode === 'zero_latency'
        ? 384
        : this.params.trackingMode === 'balanced'
        ? 512
        : 768;

    const minTau = Math.max(12, Math.floor(sampleRate / Math.max(200, this.params.maxFreqHz)));
    const maxTau = Math.min(
      1150,
      Math.min(this.ringSize - N - 2, Math.floor(sampleRate / Math.max(45, this.params.minFreqHz)))
    );

    const diff = this.diff;
    const cmndf = this.cmndf;
    const buf = this.linear;
    const endIdx = this.ringSize - 1;

    diff[0] = 0;
    cmndf[0] = 1;
    let runningSum = 0;

    for (let tau = 1; tau <= maxTau; tau++) {
      let sum = 0;
      for (let j = 0; j < N; j++) {
        const a = buf[endIdx - j];
        const b = buf[endIdx - j - tau];
        const d = a - b;
        sum += d * d;
      }
      diff[tau] = sum;
      runningSum += sum;
      cmndf[tau] = runningSum > 1e-12 ? (sum * tau) / runningSum : 1;
    }

    // YIN threshold search
    const thresh = this.params.yinConfidence;
    let bestTau = -1;
    for (let tau = minTau; tau <= maxTau; tau++) {
      if (cmndf[tau] < thresh) {
        while (tau + 1 <= maxTau && cmndf[tau + 1] < cmndf[tau]) {
          tau++;
        }
        bestTau = tau;
        break;
      }
    }

    // Soft fallback if pitch is already locked during sustain
    if (bestTau === -1 && this.activeMidi !== -1) {
      let minVal = 1;
      let minIdx = -1;
      for (let tau = minTau; tau <= maxTau; tau++) {
        if (cmndf[tau] < minVal) {
          minVal = cmndf[tau];
          minIdx = tau;
        }
      }
      if (minVal < Math.min(0.35, thresh * 1.65)) {
        bestTau = minIdx;
      }
    }

    if (bestTau === -1) {
      this.telemetryCounter++;
      if (this.telemetryCounter % 2 === 0) {
        this.port.postMessage({
          type: 'telemetry',
          rmsDb,
          frequencyHz: 0,
          midiNote: this.activeMidi,
          centsOffset: 0,
          confidence: 0,
          pitchBendNormalized: this.lastPitchBend,
          velocity: 0,
          isVoiced: false,
          sampleRate,
          blockLatencyMs: (blockLen / sampleRate) * 1000,
          waveform: ch0.slice(0)
        });
      }
      return true;
    }

    // Octave continuity lock against sudden harmonic jumps
    if (this.lastFreqHz > 0 && !isTransient) {
      const prevTau = sampleRate / this.lastFreqHz;
      const ratio = bestTau / prevTau;
      if (ratio > 1.85 && ratio < 2.15) {
        const halfTau = Math.round(bestTau * 0.5);
        if (halfTau >= minTau && cmndf[halfTau] < thresh * 1.5) {
          bestTau = halfTau;
        }
      } else if (ratio > 0.46 && ratio < 0.54) {
        const doubleTau = Math.round(bestTau * 2);
        if (doubleTau <= maxTau && cmndf[doubleTau] < thresh * 1.5) {
          bestTau = doubleTau;
        }
      }
    }

    // Parabolic interpolation for sub-cent precision
    let betterTau = bestTau;
    if (bestTau > minTau && bestTau < maxTau) {
      const s0 = cmndf[bestTau - 1];
      const s1 = cmndf[bestTau];
      const s2 = cmndf[bestTau + 1];
      const denom = 2 * s1 - s2 - s0;
      if (Math.abs(denom) > 1e-9) {
        const shift = (s0 - s2) / (2 * denom);
        if (Math.abs(shift) <= 1.0) {
          betterTau = bestTau + shift;
        }
      }
    }

    const freqHz = sampleRate / betterTau;
    const confidence = Math.max(0, Math.min(1, 1 - cmndf[bestTau]));
    this.lastFreqHz = freqHz;

    const rawMidiFloat = 69 + 12 * Math.log2(freqHz / 440) + this.params.transposeSemitones;
    const quantized = this.quantizeMidi(rawMidiFloat);
    const targetMidi = quantized.midi;
    const velocity = this.computeVelocity(rmsDb);

    // Note triggering & hysteresis
    const blockMs = (blockLen / sampleRate) * 1000;
    const requiredHoldFrames = Math.max(1, Math.round(this.params.minHoldMs / blockMs) + 1);

    if (this.activeMidi === -1) {
      // Fresh note onset: instant on 0ms hold or transient
      if (this.params.minHoldMs <= 0 || isTransient) {
        this.activeMidi = targetMidi;
        this.pendingMidi = -1;
        this.pendingFrames = 0;
        this.port.postMessage({
          type: 'noteOn',
          midi: targetMidi,
          velocity,
          freqHz,
          centsOffset: quantized.centsOffset,
          time: currentTime
        });
      } else {
        if (this.pendingMidi === targetMidi) {
          this.pendingFrames++;
        } else {
          this.pendingMidi = targetMidi;
          this.pendingFrames = 1;
        }
        if (this.pendingFrames >= requiredHoldFrames) {
          this.activeMidi = targetMidi;
          this.pendingMidi = -1;
          this.pendingFrames = 0;
          this.port.postMessage({
            type: 'noteOn',
            midi: targetMidi,
            velocity,
            freqHz,
            centsOffset: quantized.centsOffset,
            time: currentTime
          });
        }
      }
    } else if (targetMidi !== this.activeMidi) {
      // Schmitt trigger deadzone (±62 cents from active note) unless transient
      const distFromActive = Math.abs(rawMidiFloat - this.activeMidi);
      if (isTransient || distFromActive > 0.62) {
        if (this.params.minHoldMs <= 0 || isTransient) {
          this.port.postMessage({ type: 'noteOff', midi: this.activeMidi, time: currentTime });
          this.activeMidi = targetMidi;
          this.pendingMidi = -1;
          this.pendingFrames = 0;
          this.port.postMessage({
            type: 'noteOn',
            midi: targetMidi,
            velocity,
            freqHz,
            centsOffset: quantized.centsOffset,
            time: currentTime
          });
        } else {
          if (this.pendingMidi === targetMidi) {
            this.pendingFrames++;
          } else {
            this.pendingMidi = targetMidi;
            this.pendingFrames = 1;
          }
          if (this.pendingFrames >= requiredHoldFrames) {
            this.port.postMessage({ type: 'noteOff', midi: this.activeMidi, time: currentTime });
            this.activeMidi = targetMidi;
            this.pendingMidi = -1;
            this.pendingFrames = 0;
            this.port.postMessage({
              type: 'noteOn',
              midi: targetMidi,
              velocity,
              freqHz,
              centsOffset: quantized.centsOffset,
              time: currentTime
            });
          }
        }
      }
    }

    // Continuous 14-bit Pitch Bend & Expression updates
    let pbNorm = 0;
    if (this.activeMidi !== -1 && this.params.correctionMode === 'live_bend') {
      const semitoneDelta = rawMidiFloat - this.activeMidi;
      pbNorm = Math.max(-1, Math.min(1, semitoneDelta / Math.max(1, this.params.pitchBendRange)));
      if (Math.abs(pbNorm - this.lastPitchBend) > 0.002) {
        this.lastPitchBend = pbNorm;
        this.port.postMessage({
          type: 'pitchBend',
          normalized: pbNorm,
          expression: velocity
        });
      }
    } else if (this.lastPitchBend !== 0) {
      this.lastPitchBend = 0;
      this.port.postMessage({ type: 'pitchBend', normalized: 0, expression: velocity });
    }

    this.telemetryCounter++;
    if (this.telemetryCounter % 2 === 0) {
      this.port.postMessage({
        type: 'telemetry',
        rmsDb,
        frequencyHz: freqHz,
        midiNote: this.activeMidi,
        centsOffset: quantized.centsOffset,
        confidence,
        pitchBendNormalized: pbNorm,
        velocity,
        isVoiced: true,
        sampleRate,
        blockLatencyMs: (blockLen / sampleRate) * 1000,
        waveform: ch0.slice(0)
      });
    }

    return true;
  }
}

registerProcessor('vox2midi-processor', Vox2MidiProcessor);
`;
