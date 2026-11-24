#include "PluginProcessor.h"
#include "PluginEditor.h"

R2RMusicVox2MIDIProcessor::R2RMusicVox2MIDIProcessor()
 : AudioProcessor(BusesProperties().withInput("Audio Input", juce::AudioChannelSet::stereo(), true)
                                  .withOutput("Audio Output", juce::AudioChannelSet::stereo(), true)),
   parameters(*this, nullptr, "R2R_STATE", createParameterLayout())
{
}
juce::AudioProcessorValueTreeState::ParameterLayout R2RMusicVox2MIDIProcessor::createParameterLayout()
{
    juce::AudioProcessorValueTreeState::ParameterLayout p;
    p.add(std::make_unique<juce::AudioParameterFloat>("threshold","Threshold",juce::NormalisableRange<float>(-60.0f, -6.0f, 0.1f), -36.0f));
    p.add(std::make_unique<juce::AudioParameterFloat>("sensitivity","Sensitivity",juce::NormalisableRange<float>(0.05f, 0.95f, 0.01f), 0.35f));
    p.add(std::make_unique<juce::AudioParameterFloat>("minNote","Min Note",juce::NormalisableRange<float>(36.0f, 72.0f, 1.0f), 40.0f));
    p.add(std::make_unique<juce::AudioParameterFloat>("maxNote","Max Note",juce::NormalisableRange<float>(48.0f, 96.0f, 1.0f), 84.0f));
    p.add(std::make_unique<juce::AudioParameterFloat>("velocity","Velocity",juce::NormalisableRange<float>(1.0f, 127.0f, 1.0f), 100.0f));
    p.add(std::make_unique<juce::AudioParameterBool>("quantize","Snap to Semitone",true));
    return p;
}
bool R2RMusicVox2MIDIProcessor::isBusesLayoutSupported(const BusesLayout& l) const
{
    const auto in=l.getMainInputChannelSet(), out=l.getMainOutputChannelSet();
    return (in==juce::AudioChannelSet::mono() || in==juce::AudioChannelSet::stereo())
        && out==in;
}
void R2RMusicVox2MIDIProcessor::prepareToPlay(double sr, int block)
{
    currentSampleRate=sr; analysisHop=juce::jmax(128,block/2);
    analysisBuffer.setSize(1,4096); analysisBuffer.clear(); analysisWrite=0; activeNote=-1;
}
float R2RMusicVox2MIDIProcessor::detectPitch(const float* x, int n, float& confidence) const
{
    confidence=0.0f;
    if(n<1024) return 0.0f;
    double rms=0.0; for(int i=0;i<n;++i) rms += double(x[i])*x[i];
    rms=std::sqrt(rms/n); if(rms<0.0005) return 0.0f;
    const int minLag=juce::jmax(20,(int)(currentSampleRate/1000.0));
    const int maxLag=juce::jmin(n/2,(int)(currentSampleRate/65.0));
    double best=-1.0; int bestLag=0;
    for(int lag=minLag;lag<=maxLag;++lag) {
        double corr=0.0, a=0.0, b=0.0;
        for(int i=0;i<n-lag;++i){ double u=x[i],v=x[i+lag]; corr+=u*v; a+=u*u; b+=v*v; }
        double score=corr/std::sqrt(a*b+1.0e-12);
        if(score>best){best=score;bestLag=lag;}
    }
    confidence=(float)juce::jlimit(0.0,1.0,best);
    return bestLag>0 ? (float)(currentSampleRate/bestLag) : 0.0f;
}
void R2RMusicVox2MIDIProcessor::processBlock(juce::AudioBuffer<float>& audio, juce::MidiBuffer& midi)
{
    juce::ScopedNoDenormals noDenormals;
    const int channels=getTotalNumInputChannels(), samples=audio.getNumSamples();
    for(int c=getTotalNumInputChannels();c<getTotalNumOutputChannels();++c) audio.clear(c,0,samples);
    const float threshold=juce::Decibels::decibelsToGain(parameters.getRawParameterValue("threshold")->load());
    const float sensitivity=parameters.getRawParameterValue("sensitivity")->load();
    const int minNote=(int)parameters.getRawParameterValue("minNote")->load();
    const int maxNote=(int)parameters.getRawParameterValue("maxNote")->load();
    const int velocity=(int)parameters.getRawParameterValue("velocity")->load();
    const bool snap=parameters.getRawParameterValue("quantize")->load()>0.5f;
    const float* input=audio.getReadPointer(0);
    for(int i=0;i<samples;++i) {
        float mono=input[i]; if(channels>1) mono=0.5f*(mono+audio.getReadPointer(1)[i]);
        analysisBuffer.setSample(0,analysisWrite,mono);
        analysisWrite=(analysisWrite+1)%analysisBuffer.getNumSamples();
        if(++samplesSinceAnalysis < analysisHop) continue;
        samplesSinceAnalysis=0;
        float window[2048];
        for(int j=0;j<2048;++j) window[j]=analysisBuffer.getSample(0,(analysisWrite+j)%analysisBuffer.getNumSamples());
        float confidence=0.0f;
        float hz=detectPitch(window,2048,confidence);
        int note=-1;
        float level=0.0f; for(float v:window) level+=v*v; level=std::sqrt(level/2048.0f);
        if(hz>0.0f && level>=threshold && confidence>=sensitivity) {
            float noteFloat=juce::MidiMessage::getMidiNoteInHertz(69);
            (void)noteFloat;
            int detected=(int)std::round(69.0+12.0*std::log2(hz/440.0));
            if(snap) note=detected;
            else note=detected;
            note=juce::jlimit(minNote,maxNote,note);
        }
        const int pos=i;
        if(note!=activeNote) {
            if(activeNote>=0) midi.addEvent(juce::MidiMessage::noteOff(1,activeNote),pos);
            if(note>=0) midi.addEvent(juce::MidiMessage::noteOn(1,note,(juce::uint8)velocity),pos);
            activeNote=note;
        }
    }
    if(activeNote>=0 && audio.getNumSamples()>0 && samplesSinceAnalysis==0) {
        // Note-off is emitted on the next analysis frame when the voice falls below threshold.
    }
}
juce::AudioProcessorEditor* R2RMusicVox2MIDIProcessor::createEditor(){ return new R2RMusicVox2MIDIEditor(*this); }
void R2RMusicVox2MIDIProcessor::getStateInformation(juce::MemoryBlock& dest){ auto s=parameters.copyState(); std::unique_ptr<juce::XmlElement> xml(s.createXml()); copyXmlToBinary(*xml,dest); }
void R2RMusicVox2MIDIProcessor::setStateInformation(const void* data,int size){ std::unique_ptr<juce::XmlElement> xml(getXmlFromBinary(data,size)); if(xml && xml->hasTagName(parameters.state.getType())) parameters.replaceState(juce::ValueTree::fromXml(*xml)); }
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter(){ return new R2RMusicVox2MIDIProcessor(); }
