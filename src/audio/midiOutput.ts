import { MidiDeviceInfo } from '../types/dsp';

export class WebMidiRouter {
  private access: MIDIAccess | null = null;
  private activeOutput: MIDIOutput | null = null;
  private supported = typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';

  isSupported(): boolean {
    return this.supported;
  }

  async init(): Promise<MidiDeviceInfo[]> {
    if (!this.supported) return [];
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      return this.listOutputs();
    } catch {
      return [];
    }
  }

  listOutputs(): MidiDeviceInfo[] {
    if (!this.access) return [];
    const devices: MidiDeviceInfo[] = [];
    this.access.outputs.forEach((output) => {
      devices.push({
        id: output.id,
        name: output.name || 'MIDI Output',
        manufacturer: output.manufacturer || 'System',
      });
    });
    return devices;
  }

  selectOutput(deviceId: string | null) {
    if (!this.access || !deviceId) {
      this.activeOutput = null;
      return;
    }
    this.activeOutput = this.access.outputs.get(deviceId) ?? null;
  }

  onStateChange(cb: (devices: MidiDeviceInfo[]) => void) {
    if (!this.access) return;
    this.access.onstatechange = () => {
      cb(this.listOutputs());
    };
  }

  sendNoteOn(channel: number, midi: number, velocity: number) {
    if (!this.activeOutput) return;
    const ch = channel & 0x0f;
    const note = Math.max(0, Math.min(127, Math.round(midi)));
    const vel = Math.max(1, Math.min(127, Math.round(velocity)));
    this.activeOutput.send([0x90 | ch, note, vel]);
  }

  sendNoteOff(channel: number, midi: number) {
    if (!this.activeOutput) return;
    const ch = channel & 0x0f;
    const note = Math.max(0, Math.min(127, Math.round(midi)));
    this.activeOutput.send([0x80 | ch, note, 0]);
  }

  sendPitchBend(channel: number, normalized: number) {
    if (!this.activeOutput) return;
    const ch = channel & 0x0f;
    const clamped = Math.max(-1, Math.min(1, normalized));
    const val14 = Math.max(0, Math.min(16383, Math.round(8192 + clamped * 8191)));
    const lsb = val14 & 0x7f;
    const msb = (val14 >> 7) & 0x7f;
    this.activeOutput.send([0xe0 | ch, lsb, msb]);
  }

  sendExpression(channel: number, value: number) {
    if (!this.activeOutput) return;
    const ch = channel & 0x0f;
    const v = Math.max(0, Math.min(127, Math.round(value)));
    this.activeOutput.send([0xb0 | ch, 11, v]);
  }

  panic(channel: number) {
    if (!this.activeOutput) return;
    const ch = channel & 0x0f;
    // CC 123: All Notes Off, CC 120: All Sound Off
    this.activeOutput.send([0xb0 | ch, 123, 0]);
    this.activeOutput.send([0xb0 | ch, 120, 0]);
  }
}
