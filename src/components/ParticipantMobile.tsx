import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { Participant, SessionState } from '../types.js';
import { ParticipantAudioEngine } from '../audio/ParticipantAudioEngine.js';
import { RetroVUMeter } from './RetroVUMeter.js';
import { Mic, MicOff, Radio, Shield, LogOut, Sliders, AlertCircle, Wifi, WifiOff, RefreshCw } from 'lucide-react';

interface ParticipantMobileProps {
  socket: Socket | null;
  sessionId: string;
  initialParticipantName?: string;
  initialStream?: MediaStream | null;
  connectionStatus: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  connectionError?: string | null;
  onRetryConnection: () => void;
  onLeave: () => void;
}

export const ParticipantMobile: React.FC<ParticipantMobileProps> = ({
  socket,
  sessionId,
  initialParticipantName,
  initialStream,
  connectionStatus,
  connectionError,
  onRetryConnection,
  onLeave
}) => {
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [micPermissionGranted, setMicPermissionGranted] = useState<boolean>(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [sensitivity, setSensitivity] = useState<number>(1.0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [netStats, setNetStats] = useState<{ rttMs: number; packetLossPct: number; bitrateKbps: number } | null>(null);
  const [vocalProfile, setVocalProfile] = useState<'stage' | 'conference'>('stage');

  const audioEngineRef = useRef<ParticipantAudioEngine | null>(null);

  // Initialize participant audio engine
  useEffect(() => {
    const engine = new ParticipantAudioEngine();
    audioEngineRef.current = engine;

    return () => {
      engine.stop();
    };
  }, []);

  // Poll WebRTC network statistics every 1.2s to monitor Wi-Fi link quality
  useEffect(() => {
    if (!micPermissionGranted) return;
    const interval = setInterval(async () => {
      if (audioEngineRef.current) {
        try {
          const stats = await audioEngineRef.current.getStats();
          setNetStats(stats);
        } catch {}
      }
    }, 1200);
    return () => clearInterval(interval);
  }, [micPermissionGranted]);

  // Request Microphone and establish WebRTC stream
  const handleEnableMicrophone = useCallback(async (customStream?: MediaStream) => {
    setPermissionError(null);
    try {
      const engine = audioEngineRef.current;
      if (!engine || !socket) return;

      // 1. Get real phone mic stream (or use pre-acquired stream)
      await engine.startMicrophone(customStream || (initialStream || undefined));
      setMicPermissionGranted(true);

      // 2. Start audio analysis loop (sends live telemetry to host console)
      let lastTelemetryTime = 0;
      engine.startMeterLoop((level, speaking) => {
        setAudioLevel(level);
        setIsSpeaking(speaking);

        const now = Date.now();
        // Throttle socket telemetry to ~15 updates/sec (every 66ms) so local Wi-Fi never saturates
        if (now - lastTelemetryTime > 66) {
          lastTelemetryTime = now;
          socket.emit('participant:telemetry', {
            audioLevel: level,
            isSpeaking: speaking
          });
        }
      });

      // 3. Update status on server
      socket.emit('participant:status', { state: 'READY' });

      // 4. Send WebRTC offer to host
      await engine.initWebRTC((signal, type) => {
        socket.emit('webrtc:signal', {
          to: session?.adminSocketId || undefined,
          signal,
          type
        });
      });
    } catch (err: any) {
      console.error('Microphone access denied:', err);
      setPermissionError(err.message || 'Microphone access denied by browser');
      if (socket) {
        socket.emit('participant:status', { state: 'PERMISSION DENIED' });
      }
    }
  }, [socket, initialStream, session]);

  // If initialStream was provided by JoinPage gesture, initialize mic immediately!
  useEffect(() => {
    if (initialStream && socket) {
      handleEnableMicrophone(initialStream);
    }
  }, [initialStream, socket, handleEnableMicrophone]);

  // Listen to socket events
  useEffect(() => {
    if (!socket) return;

    socket.on('session:state', (updatedSession: SessionState) => {
      setSession(updatedSession);
      if (socket.id && updatedSession.participants[socket.id]) {
        setParticipant(updatedSession.participants[socket.id]);
      }
    });

    socket.on('participant:assigned', (p: Participant) => {
      setParticipant(p);
    });

    socket.on('participant:kicked', () => {
      alert('You have been disconnected from the session by the administrator.');
      onLeave();
    });

    // WebRTC signaling: Host responds with answer or candidates
    socket.on('webrtc:signal', async ({ from, signal, type }: { from: string; signal: any; type: string }) => {
      const engine = audioEngineRef.current;
      if (!engine) return;

      if (type === 'answer') {
        await engine.handleAnswer(signal);
      } else if (type === 'candidate') {
        await engine.handleCandidate(signal);
      }
    });

    return () => {
      socket.off('session:state');
      socket.off('participant:assigned');
      socket.off('participant:kicked');
      socket.off('webrtc:signal');
    };
  }, [socket, onLeave]);

  const handleToggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (audioEngineRef.current) {
      audioEngineRef.current.setMute(nextMuted);
    }
    if (socket) {
      socket.emit('participant:self_mute', { isMuted: nextMuted });
    }
  };

  const handleSensitivityChange = (val: number) => {
    setSensitivity(val);
    if (audioEngineRef.current) {
      audioEngineRef.current.setSensitivity(val);
    }
  };

  const channelNumber = participant ? participant.channelNumber : 1;
  const channelTag = `MIC ${String(channelNumber).padStart(2, '0')}`;
  const isSelectedOnAir = session?.activeSpeakerId === socket?.id && !isMuted && !participant?.isMutedByAdmin && !session?.isMuteAll && !session?.isEmergencyStop;

  return (
    <div className="min-h-screen bg-bg-main text-text-primary flex flex-col p-4 w-full sm:max-w-md mx-auto relative select-none overflow-y-auto">
      {/* Retro hardware rack screws */}
      <div className="absolute top-2 left-2 rack-screw opacity-60" />
      <div className="absolute top-2 right-2 rack-screw opacity-60" />
      <div className="absolute bottom-2 left-2 rack-screw opacity-60" />
      <div className="absolute bottom-2 right-2 rack-screw opacity-60" />

      {/* Header */}
      <header className="flex items-center justify-between pb-3 border-b border-border my-2">
        <div>
          <h1 className="font-heading font-bold text-lg tracking-widest">MICRO PAD</h1>
          <div className="text-[10px] font-mono text-text-muted uppercase">
            TX-UNIT // HANDSET TERMINAL
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs font-mono font-bold text-text-primary">
            {sessionId}
          </div>
          <div className="flex items-center justify-end gap-1 text-[10px] font-mono">
            {connectionStatus === 'CONNECTED' ? (
              <span className="text-text-primary flex items-center gap-1 font-semibold">
                <Wifi size={11} />
                <span>LINK ACTIVE</span>
              </span>
            ) : connectionStatus === 'CONNECTING' ? (
              <span className="text-text-secondary flex items-center gap-1 animate-pulse">
                <Wifi size={11} />
                <span>CONNECTING...</span>
              </span>
            ) : (
              <span className="text-text-muted flex items-center gap-1 font-semibold">
                <WifiOff size={11} />
                <span>OFFLINE</span>
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Connection Offline Banner */}
      {connectionStatus !== 'CONNECTED' && (
        <div className="my-2 p-2.5 bg-bg-elevated border-2 border-border rounded-sm flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-2">
            <WifiOff size={14} className="text-text-primary shrink-0" />
            <span className="truncate max-w-[200px]">
              {connectionError || (connectionStatus === 'CONNECTING' ? 'Re-linking to console...' : 'Console link lost')}
            </span>
          </div>
          <button
            onClick={onRetryConnection}
            className="px-2 py-1 bg-text-primary text-text-inverse font-bold text-[10px] uppercase btn-tactile hover:bg-white/90 flex items-center gap-1 shrink-0"
          >
            <RefreshCw size={10} />
            <span>RETRY</span>
          </button>
        </div>
      )}

      {/* Main Channel & Call Sign Banner */}
      <div className="my-3 p-4 bg-bg-elevated border border-border rounded-sm flex items-center justify-between">
        <div>
          <div className="text-[10px] font-mono text-text-muted uppercase">ASSIGNED CHANNEL</div>
          <div className="font-mono text-2xl font-bold tracking-wider text-text-primary">
            {channelTag}
          </div>
          <div className="text-xs font-body text-text-secondary mt-0.5">
            Call Sign: <strong className="text-text-primary">{participant?.name || initialParticipantName || 'Participant'}</strong>
          </div>
        </div>

        <div className="text-right flex flex-col items-end gap-1">
          <div className="flex items-center gap-1 text-xs font-mono px-2 py-0.5 bg-bg-main border border-border">
            <Shield size={12} />
            <span>{participant?.priority || 'Normal'}</span>
          </div>
          <span className="text-[9px] font-mono text-text-muted uppercase">PRIORITY LEVEL</span>
        </div>
      </div>

      {/* Big Tactile Broadcast Status Panel / Push Button */}
      <div className="flex flex-col items-center justify-center my-4">
        {!micPermissionGranted ? (
          <div className="w-full p-6 bg-bg-elevated border-2 border-border rounded-sm text-center flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-full bg-bg-main border-2 border-border flex items-center justify-center">
              <Mic size={28} className="text-text-primary" />
            </div>
            <div>
              <h3 className="font-heading font-bold text-base uppercase tracking-wider">
                ENGAGE MICROPHONE
              </h3>
              <p className="text-xs text-text-secondary mt-1">
                Tap to grant browser microphone permissions and link audio to the PA console.
              </p>
            </div>

            {permissionError && (
              <div className="p-2 border border-text-muted bg-bg-main text-xs font-mono text-text-primary flex items-center gap-1.5">
                <AlertCircle size={14} />
                <span>{permissionError}</span>
              </div>
            )}

            <button
              onClick={() => handleEnableMicrophone()}
              className="w-full py-3 bg-text-primary text-text-inverse font-mono font-bold tracking-wider uppercase text-sm border border-white btn-tactile hover:bg-white/90 shadow-md"
            >
              INITIALIZE AUDIO LINK
            </button>
          </div>
        ) : (
          <div className="w-full flex flex-col items-center gap-4">
            {/* Primary ON AIR / STANDBY / MUTED Visual Instrument */}
            <div
              className={`w-full py-10 px-4 rounded-sm border-2 text-center flex flex-col items-center justify-center transition-all ${
                isSelectedOnAir
                  ? 'bg-text-primary text-text-inverse border-white shadow-2xl scale-[1.02]'
                  : isMuted || participant?.isMutedByAdmin || session?.isMuteAll || session?.isEmergencyStop
                  ? 'bg-bg-elevated text-text-muted border-dashed border-border'
                  : 'bg-bg-elevated text-text-primary border-border'
              }`}
            >
              <div className="flex items-center gap-2 mb-2 font-mono text-xs uppercase tracking-widest">
                <Radio size={14} className={isSelectedOnAir ? 'animate-pulse' : ''} />
                <span>STATUS INDICATOR</span>
              </div>

              <div className="font-heading font-black text-3xl tracking-widest my-1 uppercase">
                {session?.isEmergencyStop
                  ? 'EMERGENCY STOP'
                  : session?.isMuteAll
                  ? 'ALL MICS MUTED'
                  : participant?.isMutedByAdmin
                  ? 'MUTED BY ADMIN'
                  : isMuted
                  ? 'TRANSMITTER MUTED'
                  : isSelectedOnAir
                  ? '★ ON AIR // LIVE'
                  : 'STANDBY // READY'}
              </div>

              <div className="font-mono text-xs mt-2 max-w-xs">
                {isSelectedOnAir
                  ? 'YOUR AUDIO IS BEING ROUTED TO THE MAIN PA SYSTEM'
                  : session?.mode === 'auto'
                  ? 'Speak naturally to trigger automatic VAD floor arbitration'
                  : 'Waiting for sound engineer to route your channel to output'}
              </div>
            </div>

            {/* Hardware Live VU Meter */}
            <div className="w-full p-4 bg-bg-elevated border border-border rounded-sm">
              <RetroVUMeter
                level={isMuted ? 0 : audioLevel}
                segments={18}
                height="h-5"
                showLabels={true}
                label={isSpeaking ? '● VOICE ACTIVITY ACTIVE' : 'TRANSMITTER INPUT LEVEL'}
              />
            </div>

            {/* Quick Mute Toggle */}
            <button
              onClick={handleToggleMute}
              className={`w-full py-3 px-4 border font-mono font-bold tracking-wider uppercase text-xs btn-tactile flex items-center justify-center gap-2 ${
                isMuted
                  ? 'bg-bg-secondary text-text-secondary border-border hover:border-text-primary'
                  : 'bg-text-primary text-text-inverse border-white hover:bg-white/90'
              }`}
            >
              {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
              <span>{isMuted ? 'UNMUTE TRANSMITTER' : 'MUTE MICROPHONE'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Sensitivity & Diagnostics Tray */}
      {micPermissionGranted && (
        <div className="my-2 p-3 bg-bg-elevated border border-border rounded-sm text-xs font-mono space-y-2.5">
          {/* RF / Wi-Fi Network Telemetry */}
          <div className="flex items-center justify-between text-[11px] pb-1.5 border-b border-border/50">
            <span className="flex items-center gap-1.5 text-text-secondary">
              <Wifi size={12} className={netStats && netStats.packetLossPct > 10 ? 'text-red-400 animate-pulse' : ''} />
              <span>WI-FI RF LINK</span>
            </span>
            <div className="flex items-center gap-2">
              <span className="text-text-primary font-bold">
                {netStats && netStats.rttMs > 0 ? `${netStats.rttMs}ms` : 'SYNCED'}
              </span>
              <span className={netStats && netStats.packetLossPct > 10 ? 'text-red-400 font-bold underline' : 'text-text-muted'}>
                LOSS: {netStats ? `${netStats.packetLossPct}%` : '0%'}
              </span>
            </div>
          </div>

          {/* Wi-Fi Range Advisory if packet loss occurs */}
          {netStats && netStats.packetLossPct > 10 && (
            <div className="p-2 bg-bg-main border border-border text-[10px] text-text-secondary">
              ⚠️ <strong>WI-FI PACKET LOSS DETECTED:</strong> Participant is near the boundary of the venue Wi-Fi access point. Please move closer to the router for clear audio.
            </div>
          )}

          {/* Pre-amp Sensitivity slider */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-text-secondary">
              <span className="flex items-center gap-1.5">
                <Sliders size={12} />
                <span>PRE-AMP SENSITIVITY</span>
              </span>
              <span className="text-text-primary font-bold">{Math.round(sensitivity * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.5}
              max={2.5}
              step={0.1}
              value={sensitivity}
              onChange={(e) => handleSensitivityChange(Number(e.target.value))}
              className="w-full accent-white bg-bg-main cursor-pointer"
            />
          </div>

          {/* Vocal Mode Switcher */}
          <div className="pt-1.5 border-t border-border/50 flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold text-text-primary uppercase">
                {vocalProfile === 'stage' ? 'STAGE PA VOCAL MODE' : 'CONFERENCE CALL MODE'}
              </div>
              <div className="text-[9px] text-text-muted">
                {vocalProfile === 'stage' 
                  ? 'Acoustic DSP ducking off (full room presence)' 
                  : 'Noise gating active'}
              </div>
            </div>
            <button
              onClick={async () => {
                const nextMode = vocalProfile === 'stage' ? 'conference' : 'stage';
                setVocalProfile(nextMode);
                if (audioEngineRef.current) {
                  await audioEngineRef.current.switchProfile(nextMode);
                }
              }}
              className="px-2 py-1 bg-bg-main border border-border text-[10px] hover:border-text-primary text-text-primary"
            >
              SWITCH
            </button>
          </div>
        </div>
      )}

      {/* Footer / Leave Session */}
      <footer className="pt-3 border-t border-border flex items-center justify-between mt-auto">
        <div className="text-[10px] font-mono text-text-muted">
          HARDWARE REVISION: 1.0 // B.TECH CSE
        </div>
        <button
          onClick={onLeave}
          className="flex items-center gap-1 text-xs font-mono text-text-secondary hover:text-text-primary border border-transparent hover:border-border px-2 py-1"
        >
          <LogOut size={13} />
          <span>LEAVE SESSION</span>
        </button>
      </footer>
    </div>
  );
};
