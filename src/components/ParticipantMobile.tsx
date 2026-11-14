import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { Participant, SessionState, AudioCaptureSettings } from '../types.js';
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
  const [isClipping, setIsClipping] = useState<boolean>(false);

  // Microphone and Hardware state
  const [micPermissionGranted, setMicPermissionGranted] = useState<boolean>(false);
  const [micPermissionState, setMicPermissionState] = useState<'prompt' | 'granted' | 'denied' | 'unavailable'>('prompt');
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [isStartingMic, setIsStartingMic] = useState<boolean>(false);
  const [sensitivity, setSensitivity] = useState<number>(1.0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [vocalProfile, setVocalProfile] = useState<'stage' | 'conference'>('stage');
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showDiagnostics, setShowDiagnostics] = useState<boolean>(false);
  const [audioSettings, setAudioSettings] = useState<AudioCaptureSettings>({
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: true,
    highpassFilter: true,
    sensitivity: 1.0
  });

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
        setIsClipping(data.isClipping);

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

  const handleLeaveConfirm = () => {
    if (confirm('Are you sure you want to disconnect and leave this session?')) {
      onLeave();
    }
  };

  return (
    <div className="min-h-screen bg-bg-main text-text-primary flex flex-col p-4 w-full sm:max-w-md mx-auto relative select-none">
      {/* Header */}
      <header className="flex items-center justify-between pb-3 border-b border-border mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded bg-white text-black flex items-center justify-center font-bold">
            <Radio size={16} className={isLiveOnAir ? 'animate-pulse' : ''} />
          </div>
          <div>
            <h1 className="font-heading font-black text-base tracking-wider uppercase">MICRO MAX</h1>
            <div className="text-[10px] font-mono text-text-muted">
              WIRELESS MICROPHONE
            </div>
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
        <div className="mb-3 p-3 bg-bg-elevated border-2 border-border rounded-lg flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-2">
            <WifiOff size={14} className="text-text-primary shrink-0" />
            <span className="truncate max-w-[200px]">
              {connectionError || (connectionStatus === 'CONNECTING' ? 'Connecting to speaker...' : 'Console link lost')}
            </span>
          </div>
          <button
            onClick={onRetryConnection}
            className="px-2.5 py-1 bg-white text-black font-bold text-[10px] uppercase rounded hover:bg-neutral-200 flex items-center gap-1 shrink-0"
          >
            <RefreshCw size={10} />
            <span>RETRY</span>
          </button>
        </div>
      )}

      {/* AudioContext Suspended Warning (Mobile Browser Gesture Required) */}
      {diagnostics && diagnostics.audioContextState === 'suspended' && (
        <div className="mb-3 p-3 bg-bg-elevated border-2 border-yellow-400 rounded-lg flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-2 text-yellow-400">
            <AlertCircle size={14} className="shrink-0" />
            <span className="text-[11px] font-bold">AUDIO ENGINE SUSPENDED</span>
          </div>
          <button
            onClick={handleResumeAudioContext}
            className="px-3 py-1 bg-white text-black font-bold text-[10px] uppercase rounded hover:bg-neutral-200 shrink-0"
          >
            RESUME MIC
          </button>
        </div>
      )}

      {/* Network Health & Distance Warning Pill */}
      {netStats && (
        <div className={`mb-3 px-3 py-2 rounded-lg border flex items-center justify-between text-xs font-mono ${
          netStats.isDistanceWarning
            ? 'bg-amber-950/30 border-yellow-500 text-yellow-200'
            : 'bg-bg-elevated border-border text-text-secondary'
        }`}>
          <div className="flex items-center gap-2">
            <Wifi size={14} className={
              netStats.quality === 'POOR' ? 'text-red-400 animate-pulse' :
              netStats.quality === 'FAIR' ? 'text-yellow-400' : 'text-green-400'
            } />
            <span className="font-bold text-[11px]">
              {netStats.quality === 'POOR' ? 'WEAK WI-FI' :
               netStats.quality === 'FAIR' ? 'MODERATE WI-FI' : 'STRONG WI-FI'}
            </span>
            <span className="text-[10px] text-text-muted">
              ({netStats.rttMs}ms RTT • {netStats.jitterMs}ms Jitter{netStats.packetLossPct > 0 ? ` • ${netStats.packetLossPct}% loss` : ''})
            </span>
          </div>
          {netStats.wifiSignalHint && (
            <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-bg-main border border-border/50 text-text-muted">
              {netStats.wifiSignalHint}
            </span>
          )}
        </div>
      )}

      {/* Distance Dropout Warning Alert */}
      {netStats?.isDistanceWarning && (
        <div className="mb-3 p-3 bg-amber-950/50 border-2 border-yellow-500 rounded-xl flex items-start gap-2.5 text-xs text-yellow-200 font-mono animate-pulse shadow-lg">
          <AlertCircle size={16} className="text-yellow-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <div className="font-bold text-[11px] uppercase tracking-wide text-yellow-300">
              DISTANCE ADVISORY: MOVE CLOSER TO HOST ROUTER
            </div>
            <div className="text-[11px] font-body text-yellow-100/90 leading-tight">
              Wi-Fi latency is {netStats.rttMs}ms ({netStats.packetLossPct}% packet loss). Moving closer ensures smooth, uninterrupted sound on PA speakers.
            </div>
          </div>
        </div>
      )}

      {/* Digital Clipping & Distortion Alert */}
      {isAudioLive && isClipping && (
        <div className="mb-3 p-3 bg-red-950/50 border-2 border-red-500 rounded-xl flex items-start gap-2.5 text-xs text-red-200 font-mono animate-bounce shadow-lg">
          <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <div className="font-bold text-[11px] uppercase tracking-wide text-red-300">
              MICROPHONE CLIPPING DETECTED
            </div>
            <div className="text-[11px] font-body text-red-100/90 leading-tight">
              Voice volume is too loud for the phone's microphone. Hold phone 3-4 inches away or speak softer to prevent audio distortion.
            </div>
          </div>
        </div>
      )}

      {/* Main Channel & Call Sign Info */}
      <div className="mb-3 p-3.5 bg-bg-elevated border border-border rounded-lg flex items-center justify-between">
        <div>
          <div className="text-[10px] font-mono text-text-muted uppercase">ASSIGNED SLOT</div>
          <div className="font-mono text-xl font-bold tracking-wider text-text-primary">
            {channelTag}
          </div>
          <div className="text-xs font-body text-text-secondary mt-0.5">
            Name: <strong className="text-text-primary">{participant?.name || initialParticipantName || 'Speaker'}</strong>
          </div>
        </div>

        <div className="text-right flex flex-col items-end gap-1">
          <div className="flex items-center gap-1 text-xs font-mono px-2 py-0.5 bg-bg-main border border-border rounded">
            <Shield size={12} />
            <span>{participant?.priority || 'Normal'}</span>
          </div>
          <span className="text-[9px] font-mono text-text-muted uppercase">PRIORITY</span>
        </div>
      </div>

      {/* Primary Interaction Area: Start Mic CTA OR Live Instrument */}
      <div className="flex flex-col gap-3">
        {!isAudioLive ? (
          /* START MICROPHONE CALL TO ACTION (Direct User Gesture) */
          <div className="w-full p-6 bg-bg-elevated border-2 border-border rounded-lg text-center flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-white text-black flex items-center justify-center shadow-lg">
              <Mic size={28} />
            </div>

            <div>
              <h3 className="font-heading font-bold text-base uppercase tracking-wider text-text-primary">
                ENABLE YOUR MICROPHONE
              </h3>
              <p className="text-xs text-text-secondary mt-1 max-w-xs mx-auto">
                Tap below and allow microphone permission so your voice can play on the room’s PA speakers.
              </p>
            </div>

            {permissionError && (
              <div className="w-full p-3 border-2 border-red-500/50 bg-red-950/20 text-xs font-mono text-red-300 rounded flex items-start gap-2 text-left">
                <AlertCircle size={14} className="shrink-0 mt-0.5 text-red-400" />
                <div className="space-y-1">
                  <div className="font-bold text-[10px] uppercase">PERMISSION NOTICE</div>
                  <div className="text-[11px] text-text-secondary font-body">{permissionError}</div>
                </div>
              </div>
            )}

            <button
              onClick={() => handleEnableMicrophone()}
              disabled={isStartingMic}
              className="w-full py-4 bg-white text-black font-heading font-bold tracking-wider uppercase text-sm rounded-lg hover:bg-neutral-200 shadow-lg flex items-center justify-center gap-2 disabled:opacity-50 transition-transform active:scale-[0.98]"
            >
              <Mic size={18} />
              <span>{isStartingMic ? 'STARTING MIC...' : 'START MICROPHONE'}</span>
            </button>
          </div>
        ) : (
          /* VERIFIED LIVE TRANSMITTER INTERFACE */
          <div className="w-full flex flex-col gap-3">
            {/* Main Broadcast Status Card */}
            <div
              className={`w-full py-7 px-4 rounded-xl border-2 text-center flex flex-col items-center justify-center transition-all ${
                isLiveOnAir
                  ? 'bg-green-950/30 border-green-400 text-white shadow-xl shadow-green-950/20'
                  : isMutedState
                  ? 'bg-amber-950/20 border-yellow-500/60 text-yellow-200'
                  : 'bg-bg-elevated border-border text-text-primary'
              }`}
            >
              <div className="flex items-center gap-2 mb-1.5 font-mono text-xs uppercase tracking-widest">
                <Radio size={14} className={isLiveOnAir ? 'text-green-400 animate-pulse' : ''} />
                <span>
                  {isLiveOnAir ? 'BROADCAST STATUS: LIVE' : isMutedState ? 'BROADCAST STATUS: MUTED' : 'BROADCAST STATUS: READY'}
                </span>
              </div>

              <div className="font-heading font-black text-2xl sm:text-3xl tracking-wide my-1 uppercase">
                {session?.isEmergencyStop
                  ? 'EMERGENCY STOP'
                  : session?.isMuteAll
                  ? 'ALL MICS MUTED'
                  : participant?.isMutedByAdmin
                  ? 'MUTED BY HOST'
                  : isMuted
                  ? 'MICROPHONE MUTED'
                  : isLiveOnAir
                  ? '● YOU ARE LIVE'
                  : isAssignedFloor
                  ? 'FLOOR ASSIGNED'
                  : 'MICROPHONE READY'}
              </div>

              <div className="text-xs mt-1.5 max-w-xs leading-relaxed opacity-90">
                {isLiveOnAir
                  ? 'Your voice is broadcasting live through the PA speaker right now!'
                  : isMutedState
                  ? 'Your microphone is silenced. Tap unmute below to speak.'
                  : session?.mode === 'auto'
                  ? 'Speak into your phone to automatically take the floor.'
                  : 'Connected! Waiting for host to give you the floor.'}
              </div>
            </div>

            {/* Live Volume Meter */}
            <div className="w-full p-4 bg-bg-elevated border border-border rounded-xl space-y-2">
              <RetroVUMeter
                level={isMuted ? 0 : audioLevel}
                segments={18}
                height="h-5"
                showLabels={true}
                numericValue={
                  isMuted
                    ? 'MUTED'
                    : isSpeaking
                    ? '● VOICE DETECTED'
                    : audioLevel > 5
                    ? `${audioLevel}%`
                    : 'IDLE'
                }
                label={
                  isMuted
                    ? 'MICROPHONE MUTED'
                    : isSpeaking
                    ? '● LIVE VOICE LEVEL'
                    : 'MICROPHONE INPUT LEVEL'
                }
              />
            </div>

            {/* GIANT TOUCH-FRIENDLY MUTE / UNMUTE BUTTON (Minimum 64px height) */}
            <button
              onClick={handleToggleMute}
              className={`w-full py-4 px-6 rounded-xl font-heading font-black tracking-wider uppercase text-base flex items-center justify-center gap-3 transition-all duration-150 active:scale-[0.98] shadow-lg ${
                isMuted
                  ? 'bg-white text-black hover:bg-neutral-200 border-2 border-white'
                  : 'bg-bg-elevated text-red-400 hover:text-red-300 border-2 border-red-500/50 hover:border-red-400'
              }`}
            >
              {isMuted ? (
                <>
                  <Mic size={22} className="animate-pulse" />
                  <span>TAP TO UNMUTE & SPEAK</span>
                </>
              ) : (
                <>
                  <MicOff size={22} />
                  <span>TAP TO MUTE MICROPHONE</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* OPTIONAL ACCORDION: Audio Settings & Hardware Test */}
      <div className="mt-4 bg-bg-elevated border border-border rounded-xl overflow-hidden text-xs">
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="w-full p-3.5 flex items-center justify-between text-text-secondary hover:text-text-primary font-bold uppercase tracking-wider font-mono bg-bg-secondary/40"
        >
          <div className="flex items-center gap-2">
            <Sliders size={14} className="text-white" />
            <span>AUDIO SETTINGS & HARDWARE TEST</span>
          </div>
          {showSettings ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>

        {showSettings && (
          <div className="p-4 border-t border-border space-y-4 font-mono">
            {/* ISOLATED LOCAL HARDWARE MIC TEST */}
            <div className="p-3 bg-bg-main border border-border rounded-lg space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-bold">
                  <Activity size={13} className={isLocalTestRunning ? 'text-green-400 animate-pulse' : 'text-text-primary'} />
                  <span>LOCAL MIC TEST</span>
                </div>
                <button
                  onClick={handleToggleLocalTest}
                  className={`px-3 py-1 text-[11px] font-mono font-bold uppercase rounded flex items-center gap-1.5 ${
                    isLocalTestRunning
                      ? 'bg-red-500 text-white hover:bg-red-600'
                      : 'bg-white text-black hover:bg-neutral-200'
                  }`}
                >
                  {isLocalTestRunning ? <Square size={11} /> : <Play size={11} />}
                  <span>{isLocalTestRunning ? 'STOP TEST' : 'START TEST'}</span>
                </button>
              </div>

              <p className="text-[10px] text-text-muted">
                Speak into phone to test microphone locally without streaming to the PA speakers.
              </p>

              {localTestError && (
                <div className="p-2 border border-red-500 bg-red-950/20 text-red-400 text-[10px] rounded flex items-center gap-1.5">
                  <AlertCircle size={12} className="shrink-0" />
                  <span>{localTestError}</span>
                </div>
              )}

              {isLocalTestRunning && localTestData && (
                <div className="space-y-2 pt-2 border-t border-border/50">
                  <div
                    className={`py-1.5 px-2 rounded border text-center font-mono text-xs font-bold uppercase transition-all ${
                      localTestData.isVoiceDetected
                        ? 'bg-green-500/20 border-green-400 text-green-300 animate-pulse'
                        : 'bg-bg-main border-border text-text-muted'
                    }`}
                  >
                    {localTestData.isVoiceDetected
                      ? '● VOICE DETECTED'
                      : 'LISTENING... SPEAK INTO PHONE'}
                  </div>

                  <RetroVUMeter
                    level={localTestData.levelPct}
                    segments={16}
                    height="h-4"
                    showLabels={false}
                    label="LOCAL ADC INPUT"
                  />
                  <div className="text-[10px] text-text-muted truncate">
                    DEVICE: <strong className="text-text-primary">{localTestData.deviceLabel}</strong>
                  </div>
                </div>
              )}
            </div>

            {/* Mic Sensitivity / Gain Slider */}
            {isAudioLive && (
              <div className="p-3 bg-bg-main border border-border rounded-lg space-y-2">
                <div className="flex items-center justify-between text-text-secondary text-[11px]">
                  <span>MICROPHONE GAIN / SENSITIVITY:</span>
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
            )}

            {/* Voice Profile Switch */}
            {isAudioLive && (
              <div className="p-3 bg-bg-main border border-border rounded-lg flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-bold text-text-primary uppercase">
                    {vocalProfile === 'stage' ? 'STAGE PA VOCAL MODE' : 'CONFERENCE CALL MODE'}
                  </div>
                  <div className="text-[10px] text-text-muted">
                    {vocalProfile === 'stage' ? 'Natural warm tone for venue speakers' : 'DSP noise gating enabled'}
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
                  className="px-2.5 py-1 bg-bg-elevated border border-border text-[10px] hover:border-white text-text-primary uppercase rounded"
                >
                  SWITCH
                </button>
              </div>
            )}

            {/* Professional Audio DSP Toggles */}
            {isAudioLive && (
              <div className="p-3 bg-bg-main border border-border rounded-lg space-y-2.5">
                <div className="text-[11px] font-bold text-text-primary uppercase flex items-center justify-between">
                  <span>AUDIO DSP FILTERS</span>
                  <span className="text-[9px] text-text-muted">LIVE TUNING</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <button
                    onClick={async () => {
                      const next = !audioSettings.highpassFilter;
                      setAudioSettings(s => ({ ...s, highpassFilter: next }));
                      if (audioEngineRef.current) await audioEngineRef.current.updateAudioSettings({ highpassFilter: next });
                    }}
                    className={`p-2 rounded border text-left transition-all ${
                      audioSettings.highpassFilter ? 'bg-white text-black border-white font-bold' : 'bg-bg-elevated border-border text-text-secondary'
                    }`}
                  >
                    <div>80Hz RUMBLE CUT</div>
                    <div className="text-[9px] opacity-75">{audioSettings.highpassFilter ? 'Active (Cuts wind)' : 'Off (Full bass)'}</div>
                  </button>

                  <button
                    onClick={async () => {
                      const next = !audioSettings.autoGainControl;
                      setAudioSettings(s => ({ ...s, autoGainControl: next }));
                      if (audioEngineRef.current) await audioEngineRef.current.updateAudioSettings({ autoGainControl: next });
                    }}
                    className={`p-2 rounded border text-left transition-all ${
                      audioSettings.autoGainControl ? 'bg-white text-black border-white font-bold' : 'bg-bg-elevated border-border text-text-secondary'
                    }`}
                  >
                    <div>AUTO GAIN (AGC)</div>
                    <div className="text-[9px] opacity-75">{audioSettings.autoGainControl ? 'Active (Levels voice)' : 'Manual Gain'}</div>
                  </button>

                  <button
                    onClick={async () => {
                      const next = !audioSettings.noiseSuppression;
                      setAudioSettings(s => ({ ...s, noiseSuppression: next }));
                      if (audioEngineRef.current) await audioEngineRef.current.updateAudioSettings({ noiseSuppression: next });
                    }}
                    className={`p-2 rounded border text-left transition-all ${
                      audioSettings.noiseSuppression ? 'bg-white text-black border-white font-bold' : 'bg-bg-elevated border-border text-text-secondary'
                    }`}
                  >
                    <div>NOISE SUPPRESSION</div>
                    <div className="text-[9px] opacity-75">{audioSettings.noiseSuppression ? 'Active (Filter noise)' : 'Off (Studio warm)'}</div>
                  </button>

                  <button
                    onClick={async () => {
                      const next = !audioSettings.echoCancellation;
                      setAudioSettings(s => ({ ...s, echoCancellation: next }));
                      if (audioEngineRef.current) await audioEngineRef.current.updateAudioSettings({ echoCancellation: next });
                    }}
                    className={`p-2 rounded border text-left transition-all ${
                      audioSettings.echoCancellation ? 'bg-white text-black border-white font-bold' : 'bg-bg-elevated border-border text-text-secondary'
                    }`}
                  >
                    <div>ECHO CANCEL (AEC)</div>
                    <div className="text-[9px] opacity-75">{audioSettings.echoCancellation ? 'Active' : 'Off (Stage PA)'}</div>
                  </button>
                </div>
              </div>
            )}

            {/* Expandable Technical Telemetry */}
            <div className="pt-2 border-t border-border/50">
              <button
                onClick={() => setShowDiagnostics(!showDiagnostics)}
                className="text-[10px] text-text-muted hover:text-text-primary flex items-center justify-between w-full uppercase"
              >
                <span>Technical Network Stats</span>
                {showDiagnostics ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>

              {showDiagnostics && (
                <div className="mt-2 space-y-1.5 text-[10px] text-text-secondary bg-bg-main p-2.5 border border-border rounded">
                  <div className="flex justify-between">
                    <span>WI-FI RF RTT:</span>
                    <span className="font-bold text-text-primary">{netStats && netStats.rttMs > 0 ? `${netStats.rttMs} ms` : 'SYNCED'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>BITRATE:</span>
                    <span className="font-bold text-text-primary">{netStats?.bitrateKbps || 0} kbps</span>
                  </div>
                  <div className="flex justify-between">
                    <span>AUDIO CONTEXT:</span>
                    <span className="font-bold text-text-primary">{diagnostics?.audioContextState || 'NONE'}</span>
                  </div>
                  <button
                    onClick={() => handleEnableMicrophone()}
                    className="w-full mt-2 py-1.5 bg-bg-elevated border border-border text-[10px] font-bold uppercase rounded hover:border-white text-text-primary flex items-center justify-center gap-1"
                  >
                    <RefreshCw size={10} />
                    <span>RESTART AUDIO CAPTURE</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer / Disconnect & Leave */}
      <footer className="pt-4 border-t border-border mt-auto flex items-center justify-between">
        <div className="text-[10px] font-mono text-text-muted">
          MICRO MAX // HANDSET TX
        </div>
        <button
          onClick={handleLeaveConfirm}
          className="flex items-center gap-1.5 text-xs font-mono text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-400 px-3 py-1.5 rounded transition-colors"
        >
          <LogOut size={13} />
          <span>DISCONNECT & LEAVE</span>
        </button>
      </footer>
    </div>
  );
};
