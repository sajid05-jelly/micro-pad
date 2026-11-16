import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { 
  SessionState, 
  Participant, 
  PriorityLevel, 
  ArbitrationConfig, 
} from '../types.js';
import { HostAudioEngine, optimizeOpusSDP, PeerNetworkStats } from '../audio/HostAudioEngine.js';
import { MicCard } from './MicCard.js';
import { RetroVUMeter } from './RetroVUMeter.js';
import { MasterVUMeter } from './MasterVUMeter.js';
import { AudioOutputPanel } from './AudioOutputPanel.js';
import { AutoModeConfigPanel } from './AutoModeConfigPanel.js';
import { QRCodeModal } from './QRCodeModal.js';
import { 
  Radio, 
  Volume2, 
  VolumeX, 
  AlertOctagon, 
  QrCode, 
  Sliders, 
  Activity, 
  Cpu, 
  Users, 
  Settings, 
  HelpCircle,
  Wifi, 
  ShieldAlert, 
  Shield, 
  ExternalLink,
  Play,
  RotateCcw,
  Filter,
  CheckCircle,
  Server,
  HardDrive,
  Terminal,
  ArrowRight,
  RefreshCw,
  User,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Home,
  Smartphone,
  Menu,
  X
} from 'lucide-react';

interface AdminControlRoomProps {
  socket: Socket | null;
  sessionId: string;
  localIp: string;
  tunnelUrl?: string | null;
  hostAudio: HostAudioEngine;
  onGoHome?: () => void;
}

export const AdminControlRoom: React.FC<AdminControlRoomProps> = ({
  socket,
  sessionId,
  localIp,
  tunnelUrl,
  hostAudio,
  onGoHome
}) => {
  const [session, setSession] = useState<SessionState | null>(null);
  const [activeTab, setActiveTab] = useState<'control' | 'mics' | 'auto' | 'output' | 'diagnostics'>('control');
  const [micFilter, setMicFilter] = useState<'all' | 'active' | 'ready' | 'muted' | 'vip' | 'weak'>('all');
  const [isQRModalOpen, setIsQRModalOpen] = useState(false);
  const [qrChannelNumber, setQrChannelNumber] = useState<number | undefined>(undefined);
  const [peerStatsMap, setPeerStatsMap] = useState<Record<string, PeerNetworkStats>>({});
  const [channelTrimMap, setChannelTrimMap] = useState<Record<string, number>>({});
  const [audioEngineState, setAudioEngineState] = useState<AudioContextState | 'uninitialized'>('uninitialized');
  const [copiedLink, setCopiedLink] = useState(false);
  const [masterVolume, setMasterVolume] = useState(100);
  const [showAdvancedDiagnostics, setShowAdvancedDiagnostics] = useState(false);
  const [showMobileSystemLog, setShowMobileSystemLog] = useState(false);

  // Participant audio meter throttle buffer to eliminate CPU freezing in Chrome
  const pendingMetersRef = useRef<Record<string, { level: number; isSpeaking: boolean }>>({});
  const lastMeterFlushRef = useRef<number>(0);
  const meterRafIdRef = useRef<number | null>(null);

  // Keep audio context state in sync and unlock on any user interaction
  useEffect(() => {
    const updateAudioState = () => {
      const ctx = hostAudio.getAudioContext();
      if (ctx) {
        setAudioEngineState(ctx.state);
      } else {
        setAudioEngineState('uninitialized');
      }
    };

    updateAudioState();
    const interval = setInterval(updateAudioState, 1000);

    const unlockAudio = async () => {
      await hostAudio.initAudio();
      await hostAudio.resumeAll();
      updateAudioState();
    };

    window.addEventListener('click', unlockAudio, { passive: true });
    window.addEventListener('keydown', unlockAudio, { passive: true });
    window.addEventListener('touchstart', unlockAudio, { passive: true });

    return () => {
      clearInterval(interval);
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };
  }, [hostAudio]);

  const handleEngageAudio = async () => {
    await hostAudio.initAudio();
    await hostAudio.resumeAll();
    hostAudio.playTestChime();
    const ctx = hostAudio.getAudioContext();
    if (ctx) setAudioEngineState(ctx.state);
  };

  // Poll peer network stats without invalidating interval on every audio packet
  const participantIds = useMemo(() => {
    return Object.keys(session?.participants || {}).sort().join(',');
  }, [session?.participants]);

  useEffect(() => {
    if (!participantIds) return;
    const ids = participantIds.split(',').filter(Boolean);
    const interval = setInterval(async () => {
      const statsObj: Record<string, PeerNetworkStats> = {};
      for (const id of ids) {
        try {
          const stats = await hostAudio.getPeerStats(id);
          statsObj[id] = stats;
        } catch {}
      }
      setPeerStatsMap(statsObj);
    }, 1000);

    return () => clearInterval(interval);
  }, [participantIds, hostAudio]);

  const handleTrimChange = useCallback((participantId: string, trim: number) => {
    hostAudio.setChannelTrim(participantId, trim);
    setChannelTrimMap(prev => ({ ...prev, [participantId]: trim }));
  }, [hostAudio]);

  const handleCopyLink = () => {
    const isPublicHttpsHost = typeof window !== 'undefined' && 
      window.location.protocol === 'https:' && 
      !window.location.hostname.includes('localhost') && 
      !window.location.hostname.startsWith('172.') && 
      !window.location.hostname.startsWith('192.') && 
      !window.location.hostname.startsWith('10.');

    const effectiveIp = (localIp && localIp !== 'localhost' && localIp !== '127.0.0.1' && !localIp.startsWith('169.254.'))
      ? localIp
      : (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'
          ? window.location.hostname
          : '172.20.10.5');

    const base = isPublicHttpsHost ? window.location.origin : (tunnelUrl ? tunnelUrl : `http://${effectiveIp}:5173`);
    const url = `${base}/join?session=${encodeURIComponent(sessionId)}&role=join`;

    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
      }).catch(() => {});
    }
  };

  const handleMasterVolumeChange = (volPercent: number) => {
    setMasterVolume(volPercent);
    hostAudio.setMasterVolume(volPercent / 100);
  };

  // Sync activeTab with URL search params and hash
  useEffect(() => {
    const syncTabFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get('tab') as any;
      const hashParam = window.location.hash.replace('#', '') as any;
      const validTabs = ['control', 'mics', 'auto', 'output', 'diagnostics'];
      if (validTabs.includes(tabParam)) {
        setActiveTab(tabParam);
      } else if (validTabs.includes(hashParam)) {
        setActiveTab(hashParam);
      }
    };

    syncTabFromUrl();
    window.addEventListener('popstate', syncTabFromUrl);
    return () => window.removeEventListener('popstate', syncTabFromUrl);
  }, []);

  const handleTabChange = (tabId: 'control' | 'mics' | 'auto' | 'output' | 'diagnostics') => {
    setActiveTab(tabId);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tabId);
    url.hash = tabId;
    window.history.pushState({ tab: tabId }, '', url.toString());
  };

  // Synchronize audio routing with host Web Audio API only when routing state actually changes
  const mutedIdsString = useMemo(() => {
    if (!session?.participants) return '';
    return Object.values(session.participants)
      .filter(p => p.isMutedByAdmin || p.isMutedSelf)
      .map(p => p.id)
      .sort()
      .join(',');
  }, [session?.participants]);

  useEffect(() => {
    if (!session) return;
    const mutedIds = new Set<string>(mutedIdsString ? mutedIdsString.split(',') : []);
    hostAudio.setRouting(
      session.activeSpeakerId, 
      session.isMuteAll, 
      session.isEmergencyStop,
      mutedIds
    );
  }, [session?.activeSpeakerId, session?.isMuteAll, session?.isEmergencyStop, mutedIdsString, hostAudio]);

  // Flush pending audio meter packets at ~20 FPS without re-rendering when levels don't change
  const flushPendingMeters = useCallback(() => {
    const pending = pendingMetersRef.current;
    const ids = Object.keys(pending);
    if (ids.length === 0) return;
    pendingMetersRef.current = {};

    setSession(prev => {
      if (!prev) return prev;
      let hasChanges = false;
      const updatedParticipants = { ...prev.participants };

      for (const id of ids) {
        const current = updatedParticipants[id];
        if (current) {
          const update = pending[id];
          if (
            Math.abs((current.audioLevel || 0) - update.level) >= 2 ||
            current.isSpeaking !== update.isSpeaking
          ) {
            updatedParticipants[id] = {
              ...current,
              audioLevel: update.level,
              isSpeaking: update.isSpeaking
            };
            hasChanges = true;
          }
        }
      }

      if (!hasChanges) return prev;
      return {
        ...prev,
        participants: updatedParticipants
      };
    });
  }, []);

  // Socket event listeners
  useEffect(() => {
    if (!socket) return;

    socket.on('session:state', (updatedSession: SessionState) => {
      setSession(updatedSession);
    });

    // Real-time audio meter broadcast (throttled to ~20 FPS)
    socket.on('participant:audio_meter', ({ id, level, isSpeaking }: { id: string; level: number; isSpeaking: boolean }) => {
      pendingMetersRef.current[id] = { level, isSpeaking };
      const now = performance.now();
      if (now - lastMeterFlushRef.current >= 50) {
        lastMeterFlushRef.current = now;
        flushPendingMeters();
      } else if (!meterRafIdRef.current) {
        meterRafIdRef.current = requestAnimationFrame(() => {
          meterRafIdRef.current = null;
          if (performance.now() - lastMeterFlushRef.current >= 50) {
            lastMeterFlushRef.current = performance.now();
            flushPendingMeters();
          }
        });
      }
    });

    // WebRTC peer joining: Host creates peer connection and awaits offer
    socket.on('webrtc:peer_joined', ({ participantId }: { participantId: string }) => {
      hostAudio.initAudio();
    });

    // WebRTC signaling from participant
    socket.on('webrtc:signal', async ({ from, signal, type }: { from: string; signal: any; type: string }) => {
      await hostAudio.initAudio();

      if (type === 'offer') {
        const pc = hostAudio.createPeerConnection(from, (answerSignal, sigType) => {
          socket.emit('webrtc:signal', {
            to: from,
            signal: answerSignal,
            type: sigType
          });
        });

        await pc.setRemoteDescription(new RTCSessionDescription(signal));
        // Drain any ICE candidates received while remote description was setting
        await hostAudio.drainPendingCandidates(from);

        const answer = await pc.createAnswer();
        if (answer.sdp) {
          answer.sdp = optimizeOpusSDP(answer.sdp);
        }
        await pc.setLocalDescription(answer);

        socket.emit('webrtc:signal', {
          to: from,
          signal: answer,
          type: 'answer'
        });
      } else if (type === 'candidate') {
        await hostAudio.addIceCandidate(from, signal);
      }
    });

    return () => {
      if (meterRafIdRef.current) cancelAnimationFrame(meterRafIdRef.current);
      socket.off('session:state');
      socket.off('participant:audio_meter');
      socket.off('webrtc:peer_joined');
      socket.off('webrtc:signal');
    };
  }, [socket, hostAudio, flushPendingMeters]);

  // Keyboard Hotkeys: 1 -> Select MIC 01, 2 -> Select MIC 02, 3 -> Select MIC 03
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (['1', '2', '3'].includes(e.key)) {
        const channelNum = parseInt(e.key, 10);
        const match = Object.values(session?.participants || {}).find(p => p.channelNumber === channelNum);
        if (match) {
          handleSelectMic(match.id);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [session]);

  // Stable Admin Actions
  const handleSelectMic = useCallback((participantId: string | null) => {
    hostAudio.initAudio();
    socket?.emit('admin:select_mic', { participantId });
  }, [socket, hostAudio]);

  const handleToggleMode = useCallback((mode: 'manual' | 'auto') => {
    socket?.emit('admin:set_mode', { mode });
  }, [socket]);

  const handleToggleMuteParticipant = useCallback((participantId: string, muted: boolean) => {
    socket?.emit('admin:mute_participant', { participantId, muted });
  }, [socket]);

  const handleToggleMuteAll = useCallback(() => {
    if (!session) return;
    const nextMuteAll = !session.isMuteAll;
    socket?.emit('admin:mute_all', { isMuteAll: nextMuteAll });
  }, [socket, session?.isMuteAll]);

  const handleEmergencyStop = useCallback(() => {
    if (!session) return;
    const nextStop = !session.isEmergencyStop;
    socket?.emit('admin:emergency_stop', { isEmergencyStop: nextStop });
  }, [socket, session?.isEmergencyStop]);

  const handleChangePriority = useCallback((participantId: string, priority: PriorityLevel) => {
    socket?.emit('admin:set_priority', { participantId, priority });
  }, [socket]);

  const handleKickParticipant = useCallback((participantId: string) => {
    if (confirm('Disconnect participant from audio bus?')) {
      socket?.emit('admin:kick_participant', { participantId });
      hostAudio.closePeerConnection(participantId);
    }
  }, [socket, hostAudio]);

  const handleUpdateConfig = useCallback((config: Partial<ArbitrationConfig>) => {
    socket?.emit('admin:update_config', config);
  }, [socket]);

  const handleInjectVirtualParticipant = (name: string, priority: PriorityLevel) => {
    const virtualSocket = {
      sessionId,
      name,
      priority
    };
    socket?.emit('participant:join', virtualSocket);
  };

  const participants = Object.values(session?.participants || {});
  const activeSpeaker = session?.activeSpeakerId ? session.participants[session.activeSpeakerId] : null;

  const activeCount = participants.filter(p => session?.activeSpeakerId === p.id).length;
  const readyCount = participants.filter(p => p.state === 'READY').length;
  const mutedCount = participants.filter(p => p.isMutedByAdmin || p.isMutedSelf || session?.isMuteAll || session?.isEmergencyStop).length;
  const vipCount = participants.filter(p => p.priority === 'VIP').length;
  const weakCount = participants.filter(p => {
    const stats = peerStatsMap[p.id];
    return stats && (stats.packetLossPct > 5 || stats.rttMs > 80 || stats.jitterMs > 35);
  }).length;

  const filteredParticipants = participants.filter(p => {
    if (micFilter === 'active') return session?.activeSpeakerId === p.id;
    if (micFilter === 'ready') return p.state === 'READY';
    if (micFilter === 'muted') return p.isMutedByAdmin || p.isMutedSelf || session?.isMuteAll || session?.isEmergencyStop;
    if (micFilter === 'vip') return p.priority === 'VIP';
    if (micFilter === 'weak') {
      const stats = peerStatsMap[p.id];
      return stats && (stats.packetLossPct > 5 || stats.rttMs > 80 || stats.jitterMs > 35);
    }
    return true;
  });

  const navigationTabs = [
    { id: 'control', label: 'CONTROL ROOM', shortLabel: 'CONTROL', icon: Activity, badge: null },
    { id: 'mics', label: 'MICROPHONES', shortLabel: 'MICS', icon: Radio, badge: participants.length > 0 ? String(participants.length) : null },
    { id: 'auto', label: 'AUTO ARBITRATION', shortLabel: 'AUTO', icon: Cpu, badge: session?.mode === 'auto' ? 'AUTO' : null },
    { id: 'output', label: 'AUDIO OUTPUT / PA', shortLabel: 'OUTPUT', icon: Volume2, badge: session?.isEmergencyStop ? 'STOP' : session?.isMuteAll ? 'MUTE' : null },
    { id: 'diagnostics', label: 'DIAGNOSTICS & SIM', shortLabel: 'DIAGS', icon: Settings, badge: null },
  ] as const;

  return (
    <div className="min-h-screen bg-transparent text-text-primary flex flex-col font-body relative overflow-x-hidden">
      {/* ===================== TOP AUTOPLAY UNLOCK BANNER ===================== */}
      {audioEngineState !== 'running' && (
        <div className="bg-bg-secondary text-text-primary px-3 sm:px-4 py-2 border-b border-border flex items-center justify-between text-xs font-mono font-bold z-50 shadow-md">
          <div className="flex items-center gap-2 text-accent-blue truncate mr-2">
            <VolumeX size={15} className="shrink-0" />
            <span className="truncate">PA OUTPUT MUTED // CLICK TO UNMUTE</span>
          </div>
          <button
            onClick={handleEngageAudio}
            className="px-3 py-1 bg-accent-blue text-white uppercase text-[11px] btn-tactile hover:bg-accent-blue-hover font-bold flex items-center gap-1.5 shadow-sm rounded-lg transition-colors shrink-0"
          >
            <Volume2 size={12} />
            <span>ENGAGE PA</span>
          </button>
        </div>
      )}

      {/* ===================== TOP HEADER: PIXEL-PERFECT ALIGNED & RESPONSIVE ===================== */}
      <header className="bg-bg-secondary/95 backdrop-blur-md border-b border-border px-3 sm:px-4 h-14 flex items-center justify-between select-none z-30 flex-shrink-0 gap-2">
        {/* Left: Brand Mark & Session Badge */}
        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          <div 
            className="flex items-center gap-2 cursor-pointer group" 
            onClick={onGoHome} 
            title="Go to Home Dashboard"
          >
            <div className="w-8 h-8 rounded-lg bg-bg-card border border-border text-accent-blue flex items-center justify-center font-bold shadow-sm group-hover:border-accent-blue/50 transition-colors flex-shrink-0">
              <Radio size={15} className="animate-pulse" />
            </div>
            <h1 className="font-heading font-black text-sm sm:text-base tracking-wider uppercase text-text-primary whitespace-nowrap">
              MICRO MAX
            </h1>
          </div>

          <div className="h-5 w-px bg-border hidden sm:block flex-shrink-0" />

          {/* Unified Session & Broadcast Stage Badge */}
          <div className="h-8 px-2 sm:px-2.5 rounded-lg bg-bg-card border border-border flex items-center gap-1.5 text-xs font-mono whitespace-nowrap flex-shrink-0">
            <span className="text-text-muted text-[10px] hidden sm:inline">SESSION:</span>
            <span className="font-bold text-text-primary text-[11px] sm:text-xs">{sessionId}</span>
            <span className="text-border mx-0.5 hidden md:inline">|</span>
            <span className="text-[10px] text-accent-blue font-semibold hidden md:inline truncate max-w-[140px]">
              {session?.sessionName || 'STAGE'}
            </span>
          </div>
        </div>

        {/* Center: Desktop Badges (Strict h-8 Height) */}
        <div className="hidden lg:flex items-center gap-2 text-xs font-mono flex-shrink-0">
          {/* Live PA Output Status Button */}
          <button
            onClick={handleEngageAudio}
            title="Click to toggle or test PA output chime"
            className={`h-8 px-2.5 border rounded-lg cursor-pointer transition-colors flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 btn-tactile ${
              audioEngineState === 'running'
                ? 'border-emerald-500/40 bg-emerald-950/20 hover:bg-emerald-950/40'
                : 'border-yellow-500/40 bg-yellow-950/20 hover:bg-yellow-950/40'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${audioEngineState === 'running' ? 'bg-emerald-400 animate-pulse' : 'bg-yellow-400'}`} />
            <span className={`font-bold text-[10px] tracking-wide whitespace-nowrap ${audioEngineState === 'running' ? 'text-emerald-300' : 'text-yellow-300'}`}>
              {audioEngineState === 'running' ? 'PA LIVE' : 'PA MUTED'}
            </span>
          </button>

          {/* LAN IP Badge */}
          <div className="h-8 px-2.5 rounded-lg bg-bg-card border border-border flex items-center gap-1.5 whitespace-nowrap flex-shrink-0">
            <Wifi size={12} className="text-accent-blue flex-shrink-0" />
            <span className="text-text-muted text-[10px]">LAN:</span>
            <span className="font-semibold text-text-primary text-[11px]">{localIp}:5173</span>
          </div>

          {/* Connected Units Badge */}
          <div className="h-8 px-2.5 rounded-lg bg-bg-card border border-border flex items-center gap-1.5 whitespace-nowrap flex-shrink-0">
            <Users size={12} className="text-accent-blue flex-shrink-0" />
            <span className="text-text-muted text-[10px]">UNITS:</span>
            <span className="font-semibold text-text-primary text-[11px]">{participants.length}</span>
          </div>

          {/* Engine Mode Badge */}
          <div className="h-8 px-2.5 rounded-lg bg-bg-card border border-border flex items-center gap-1.5 whitespace-nowrap flex-shrink-0">
            <Cpu size={12} className="text-accent-blue flex-shrink-0" />
            <span className="text-text-muted text-[10px]">ENGINE:</span>
            <span className={`font-semibold text-[11px] uppercase ${session?.mode === 'auto' ? 'text-accent-blue font-bold' : 'text-text-secondary'}`}>
              {session?.mode || 'MANUAL'}
            </span>
          </div>
        </div>

        {/* Right: Action Buttons (Strict h-8 Uniform Heights) */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          {/* Mobile PA indicator badge */}
          <div className="lg:hidden flex items-center">
            <button
              onClick={handleEngageAudio}
              className={`h-8 px-2 border rounded-lg cursor-pointer transition-colors flex items-center gap-1 whitespace-nowrap flex-shrink-0 ${
                audioEngineState === 'running'
                  ? 'border-emerald-500/40 bg-emerald-950/20 text-emerald-300'
                  : 'border-yellow-500/40 bg-yellow-950/20 text-yellow-300'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${audioEngineState === 'running' ? 'bg-emerald-400 animate-pulse' : 'bg-yellow-400'}`} />
              <span className="text-[10px] font-mono font-bold hidden xs:inline">
                {audioEngineState === 'running' ? 'PA LIVE' : 'PA OFF'}
              </span>
            </button>
          </div>

          {onGoHome && (
            <button
              onClick={onGoHome}
              className="h-8 px-2.5 bg-bg-card border border-border text-xs font-mono text-text-secondary hover:text-text-primary hover:border-border-hover rounded-lg btn-tactile flex items-center gap-1.5 transition-colors whitespace-nowrap flex-shrink-0"
              title="Return to Home Dashboard"
            >
              <Home size={13} className="flex-shrink-0" />
              <span className="whitespace-nowrap hidden sm:inline">HOME</span>
            </button>
          )}

          {/* Connect Phones (QR Code) Button */}
          <button
            onClick={() => {
              setQrChannelNumber(undefined);
              setIsQRModalOpen(true);
            }}
            className="h-8 px-2.5 sm:px-3 bg-bg-card border border-border text-xs font-mono text-text-primary hover:border-border-hover hover:text-white rounded-lg btn-tactile flex items-center gap-1.5 transition-colors whitespace-nowrap flex-shrink-0"
            title="Scan QR Code to connect phones"
          >
            <QrCode size={13} className="flex-shrink-0 text-accent-blue" />
            <span className="whitespace-nowrap hidden md:inline">CONNECT PHONES</span>
          </button>

          {/* Mute All Toggle */}
          <button
            onClick={handleToggleMuteAll}
            className={`h-8 px-2.5 sm:px-3 text-xs font-mono font-bold tracking-wider uppercase border rounded-lg btn-tactile flex items-center gap-1.5 transition-colors whitespace-nowrap flex-shrink-0 ${
              session?.isMuteAll
                ? 'bg-red-950/60 text-red-300 border-red-500/50'
                : 'bg-bg-card text-text-primary border-border hover:border-border-hover'
            }`}
            title={session?.isMuteAll ? 'Unmute all channels' : 'Silence all microphones'}
          >
            <VolumeX size={13} className="flex-shrink-0" />
            <span className="whitespace-nowrap hidden sm:inline">{session?.isMuteAll ? 'ALL MUTED' : 'MUTE ALL'}</span>
          </button>

          {/* Emergency Stop Hard Cut */}
          <button
            onClick={handleEmergencyStop}
            className={`h-8 px-2.5 sm:px-3 text-xs font-mono font-black tracking-wider uppercase border rounded-lg btn-tactile flex items-center gap-1.5 transition-colors whitespace-nowrap flex-shrink-0 ${
              session?.isEmergencyStop
                ? 'bg-red-600 text-white border-red-500 ring-2 ring-red-400/40 animate-pulse'
                : 'bg-bg-card text-red-400 border-red-500/60 hover:bg-red-500 hover:text-white'
            }`}
            title="Immediate emergency audio cutoff"
          >
            <AlertOctagon size={13} className="flex-shrink-0" />
            <span className="whitespace-nowrap">{session?.isEmergencyStop ? 'STOPPED' : 'STOP'}</span>
          </button>
        </div>
      </header>

      {/* ===================== WORKSPACE CONTAINER ===================== */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Antigravity Ambient Glow & Halftone Texture */}
        <div className="absolute inset-0 antigravity-glow pointer-events-none" />
        <div className="absolute inset-0 antigravity-halftone pointer-events-none" />

        {/* ===================== DESKTOP LEFT SIDEBAR (HIDDEN ON MOBILE/TABLET) ===================== */}
        <nav className="relative z-10 w-56 bg-bg-secondary/70 backdrop-blur-sm border-r border-border hidden lg:flex flex-col p-3 gap-1 select-none flex-shrink-0">
          <div className="text-[10px] font-mono text-text-muted uppercase tracking-widest px-2 py-1 mb-1 font-bold">
            CONSOLE NAVIGATION
          </div>

          {navigationTabs.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleTabChange(item.id)}
                className={`w-full text-left px-3 py-2 text-xs font-mono tracking-wider flex items-center justify-between rounded-lg border transition-all ${
                  isActive
                    ? 'bg-bg-card border-accent-blue text-accent-blue font-bold shadow-sm'
                    : 'bg-transparent text-text-secondary border-transparent hover:bg-bg-card hover:text-text-primary'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon size={14} />
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span className={`text-[10px] px-1.5 py-0.2 border rounded-xs font-mono ${
                    isActive ? 'bg-accent-blue text-white border-accent-blue font-bold' : 'bg-bg-secondary text-text-muted border-border'
                  }`}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}

          {/* Mode Switcher Shortcut */}
          <div className="mt-auto p-3 bg-bg-card border border-border rounded-xl">
            <div className="text-[10px] font-mono text-text-muted uppercase mb-1.5 font-semibold">
              ARBITRATION MODE
            </div>
            <div className="grid grid-cols-2 gap-1.5 font-mono text-[11px]">
              <button
                onClick={() => handleToggleMode('manual')}
                className={`py-1.5 border rounded-md transition-colors ${
                  session?.mode === 'manual'
                    ? 'bg-accent-blue text-white font-bold border-accent-blue shadow-sm'
                    : 'border-border text-text-secondary hover:text-text-primary hover:border-border-hover'
                }`}
              >
                MANUAL
              </button>
              <button
                onClick={() => handleToggleMode('auto')}
                className={`py-1.5 border rounded-md transition-colors ${
                  session?.mode === 'auto'
                    ? 'bg-accent-blue text-white font-bold border-accent-blue shadow-sm'
                    : 'border-border text-text-secondary hover:text-text-primary hover:border-border-hover'
                }`}
              >
                AUTO
              </button>
            </div>
          </div>
        </nav>

        {/* ===================== MAIN CENTER WORKSPACE ===================== */}
        <main className="relative z-10 flex-1 flex flex-col p-3 sm:p-4 md:p-6 gap-4 overflow-y-auto overflow-x-hidden w-full max-w-full pb-24 lg:pb-6">

          {/* ============================================================== */}
          {/* TAB 1: CONTROL ROOM (RECOMMENDED MOBILE ARCHITECTURE)           */}
          {/* ============================================================== */}
          {activeTab === 'control' && (
            <div className="flex flex-col gap-4 sm:gap-5 w-full max-w-full">
              
              {/* 1. HERO SPEAKER STATUS BANNER */}
              <section className="p-4 sm:p-5 bg-bg-card border border-border rounded-2xl shadow-xl shadow-black/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 w-full">
                <div className="flex items-center gap-3">
                  <div className={`w-11 h-11 rounded-xl bg-bg-secondary border border-border flex items-center justify-center font-bold shadow-sm shrink-0 ${
                    activeSpeaker ? 'text-accent-blue border-accent-blue/50' : 'text-text-muted'
                  }`}>
                    <Radio size={20} className={activeSpeaker ? 'animate-pulse' : ''} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] font-mono text-text-muted uppercase tracking-wider font-semibold">
                      CURRENT SPEAKER FLOOR
                    </div>
                    <div className="flex items-baseline gap-2 truncate">
                      {activeSpeaker ? (
                        <>
                          <span className="font-heading font-black text-xl sm:text-2xl text-accent-blue tracking-wide">
                            MIC {String(activeSpeaker.channelNumber).padStart(2, '0')}
                          </span>
                          <span className="text-xs sm:text-sm font-semibold text-text-primary truncate">
                            {activeSpeaker.name}
                          </span>
                          <span className="text-[10px] font-mono text-text-muted">
                            ({activeSpeaker.priority})
                          </span>
                        </>
                      ) : (
                        <span className="font-heading font-bold text-lg sm:text-xl text-text-muted">
                          ALL MICROPHONES STANDBY
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center flex-wrap gap-2 w-full sm:w-auto justify-end">
                  {/* Connect phone button */}
                  <button
                    onClick={() => {
                      setQrChannelNumber(undefined);
                      setIsQRModalOpen(true);
                    }}
                    className="flex-1 sm:flex-none px-3 py-2 bg-accent-blue text-white font-mono font-semibold text-xs uppercase rounded-lg hover:bg-accent-blue-hover btn-tactile flex items-center justify-center gap-1.5 shadow-blue-glow transition-all"
                  >
                    <QrCode size={14} />
                    <span>CONNECT MIC</span>
                  </button>

                  {/* Copy Link Button */}
                  <button
                    onClick={handleCopyLink}
                    className="px-3 py-2 bg-bg-secondary border border-border text-xs font-mono text-text-primary hover:border-border-hover hover:text-white rounded-lg btn-tactile flex items-center justify-center gap-1.5 transition-colors"
                    title="Copy direct join link to clipboard"
                  >
                    {copiedLink ? <Check size={13} className="text-accent-blue" /> : <Copy size={13} />}
                    <span className="hidden sm:inline">{copiedLink ? 'COPIED!' : 'COPY LINK'}</span>
                  </button>
                </div>
              </section>

              {/* 2. MICROPHONE CONTROL MATRIX */}
              <section className="p-4 sm:p-5 bg-bg-card border border-border rounded-2xl shadow-card space-y-4 w-full">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-border/80 gap-2">
                  <div>
                    <h3 className="font-heading font-black text-base uppercase tracking-wider text-text-primary flex items-center gap-2">
                      <span>MICROPHONE CONTROL</span>
                      {activeSpeaker && (
                        <span className="text-xs font-mono font-bold text-accent-blue px-2.5 py-0.5 bg-bg-secondary border border-accent-blue/40 rounded-full flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-accent-blue animate-pulse" />
                          <span>MIC {String(activeSpeaker.channelNumber).padStart(2, '0')} LIVE</span>
                        </span>
                      )}
                    </h3>
                    <p className="text-xs text-text-secondary mt-0.5">
                      Tap any microphone to grant floor broadcast.
                    </p>
                  </div>

                  {/* Auto Mode Switch & Unroute */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggleMode(session?.mode === 'auto' ? 'manual' : 'auto')}
                      className={`px-3 py-1.5 rounded-lg font-mono text-xs font-semibold uppercase border transition-all flex items-center gap-2 ${
                        session?.mode === 'auto'
                          ? 'bg-bg-secondary text-accent-blue border-accent-blue/50 hover:bg-accent-blue hover:text-white'
                          : 'bg-bg-secondary text-text-secondary border-border hover:border-border-hover'
                      }`}
                    >
                      <Cpu size={13} className={session?.mode === 'auto' ? 'text-accent-blue' : ''} />
                      <span>{session?.mode === 'auto' ? 'AUTO: ON' : 'AUTO: OFF'}</span>
                    </button>
                    {activeSpeaker && (
                      <button
                        onClick={() => handleSelectMic(null)}
                        className="px-2.5 py-1.5 bg-bg-secondary border border-border text-xs font-mono text-text-secondary hover:text-white rounded-lg transition-colors"
                        title="Un-route current speaker floor"
                      >
                        UNROUTE
                      </button>
                    )}
                  </div>
                </div>

                {/* Quick Channel Filter Pills */}
                <div className="flex items-center gap-1.5 flex-wrap font-mono text-xs">
                  {[
                    { id: 'all', label: `ALL (${participants.length})` },
                    { id: 'active', label: `ON AIR (${activeSpeaker ? 1 : 0})` },
                    { id: 'ready', label: `READY (${readyCount})` },
                    { id: 'muted', label: `MUTED (${mutedCount})` },
                    { id: 'weak', label: `WEAK (${weakCount})` },
                    { id: 'vip', label: `VIP (${vipCount})` }
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setMicFilter(tab.id as any)}
                      className={`px-2.5 sm:px-3 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
                        micFilter === tab.id
                          ? 'bg-accent-blue text-white border-accent-blue shadow-sm font-bold'
                          : 'bg-bg-secondary text-text-secondary border-border hover:border-border-hover hover:text-text-primary'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Tactile Microphone Matrix: Fluid Grid (1 col mobile, 2 col tablet, 3-4 col desktop) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-3.5 w-full">
                  {/* Empty filter notice */}
                  {filteredParticipants.length === 0 && participants.length > 0 && (
                    <div className="col-span-full p-6 text-center text-xs text-text-muted font-mono bg-bg-main border border-border rounded-lg">
                      No microphones match the selected filter ({micFilter.toUpperCase()}).
                    </div>
                  )}

                  {/* Render all connected microphones matching current filter */}
                  {filteredParticipants.map((p) => {
                    const isSelected = session?.activeSpeakerId === p.id;
                    return (
                      <MicCard
                        key={p.id}
                        participant={p}
                        isSelected={isSelected}
                        isQuickSlot={p.channelNumber <= 3}
                        stats={peerStatsMap[p.id]}
                        trimMultiplier={channelTrimMap[p.id] ?? 1.5}
                        onTrimChange={(val) => handleTrimChange(p.id, val)}
                        onSelect={() => handleSelectMic(isSelected ? null : p.id)}
                        onToggleMute={(m) => handleToggleMuteParticipant(p.id, m)}
                        onChangePriority={(prio) => handleChangePriority(p.id, prio)}
                        onKick={() => handleKickParticipant(p.id)}
                      />
                    );
                  })}

                  {/* If participants < 3, render available slots for 1, 2, 3 */}
                  {participants.length < 3 && [1, 2, 3].filter(ch => !participants.some(p => p.channelNumber === ch)).map((channelNumber) => {
                    const label = `MIC ${String(channelNumber).padStart(2, '0')}`;
                    return (
                      <div
                        key={channelNumber}
                        className="p-4 bg-bg-main border border-dashed border-border rounded-xl flex flex-col justify-between h-36 hover:border-text-secondary transition-colors"
                      >
                        <div className="flex justify-between items-center">
                          <span className="font-mono text-xs font-bold text-text-muted">{label}</span>
                          <span className="text-[10px] font-mono text-text-muted px-1.5 py-0.5 bg-bg-elevated border border-border rounded">
                            AVAILABLE
                          </span>
                        </div>
                        <div className="text-xs text-text-muted font-mono">
                          No phone connected
                        </div>
                        <button
                          onClick={() => {
                            setQrChannelNumber(channelNumber);
                            setIsQRModalOpen(true);
                          }}
                          className="text-xs font-mono text-text-primary hover:underline flex items-center gap-1 font-semibold"
                        >
                          <span>+ Connect as {label}</span>
                        </button>
                      </div>
                    );
                  })}

                  {/* Add Next Participant Channel Card */}
                  <div
                    onClick={() => {
                      setQrChannelNumber(undefined);
                      setIsQRModalOpen(true);
                    }}
                    className="p-4 bg-bg-card border border-dashed border-border rounded-xl flex flex-col items-center justify-center gap-2 h-36 hover:border-accent-blue/50 cursor-pointer transition-colors group select-none shadow-card"
                  >
                    <div className="w-8 h-8 rounded-full bg-bg-secondary border border-border group-hover:border-accent-blue/60 flex items-center justify-center font-bold text-text-secondary group-hover:text-accent-blue transition-colors">
                      +
                    </div>
                    <div className="text-xs font-mono font-bold text-text-secondary group-hover:text-accent-blue transition-colors">
                      + CONNECT MIC {String(participants.length + 1).padStart(2, '0')}
                    </div>
                    <div className="text-[10px] text-text-muted font-mono">
                      Scan QR or tap to pair
                    </div>
                  </div>
                </div>
              </section>

              {/* 3. AUDIO OUTPUT & MASTER PA VOLUME SECTION */}
              <section className="p-4 sm:p-5 bg-bg-card border border-border rounded-2xl shadow-card space-y-4 w-full">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-border/80 gap-2">
                  <div>
                    <h3 className="font-heading font-black text-base uppercase tracking-wider text-text-primary flex items-center gap-2">
                      <Volume2 size={18} className="text-accent-blue" />
                      <span>AUDIO OUTPUT &amp; PA SPEAKERS</span>
                    </h3>
                    <p className="text-xs text-text-secondary mt-0.5">
                      Master room volume, output testing, and PA speaker control.
                    </p>
                  </div>

                  {/* Output Status Pill */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleEngageAudio}
                      className={`px-3 py-1 rounded-full text-xs font-mono font-bold flex items-center gap-1.5 border transition-all ${
                        audioEngineState === 'running'
                          ? 'bg-bg-secondary text-accent-blue border-accent-blue/40'
                          : 'bg-bg-secondary text-yellow-300 border-yellow-500/40 animate-pulse'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${audioEngineState === 'running' ? 'bg-accent-blue animate-pulse' : 'bg-yellow-400'}`} />
                      <span>{audioEngineState === 'running' ? 'PA OUTPUT LIVE' : 'CLICK TO UNMUTE PA'}</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                  {/* Master Hardware VU Meter (Isolated rendering for zero parent CPU usage) */}
                  <div className="p-3.5 bg-bg-secondary border border-border rounded-xl">
                    <MasterVUMeter
                      hostAudio={hostAudio}
                      isMuted={!!(session?.isEmergencyStop || session?.isMuteAll)}
                      activeSpeakerAudioLevel={activeSpeaker?.audioLevel}
                    />
                  </div>

                  {/* Master Volume Slider */}
                  <div className="p-3.5 bg-bg-secondary border border-border rounded-xl space-y-1.5">
                    <div className="flex justify-between items-center text-xs font-mono">
                      <span className="text-text-secondary font-semibold">MASTER VOLUME</span>
                      <span className="font-bold text-accent-blue">{masterVolume}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={masterVolume}
                      onChange={(e) => handleMasterVolumeChange(Number(e.target.value))}
                      className="w-full accent-[#3478F6] bg-bg-card h-2 rounded-lg cursor-pointer"
                    />
                  </div>

                  {/* Audio Actions: Test Sound & Mute All */}
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        await hostAudio.initAudio();
                        hostAudio.playTestChime();
                      }}
                      className="flex-1 py-3 px-3 bg-accent-blue text-white font-mono text-xs font-semibold uppercase rounded-lg hover:bg-accent-blue-hover btn-tactile flex items-center justify-center gap-1.5 shadow-blue-glow transition-all active:scale-[0.99] min-h-[44px]"
                    >
                      <Volume2 size={14} />
                      <span>PLAY CHIME</span>
                    </button>

                    <button
                      onClick={handleToggleMuteAll}
                      className={`flex-1 py-3 px-3 border font-mono text-xs font-semibold uppercase rounded-lg btn-tactile flex items-center justify-center gap-1.5 transition-colors min-h-[44px] ${
                        session?.isMuteAll
                          ? 'bg-red-950/60 text-red-300 border-red-500/50'
                          : 'bg-bg-secondary text-text-primary border-border hover:border-border-hover'
                      }`}
                    >
                      <VolumeX size={14} />
                      <span>{session?.isMuteAll ? 'UNMUTE ALL' : 'MUTE ALL'}</span>
                    </button>
                  </div>
                </div>
              </section>

              {/* 4. ARBITRATION STATUS & QUEUE (VISIBLE EMBEDDED ON MOBILE/TABLET WHEN XL ASIDE IS HIDDEN) */}
              <div className="xl:hidden grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                {/* Status Box */}
                <div className="bg-bg-card border border-border p-4 rounded-xl space-y-2 text-xs font-mono shadow-card">
                  <div className="text-[10px] text-text-muted uppercase tracking-widest font-bold pb-1.5 border-b border-border">
                    ARBITRATION ENGINE STATUS
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Floor Speaker:</span>
                    <span className="font-bold text-accent-blue">
                      {activeSpeaker ? `MIC ${String(activeSpeaker.channelNumber).padStart(2, '0')} (${activeSpeaker.name})` : 'STANDBY'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Decision Reason:</span>
                    <span className="text-text-primary truncate max-w-[160px]">
                      {session?.selectionReason || 'INITIAL_IDLE'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Arbitration Mode:</span>
                    <span className="text-text-primary font-bold uppercase">
                      {session?.mode || 'MANUAL'}
                    </span>
                  </div>
                </div>

                {/* Contenders Queue */}
                <div className="bg-bg-card border border-border p-4 rounded-xl space-y-2 text-xs font-mono shadow-card">
                  <div className="text-[10px] text-text-muted uppercase tracking-widest font-bold pb-1.5 border-b border-border flex justify-between">
                    <span>CONTENDERS QUEUE</span>
                    <span>PRIORITY</span>
                  </div>
                  {participants.length === 0 ? (
                    <div className="text-[11px] text-text-muted">No mobile handsets connected</div>
                  ) : (
                    <div className="space-y-1.5 max-h-36 overflow-y-auto">
                      {participants
                        .slice()
                        .sort((a, b) => (b.priority === 'VIP' ? 1 : 0) - (a.priority === 'VIP' ? 1 : 0))
                        .map((p) => {
                          const isActive = session?.activeSpeakerId === p.id;
                          return (
                            <div
                              key={p.id}
                              className={`flex items-center justify-between p-1.5 rounded-lg border text-[11px] ${
                                isActive
                                  ? 'bg-bg-secondary text-accent-blue font-bold border-accent-blue/50'
                                  : 'bg-bg-card text-text-secondary border-border'
                              }`}
                            >
                              <span className="truncate max-w-[140px]">
                                MIC {String(p.channelNumber).padStart(2, '0')} {p.name}
                              </span>
                              <div className="flex items-center gap-1.5">
                                {p.isSpeaking && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-accent-blue animate-pulse" />
                                )}
                                <span>{p.priority}</span>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              </div>

              {/* 5. CONNECTED PARTICIPANTS TABLE */}
              <section className="p-4 sm:p-5 bg-bg-card border border-border rounded-2xl shadow-xl shadow-black/40 space-y-3 w-full">
                <div className="flex items-center justify-between pb-3 border-b border-border/80">
                  <h3 className="font-heading font-black text-base uppercase tracking-wider text-text-primary flex items-center gap-2">
                    <Users size={16} />
                    <span>CONNECTED PARTICIPANTS ({participants.length})</span>
                  </h3>
                  <button
                    onClick={() => {
                      setQrChannelNumber(undefined);
                      setIsQRModalOpen(true);
                    }}
                    className="text-xs font-mono text-text-primary hover:underline flex items-center gap-1 font-bold"
                  >
                    <span>+ Invite Handset</span>
                  </button>
                </div>

                {participants.length === 0 ? (
                  <div className="p-6 sm:p-8 text-center bg-bg-main/60 border border-dashed border-border rounded-xl space-y-3">
                    <Smartphone size={32} className="mx-auto text-text-muted opacity-60" />
                    <p className="text-sm text-text-secondary font-mono">
                      No mobile microphones connected yet.
                    </p>
                    <button
                      onClick={() => {
                        setQrChannelNumber(undefined);
                        setIsQRModalOpen(true);
                      }}
                      className="px-4 py-2 bg-accent-blue text-white font-semibold font-mono text-xs uppercase rounded-lg hover:bg-accent-blue-hover transition-all shadow-blue-glow"
                    >
                      SHOW QR CODE TO JOIN
                    </button>
                  </div>
                ) : (
                  <div className="overflow-x-auto w-full">
                    <table className="w-full text-left font-mono text-xs">
                      <thead>
                        <tr className="border-b border-border text-text-muted text-[10px] uppercase">
                          <th className="py-2 px-2 sm:px-3 font-semibold">SLOT</th>
                          <th className="py-2 px-2 sm:px-3 font-semibold">NAME</th>
                          <th className="py-2 px-2 sm:px-3 font-semibold">STATUS</th>
                          <th className="py-2 px-2 sm:px-3 font-semibold hidden sm:table-cell">LIVE INPUT</th>
                          <th className="py-2 px-2 sm:px-3 text-right font-semibold">ACTIONS</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40">
                        {participants.map(p => {
                          const isLive = session?.activeSpeakerId === p.id;
                          const isMuted = p.isMutedByAdmin || p.isMutedSelf || session?.isMuteAll || session?.isEmergencyStop;
                          return (
                            <tr key={p.id} className={`hover:bg-bg-secondary/40 transition-colors ${isLive ? 'bg-bg-secondary/70 border-l-2 border-l-accent-blue' : ''}`}>
                              <td className="py-2.5 px-2 sm:px-3 font-bold text-text-primary whitespace-nowrap">
                                MIC {String(p.channelNumber).padStart(2, '0')}
                              </td>
                              <td className="py-2.5 px-2 sm:px-3 truncate max-w-[120px]">
                                <span className="font-semibold text-text-primary">{p.name}</span>
                                <span className="ml-1 text-[10px] text-text-muted">({p.priority})</span>
                              </td>
                              <td className="py-2.5 px-2 sm:px-3 whitespace-nowrap">
                                {isLive ? (
                                  <span className="text-accent-blue font-bold flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-accent-blue animate-pulse" />
                                    <span>LIVE</span>
                                  </span>
                                ) : isMuted ? (
                                  <span className="text-text-muted font-bold">MUTED</span>
                                ) : (
                                  <span className="text-text-secondary">STANDBY</span>
                                )}
                              </td>
                              <td className="py-2.5 px-2 sm:px-3 w-36 hidden sm:table-cell">
                                <div className="h-2 bg-bg-secondary border border-border rounded-full overflow-hidden">
                                  <div
                                    className={`h-full transition-all duration-75 ${isLive ? 'bg-accent-blue' : 'bg-text-secondary'}`}
                                    style={{ width: `${p.audioLevel || 0}%` }}
                                  />
                                </div>
                              </td>
                              <td className="py-2.5 px-2 sm:px-3 text-right space-x-1 sm:space-x-2 whitespace-nowrap">
                                <button
                                  onClick={() => handleSelectMic(isLive ? null : p.id)}
                                  className={`px-2 py-1 rounded-md text-[10px] sm:text-[11px] font-bold uppercase transition-colors ${
                                    isLive
                                      ? 'bg-bg-secondary text-text-secondary border border-border hover:text-white'
                                      : 'bg-accent-blue text-white hover:bg-accent-blue-hover'
                                  }`}
                                >
                                  {isLive ? 'UNROUTE' : 'ROUTE'}
                                </button>
                                <button
                                  onClick={() => handleToggleMuteParticipant(p.id, !isMuted)}
                                  className="px-2 py-1 bg-bg-secondary border border-border hover:border-border-hover rounded-md text-[10px] sm:text-[11px] text-text-secondary hover:text-text-primary uppercase transition-colors"
                                >
                                  {isMuted ? 'UNMUTE' : 'MUTE'}
                                </button>
                                <button
                                  onClick={() => handleKickParticipant(p.id)}
                                  className="px-1.5 py-1 bg-bg-secondary border border-border hover:border-red-400 rounded-md text-[10px] text-red-400 uppercase transition-colors hidden sm:inline-block"
                                  title="Disconnect handset"
                                >
                                  EJECT
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* 6. COLLAPSIBLE SYSTEM LOG & DIAGNOSTICS */}
              <div className="bg-bg-card border border-border rounded-2xl overflow-hidden text-xs shadow-card w-full">
                <button
                  onClick={() => setShowMobileSystemLog(!showMobileSystemLog)}
                  className="w-full p-3.5 flex items-center justify-between text-text-secondary hover:text-text-primary font-mono font-bold uppercase tracking-wider bg-bg-secondary transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Terminal size={14} className="text-accent-blue" />
                    <span>SYSTEM CHRONOLOGICAL LOG ({Math.min(50, (session?.recentEvents || []).length)})</span>
                  </div>
                  {showMobileSystemLog ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>

                {showMobileSystemLog && (
                  <div className="p-3 border-t border-border max-h-48 overflow-y-auto space-y-1.5 font-mono text-[11px]">
                    {(session?.recentEvents || []).slice(-50).map(evt => (
                      <div key={evt.id} className="flex gap-2">
                        <span className="text-text-muted shrink-0">[{evt.timestamp}]</span>
                        <span className="font-bold text-text-primary shrink-0">{evt.message}</span>
                        {evt.details && <span className="text-text-muted truncate">— {evt.details}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 7. ADVANCED ARBITRATION TUNING & SIMULATOR */}
              <div className="bg-bg-card border border-border rounded-2xl overflow-hidden text-xs shadow-card w-full">
                <button
                  onClick={() => setShowAdvancedDiagnostics(!showAdvancedDiagnostics)}
                  className="w-full p-3.5 flex items-center justify-between text-text-secondary hover:text-text-primary font-mono font-bold uppercase tracking-wider bg-bg-secondary transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Settings size={14} className="text-accent-blue" />
                    <span>ADVANCED ARBITRATION TUNING &amp; SIMULATOR</span>
                  </div>
                  {showAdvancedDiagnostics ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>

                {showAdvancedDiagnostics && (
                  <div className="p-4 border-t border-border space-y-4 font-mono text-xs">
                    {/* Auto Arbitration Timers */}
                    <div className="p-3 bg-bg-main border border-border rounded-lg space-y-2">
                      <div className="text-[11px] font-bold text-text-primary uppercase">
                        ARBITRATION TIMERS
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
                        <div>
                          <div className="flex justify-between text-text-secondary mb-1">
                            <span>SILENCE TIMEOUT:</span>
                            <span className="font-bold text-text-primary">{session?.arbitrationConfig?.silenceTimeoutMs || 1200} ms</span>
                          </div>
                          <input
                            type="range"
                            min={400}
                            max={3000}
                            step={100}
                            value={session?.arbitrationConfig?.silenceTimeoutMs || 1200}
                            onChange={(e) => handleUpdateConfig({ silenceTimeoutMs: Number(e.target.value) })}
                            className="w-full accent-white"
                          />
                        </div>
                        <div>
                          <div className="flex justify-between text-text-secondary mb-1">
                            <span>SPEAKER LOCK:</span>
                            <span className="font-bold text-text-primary">{session?.arbitrationConfig?.speakerLockMs || 1500} ms</span>
                          </div>
                          <input
                            type="range"
                            min={500}
                            max={4000}
                            step={100}
                            value={session?.arbitrationConfig?.speakerLockMs || 1500}
                            onChange={(e) => handleUpdateConfig({ speakerLockMs: Number(e.target.value) })}
                            className="w-full accent-white"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Virtual Simulator */}
                    <div className="p-3 bg-bg-main border border-border rounded-lg flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <div className="text-[11px] font-bold text-text-primary uppercase">SIMULATED PHONE INJECTOR</div>
                        <div className="text-[10px] text-text-muted">Inject test handset to test auto arbitration locally</div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleInjectVirtualParticipant('Simulated VIP', 'VIP')}
                          className="px-2.5 py-1 bg-bg-elevated border border-border hover:border-white text-[10px] font-bold uppercase rounded"
                        >
                          + INJECT VIP
                        </button>
                        <button
                          onClick={() => handleInjectVirtualParticipant('Simulated Speaker', 'Normal')}
                          className="px-2.5 py-1 bg-bg-elevated border border-border hover:border-white text-[10px] font-bold uppercase rounded"
                        >
                          + INJECT SPEAKER
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 2: MICROPHONES (CHANNEL RACK & MATRIX)                     */}
          {/* ============================================================== */}
          {activeTab === 'mics' && (
            <div className="flex flex-col gap-4 w-full max-w-full">
              {/* Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-border gap-2">
                <div>
                  <div className="text-[10px] font-mono text-text-muted uppercase tracking-widest font-bold">
                    CONSOLE // TRANSMITTER CHANNEL RACK
                  </div>
                  <h2 className="font-heading font-black text-lg tracking-wider uppercase text-text-primary">
                    WIRELESS HANDSET MATRIX &amp; PRE-AMP CONTROLS
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setQrChannelNumber(undefined);
                      setIsQRModalOpen(true);
                    }}
                    className="px-3 py-1.5 bg-accent-blue text-white font-mono font-bold text-xs uppercase btn-tactile hover:bg-accent-blue-hover flex items-center gap-1.5 rounded-lg shadow-blue-glow"
                  >
                    <QrCode size={13} />
                    <span>+ PAIR HANDSET</span>
                  </button>
                </div>
              </div>

              {/* Filters */}
              <div className="p-3 bg-bg-card border border-border rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-3 font-mono text-xs">
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-[10px] text-text-muted uppercase mr-1">FILTER:</span>
                  {[
                    { id: 'all', label: `ALL (${participants.length})` },
                    { id: 'active', label: `ON AIR (${activeCount})` },
                    { id: 'ready', label: `READY (${readyCount})` },
                    { id: 'muted', label: `MUTED (${mutedCount})` },
                    { id: 'vip', label: `VIP (${vipCount})` }
                  ].map(f => (
                    <button
                      key={f.id}
                      onClick={() => setMicFilter(f.id as any)}
                      className={`px-2.5 py-1 rounded-lg border transition-all ${
                        micFilter === f.id
                          ? 'bg-accent-blue text-white border-accent-blue font-bold shadow-sm'
                          : 'bg-bg-secondary text-text-secondary border-border hover:text-text-primary'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2 w-full md:w-auto justify-end">
                  <button
                    onClick={handleToggleMuteAll}
                    className={`px-2.5 py-1 border text-xs uppercase btn-tactile rounded-lg ${
                      session?.isMuteAll
                        ? 'bg-red-950/60 text-red-300 border-red-500/50'
                        : 'bg-bg-secondary text-text-primary border-border hover:border-border-hover'
                    }`}
                  >
                    {session?.isMuteAll ? 'UNMUTE ALL MICS' : 'MUTE ALL MICS'}
                  </button>

                  <button
                    onClick={() => handleSelectMic(null)}
                    disabled={!activeSpeaker}
                    className="px-2.5 py-1 bg-bg-secondary border border-border text-xs uppercase text-text-secondary hover:text-text-primary rounded-lg btn-tactile disabled:opacity-30 disabled:pointer-events-none"
                  >
                    UNROUTE FLOOR
                  </button>
                </div>
              </div>

              {/* Handset Grid: Responsive Multi-Column */}
              {filteredParticipants.length === 0 ? (
                <div className="p-8 sm:p-12 bg-bg-card border border-border rounded-2xl shadow-card text-center flex flex-col items-center justify-center gap-3">
                  <Radio size={32} className="text-accent-blue animate-pulse" />
                  <div>
                    <h4 className="font-heading font-bold text-base tracking-wider uppercase text-text-primary">
                      {participants.length === 0
                        ? 'NO WIRELESS TRANSMITTERS DETECTED'
                        : `NO HANDSETS MATCHING FILTER '${micFilter.toUpperCase()}'`}
                    </h4>
                    <p className="text-xs text-text-secondary font-mono mt-1 max-w-md leading-relaxed">
                      {participants.length === 0
                        ? 'Scan the session pairing QR code with your phone or open the join link in another tab.'
                        : 'Change your filter selection to view all connected handset channels.'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 mt-2">
                    {participants.length === 0 ? (
                      <button
                        onClick={() => {
                          setQrChannelNumber(undefined);
                          setIsQRModalOpen(true);
                        }}
                        className="px-4 py-2 bg-accent-blue text-white font-mono font-semibold text-xs uppercase rounded-lg hover:bg-accent-blue-hover transition-all shadow-blue-glow"
                      >
                        OPEN PAIRING QR CODE
                      </button>
                    ) : (
                      <button
                        onClick={() => setMicFilter('all')}
                        className="px-4 py-2 bg-accent-blue text-white font-mono font-semibold text-xs uppercase rounded-lg hover:bg-accent-blue-hover transition-all shadow-blue-glow"
                      >
                        RESET TO ALL HANDSETS
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {filteredParticipants.map((p) => {
                    const isSelected = session?.activeSpeakerId === p.id;
                    return (
                      <MicCard
                        key={p.id}
                        participant={p}
                        isSelected={isSelected}
                        stats={peerStatsMap[p.id]}
                        trimMultiplier={channelTrimMap[p.id] ?? 1.5}
                        onTrimChange={(val) => handleTrimChange(p.id, val)}
                        onSelect={() => handleSelectMic(isSelected ? null : p.id)}
                        onToggleMute={(m) => handleToggleMuteParticipant(p.id, m)}
                        onChangePriority={(pr) => handleChangePriority(p.id, pr)}
                        onKick={() => handleKickParticipant(p.id)}
                      />
                    );
                  })}
                </div>
              )}

              {/* Rack Specs Footer */}
              <div className="mt-auto p-3 bg-bg-secondary border border-border rounded-xl flex items-center justify-between text-[11px] font-mono text-text-muted">
                <span>CHANNEL CAPACITY: 32 BUS SLOTS ALLOCATED</span>
                <span>AUDIO TRANSPORT: WEBRTC OPUS 48KHZ STEREO // LAN UDP</span>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 3: AUTO ARBITRATION                                        */}
          {/* ============================================================== */}
          {activeTab === 'auto' && (
            <div className="flex flex-col gap-4 w-full max-w-full">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-border gap-2">
                <div>
                  <div className="text-[10px] font-mono text-text-muted uppercase tracking-widest font-bold">
                    CONSOLE // AUTO ARBITRATION ENGINE
                  </div>
                  <h2 className="font-heading font-black text-lg tracking-wider uppercase text-text-primary">
                    AUTOMATIC VAD FLOOR ARBITRATION &amp; PREEMPTION
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleToggleMode(session?.mode === 'auto' ? 'manual' : 'auto')}
                    className={`px-3.5 py-1.5 font-mono font-semibold text-xs uppercase border rounded-lg btn-tactile transition-all shadow-sm ${
                      session?.mode === 'auto'
                        ? 'bg-accent-blue text-white border-accent-blue hover:bg-accent-blue-hover shadow-blue-glow'
                        : 'bg-bg-secondary text-text-primary border-border hover:border-border-hover hover:text-white'
                    }`}
                  >
                    {session?.mode === 'auto' ? 'AUTO ENGINE ENGAGED' : 'ENGAGE AUTO ARBITRATION'}
                  </button>
                </div>
              </div>

              <AutoModeConfigPanel
                config={session?.arbitrationConfig || { silenceTimeoutMs: 1200, speakerLockMs: 1500, switchCooldownMs: 800, vadThreshold: 15 }}
                onUpdateConfig={handleUpdateConfig}
                selectionReason={session?.selectionReason || 'INITIAL_IDLE'}
                mode={session?.mode || 'manual'}
                onToggleMode={handleToggleMode}
              />

              {/* Priority Arbitration Rules Reference Card */}
              <div className="bg-bg-card border border-border p-4 sm:p-5 rounded-2xl shadow-card flex flex-col gap-3.5 font-mono text-xs">
                <div className="pb-2.5 border-b border-border">
                  <h3 className="font-heading font-bold text-sm tracking-wider uppercase text-text-primary">
                    ARBITRATION PREEMPTION &amp; TIMING SPECIFICATION
                  </h3>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    Deterministic rules governing automatic floor grants across multi-speaker wireless channels.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="p-3.5 bg-bg-secondary border border-border rounded-xl flex flex-col gap-1.5">
                    <span className="font-bold text-accent-blue">VIP (SCORE: 3)</span>
                    <span className="text-[11px] text-text-secondary leading-relaxed">
                      Moderators &amp; Stage Chairs. Can preempt Normal and Low participants once the active speaker lock duration has passed.
                    </span>
                  </div>

                  <div className="p-3.5 bg-bg-secondary border border-border rounded-xl flex flex-col gap-1.5">
                    <span className="font-bold text-text-primary">NORMAL (SCORE: 2)</span>
                    <span className="text-[11px] text-text-secondary leading-relaxed">
                      Standard audience question microphones. Contenders compete based on who starts speaking first, with lock timer protection.
                    </span>
                  </div>

                  <div className="p-3.5 bg-bg-secondary border border-border rounded-xl flex flex-col gap-1.5">
                    <span className="font-bold text-text-muted">LOW (SCORE: 1)</span>
                    <span className="text-[11px] text-text-secondary leading-relaxed">
                      Observer or background mics. Readily yielded to any Normal or VIP contender upon active voice activity.
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 4: AUDIO OUTPUT / PA SYSTEM                                */}
          {/* ============================================================== */}
          {activeTab === 'output' && (
            <div className="flex flex-col gap-4 w-full max-w-full">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-border gap-2">
                <div>
                  <div className="text-[10px] font-mono text-text-muted uppercase tracking-widest font-bold">
                    CONSOLE // AUDIO OUTPUT &amp; PA SYSTEM
                  </div>
                  <h2 className="font-heading font-black text-lg tracking-wider uppercase text-text-primary">
                    BLUETOOTH HARDWARE ROUTING &amp; MASTER BUS CONTROLS
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => {
                      await hostAudio.initAudio();
                      hostAudio.playTestChime();
                    }}
                    className="px-3.5 py-1.5 bg-accent-blue text-white font-mono font-semibold text-xs uppercase rounded-lg hover:bg-accent-blue-hover btn-tactile flex items-center gap-1.5 shadow-blue-glow transition-all active:scale-[0.99]"
                  >
                    <Volume2 size={13} />
                    <span>TEST 440Hz CHIME</span>
                  </button>
                </div>
              </div>

              <AudioOutputPanel
                hostAudio={hostAudio}
                activeSpeakerName={activeSpeaker ? `MIC ${String(activeSpeaker.channelNumber).padStart(2, '0')} (${activeSpeaker.name})` : undefined}
                isMuteAll={!!session?.isMuteAll}
                isEmergencyStop={!!session?.isEmergencyStop}
              />

              {/* Host Audio Signal Flow Schematic */}
              <div className="bg-bg-card border border-border p-4 sm:p-5 rounded-2xl shadow-card flex flex-col gap-2.5 font-mono text-xs">
                <div className="pb-1.5 border-b border-border text-[10px] text-accent-blue uppercase font-bold tracking-wider">
                  AUDIO SIGNAL GRAPH ROUTING SCHEMATIC
                </div>
                <div className="p-3.5 bg-bg-main/80 border border-border rounded-xl text-[11px] leading-relaxed text-text-secondary overflow-x-auto">
                  <code>
                    [Phone Mic] ➔ [WebRTC Opus AudioTrack] ➔ [Host RTCPeerConnection] ➔ [MediaStreamAudioSourceNode]
                    <br />
                    ➔ [Channel Gain Clamping Node (0.0 / 1.0 with 25ms crossfade)]
                    <br />
                    ➔ [Channel AnalyserNode (64-pt FFT)]
                    <br />
                    ➔ [Master GainNode (Attenuation &amp; Emergency Stop)]
                    <br />
                    ➔ [Master AnalyserNode] ➔ [AudioContext.destination (Bluetooth / Laptop Speaker)]
                  </code>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 5: DIAGNOSTICS & SIM                                       */}
          {/* ============================================================== */}
          {activeTab === 'diagnostics' && (
            <div className="flex flex-col gap-4 w-full max-w-full">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-border gap-2">
                <div>
                  <div className="text-[10px] font-mono text-text-muted uppercase tracking-widest font-bold">
                    CONSOLE // SYSTEM DIAGNOSTICS &amp; SIMULATOR
                  </div>
                  <h2 className="font-heading font-black text-lg tracking-wider uppercase text-text-primary">
                    TELEMETRY INSPECTOR &amp; ARBITRATION TEST BENCH
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => hostAudio.initAudio()}
                    className="px-3 py-1.5 bg-bg-card border border-border text-text-primary hover:border-border-hover font-mono text-xs uppercase btn-tactile flex items-center gap-1.5 rounded-lg"
                  >
                    <RotateCcw size={12} />
                    <span>RESET AUDIO CONTEXT</span>
                  </button>
                </div>
              </div>

              {/* Link Health Telemetry Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5 font-mono text-xs">
                <div className="p-4 bg-bg-card border border-border rounded-xl shadow-card flex flex-col gap-2">
                  <div className="flex items-center justify-between text-text-muted text-[10px] uppercase font-bold">
                    <span className="flex items-center gap-1.5 text-accent-blue">
                      <Server size={13} />
                      <span>SIGNALING SERVER</span>
                    </span>
                    <span className="text-accent-blue font-bold">ONLINE</span>
                  </div>
                  <div className="font-bold text-text-primary text-sm">
                    {socket?.connected ? 'CONNECTED (SOCKET.IO)' : 'CONNECTING...'}
                  </div>
                  <div className="text-[11px] text-text-secondary truncate">
                    Socket ID: {socket?.id || '—'}
                  </div>
                  <div className="text-[10px] text-text-muted mt-auto pt-1.5 border-t border-border">
                    Host LAN URL: {localIp}:5173
                  </div>
                </div>

                <div className="p-4 bg-bg-card border border-border rounded-xl shadow-card flex flex-col gap-2">
                  <div className="flex items-center justify-between text-text-muted text-[10px] uppercase font-bold">
                    <span className="flex items-center gap-1.5 text-accent-blue">
                      <HardDrive size={13} />
                      <span>WEB AUDIO ENGINE</span>
                    </span>
                    <span className="text-accent-blue font-bold">{hostAudio.getAudioContext()?.state.toUpperCase() || 'OFF'}</span>
                  </div>
                  <div className="font-bold text-text-primary text-sm">
                    {hostAudio.getAudioContext()?.state === 'running' ? '48,000 HZ ACTIVE' : 'SUSPENDED'}
                  </div>
                  <div className="text-[11px] text-text-secondary">
                    Active Audio Channels: {hostAudio.getChannelNodes().size}
                  </div>
                  <div className="text-[10px] text-text-muted mt-auto pt-1.5 border-t border-border">
                    Crossfade Ramp: 25ms Anti-Click
                  </div>
                </div>

                <div className="p-4 bg-bg-card border border-border rounded-xl shadow-card flex flex-col gap-2">
                  <div className="flex items-center justify-between text-text-muted text-[10px] uppercase font-bold">
                    <span className="flex items-center gap-1.5 text-accent-blue">
                      <Wifi size={13} />
                      <span>WEBRTC MESH</span>
                    </span>
                    <span className="text-accent-blue font-bold">{hostAudio.getPeerConnections().size} PEERS</span>
                  </div>
                  <div className="font-bold text-text-primary text-sm">
                    DIRECT LAN UDP
                  </div>
                  <div className="text-[11px] text-text-secondary">
                    Codec: Opus 48kHz Stereo Audio
                  </div>
                  <div className="text-[10px] text-text-muted mt-auto pt-1.5 border-t border-border">
                    STUN / Host ICE Candidates Buffered
                  </div>
                </div>
              </div>

              {/* WebRTC Diagnostics Table */}
              <div className="bg-bg-card border border-border p-4 sm:p-5 rounded-2xl shadow-card flex flex-col gap-3.5 font-mono text-xs">
                <div className="flex items-center justify-between pb-2.5 border-b border-border">
                  <div>
                    <span className="font-heading font-bold text-sm tracking-wider uppercase text-text-primary">
                      LIVE RF &amp; WEBRTC TELEMETRY ({hostAudio.getPeerConnections().size} ACTIVE LINKS)
                    </span>
                    <p className="text-[10px] text-text-muted mt-0.5">
                      Actual measured physical network statistics and jitter buffer health.
                    </p>
                  </div>
                  <span className="text-[10px] text-accent-blue font-bold px-2.5 py-0.5 bg-bg-secondary border border-accent-blue/40 rounded-full">
                    REAL-TIME
                  </span>
                </div>

                {hostAudio.getPeerConnections().size === 0 ? (
                  <div className="p-6 bg-bg-main/70 border border-border rounded-xl text-center text-text-muted text-xs">
                    No active WebRTC peer connections established. Connect handsets via QR code or inject test handsets below.
                  </div>
                ) : (
                  <div className="overflow-x-auto w-full">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-border text-[10px] text-text-muted uppercase">
                          <th className="py-2 px-2">CH / CALL SIGN</th>
                          <th className="py-2 px-2">RTT</th>
                          <th className="py-2 px-2">LOSS</th>
                          <th className="py-2 px-2">JITTER</th>
                          <th className="py-2 px-2">BITRATE</th>
                          <th className="py-2 px-2">CLIPPING</th>
                          <th className="py-2 px-2">STATE</th>
                          <th className="py-2 px-2 text-right">ACTION</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40 text-[11px]">
                        {Array.from(hostAudio.getPeerConnections().entries()).map(([pId, pc]) => {
                          const p = session?.participants[pId];
                          const stats = peerStatsMap[pId];
                          const rtt = stats?.rttMs || 0;
                          const loss = stats?.packetLossPct || 0;
                          const jitter = stats?.jitterMs || 0;
                          const isClipped = stats?.isClipping || false;

                          return (
                            <tr key={pId} className="hover:bg-bg-main">
                              <td className="py-2 px-2 font-bold text-text-primary">
                                <div className="flex items-center gap-1.5">
                                  <span>{p ? `MIC ${String(p.channelNumber).padStart(2, '0')}` : pId.substring(0, 6)}</span>
                                  <span className="text-text-muted font-normal text-[10px]">({p?.name || 'Handset'})</span>
                                </div>
                              </td>
                              <td className="py-2 px-2 font-mono">
                                <span className={`font-bold ${
                                  rtt === 0 ? 'text-text-muted' :
                                  rtt < 35 ? 'text-green-400' :
                                  rtt < 80 ? 'text-yellow-400' : 'text-red-400'
                                }`}>
                                  {rtt > 0 ? `${rtt} ms` : '<10 ms'}
                                </span>
                              </td>
                              <td className="py-2 px-2 font-mono">
                                <span className={loss > 5 ? 'text-red-400 font-bold' : loss > 0 ? 'text-yellow-400' : 'text-text-secondary'}>
                                  {loss}%
                                </span>
                              </td>
                              <td className="py-2 px-2 font-mono text-text-secondary">
                                ±{jitter} ms
                              </td>
                              <td className="py-2 px-2 font-mono text-text-primary">
                                {stats?.bitrateKbps ? `${stats.bitrateKbps} kbps` : '96 kbps'}
                              </td>
                              <td className="py-2 px-2">
                                {isClipped ? (
                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-950/60 text-red-300 border border-red-500 animate-pulse">
                                    CLIPPING
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-green-400">CLEAN</span>
                                )}
                              </td>
                              <td className="py-2 px-2">
                                <span className={`px-1.5 py-0.5 border rounded text-[10px] uppercase ${
                                  pc.connectionState === 'connected'
                                    ? 'bg-accent-blue text-white border-accent-blue font-bold'
                                    : 'bg-bg-main text-text-muted border-border'
                                }`}>
                                  {pc.connectionState}
                                </span>
                              </td>
                              <td className="py-2 px-2 text-right">
                                <button
                                  onClick={() => handleKickParticipant(pId)}
                                  className="px-2 py-0.5 border border-border text-text-secondary hover:text-white rounded text-[10px] uppercase"
                                >
                                  DISCONNECT
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Virtual Handset Injection Test Bench */}
              <div className="bg-bg-card border border-border p-4 sm:p-5 rounded-2xl shadow-xl shadow-black/40 flex flex-col gap-3.5 font-mono text-xs">
                <div className="pb-2.5 border-b border-border">
                  <h3 className="font-heading font-bold text-sm tracking-wider uppercase text-text-primary">
                    VIRTUAL PARTICIPANT INJECTION TEST BENCH
                  </h3>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    Inject simulated participants to test multi-microphone priority preemption and floor locking without requiring physical phones.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="p-3.5 bg-bg-secondary border border-border rounded-xl flex flex-col gap-2">
                    <div className="font-bold text-accent-blue">ADD TEST PARTICIPANT (VIP)</div>
                    <p className="text-[11px] text-text-muted leading-relaxed">Simulate Moderator or Stage Chair with highest priority (Score 3).</p>
                    <button
                      onClick={() => handleInjectVirtualParticipant('Stage Moderator (VIP)', 'VIP')}
                      className="mt-auto py-2 px-3 bg-accent-blue text-white font-mono font-semibold text-xs uppercase rounded-lg hover:bg-accent-blue-hover btn-tactile shadow-blue-glow transition-all active:scale-[0.99]"
                    >
                      + INJECT VIP MIC
                    </button>
                  </div>

                  <div className="p-3.5 bg-bg-secondary border border-border rounded-xl flex flex-col gap-2">
                    <div className="font-bold text-text-primary">ADD TEST PARTICIPANT (NORMAL)</div>
                    <p className="text-[11px] text-text-muted leading-relaxed">Simulate audience question microphone (Score 2).</p>
                    <button
                      onClick={() => handleInjectVirtualParticipant('Audience Floor MIC', 'Normal')}
                      className="mt-auto py-2 px-3 bg-bg-card border border-border text-text-primary font-mono text-xs uppercase rounded-lg btn-tactile hover:border-border-hover hover:text-white transition-colors"
                    >
                      + INJECT NORMAL MIC
                    </button>
                  </div>

                  <div className="p-3.5 bg-bg-secondary border border-border rounded-xl flex flex-col gap-2">
                    <div className="font-bold text-text-muted">ADD TEST PARTICIPANT (LOW)</div>
                    <p className="text-[11px] text-text-muted leading-relaxed">Simulate observer microphone (Score 1).</p>
                    <button
                      onClick={() => handleInjectVirtualParticipant('Guest Observer MIC', 'Low')}
                      className="mt-auto py-2 px-3 bg-bg-card border border-border text-text-primary font-mono text-xs uppercase rounded-lg btn-tactile hover:border-border-hover hover:text-white transition-colors"
                    >
                      + INJECT LOW MIC
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

        </main>

        {/* ===================== DESKTOP RIGHT ASIDE: TELEMETRY & SYSTEM LOG (HIDDEN ON MOBILE/TABLET) ===================== */}
        <aside className="w-72 bg-bg-secondary/70 backdrop-blur-sm border-l border-border hidden xl:flex flex-col p-3.5 gap-4 overflow-y-auto select-none flex-shrink-0">
          {/* Status Box */}
          <section className="bg-bg-card border border-border p-3.5 rounded-xl space-y-2 text-xs font-mono shadow-card">
            <div className="text-[10px] text-text-muted uppercase tracking-widest font-bold pb-1.5 border-b border-border">
              ARBITRATION STATUS
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">Current Speaker:</span>
              <span className="font-bold text-accent-blue">
                {activeSpeaker ? `MIC ${String(activeSpeaker.channelNumber).padStart(2, '0')}` : 'NONE'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">Decision Reason:</span>
              <span className="text-text-primary truncate max-w-[130px]">
                {session?.selectionReason || 'INITIAL_IDLE'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">Active Priority:</span>
              <span className="text-text-primary">
                {activeSpeaker?.priority || '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">Host PA State:</span>
              <span className="text-accent-blue font-bold">
                {session?.isEmergencyStop ? 'MUTED (STOP)' : session?.isMuteAll ? 'MUTED (ALL)' : 'AUDIBLE'}
              </span>
            </div>
          </section>

          {/* Real-time Eligible Queue */}
          <section className="bg-bg-card border border-border p-3.5 rounded-xl space-y-2 text-xs font-mono shadow-card">
            <div className="text-[10px] text-text-muted uppercase tracking-widest font-bold pb-1.5 border-b border-border flex justify-between">
              <span>CONTENDERS QUEUE</span>
              <span>PRIORITY</span>
            </div>
            {participants.length === 0 ? (
              <div className="text-[11px] text-text-muted">No transmitters connected</div>
            ) : (
              <div className="space-y-1.5">
                {participants
                  .slice()
                  .sort((a, b) => (b.priority === 'VIP' ? 1 : 0) - (a.priority === 'VIP' ? 1 : 0))
                  .map((p) => {
                    const isMuted = p.isMutedByAdmin || p.isMutedSelf;
                    const isActive = session?.activeSpeakerId === p.id;
                    return (
                      <div
                        key={p.id}
                        className={`flex items-center justify-between p-2 rounded-lg border text-[11px] transition-all ${
                          isActive
                            ? 'bg-bg-secondary text-accent-blue font-bold border-accent-blue/50 shadow-sm'
                            : 'bg-bg-card text-text-secondary border-border'
                        }`}
                      >
                        <span className="truncate max-w-[120px]">
                          MIC {String(p.channelNumber).padStart(2, '0')} {p.name}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {p.isSpeaking && !isMuted && (
                            <span className="w-1.5 h-1.5 rounded-full bg-accent-blue animate-pulse" />
                          )}
                          <span>{p.priority}</span>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </section>

          {/* Chronological Event Log */}
          <section className="bg-bg-card border border-border p-3.5 rounded-xl flex-1 flex flex-col text-xs font-mono shadow-md">
            <div className="text-[10px] text-text-muted uppercase tracking-widest font-bold pb-1.5 border-b border-border mb-2 flex justify-between">
              <span>SYSTEM LOG</span>
              <span>TIME</span>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1 max-h-72">
              {(session?.recentEvents || []).slice(-50).map((evt) => (
                <div key={evt.id} className="text-[10px] pb-1.5 border-b border-border/40">
                  <div className="flex justify-between text-text-muted">
                    <span className="font-semibold text-text-primary">{evt.message}</span>
                    <span className="text-text-muted">{evt.timestamp}</span>
                  </div>
                  {evt.details && (
                    <div className="text-text-secondary truncate mt-0.5">{evt.details}</div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      {/* ===================== MOBILE & TABLET BOTTOM NAVIGATION DOCK ===================== */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-bg-secondary/95 backdrop-blur-lg border-t border-border px-2 py-1.5 flex items-center justify-around select-none shadow-[0_-5px_20px_rgba(0,0,0,0.5)]">
        {navigationTabs.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => handleTabChange(item.id)}
              className={`flex-1 py-1 px-1 flex flex-col items-center justify-center gap-0.5 relative transition-colors min-h-[46px] rounded-lg ${
                isActive
                  ? 'text-accent-blue font-bold bg-accent-blue/10'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              <div className="relative">
                <Icon size={17} />
                {item.badge && (
                  <span className="absolute -top-1.5 -right-2.5 w-3.5 h-3.5 bg-accent-blue text-white rounded-full text-[8px] font-mono font-bold flex items-center justify-center shadow-xs">
                    {item.badge.length > 2 ? '•' : item.badge}
                  </span>
                )}
              </div>
              <span className="text-[9px] font-mono tracking-tight leading-none mt-0.5">
                {item.shortLabel}
              </span>
            </button>
          );
        })}
      </nav>

      {/* QR Code Modal for Phone Pairing */}
      <QRCodeModal
        isOpen={isQRModalOpen}
        onClose={() => setIsQRModalOpen(false)}
        sessionId={sessionId}
        localIp={localIp}
        tunnelUrl={tunnelUrl}
        channelNumber={qrChannelNumber}
      />
    </div>
  );
};
