import React, { useEffect, useState } from 'react';
import { HostAudioEngine } from '../audio/HostAudioEngine.js';
import { Volume2, VolumeX, Radio, CheckCircle, AlertTriangle, Disc, RefreshCw } from 'lucide-react';

interface AudioOutputPanelProps {
  hostAudio: HostAudioEngine;
  activeSpeakerName: string | null;
  isMuteAll: boolean;
  isEmergencyStop: boolean;
}

export const AudioOutputPanel: React.FC<AudioOutputPanelProps> = ({
  hostAudio,
  activeSpeakerName,
  isMuteAll,
  isEmergencyStop
}) => {
  const [audioState, setAudioState] = useState<string>('uninitialized');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('default');
  const [testTonePlayed, setTestTonePlayed] = useState<boolean>(false);
  const [supportsSinkId, setSupportsSinkId] = useState<boolean>(false);

  useEffect(() => {
    const ctx = hostAudio.getAudioContext();
    if (ctx) {
      setAudioState(ctx.state);
    }
    // Check setSinkId support in browser
    if (typeof (AudioContext.prototype as any).setSinkId === 'function' ||
        typeof (HTMLAudioElement.prototype as any).setSinkId === 'function') {
      setSupportsSinkId(true);
    }

    refreshDevices();
  }, [hostAudio]);

  const refreshDevices = async () => {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const audioOutputs = allDevices.filter(d => d.kind === 'audiooutput');
        setDevices(audioOutputs);
      }
    } catch (e) {
      console.warn('Could not enumerate audio output devices', e);
    }
  };

  const initializeHostAudio = async () => {
    await hostAudio.initAudio();
    const ctx = hostAudio.getAudioContext();
    if (ctx) {
      setAudioState(ctx.state);
    }
  };

  const handlePlayTestChime = async () => {
    await initializeHostAudio();
    hostAudio.playTestChime();
    setTestTonePlayed(true);
    setTimeout(() => setTestTonePlayed(false), 800);
  };

  return (
    <div className="bg-bg-elevated border border-border p-4 rounded-sm flex flex-col gap-4 font-body">
      <div className="flex items-center justify-between pb-2 border-b border-border">
        <div className="flex items-center gap-2">
          <Volume2 size={16} className="text-text-primary" />
          <h3 className="font-heading font-semibold text-sm tracking-wider uppercase">
            AUDIO OUTPUT // BLUETOOTH PA SYSTEM
          </h3>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-xs">
          <span className={`w-2 h-2 rounded-full ${audioState === 'running' ? 'bg-text-primary' : 'bg-text-muted border border-border'}`} />
          <span className="uppercase">{audioState}</span>
        </div>
      </div>

      {/* Host Audio Readiness Banner */}
      {audioState !== 'running' ? (
        <div className="p-3 bg-bg-main border border-border flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-mono text-text-secondary">
            <AlertTriangle size={14} className="text-text-primary" />
            <span>Host audio context suspended (browser autoplay policy)</span>
          </div>
          <button
            onClick={initializeHostAudio}
            className="px-3 py-1 bg-text-primary text-text-inverse font-mono font-bold text-xs uppercase btn-tactile hover:bg-white/90"
          >
            ENGAGE HOST AUDIO
          </button>
        </div>
      ) : (
        <div className="p-2.5 bg-bg-main border border-border flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-mono text-text-primary">
            <CheckCircle size={14} />
            <span>Web Audio engine active (interactive latency, 48kHz stereo bus)</span>
          </div>
          <button
            onClick={handlePlayTestChime}
            className="px-2.5 py-1 bg-bg-secondary border border-border text-xs font-mono hover:border-text-primary btn-tactile flex items-center gap-1"
          >
            <Radio size={12} className={testTonePlayed ? 'animate-ping' : ''} />
            <span>TEST 440Hz CHIME</span>
          </button>
        </div>
      )}

      {/* Routing status & Device selection */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
        {/* Current Physical Route */}
        <div className="p-3 bg-bg-main border border-border space-y-2">
          <div className="text-[10px] text-text-muted uppercase tracking-wider">ROUTING PIPELINE</div>
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">Audible Stream:</span>
            <span className="font-bold text-text-primary">
              {isEmergencyStop 
                ? '[EMERGENCY STOP]' 
                : isMuteAll 
                ? '[MUTE ALL]' 
                : activeSpeakerName || '[NONE / MUTED]'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">Host Target:</span>
            <span className="text-text-primary">System Default Output (Bluetooth/Wired)</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">Bus Crossfade:</span>
            <span className="text-text-primary">25ms Exponential (Clickless)</span>
          </div>
        </div>

        {/* Output Device Selection & Detection */}
        <div className="p-3 bg-bg-main border border-border space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-text-muted uppercase tracking-wider">HARDWARE DESTINATION</span>
            <button onClick={refreshDevices} title="Refresh device list" className="text-text-secondary hover:text-white">
              <RefreshCw size={11} />
            </button>
          </div>

          {devices.length > 0 ? (
            <select
              value={selectedDeviceId}
              onChange={async (e) => {
                const devId = e.target.value;
                setSelectedDeviceId(devId);
                await hostAudio.setOutputDevice(devId);
              }}
              className="w-full bg-bg-secondary border border-border text-text-primary text-xs p-1.5 rounded-sm focus:border-text-primary"
            >
              <option value="default">System Default (Default Speaker / Bluetooth)</option>
              {devices.map(d => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Output Device (${d.deviceId.substring(0, 6)})`}
                </option>
              ))}
            </select>
          ) : (
            <div className="text-text-secondary text-[11px]">
              Host OS audio mixer controls physical routing. Connect your Bluetooth speaker in Windows settings: <code className="text-text-primary">Settings &gt; Bluetooth &amp; devices</code>.
            </div>
          )}

          <div className="text-[10px] text-text-muted">
            {supportsSinkId 
              ? '✓ Direct hardware sink routing enabled.' 
              : 'ℹ Standard system audio driver routing.'}
          </div>
        </div>
      </div>

      {/* Studio Limiter & Stage Transmission Chain */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
        <div className="p-3 bg-bg-main border border-border space-y-1.5">
          <div className="text-[10px] text-text-muted uppercase tracking-wider font-bold">STUDIO MASTER LIMITER (ANTI-CLIPPING)</div>
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">Limiter Ceiling:</span>
            <span className="text-text-primary font-bold">-3.0 dBFS (True Peak Protected)</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">Dynamics Compression:</span>
            <span className="text-text-primary">Ratio 20:1 | 3ms Attack | 120ms Release</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">Limiter Reduction:</span>
            <span className="text-text-primary font-bold">{hostAudio.getCompressorReduction()} dB</span>
          </div>
          <p className="text-[10px] text-text-muted mt-1">
            Safe pre-amp gain boost enabled. Even when phone distance varies or gain trim is raised, signals never digitally clip or distort through the PA speakers.
          </p>
        </div>

        <div className="p-3 bg-bg-main border border-border space-y-1.5">
          <div className="text-[10px] text-text-muted uppercase tracking-wider font-bold">END-TO-END LATENCY PROFILES</div>
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">Wi-Fi LAN Transmission:</span>
            <span className="text-text-primary">~8 - 15 ms (Opus 128k CBR)</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">Wired 3.5mm AUX / USB Interface:</span>
            <span className="text-text-primary font-bold text-green-400">~20 - 35 ms (Near Zero Latency)</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">Bluetooth Speaker (A2DP Codec):</span>
            <span className="text-text-primary font-bold">~120 - 180 ms (Hardware Buffer)</span>
          </div>
          <p className="text-[10px] text-text-muted mt-1">
            For live musical performance or rapid call-and-response, plug laptop directly into venue amplifier via AUX cable.
          </p>
        </div>
      </div>

      {/* Bluetooth & Latency Engineering Notes */}
      <div className="p-3 bg-bg-main border border-border text-xs space-y-1.5 text-text-secondary">
        <div className="font-mono text-[10px] text-text-muted uppercase tracking-widest font-bold">
          LARGE-VENUE PRODUCTION ADVISORY
        </div>
        <p className="text-[11px] leading-relaxed">
          • <strong>Phone Distance Independence:</strong> Participant phones transmit digital Opus audio exclusively across your local Wi-Fi router to the laptop host. Mobile phones do <em>not</em> need to be near the laptop or the Bluetooth speaker.
        </p>
        <p className="text-[11px] leading-relaxed">
          • <strong>Venue Acoustics &amp; Feedback:</strong> If a participant stands physically right in front of the Bluetooth PA speaker while speaking loudly, physical acoustic feedback (howling) can occur. Position the PA speakers facing the audience, ahead of the stage microphones.
        </p>
      </div>
    </div>
  );
};
