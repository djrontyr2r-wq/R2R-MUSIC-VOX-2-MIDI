#include "PluginEditor.h"
R2RMusicVox2MIDIEditor::R2RMusicVox2MIDIEditor(R2RMusicVox2MIDIProcessor& p):AudioProcessorEditor(&p),processor(p)
{
    setSize(640,420);
    auto setup=[this](juce::Slider& s,const juce::String& name){ styleSlider(s); addAndMakeVisible(s); };
    setup(threshold,"Threshold"); setup(sensitivity,"Sensitivity"); setup(minNote,"Min Note"); setup(maxNote,"Max Note"); setup(velocity,"Velocity");
    threshold.setName("THRESHOLD"); sensitivity.setName("SENSITIVITY"); minNote.setName("LOW NOTE"); maxNote.setName("HIGH NOTE"); velocity.setName("VELOCITY");
    thresholdA=std::make_unique<SliderAttachment>(p.parameters,"threshold",threshold);
    sensitivityA=std::make_unique<SliderAttachment>(p.parameters,"sensitivity",sensitivity);
    minA=std::make_unique<SliderAttachment>(p.parameters,"minNote",minNote);
    maxA=std::make_unique<SliderAttachment>(p.parameters,"maxNote",maxNote);
    velocityA=std::make_unique<SliderAttachment>(p.parameters,"velocity",velocity);
    addAndMakeVisible(quantize); quantizeA=std::make_unique<juce::AudioProcessorValueTreeState::ButtonAttachment>(p.parameters,"quantize",quantize);
    status.setText("AUDIO IN  →  PITCH TRACKING  →  MIDI OUT",juce::dontSendNotification);
    status.setJustificationType(juce::Justification::centred); status.setColour(juce::Label::textColourId,juce::Colour(0xff8eeeff)); addAndMakeVisible(status);
}
void R2RMusicVox2MIDIEditor::styleSlider(juce::Slider& s)
{
    s.setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
    s.setTextBoxStyle(juce::Slider::TextBoxBelow,false,78,22);
    s.setColour(juce::Slider::rotarySliderFillColourId,juce::Colour(0xffff4fd8));
    s.setColour(juce::Slider::rotarySliderOutlineColourId,juce::Colour(0xff26364f));
    s.setColour(juce::Slider::thumbColourId,juce::Colour(0xff70f7ff));
    s.setColour(juce::Slider::textBoxTextColourId,juce::Colours::white);
    s.setColour(juce::Slider::textBoxBackgroundColourId,juce::Colour(0xff111827));
    s.setColour(juce::Slider::textBoxOutlineColourId,juce::Colour(0xff334155));
}
void R2RMusicVox2MIDIEditor::paint(juce::Graphics& g)
{
    auto b=getLocalBounds().toFloat();
    g.fillAll(juce::Colour(0xff080d18));
    g.setGradientFill(juce::ColourGradient(juce::Colour(0xff171a3b),0,0,juce::Colour(0xff080d18),640,420,false)); g.fillRoundedRectangle(b,18);
    g.setColour(juce::Colour(0xff70f7ff)); g.drawRoundedRectangle(b.reduced(1),18,2);
    g.setColour(juce::Colour(0xffff4fd8)); g.fillRoundedRectangle(24,22,8,52,4);
    g.setColour(juce::Colours::white); g.setFont(juce::Font(27.0f,juce::Font::bold)); g.drawText("DJ R2R",44,20,180,34,juce::Justification::centredLeft);
    g.setColour(juce::Colour(0xff70f7ff)); g.setFont(juce::Font(15.0f,juce::Font::bold)); g.drawText("MUSIC  /  VOX 2 MIDI",45,53,260,22,juce::Justification::centredLeft);
    g.setColour(juce::Colour(0xff26364f)); g.drawLine(24,88,616,88,1.0f);
    g.setColour(juce::Colour(0xffaab7cf)); g.setFont(11.0f); g.drawText("REAL-TIME MONOPHONIC PITCH TO MIDI",26,96,300,18,juce::Justification::centredLeft);
    g.setColour(juce::Colour(0xffff4fd8)); g.fillRoundedRectangle(475,27,140,30,8);
    g.setColour(juce::Colour(0xff080d18)); g.setFont(juce::Font(11.0f,juce::Font::bold)); g.drawText("64-BIT  •  VST3",480,32,130,20,juce::Justification::centred);
    g.setColour(juce::Colour(0xff26364f)); g.drawRoundedRectangle(22,126,596,224,14,1.0f);
}
void R2RMusicVox2MIDIEditor::resized()
{
    const int y=143,w=112,h=145,gap=8; juce::Slider* sliders[]={&threshold,&sensitivity,&minNote,&maxNote,&velocity};
    for(int i=0;i<5;++i) sliders[i]->setBounds(28+i*(w+gap),y,w,h);
    quantize.setBounds(35,300,210,28); status.setBounds(245,300,350,28);
}
