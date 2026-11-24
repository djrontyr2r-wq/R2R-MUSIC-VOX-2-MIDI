#pragma once
#include <JuceHeader.h>
#include "PluginProcessor.h"

class R2RMusicVox2MIDIEditor final : public juce::AudioProcessorEditor
{
public:
    explicit R2RMusicVox2MIDIEditor(R2RMusicVox2MIDIProcessor&);
    void paint(juce::Graphics&) override;
    void resized() override;
private:
    R2RMusicVox2MIDIProcessor& processor;
    juce::Slider threshold, sensitivity, minNote, maxNote, velocity;
    juce::ToggleButton quantize{"SNAP TO SEMITONE"};
    juce::Label status;
    using SliderAttachment=juce::AudioProcessorValueTreeState::SliderAttachment;
    std::unique_ptr<SliderAttachment> thresholdA,sensitivityA,minA,maxA,velocityA;
    std::unique_ptr<juce::AudioProcessorValueTreeState::ButtonAttachment> quantizeA;
    void styleSlider(juce::Slider&);
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(R2RMusicVox2MIDIEditor)
};
