import React, { useMemo, useState } from 'react';
import { Check, Copy, Download, FileCode2, FolderTree } from 'lucide-react';
import { DspParams } from '../types/dsp';
import { generateVst3ProjectFiles } from '../utils/vst3Generator';
import { buildZipArchive } from '../utils/zipBuilder';

interface VstExportViewProps {
  params: DspParams;
  accentHex?: string;
}

export const VstExportView: React.FC<VstExportViewProps> = ({ params, accentHex = '#EF233C' }) => {
  const files = useMemo(() => generateVst3ProjectFiles(params), [params]);
  const [selectedPath, setSelectedPath] = useState(files[1].path);
  const [copied, setCopied] = useState(false);

  const activeFile = files.find((f) => f.path === selectedPath) ?? files[0];

  const handleDownloadZip = () => {
    const zipBlob = buildZipArchive(files);
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'RZR-VOX2MIDI-VST3-Plugin.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(activeFile.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard fallback ignored
    }
  };

  return (
    <section className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border studio-panel rounded-lg p-5">
        <div className="flex items-center gap-4">
          <img
            src="/assets/aistudio/kh_a61a0305.png"
            alt="RZR Music"
            className="h-14 w-auto object-contain shrink-0"
          />
          <div className="space-y-1">
            <h2 className="text-xl font-semibold tracking-tight text-slate-100">
              Native VST3 & AudioUnit C++20 Plugin Generator
            </h2>
            <p className="text-sm text-slate-400">
              Compiles directly with JUCE 8 & CMake into a 64-bit <code className="font-mono text-slate-200">.vst3</code> plugin for FL Studio, Ableton Live, Logic Pro, Cubase, and Reaper with <span className="font-mono text-emerald-400">getLatencySamples() == 0</span>.
            </p>
          </div>
        </div>
        <button
          onClick={handleDownloadZip}
          style={{ backgroundColor: accentHex }}
          className="inline-flex items-center gap-2 px-4 py-2.5 hover:brightness-110 text-white font-semibold text-sm rounded-md transition-all whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-4 h-4" />
          Download VST3 Project (.zip)
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        <div className="lg:col-span-4 border studio-panel rounded-lg p-4 flex flex-col justify-between gap-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-400 pb-2 border-b border-[var(--studio-border)]">
              <FolderTree className="w-3.5 h-3.5" style={{ color: accentHex }} />
              <span>Generated CMake / JUCE 8 Project</span>
            </div>
            <div className="space-y-1">
              {files.map((file) => {
                const shortName = file.path.replace('VOX2MIDI-VST3/', '');
                const active = file.path === activeFile.path;
                return (
                  <button
                    key={file.path}
                    onClick={() => setSelectedPath(file.path)}
                    style={
                      active
                        ? {
                            backgroundColor: `${accentHex}22`,
                            borderColor: `${accentHex}66`,
                            color: '#FFFFFF',
                          }
                        : undefined
                    }
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded text-left font-mono text-xs transition-colors cursor-pointer border ${
                      active
                        ? 'font-semibold'
                        : 'text-slate-300 hover:bg-white/5 border-transparent'
                    }`}
                  >
                    <FileCode2 className="w-3.5 h-3.5 shrink-0 opacity-75" />
                    <span className="truncate">{shortName}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-[var(--studio-border)] pt-4 space-y-2.5">
            <h3 className="text-xs font-semibold text-slate-200">Quick Compile (Windows / macOS)</h3>
            <pre className="studio-well border rounded p-3 font-mono text-[11px] text-slate-300 overflow-x-auto leading-relaxed">
{`cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release`}
            </pre>
            <p className="text-xs text-slate-400 leading-relaxed">
              Your active scale, gate threshold, YIN sensitivity, and pitch bend range are pre-baked into the C++ parameter defaults.
            </p>
          </div>
        </div>

        <div className="lg:col-span-8 border studio-well rounded-lg flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--studio-border)] studio-panel">
            <span className="font-mono text-xs text-slate-300 truncate">
              {activeFile.path}
            </span>
            <button
              onClick={handleCopyCode}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-200 hover:text-white bg-white/5 hover:bg-white/10 rounded border border-[var(--studio-border)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy File'}
            </button>
          </div>
          <pre className="p-4 font-mono text-xs text-slate-300 overflow-auto max-h-[480px] leading-relaxed">
            <code>{activeFile.content}</code>
          </pre>
        </div>
      </div>
    </section>
  );
};
