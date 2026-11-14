import React, { useEffect, useState } from 'react';
import { HostAudioEngine } from '../audio/HostAudioEngine.js';
import { Volume2, VolumeX, Radio, CheckCircle, AlertTriangle, RefreshCw } from 'lucide-react';

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
  const [speakerDelay, setSpeakerDelay] = useState<number>(hostAudio.getSpeakerDelay());
  const [speakerOutputs, setSpeakerOutputs] = useState(hostAudio.getSpeakerOutputs());

  useEffect(() => {
    const ctx = hostAudio.getAudioContext();
    if (ctx) {
      setAudioState(ctx.state);
    }
    setSpeakerDelay(hostAudio.getSpeakerDelay());
    setSpeakerOutputs(hostAudio.getSpeakerOutputs());

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

  const handleDelayChange = (delayMs: number) => {
    setSpeakerDelay(delayMs);
    hostAudio.setSpeakerDelay(delayMs);
    setSpeakerOutputs(hostAudio.getSpeakerOutputs());
  };

  return (
    <div className="bg-bg-card border border-border p-5 rounded-2xl flex flex-col gap-4 font-body shadow-xl shadow-black/40">
      <div className="flex items-center justify-between pb-3 border-b border-border">
        <div className="flex items-center gap-2.5">
          <Volume2 size={18} className="text-gold" />
          <h3 className="font-heading font-semibold text-sm tracking-wider uppercase text-text-primary">
            AUDIO OUTPUT // BLUETOOTH PA SYSTEM
          </h3>
        </div>
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className={`w-2 h-2 rounded-full ${audioState === 'running' ? 'bg-gold animate-pulse' : 'bg-text-muted border border-border'}`} />
          <span className={`uppercase font-bold ${audioState === 'running' ? 'text-gold' : 'text-text-muted'}`}>{audioState}</span>
        </div>
      </div>

      {/* Host Audio Readiness Banner */}
      {audioState !== 'running' ? (
        <div className="p-3.5 bg-burgundy-deep/80 border border-gold/40 rounded-xl flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2 text-xs font-mono text-text-secondary">
            <AlertTriangle size={15} className="text-gold shrink-0" />
            <span>Host audio context suspended (browser autoplay policy)</span>
          </div>
          <button
            onClick={initializeHostAudio}
            className="px-3.5 py-1.5 bg-gold text-bg-main font-mono font-bold text-xs uppercase rounded-lg hover:bg-gold-light transition-all shadow-md active:scale-[0.99]"
          >
            ENGAGE HOST AUDIO
          </button>
        </div>
      ) : (
        <div className="p-3 bg-burgundy-deep/50 border border-border rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-mono text-text-primary">
            <CheckCircle size={15} className="text-gold" />
            <span>Web Audio engine active (interactive latency, 48kHz stereo bus)</span>
          </div>
          <button
            onClick={handlePlayTestChime}
            className="px-3 py-1 bg-burgundy-deep border border-border text-xs font-mono text-text-primary hover:border-gold hover:text-gold rounded-lg btn-tactile flex items-center gap-1.5 transition-all"
          >
            <Radio size={12} className={testTonePlayed ? 'animate-ping text-gold' : 'text-gold'} />
            <span>TEST 440Hz CHIME</span>
          </button>
        </div>
      )}

      {/* Routing status & Device selection */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
        {/* Current Physical Route */}
        <div className="p-3.5 bg-bg-main/80 border border-border rounded-xl space-y-2">
          <div className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">ROUTING PIPELINE</div>
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">Audible Stream:</span>
            <span className="font-bold text-gold">
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
        <div className="p-3.5 bg-bg-main/80 border border-border rounded-xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">HARDWARE DESTINATION</span>
            <button onClick={refreshDevices} title="Refresh device list" className="text-text-secondary hover:text-gold transition-colors">
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
              className="w-full bg-bg-secondary border border-border text-text-primary text-xs p-2 rounded-lg focus:border-gold outline-none"
            >
              <option value="default">System Default (Default Speaker / Bluetooth)</option>
              {devices.map(d => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Output Device (${d.deviceId.substring(0, 6)})`}
                </option>
              ))}
            </select>
          ) : (
            <div className="text-text-secondary text-[11px] leading-relaxed">
              Host OS audio mixer controls physical routing. Connect your Bluetooth speaker in Windows settings: <code className="text-gold">Settings &gt; Bluetooth &amp; devices</code>.
            </div>
          )}

          <div className="text-[10px] text-text-muted">
            {supportsSinkId 
              ? '✓ Direct hardware sink routing enabled.' 
              : 'ℹ Standard system audio driver routing.'}
          </div>
        </div>
      </div>

      {/* Multi-Speaker Synchronization & Delay Alignment Panel */}
      <div className="p-4 bg-bg-main/80 border border-border rounded-xl space-y-3 font-mono text-xs">
        <div className="flex items-center justify-between pb-2 border-b border-border">
          <span className="font-bold uppercase text-[11px] tracking-wider text-text-primary">
            SPEAKER LATENCY SYNCHRONIZATION // DELAY ALIGNMENT
          </span>
          <span className="text-[10px] text-text-muted">
            DELAY: <strong className="text-gold">{speakerDelay} ms</strong>
          </span>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-text-secondary text-[11px]">
            <span>PA Alignment Delay (compensates Bluetooth &amp; satellite speaker distance):</span>
            <span className="text-gold font-bold">{speakerDelay} ms</span>
          </div>
          <input
            type="range"
            min={0}
            max={250}
            step={5}
            value={speakerDelay}
            onChange={(e) => handleDelayChange(Number(e.target.value))}
            className="w-full accent-[#D6B36A] bg-burgundy-deep h-1.5 rounded-lg cursor-pointer"
          />
          <div className="flex justify-between text-[9px] text-text-muted">
            <span>0 ms (Direct Wired AUX)</span>
            <span>75 ms (Delay Tower)</span>
            <span>150 ms (Bluetooth Align)</span>
            <span>250 ms (Max PA Buffer)</span>
          </div>
        </div>

        {/* Multi-Speaker Destinations Status */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1 text-[11px]">
          {speakerOutputs.map((out) => (
            <div key={out.id} className="p-3 bg-burgundy-deep/40 border border-border rounded-lg flex items-center justify-between">
              <div>
                <div className="font-bold text-text-primary">{out.name}</div>
                <div className="text-[9px] text-text-muted mt-0.5">
                  Device: {out.deviceId === 'default' ? 'System Default' : out.deviceId.substring(0, 8)} • Delay: {out.delayMs}ms
                </div>
              </div>
              <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-gold/15 text-gold border border-gold/30">
                ACTIVE
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Studio Limiter & Stage Transmission Chain */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
        <div className="p-3.5 bg-bg-main/80 border border-border rounded-xl space-y-1.5">
          <div className="text-[10px] text-text-muted uppercase tracking-wider font-bold">STUDIO MASTER LIMITER (ANTI-CLIPPING)</div>
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">Limiter Ceiling:</span>
            <span className="text-gold font-bold">-3.0 dBFS (True Peak Protected)</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">Dynamics Compression:</span>
            <span className="text-text-primary">Ratio 20:1 | 3ms Attack | 120ms Release</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">Limiter Reduction:</span>
            <span className="text-gold font-bold">{hostAudio.getCompressorReduction()} dB</span>
          </div>
          <p className="text-[10px] text-text-muted mt-1 leading-relaxed">
            Safe pre-amp gain boost enabled. Even when phone distance varies or gain trim is raised, signals never digitally clip or distort through the PA speakers.
          </p>
        </div>

        <div className="p-3.5 bg-bg-main/80 border border-border rounded-xl space-y-1.5">
          <div className="text-[10px] text-text-muted uppercase tracking-wider font-bold">END-TO-END LATENCY PROFILES</div>
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">Wi-Fi LAN Transmission:</span>
            <span className="text-text-primary">~8 - 15 ms (Opus 128k CBR)</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">Wired 3.5mm AUX / USB Interface:</span>
            <span className="text-gold font-bold">~20 - 35 ms (Near Zero Latency)</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">Bluetooth Speaker (A2DP Codec):</span>
            <span className="text-text-primary font-bold">~120 - 180 ms (Hardware Buffer)</span>
          </div>
          <p className="text-[10px] text-text-muted mt-1 leading-relaxed">
            For live musical performance or rapid call-and-response, plug laptop directly into venue amplifier via AUX cable.
          </p>
        </div>
      </div>

      {/* Bluetooth & Latency Engineering Notes */}
      <div className="p-3.5 bg-burgundy-deep/30 border border-border rounded-xl text-xs space-y-1.5 text-text-secondary">
        <div className="font-mono text-[10px] text-gold uppercase tracking-widest font-bold">
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
