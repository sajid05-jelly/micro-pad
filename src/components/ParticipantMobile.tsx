import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { Participant, SessionState } from '../types.js';
import { 
  ParticipantAudioEngine, 
  AudioLevelData, 
  MicrophoneDiagnostics, 
  ClientNetworkStats,
  LocalMicTestResult 
} from '../audio/ParticipantAudioEngine.js';
import { RetroVUMeter } from './RetroVUMeter.js';
import { 
  Mic, 
  MicOff, 
  Radio, 
  Shield, 
  LogOut, 
  Sliders, 
  AlertCircle, 
  Wifi, 
  WifiOff, 
  RefreshCw, 
  Activity, 
  Lock, 
  Terminal, 
  ChevronDown, 
  ChevronUp,
  Volume2,
  CheckCircle2,
  Play,
  Square
} from 'lucide-react';

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
  
  // Real-time audio levels
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [dbLevel, setDbLevel] = useState<number>(-Infinity);
  const [rawRms, setRawRms] = useState<number>(0);
  const [peakLevel, setPeakLevel] = useState<number>(0);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);

  // Microphone and Hardware state
  const [micPermissionGranted, setMicPermissionGranted] = useState<boolean>(false);
  const [micPermissionState, setMicPermissionState] = useState<'prompt' | 'granted' | 'denied' | 'unavailable'>('prompt');
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [isStartingMic, setIsStartingMic] = useState<boolean>(false);
  const [sensitivity, setSensitivity] = useState<number>(1.0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [vocalProfile, setVocalProfile] = useState<'stage' | 'conference'>('stage');
  const [showDiagnostics, setShowDiagnostics] = useState<boolean>(true);

  // Isolated Local Hardware Mic Test state (Section B)
  const [isLocalTestRunning, setIsLocalTestRunning] = useState<boolean>(false);
  const [localTestData, setLocalTestData] = useState<LocalMicTestResult | null>(null);
  const [localTestError, setLocalTestError] = useState<string | null>(null);
  const localTestCleanupRef = useRef<(() => void) | null>(null);

  // Diagnostics and WebRTC telemetry
  const [diagnostics, setDiagnostics] = useState<MicrophoneDiagnostics | null>(null);
  const [netStats, setNetStats] = useState<ClientNetworkStats | null>(null);

  const audioEngineRef = useRef<ParticipantAudioEngine | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const sessionRef = useRef<SessionState | null>(null);
  const webrtcInitializedRef = useRef<boolean>(false);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // Check initial permission status if supported by browser
  useEffect(() => {
    isMountedRef.current = true;
    if (typeof navigator !== 'undefined' && (navigator as any).permissions?.query) {
      (navigator as any).permissions.query({ name: 'microphone' })
        .then((status: any) => {
          if (isMountedRef.current && status && status.state) {
            setMicPermissionState(status.state);
            status.onchange = () => {
              if (isMountedRef.current) setMicPermissionState(status.state);
            };
          }
        })
        .catch(() => {});
    }
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Initialize participant audio engine singleton
  useEffect(() => {
    const engine = new ParticipantAudioEngine();
    audioEngineRef.current = engine;

    return () => {
      // Do NOT tear down microphone streams prematurely if page is active
      engine.stop();
      if (localTestCleanupRef.current) {
        localTestCleanupRef.current();
        localTestCleanupRef.current = null;
      }
    };
  }, []);

  // Poll hardware diagnostics and WebRTC network statistics every 1.5s
  useEffect(() => {
    const interval = setInterval(async () => {
      const engine = audioEngineRef.current;
      if (!engine) return;

      try {
        const diag = await engine.getDiagnostics();
        if (isMountedRef.current) {
          setDiagnostics(diag);
          if (diag.trackCount > 0 && diag.trackReadyState === 'live') {
            setMicPermissionGranted(true);
            setMicPermissionState('granted');
          }
        }

        if (micPermissionGranted) {
          const stats = await engine.getStats();
          if (isMountedRef.current) {
            setNetStats(stats);
          }
        }
      } catch {}
    }, 1500);

    return () => clearInterval(interval);
  }, [micPermissionGranted]);

  // ISOLATED LOCAL HARDWARE MIC TEST HANDLER
  const handleToggleLocalTest = async () => {
    if (isLocalTestRunning) {
      if (localTestCleanupRef.current) {
        localTestCleanupRef.current();
        localTestCleanupRef.current = null;
      }
      setIsLocalTestRunning(false);
      return;
    }

    setLocalTestError(null);
    setIsLocalTestRunning(true);

    try {
      const engine = audioEngineRef.current;
      if (!engine) throw new Error('Audio engine not initialized');

      const cleanup = await engine.startLocalTest((data: LocalMicTestResult) => {
        if (!isMountedRef.current) return;
        setLocalTestData(data);
      });

      localTestCleanupRef.current = cleanup;
    } catch (err: any) {
      setIsLocalTestRunning(false);
      setLocalTestError(err.message || 'Could not access microphone for local test');
    }
  };

  // Request Microphone, resume AudioContext, and bind Analyser & WebRTC stream
  const handleEnableMicrophone = useCallback(async (customStream?: MediaStream) => {
    setIsStartingMic(true);
    setPermissionError(null);

    const engine = audioEngineRef.current;
    if (!engine) {
      setIsStartingMic(false);
      setPermissionError('Audio engine not ready. Please refresh the page.');
      return;
    }

    try {
      // Free any running local test before starting main broadcast stream
      if (localTestCleanupRef.current) {
        localTestCleanupRef.current();
        localTestCleanupRef.current = null;
        setIsLocalTestRunning(false);
      }

      // 1. Capture microphone or reuse live stream
      await engine.startMicrophone(customStream || (initialStream || undefined), vocalProfile);
      
      // 2. Refresh diagnostics
      const diag = await engine.getDiagnostics();
      setDiagnostics(diag);
      setMicPermissionGranted(true);
      setMicPermissionState('granted');

      // 3. Start high-precision time-domain RMS meter loop
      let lastTelemetryTime = 0;
      engine.startMeterLoop((data: AudioLevelData) => {
        if (!isMountedRef.current) return;

        setAudioLevel(data.levelPct);
        setDbLevel(data.db);
        setRawRms(data.rawRms);
        setPeakLevel(data.peak);
        setIsSpeaking(data.isSpeaking);

        // Throttle telemetry sent to host console (~15 updates/sec)
        const now = Date.now();
        if (socket && socket.connected && now - lastTelemetryTime > 66) {
          lastTelemetryTime = now;
          socket.emit('participant:telemetry', {
            audioLevel: data.levelPct,
            isSpeaking: data.isSpeaking
          });
        }
      });

      // 4. Update status on server
      if (socket && socket.connected) {
        socket.emit('participant:status', { state: 'READY' });
      }

      // 5. Establish WebRTC uplink to Host (only once per session lifecycle)
      if (socket && !webrtcInitializedRef.current) {
        webrtcInitializedRef.current = true;
        await engine.initWebRTC((signal, type) => {
          socket.emit('webrtc:signal', {
            to: sessionRef.current?.adminSocketId || undefined,
            sessionId,
            signal,
            type
          });
        });
      }

      setIsStartingMic(false);
    } catch (err: any) {
      setIsStartingMic(false);
      console.error('[ParticipantMobile] Microphone initialization failed:', err);

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setMicPermissionState('denied');
        setPermissionError('Microphone permission denied. Tap the lock/settings icon in your browser address bar to allow microphone access, then tap RETRY.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setMicPermissionState('unavailable');
        setPermissionError('No microphone input device detected on this mobile phone.');
      } else {
        setPermissionError(err.message || 'Microphone access failed. Tap START MICROPHONE to retry.');
      }

      if (socket && socket.connected) {
        socket.emit('participant:status', { state: 'PERMISSION DENIED' });
      }
    }
  }, [socket, initialStream, vocalProfile, sessionId]);

  // Attempt immediate auto-activation if initialStream was acquired on JoinPage
  useEffect(() => {
    if (initialStream && socket) {
      handleEnableMicrophone(initialStream);
    }
  }, [initialStream, socket, handleEnableMicrophone]);

  // Manual gesture to resume AudioContext if browser suspends it
  const handleResumeAudioContext = async () => {
    if (audioEngineRef.current) {
      await audioEngineRef.current.resumeAudioContext();
      const diag = await audioEngineRef.current.getDiagnostics();
      setDiagnostics(diag);
    }
  };

  // Socket event listeners
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
      alert('You have been disconnected from the session by the host.');
      onLeave();
    });

    socket.on('webrtc:signal', async ({ signal, type }: { from: string; signal: any; type: string }) => {
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

  // Rigorous verification of local microphone audio capture
  const isAudioLive = Boolean(
    micPermissionGranted &&
    diagnostics &&
    diagnostics.trackCount > 0 &&
    diagnostics.trackReadyState === 'live' &&
    diagnostics.trackEnabled &&
    diagnostics.audioContextState === 'running'
  );

  // Strictly enforce: never display ON AIR unless the floor is assigned AND local microphone capture is verified live!
  const isAssignedFloor = session?.activeSpeakerId === socket?.id;
  const isMutedState = isMuted || participant?.isMutedByAdmin || session?.isMuteAll || session?.isEmergencyStop;
  const isLiveOnAir = isAssignedFloor && isAudioLive && !isMutedState;

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
          <h1 className="font-heading font-bold text-lg tracking-widest uppercase">MICRO PAD</h1>
          <div className="text-[10px] font-mono text-text-muted uppercase">
            TX-UNIT // HANDSET TRANSMITTER
          </div>
        </div>
        <div className="text-right font-mono">
          <div className="text-xs font-bold text-text-primary">
            {sessionId}
          </div>
          <div className="flex items-center justify-end gap-1.5 text-[10px]">
            {isAudioLive ? (
              <span className="text-green-400 font-bold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                <span>MIC LIVE</span>
              </span>
            ) : (
              <span className="text-yellow-400 font-bold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
                <span>MIC OFF</span>
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

      {/* AudioContext Suspended Warning (Mobile Browser Gesture Required) */}
      {diagnostics && diagnostics.audioContextState === 'suspended' && (
        <div className="my-2 p-2.5 bg-bg-elevated border-2 border-yellow-400 rounded-sm flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-2 text-yellow-400">
            <AlertCircle size={14} className="shrink-0" />
            <span className="text-[11px] font-bold">AUDIO ENGINE SUSPENDED</span>
          </div>
          <button
            onClick={handleResumeAudioContext}
            className="px-2.5 py-1 bg-text-primary text-text-inverse font-bold text-[10px] uppercase btn-tactile hover:bg-white/90 shrink-0"
          >
            RESUME MIC
          </button>
        </div>
      )}

      {/* Main Channel & Call Sign Banner */}
      <div className="my-2 p-3 bg-bg-elevated border border-border rounded-sm flex items-center justify-between">
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

      {/* ISOLATED LOCAL HARDWARE MIC TEST (SECTION B) */}
      <div className="my-1 p-3 bg-bg-elevated border-2 border-border rounded-sm space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-mono font-bold">
            <Activity size={13} className={isLocalTestRunning ? 'text-green-400 animate-pulse' : 'text-text-primary'} />
            <span>LOCAL MIC TEST</span>
          </div>
          <button
            onClick={handleToggleLocalTest}
            className={`px-2.5 py-1 text-[10px] font-mono font-bold uppercase btn-tactile flex items-center gap-1 border ${
              isLocalTestRunning
                ? 'bg-red-500 text-white border-red-400 hover:bg-red-600'
                : 'bg-text-primary text-text-inverse border-white hover:bg-white/90'
            }`}
          >
            {isLocalTestRunning ? <Square size={10} /> : <Play size={10} />}
            <span>{isLocalTestRunning ? 'STOP TEST' : 'START LOCAL TEST'}</span>
          </button>
        </div>

        <p className="text-[10px] font-mono text-text-muted">
          Verifies physical ADC microphone capture directly without depending on WebRTC, server, or admin floor.
        </p>

        {localTestError && (
          <div className="p-2 border border-red-500 bg-red-950/20 text-red-400 text-[10px] font-mono flex items-center gap-1.5">
            <AlertCircle size={12} className="shrink-0" />
            <span>{localTestError}</span>
          </div>
        )}

        {isLocalTestRunning && localTestData && (
          <div className="space-y-2 pt-2 border-t border-border/50">
            <div
              className={`py-1.5 px-2 rounded-sm border text-center font-mono text-xs font-bold uppercase transition-all ${
                localTestData.isVoiceDetected
                  ? 'bg-green-500/20 border-green-400 text-green-300 animate-pulse'
                  : 'bg-bg-main border-border text-text-muted'
              }`}
            >
              {localTestData.isVoiceDetected
                ? '● VOICE DETECTED (INPUT EXCEEDS THRESHOLD)'
                : 'LISTENING... SPEAK INTO PHONE MICROPHONE'}
            </div>

            <RetroVUMeter
              level={localTestData.levelPct}
              segments={16}
              height="h-4"
              showLabels={true}
              numericValue={
                localTestData.db !== -Infinity
                  ? `${localTestData.db} dBFS (${localTestData.levelPct}%)`
                  : '-INF dB (0%)'
              }
              label="LOCAL HARDWARE ADC INPUT"
            />

            <div className="grid grid-cols-3 gap-1 font-mono text-[9px] text-center">
              <div className="p-1.5 bg-bg-main border border-border">
                <span className="text-text-muted block text-[8px]">RMS</span>
                <span className="font-bold text-text-primary">{localTestData.rms.toFixed(4)}</span>
              </div>
              <div className="p-1.5 bg-bg-main border border-border">
                <span className="text-text-muted block text-[8px]">PEAK</span>
                <span className="font-bold text-text-primary">{localTestData.peak.toFixed(2)}</span>
              </div>
              <div className="p-1.5 bg-bg-main border border-border">
                <span className="text-text-muted block text-[8px]">dBFS</span>
                <span className="font-bold text-text-primary">
                  {localTestData.db !== -Infinity ? `${localTestData.db}` : '-INF'}
                </span>
              </div>
            </div>

            <div className="p-1.5 bg-bg-main border border-border font-mono text-[9px]">
              <div className="text-text-muted text-[8px] mb-0.5">ADC FLOAT SAMPLES (FIRST 8):</div>
              <div className="text-text-primary font-mono truncate">
                [{localTestData.samplePreview.map((v) => (v >= 0 ? `+${v.toFixed(3)}` : v.toFixed(3))).join(', ')}]
              </div>
            </div>

            <div className="text-[9px] font-mono text-text-muted truncate">
              DEVICE: <strong className="text-text-primary">{localTestData.deviceLabel}</strong>
            </div>
          </div>
        )}
      </div>

      {/* Primary Interaction Area: Start Mic CTA OR Live Instrument */}
      <div className="my-2 flex flex-col gap-3">
        {!isAudioLive ? (
          /* START MICROPHONE CALL TO ACTION (Direct User Gesture) */
          <div className="w-full p-5 bg-bg-elevated border-2 border-border rounded-sm text-center flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-full bg-bg-main border-2 border-border flex items-center justify-center">
              <Mic size={24} className="text-text-primary" />
            </div>

            <div>
              <h3 className="font-heading font-bold text-sm uppercase tracking-wider text-text-primary">
                MICROPHONE CAPTURE REQUIRED
              </h3>
              <p className="text-xs text-text-secondary font-mono mt-1">
                Tap below to grant microphone access and start the local audio capture engine.
              </p>
            </div>

            {permissionError && (
              <div className="w-full p-2.5 border-2 border-border bg-bg-main text-xs font-mono text-text-primary flex items-start gap-2 text-left">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-bold text-[10px] uppercase">AUDIO PERMISSION ERROR</div>
                  <div className="text-[11px] text-text-secondary font-body">{permissionError}</div>
                </div>
              </div>
            )}

            <button
              onClick={() => handleEnableMicrophone()}
              disabled={isStartingMic}
              className="w-full py-3.5 bg-text-primary text-text-inverse font-mono font-bold tracking-wider uppercase text-sm border border-white btn-tactile hover:bg-white/90 shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Mic size={16} />
              <span>{isStartingMic ? 'INITIALIZING MIC...' : 'START MICROPHONE'}</span>
            </button>
          </div>
        ) : (
          /* VERIFIED LIVE TRANSMITTER INTERFACE */
          <div className="w-full flex flex-col gap-3">
            {/* Main Stage Broadcast Status Indicator */}
            <div
              className={`w-full py-8 px-4 rounded-sm border-2 text-center flex flex-col items-center justify-center transition-all ${
                isLiveOnAir
                  ? 'bg-text-primary text-text-inverse border-white shadow-2xl scale-[1.01]'
                  : isMutedState
                  ? 'bg-bg-elevated text-text-muted border-dashed border-border'
                  : 'bg-bg-elevated text-text-primary border-border'
              }`}
            >
              <div className="flex items-center gap-2 mb-1 font-mono text-xs uppercase tracking-widest">
                <Radio size={14} className={isLiveOnAir ? 'animate-pulse' : ''} />
                <span>BROADCAST STATUS</span>
              </div>

              <div className="font-heading font-black text-2xl sm:text-3xl tracking-widest my-1 uppercase">
                {session?.isEmergencyStop
                  ? 'EMERGENCY STOP'
                  : session?.isMuteAll
                  ? 'ALL MICS MUTED'
                  : participant?.isMutedByAdmin
                  ? 'MUTED BY ADMIN'
                  : isMuted
                  ? 'TRANSMITTER MUTED'
                  : isLiveOnAir
                  ? '★ ON AIR // LIVE'
                  : isAssignedFloor
                  ? 'FLOOR GRANTED'
                  : 'STANDBY // READY'}
              </div>

              <div className="font-mono text-[11px] mt-1.5 max-w-xs leading-relaxed">
                {isLiveOnAir
                  ? 'VOICE IS LIVE AND ROUTED TO THE MAIN PA SYSTEM'
                  : isMutedState
                  ? 'TRANSMITTER IS SILENCED'
                  : session?.mode === 'auto'
                  ? 'Speak to trigger automatic VAD floor arbitration'
                  : 'Waiting for sound engineer to assign floor'}
              </div>
            </div>

            {/* Hardware Live VU Meter & Exact Numeric Display */}
            <div className="w-full p-3.5 bg-bg-elevated border border-border rounded-sm space-y-2">
              <RetroVUMeter
                level={isMuted ? 0 : audioLevel}
                segments={18}
                height="h-5"
                showLabels={true}
                numericValue={
                  isMuted
                    ? 'MUTED'
                    : dbLevel !== -Infinity
                    ? `${dbLevel} dBFS (${audioLevel}%)`
                    : '-INF dB (0%)'
                }
                label={
                  isMuted
                    ? 'TRANSMITTER MUTED'
                    : isSpeaking
                    ? '● VOICE ACTIVITY ACTIVE'
                    : 'TRANSMITTER INPUT LEVEL'
                }
              />

              <div className="flex items-center justify-between font-mono text-[10px] text-text-muted pt-1 border-t border-border/50">
                <span>RMS: <strong className="text-text-primary">{rawRms.toFixed(4)}</strong></span>
                <span>PEAK: <strong className="text-text-primary">{peakLevel.toFixed(2)}</strong></span>
                <span>VAD: <strong className={isSpeaking ? 'text-green-400 font-bold' : 'text-text-muted'}>
                  {isSpeaking ? 'VOICE DETECTED' : 'IDLE'}
                </strong></span>
              </div>
            </div>

            {/* Tactile Mute Toggle */}
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

      {/* Pre-amp Sensitivity & Vocal Mode */}
      {isAudioLive && (
        <div className="my-2 p-3 bg-bg-elevated border border-border rounded-sm text-xs font-mono space-y-2.5">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-text-secondary">
              <span className="flex items-center gap-1.5">
                <Sliders size={12} />
                <span>PRE-AMP GAIN TRIM</span>
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

          <div className="pt-2 border-t border-border/50 flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold text-text-primary uppercase">
                {vocalProfile === 'stage' ? 'STAGE PA VOCAL MODE' : 'CONFERENCE CALL MODE'}
              </div>
              <div className="text-[9px] text-text-muted">
                {vocalProfile === 'stage' ? 'Raw venue warmth (AEC/DSP ducking disabled)' : 'DSP noise gating enabled'}
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
              className="px-2 py-1 bg-bg-main border border-border text-[10px] hover:border-text-primary text-text-primary uppercase"
            >
              SWITCH
            </button>
          </div>
        </div>
      )}

      {/* Hardware Diagnostic Tray (Expandable Real-Time Telemetry) */}
      <div className="my-2 bg-bg-elevated border border-border rounded-sm text-xs font-mono">
        <button
          onClick={() => setShowDiagnostics(!showDiagnostics)}
          className="w-full p-2.5 flex items-center justify-between text-text-secondary hover:text-text-primary font-bold text-[11px] uppercase"
        >
          <div className="flex items-center gap-1.5">
            <Activity size={13} className="text-text-primary" />
            <span>TRANSMITTER HARDWARE TELEMETRY</span>
          </div>
          {showDiagnostics ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {showDiagnostics && (
          <div className="p-3 pt-0 border-t border-border/50 space-y-2 text-[10px] font-mono">
            <div className="grid grid-cols-2 gap-2 pt-2">
              <div className="p-2 bg-bg-main border border-border">
                <span className="text-text-muted block text-[9px]">SECURE CONTEXT</span>
                <span className={typeof window !== 'undefined' && window.isSecureContext ? 'text-green-400 font-bold' : 'text-red-400 font-bold'}>
                  {typeof window !== 'undefined' && window.isSecureContext ? 'TRUE (HTTPS / LOCAL)' : 'FALSE (INSECURE)'}
                </span>
              </div>

              <div className="p-2 bg-bg-main border border-border">
                <span className="text-text-muted block text-[9px]">MIC PERMISSION</span>
                <span className={micPermissionState === 'granted' ? 'text-green-400 font-bold' : 'text-yellow-400 font-bold'}>
                  {micPermissionState.toUpperCase()}
                </span>
              </div>

              <div className="p-2 bg-bg-main border border-border">
                <span className="text-text-muted block text-[9px]">AUDIO TRACK</span>
                <span className="text-text-primary font-bold">
                  {diagnostics?.trackCount ? `${diagnostics.trackReadyState.toUpperCase()} (${diagnostics.trackCount}ch)` : 'NO TRACK'}
                </span>
              </div>

              <div className="p-2 bg-bg-main border border-border">
                <span className="text-text-muted block text-[9px]">AUDIO CONTEXT</span>
                <span className={diagnostics?.audioContextState === 'running' ? 'text-green-400 font-bold' : 'text-yellow-400 font-bold'}>
                  {diagnostics?.audioContextState ? diagnostics.audioContextState.toUpperCase() : 'NONE'}
                </span>
              </div>
            </div>

            {/* Active Microphone Device Name */}
            {diagnostics && diagnostics.trackLabel && (
              <div className="p-2 bg-bg-main border border-border flex items-center justify-between">
                <span className="text-text-muted text-[9px]">DEVICE:</span>
                <span className="text-text-primary font-bold truncate max-w-[200px]">
                  {diagnostics.trackLabel}
                </span>
              </div>
            )}

            {/* WebRTC RF Network Stats */}
            <div className="p-2 bg-bg-main border border-border space-y-1">
              <div className="flex items-center justify-between text-text-secondary">
                <span>WI-FI RF RTT:</span>
                <span className="text-text-primary font-bold">{netStats && netStats.rttMs > 0 ? `${netStats.rttMs} ms` : 'SYNCED'}</span>
              </div>
              <div className="flex items-center justify-between text-text-secondary">
                <span>OUTBOUND BITRATE:</span>
                <span className="text-text-primary font-bold">{netStats?.bitrateKbps || 0} kbps</span>
              </div>
              <div className="flex items-center justify-between text-text-secondary">
                <span>RTP PACKETS SENT:</span>
                <span className="text-text-primary font-bold">{netStats?.packetsSent || 0}</span>
              </div>
              <div className="flex items-center justify-between text-text-secondary">
                <span>OUTBOUND BYTES:</span>
                <span className="text-text-primary font-bold">{netStats?.bytesSent ? `${Math.round(netStats.bytesSent / 1024)} KB` : '0 KB'}</span>
              </div>
            </div>

            {/* Quick Restart Microphone Action */}
            <button
              onClick={() => handleEnableMicrophone()}
              className="w-full py-1.5 bg-bg-main border border-border text-text-secondary hover:text-text-primary text-[10px] font-bold uppercase btn-tactile flex items-center justify-center gap-1.5"
            >
              <RefreshCw size={11} />
              <span>RESTART AUDIO CAPTURE</span>
            </button>
          </div>
        )}
      </div>

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
