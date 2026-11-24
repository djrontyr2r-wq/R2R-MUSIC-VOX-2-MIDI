#pragma once
#include <JuceHeader.h>

class R2RMusicVox2MIDIProcessor final : public juce::AudioProcessor
{
public:
    R2RMusicVox2MIDIProcessor();
    ~R2RMusicVox2MIDIProcessor() override = default;
    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported(const BusesLayout& layouts) const override;
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }
    const juce::String getName() const override { return "R2R MUSIC VOX 2 MIDI"; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return true; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 0.12; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}
    void getStateInformation(juce::MemoryBlock&) override;
    void setStateInformation(const void*, int) override;
    juce::AudioProcessorValueTreeState parameters;
private:
    static juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout();
    float detectPitch(const float* data, int count, float& confidence) const;
    double currentSampleRate = 44100.0;
    int activeNote = -1;
    int samplesSinceAnalysis = 0;
    int analysisHop = 256;
    juce::AudioBuffer<float> analysisBuffer;
    int analysisWrite = 0;
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(R2RMusicVox2MIDIProcessor)
};
