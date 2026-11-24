import { DspParams } from '../types/dsp';
import { buildAllowedPitchClasses, NOTE_NAMES, SCALES } from './musicTheory';
import { ZipEntryInput } from './zipBuilder';

export function generateVst3ProjectFiles(params: DspParams): ZipEntryInput[] {
  const scaleObj = SCALES.find((s) => s.id === params.scaleId) ?? SCALES[0];
  const allowedMask = buildAllowedPitchClasses(params.scaleId, params.rootNote).map((b) => (b ? 1 : 0));
  const rootName = NOTE_NAMES[params.rootNote] ?? 'C';
  const windowSize =
    params.trackingMode === 'zero_latency' ? 384 : params.trackingMode === 'balanced' ? 512 : 768;

  const cmakeLists = `cmake_minimum_required(VERSION 3.22)
project(VOX2MIDI VERSION 1.0.0)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Fetch JUCE 8 automatically during configure
include(FetchContent)
FetchContent_Declare(
    JUCE
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG 8.0.4
)
FetchContent_MakeAvailable(JUCE)

juce_add_plugin(Vox2Midi
    COMPANY_NAME "Vox2Midi Audio"
    IS_SYNTH FALSE
    NEEDS_MIDI_INPUT FALSE
    NEEDS_MIDI_OUTPUT TRUE
    IS_MIDI_EFFECT FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS FALSE
    COPY_PLUGIN_AFTER_BUILD TRUE
    PLUGIN_MANUFACTURER_CODE Vx2M
    PLUGIN_CODE V2Md
    FORMATS VST3 AU Standalone
    PRODUCT_NAME "VOX 2 MIDI"
)

target_sources(Vox2Midi
    PRIVATE
        Source/PluginProcessor.cpp
        Source/PluginEditor.cpp
)

target_compile_definitions(Vox2Midi
    PUBLIC
        JUCE_WEB_BROWSER=0
        JUCE_USE_CURL=0
        JUCE_VST3_CAN_REPLACE_VST2=0
)

target_link_libraries(Vox2Midi
    PRIVATE
        juce::juce_audio_utils
        juce::juce_dsp
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags
        juce::juce_recommended_warning_flags
)
`;

  const pitchDetectorH = `#pragma once
#include <array>
#include <cmath>
#include <algorithm>

/**
 * Lock-free, allocation-free causal YIN/CMNDF pitch detector.
 * Zero lookahead latency: reports 0 samples to DAW PDC.
 * Configured from studio preset: ${scaleObj.label} (Root: ${rootName})
 */
class PitchDetectorYin {
public:
    static constexpr int kRingSize = 2048;
    static constexpr int kMaxTau = 1150;

    void prepare(double newSampleRate) noexcept {
        sampleRate = newSampleRate;
        ring.fill(0.0f);
        diff.fill(0.0f);
        cmndf.fill(1.0f);
        writePos = 0;
        lastFreqHz = 0.0f;
        prevRms = 0.0f;
        prevSample = 0.0f;
    }

    struct Result {
        bool voiced = false;
        bool isTransient = false;
        float freqHz = 0.0f;
        float confidence = 0.0f;
        float rmsDb = -96.0f;
    };

    void pushSample(float sample) noexcept {
        ring[writePos] = sample;
        writePos = (writePos + 1) % kRingSize;
    }

    Result analyzeBlock(const float* samples, int numSamples,
                        float gateThresholdDb, float yinThreshold,
                        float minFreqHz, float maxFreqHz,
                        float transientSensitivity, int integrationWindow = ${windowSize}) noexcept {
        Result res;
        float sumSq = 0.0f;
        float flux = 0.0f;

        for (int i = 0; i < numSamples; ++i) {
            const float s = samples[i];
            pushSample(s);
            sumSq += s * s;
            flux += std::abs(s - prevSample);
            prevSample = s;
        }

        const float rms = std::sqrt(sumSq / static_cast<float>(std::max(1, numSamples)));
        res.rmsDb = 20.0f * std::log10(rms + 1e-9f);
        const float avgFlux = flux / static_cast<float>(std::max(1, numSamples));
        const float rmsJump = rms - prevRms;
        prevRms = rms;

        res.isTransient = (transientSensitivity > 0.05f) &&
                          (rmsJump > 0.015f * (1.25f - transientSensitivity)) &&
                          (avgFlux > 0.006f);

        if (res.rmsDb < gateThresholdDb) {
            lastFreqHz = 0.0f;
            return res;
        }

        const int N = std::min(integrationWindow, kRingSize - kMaxTau - 2);
        const int minTau = std::max(12, static_cast<int>(sampleRate / std::max(200.0f, maxFreqHz)));
        const int maxTau = std::min(kMaxTau, static_cast<int>(sampleRate / std::max(45.0f, minFreqHz)));

        float runningSum = 0.0f;
        diff[0] = 0.0f;
        cmndf[0] = 1.0f;

        for (int tau = 1; tau <= maxTau; ++tau) {
            float sum = 0.0f;
            for (int j = 0; j < N; ++j) {
                const int idxA = (writePos - 1 - j + kRingSize) % kRingSize;
                const int idxB = (writePos - 1 - j - tau + kRingSize) % kRingSize;
                const float d = ring[idxA] - ring[idxB];
                sum += d * d;
            }
            diff[tau] = sum;
            runningSum += sum;
            cmndf[tau] = (runningSum > 1e-12f) ? (sum * static_cast<float>(tau)) / runningSum : 1.0f;
        }

        int bestTau = -1;
        for (int tau = minTau; tau <= maxTau; ++tau) {
            if (cmndf[tau] < yinThreshold) {
                while (tau + 1 <= maxTau && cmndf[tau + 1] < cmndf[tau]) {
                    ++tau;
                }
                bestTau = tau;
                break;
            }
        }

        if (bestTau == -1) return res;

        // Octave continuity lock
        if (lastFreqHz > 0.0f && !res.isTransient) {
            const float prevTau = static_cast<float>(sampleRate) / lastFreqHz;
            const float ratio = static_cast<float>(bestTau) / prevTau;
            if (ratio > 1.85f && ratio < 2.15f) {
                const int halfTau = bestTau / 2;
                if (halfTau >= minTau && cmndf[halfTau] < yinThreshold * 1.5f) bestTau = halfTau;
            } else if (ratio > 0.46f && ratio < 0.54f) {
                const int doubleTau = bestTau * 2;
                if (doubleTau <= maxTau && cmndf[doubleTau] < yinThreshold * 1.5f) bestTau = doubleTau;
            }
        }

        // Parabolic interpolation
        float betterTau = static_cast<float>(bestTau);
        if (bestTau > minTau && bestTau < maxTau) {
            const float s0 = cmndf[bestTau - 1];
            const float s1 = cmndf[bestTau];
            const float s2 = cmndf[bestTau + 1];
            const float denom = 2.0f * s1 - s2 - s0;
            if (std::abs(denom) > 1e-9f) {
                const float shift = (s0 - s2) / (2.0f * denom);
                if (std::abs(shift) <= 1.0f) betterTau += shift;
            }
        }

        res.voiced = true;
        res.freqHz = static_cast<float>(sampleRate) / betterTau;
        res.confidence = std::clamp(1.0f - cmndf[bestTau], 0.0f, 1.0f);
        lastFreqHz = res.freqHz;
        return res;
    }

private:
    double sampleRate = 48000.0;
    std::array<float, kRingSize> ring{};
    std::array<float, kMaxTau + 1> diff{};
    std::array<float, kMaxTau + 1> cmndf{};
    int writePos = 0;
    float lastFreqHz = 0.0f;
    float prevRms = 0.0f;
    float prevSample = 0.0f;
};
`;

  const processorH = `#pragma once
#include <JuceHeader.h>
#include "PitchDetectorYin.h"

class Vox2MidiAudioProcessor : public juce::AudioProcessor {
public:
    Vox2MidiAudioProcessor();
    ~Vox2MidiAudioProcessor() override = default;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported(const BusesLayout& layouts) const override;
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return JucePlugin_Name; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return true; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }
    int getLatencySamples() const { return 0; } // Zero lookahead latency

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}

    void getStateInformation(juce::MemoryBlock& destData) override;
    void setStateInformation(const void* data, int sizeInBytes) override;

    juce::AudioProcessorValueTreeState apvts;

private:
    static juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout();
    int quantizeToScale(float midiFloat) const noexcept;

    PitchDetectorYin detector;
    int activeMidiNote = -1;
    int lastPitchBendVal = 8192;
    std::array<int, 12> allowedPitchClasses = { ${allowedMask.join(', ')} };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(Vox2MidiAudioProcessor)
};
`;

  const processorCpp = `#include "PluginProcessor.h"
#include "PluginEditor.h"

Vox2MidiAudioProcessor::Vox2MidiAudioProcessor()
    : AudioProcessor(BusesProperties()
                         .withInput("Input", juce::AudioChannelSet::stereo(), true)
                         .withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      apvts(*this, nullptr, "PARAMETERS", createParameterLayout()) {}

juce::AudioProcessorValueTreeState::ParameterLayout Vox2MidiAudioProcessor::createParameterLayout() {
    std::vector<std::unique_ptr<juce::RangedAudioParameter>> params;
    params.push_back(std::make_unique<juce::AudioParameterFloat>("gateDb", "Gate Threshold (dB)", -60.0f, -12.0f, ${params.gateThresholdDb.toFixed(1)}f));
    params.push_back(std::make_unique<juce::AudioParameterFloat>("yinThresh", "YIN Confidence", 0.08f, 0.30f, ${params.yinConfidence.toFixed(2)}f));
    params.push_back(std::make_unique<juce::AudioParameterFloat>("minFreq", "Min Frequency (Hz)", 60.0f, 220.0f, ${params.minFreqHz.toFixed(1)}f));
    params.push_back(std::make_unique<juce::AudioParameterFloat>("maxFreq", "Max Frequency (Hz)", 600.0f, 1600.0f, ${params.maxFreqHz.toFixed(1)}f));
    params.push_back(std::make_unique<juce::AudioParameterInt>("transpose", "Transpose", -24, 24, ${params.transposeSemitones}));
    params.push_back(std::make_unique<juce::AudioParameterInt>("pbRange", "Pitch Bend Range", 2, 48, ${params.pitchBendRange}));
    params.push_back(std::make_unique<juce::AudioParameterBool>("liveBend", "Live Pitch Bend", ${params.correctionMode === 'live_bend' ? 'true' : 'false'}));
    params.push_back(std::make_unique<juce::AudioParameterInt>("midiChannel", "MIDI Channel", 1, 16, ${params.midiChannel + 1}));
    return { params.begin(), params.end() };
}

void Vox2MidiAudioProcessor::prepareToPlay(double sampleRate, int) {
    detector.prepare(sampleRate);
    activeMidiNote = -1;
    setLatencySamples(0); // Explicit zero-latency declaration to DAW
}

bool Vox2MidiAudioProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const {
    return layouts.getMainInputChannelSet() == layouts.getMainOutputChannelSet() &&
           !layouts.getMainInputChannelSet().isDisabled();
}

int Vox2MidiAudioProcessor::quantizeToScale(float midiFloat) const noexcept {
    const int base = static_cast<int>(std::round(midiFloat));
    int bestMidi = base;
    float minDist = 1e9f;
    for (int offset = -6; offset <= 6; ++offset) {
        const int cand = base + offset;
        if (cand < 0 || cand > 127) continue;
        const int pc = ((cand % 12) + 12) % 12;
        if (allowedPitchClasses[pc] == 0) continue;
        const float d = std::abs(midiFloat - static_cast<float>(cand));
        if (d < minDist) {
            minDist = d;
            bestMidi = cand;
        }
    }
    return bestMidi;
}

void Vox2MidiAudioProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midiMessages) {
    juce::ScopedNoDenormals noDenormals;
    const int numSamples = buffer.getNumSamples();
    const float* mono = buffer.getReadPointer(0);

    const float gateDb = apvts.getRawParameterValue("gateDb")->load();
    const float yinThresh = apvts.getRawParameterValue("yinThresh")->load();
    const float minFreq = apvts.getRawParameterValue("minFreq")->load();
    const float maxFreq = apvts.getRawParameterValue("maxFreq")->load();
    const int transpose = static_cast<int>(apvts.getRawParameterValue("transpose")->load());
    const int pbRange = static_cast<int>(apvts.getRawParameterValue("pbRange")->load());
    const bool liveBend = apvts.getRawParameterValue("liveBend")->load() > 0.5f;
    const int ch = static_cast<int>(apvts.getRawParameterValue("midiChannel")->load());

    const auto res = detector.analyzeBlock(mono, numSamples, gateDb, yinThresh, minFreq, maxFreq, ${params.transientSensitivity.toFixed(2)}f);

    if (!res.voiced) {
        if (activeMidiNote != -1) {
            midiMessages.addEvent(juce::MidiMessage::noteOff(ch, activeMidiNote), 0);
            activeMidiNote = -1;
        }
        return;
    }

    const float midiFloat = 69.0f + 12.0f * std::log2(res.freqHz / 440.0f) + static_cast<float>(transpose);
    const int targetMidi = quantizeToScale(midiFloat);
    const float normVel = std::clamp((res.rmsDb - gateDb) / std::max(6.0f, -gateDb), 0.0f, 1.0f);
    const uint8_t velocity = static_cast<uint8_t>(std::clamp(18.0f + std::pow(normVel, ${params.velocityCurve.toFixed(2)}f) * 109.0f, 1.0f, 127.0f));

    if (activeMidiNote == -1) {
        activeMidiNote = targetMidi;
        midiMessages.addEvent(juce::MidiMessage::noteOn(ch, activeMidiNote, velocity), 0);
    } else if (targetMidi != activeMidiNote) {
        const float distFromActive = std::abs(midiFloat - static_cast<float>(activeMidiNote));
        if (res.isTransient || distFromActive > 0.62f) {
            midiMessages.addEvent(juce::MidiMessage::noteOff(ch, activeMidiNote), 0);
            activeMidiNote = targetMidi;
            midiMessages.addEvent(juce::MidiMessage::noteOn(ch, activeMidiNote, velocity), 0);
        }
    }

    if (liveBend && activeMidiNote != -1) {
        const float pbNorm = std::clamp((midiFloat - static_cast<float>(activeMidiNote)) / static_cast<float>(std::max(1, pbRange)), -1.0f, 1.0f);
        const int pb14 = std::clamp(static_cast<int>(8192.0f + pbNorm * 8191.0f), 0, 16383);
        if (std::abs(pb14 - lastPitchBendVal) > 16) {
            lastPitchBendVal = pb14;
            midiMessages.addEvent(juce::MidiMessage::pitchWheel(ch, pb14), 0);
        }
    }
}

void Vox2MidiAudioProcessor::getStateInformation(juce::MemoryBlock& destData) {
    if (auto xml = apvts.copyState().createXml())
        copyXmlToBinary(*xml, destData);
}

void Vox2MidiAudioProcessor::setStateInformation(const void* data, int sizeInBytes) {
    if (auto xml = getXmlFromBinary(data, sizeInBytes))
        apvts.replaceState(juce::ValueTree::fromXml(*xml));
}

juce::AudioProcessorEditor* Vox2MidiAudioProcessor::createEditor() {
    return new Vox2MidiAudioProcessorEditor(*this);
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() {
    return new Vox2MidiAudioProcessor();
}
`;

  const editorH = `#pragma once
#include <JuceHeader.h>
#include "PluginProcessor.h"

class Vox2MidiAudioProcessorEditor : public juce::AudioProcessorEditor {
public:
    explicit Vox2MidiAudioProcessorEditor(Vox2MidiAudioProcessor&);
    ~Vox2MidiAudioProcessorEditor() override = default;

    void paint(juce::Graphics&) override;
    void resized() override;

private:
    Vox2MidiAudioProcessor& audioProcessor;
    juce::Slider gateSlider, yinSlider, transposeSlider;
    juce::ToggleButton liveBendToggle{"Live Pitch Bend"};
    std::unique_ptr<juce::AudioProcessorValueTreeState::SliderAttachment> gateAttach, yinAttach, transposeAttach;
    std::unique_ptr<juce::AudioProcessorValueTreeState::ButtonAttachment> bendAttach;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(Vox2MidiAudioProcessorEditor)
};
`;

  const editorCpp = `#include "PluginEditor.h"

Vox2MidiAudioProcessorEditor::Vox2MidiAudioProcessorEditor(Vox2MidiAudioProcessor& p)
    : AudioProcessorEditor(&p), audioProcessor(p) {
    setSize(520, 260);

    for (auto* s : { &gateSlider, &yinSlider, &transposeSlider }) {
        s->setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
        s->setTextBoxStyle(juce::Slider::TextBoxBelow, false, 68, 20);
        addAndMakeVisible(*s);
    }
    addAndMakeVisible(liveBendToggle);

    gateAttach = std::make_unique<juce::AudioProcessorValueTreeState::SliderAttachment>(audioProcessor.apvts, "gateDb", gateSlider);
    yinAttach = std::make_unique<juce::AudioProcessorValueTreeState::SliderAttachment>(audioProcessor.apvts, "yinThresh", yinSlider);
    transposeAttach = std::make_unique<juce::AudioProcessorValueTreeState::SliderAttachment>(audioProcessor.apvts, "transpose", transposeSlider);
    bendAttach = std::make_unique<juce::AudioProcessorValueTreeState::ButtonAttachment>(audioProcessor.apvts, "liveBend", liveBendToggle);
}

void Vox2MidiAudioProcessorEditor::paint(juce::Graphics& g) {
    g.fillAll(juce::Colour(0xff090b10));
    g.setColour(juce::Colour(0xff06b6d4));
    g.setFont(juce::Font(20.0f, juce::Font::bold));
    g.drawText("VOX 2 MIDI  |  ZERO-LATENCY VST3", 20, 16, getWidth() - 40, 28, juce::Justification::left);
    g.setColour(juce::Colours::lightgrey);
    g.setFont(12.0f);
    g.drawText("Scale: ${scaleObj.label} (${rootName})  |  Buffer: ${windowSize}-smp Causal YIN", 20, 44, getWidth() - 40, 20, juce::Justification::left);
}

void Vox2MidiAudioProcessorEditor::resized() {
    auto area = getLocalBounds().reduced(20);
    area.removeFromTop(64);
    auto row = area.removeFromTop(120);
    gateSlider.setBounds(row.removeFromLeft(130));
    yinSlider.setBounds(row.removeFromLeft(130));
    transposeSlider.setBounds(row.removeFromLeft(130));
    liveBendToggle.setBounds(area.removeFromTop(32));
}
`;

  const readmeMd = `# VOX 2 MIDI — Zero-Latency VST3 / AU C++20 Plugin

Generated directly from your VOX 2 MIDI Studio configuration:
- **Scale Lock**: ${scaleObj.label} (Root: ${rootName})
- **Gate Threshold**: ${params.gateThresholdDb} dB
- **YIN Confidence**: ${params.yinConfidence}
- **Causal Integration Window**: ${windowSize} samples (0 samples lookahead / PDC = 0)
- **Pitch Correction**: ${params.correctionMode} (±${params.pitchBendRange} semitones)

## Build Instructions (Windows / macOS)

Requires **CMake 3.22+** and a C++20 compiler (Visual Studio 2022 on Windows, Xcode 15+ on macOS).

\`\`\`bash
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release
\`\`\`

CMake automatically fetches JUCE 8.0.4, compiles \`VOX 2 MIDI.vst3\` (and \`.component\` AU on macOS), and copies the plugin into your system VST3 folder so it loads immediately inside FL Studio, Ableton Live, Logic Pro, Cubase, or Reaper.
`;

  return [
    { path: 'VOX2MIDI-VST3/CMakeLists.txt', content: cmakeLists },
    { path: 'VOX2MIDI-VST3/Source/PitchDetectorYin.h', content: pitchDetectorH },
    { path: 'VOX2MIDI-VST3/Source/PluginProcessor.h', content: processorH },
    { path: 'VOX2MIDI-VST3/Source/PluginProcessor.cpp', content: processorCpp },
    { path: 'VOX2MIDI-VST3/Source/PluginEditor.h', content: editorH },
    { path: 'VOX2MIDI-VST3/Source/PluginEditor.cpp', content: editorCpp },
    { path: 'VOX2MIDI-VST3/README.md', content: readmeMd },
  ];
}
