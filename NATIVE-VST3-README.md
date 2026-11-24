# R2R MUSIC VOX 2 MIDI — Native Windows VST3

This repository now includes a native JUCE/C++ VST3 target alongside the original browser app.

## What it does
- Receives mono/stereo audio from a DAW track.
- Tracks a monophonic fundamental pitch using a lightweight autocorrelation detector.
- Emits MIDI note-on/note-off events from the VST3 effect.
- Provides Threshold, Sensitivity, Low Note, High Note, Velocity and semitone-snap controls.
- Uses a custom dark navy / cyan / magenta DJ R2R interface and a vector-drawn DJ R2R wordmark.

## Build on GitHub
1. Open the repository's **Actions** tab.
2. Select **Build R2R MUSIC VOX 2 MIDI VST3**.
3. Click **Run workflow** (or wait for a push-triggered build).
4. When the run is green, open it and download the artifact named
   `R2R-MUSIC-VOX-2-MIDI-Windows-x64-VST3`.

## Install
Extract the ZIP. Copy the complete `.vst3` bundle to:
`C:\\Program Files\\Common Files\\VST3\\`
Then restart/rescan plugins in your DAW.

## Important routing note
This is an audio-effect VST3: put it on an audio track carrying the vocal/microphone signal, then route/enable that track's MIDI output to a MIDI instrument. The plugin does not independently open the Windows microphone device. The pitch tracker is monophonic; polyphonic singing and chords are not supported.

## Local build
Install Visual Studio 2022 with the **Desktop development with C++** workload and CMake. Then run:
```powershell
cmake -S . -B build -A x64
cmake --build build --config Release --target R2RMusicVox2MIDI_VST3
```

JUCE is fetched at configure time from the JUCE 8.0.6 tag. The first configure needs an internet connection.
