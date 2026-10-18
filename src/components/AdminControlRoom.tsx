import React, { useState, useEffect, useRef } from 'react';
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
  User
} from 'lucide-react';

interface AdminControlRoomProps {
  socket: Socket | null;
  sessionId: string;
  localIp: string;
  tunnelUrl?: string | null;
  hostAudio: HostAudioEngine;
}

export const AdminControlRoom: React.FC<AdminControlRoomProps> = ({
  socket,
  sessionId,
  localIp,
  tunnelUrl,
  hostAudio
}) => {
  const [session, setSession] = useState<SessionState | null>(null);
  const [activeTab, setActiveTab] = useState<'control' | 'mics' | 'auto' | 'output' | 'diagnostics'>('control');
  const [micFilter, setMicFilter] = useState<'all' | 'active' | 'ready' | 'muted' | 'vip'>('all');
  const [isQRModalOpen, setIsQRModalOpen] = useState(false);
  const [qrChannelNumber, setQrChannelNumber] = useState<number | undefined>(undefined);
  const [masterAudioLevel, setMasterAudioLevel] = useState<number>(0);
  const [peerStatsMap, setPeerStatsMap] = useState<Record<string, PeerNetworkStats>>({});
  const [channelTrimMap, setChannelTrimMap] = useState<Record<string, number>>({});

  // Poll peer network stats for all connected participant phones
  useEffect(() => {
    if (!session?.participants) return;
    const interval = setInterval(async () => {
      const statsObj: Record<string, PeerNetworkStats> = {};
      for (const id of Object.keys(session.participants)) {
        try {
          const stats = await hostAudio.getPeerStats(id);
          statsObj[id] = stats;
        } catch {}
      }
      setPeerStatsMap(statsObj);
    }, 1000);

    return () => clearInterval(interval);
  }, [session?.participants, hostAudio]);

  const handleTrimChange = (participantId: string, trim: number) => {
    hostAudio.setChannelTrim(participantId, trim);
    setChannelTrimMap(prev => ({ ...prev, [participantId]: trim }));
  };

  // Sync activeTab with URL search params and hash (supports bookmarking and back/forward buttons)
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

  // Synchronize audio routing with host Web Audio API
  useEffect(() => {
    if (!session) return;
    const mutedIds = new Set<string>();
    for (const p of Object.values(session.participants || {})) {
      if (p.isMutedByAdmin || p.isMutedSelf) {
        mutedIds.add(p.id);
      }
    }

    hostAudio.setRouting(
      session.activeSpeakerId, 
      session.isMuteAll, 
      session.isEmergencyStop,
      mutedIds
    );
  }, [session, hostAudio]);

  // Master output VU meter animation loop
  useEffect(() => {
    let animId: number;
    const poll = () => {
      const lvl = hostAudio.getMasterLevel();
      // If server active speaker has audioLevel, mix in as fallback
      if (session?.activeSpeakerId && session.participants[session.activeSpeakerId]) {
        const pLevel = session.participants[session.activeSpeakerId].audioLevel;
        setMasterAudioLevel(Math.max(lvl, pLevel));
      } else {
        setMasterAudioLevel(lvl);
      }
      animId = requestAnimationFrame(poll);
    };
    animId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(animId);
  }, [hostAudio, session]);

  // Socket event listeners
  useEffect(() => {
    if (!socket) return;

    socket.on('session:state', (updatedSession: SessionState) => {
      setSession(updatedSession);
    });

    // Real-time audio meter broadcast
    socket.on('participant:audio_meter', ({ id, level, isSpeaking }: { id: string; level: number; isSpeaking: boolean }) => {
      setSession(prev => {
        if (!prev || !prev.participants[id]) return prev;
        return {
          ...prev,
          participants: {
            ...prev.participants,
            [id]: {
              ...prev.participants[id],
              audioLevel: level,
              isSpeaking
            }
          }
        };
      });
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
      socket.off('session:state');
      socket.off('participant:audio_meter');
      socket.off('webrtc:peer_joined');
      socket.off('webrtc:signal');
    };
  }, [socket, hostAudio]);

  // Keyboard Hotkeys: 1 -> Select MIC 01, 2 -> Select MIC 02, 3 -> Select MIC 03, Space -> Mute All
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

  // Admin Actions
  const handleSelectMic = (participantId: string | null) => {
    hostAudio.initAudio();
    socket?.emit('admin:select_mic', { participantId });
  };

  const handleToggleMode = (mode: 'manual' | 'auto') => {
    socket?.emit('admin:set_mode', { mode });
  };

  const handleToggleMuteParticipant = (participantId: string, muted: boolean) => {
    socket?.emit('admin:mute_participant', { participantId, muted });
  };

  const handleToggleMuteAll = () => {
    if (!session) return;
    const nextMuteAll = !session.isMuteAll;
    socket?.emit('admin:mute_all', { isMuteAll: nextMuteAll });
  };

  const handleEmergencyStop = () => {
    if (!session) return;
    const nextStop = !session.isEmergencyStop;
    socket?.emit('admin:emergency_stop', { isEmergencyStop: nextStop });
  };

  const handleChangePriority = (participantId: string, priority: PriorityLevel) => {
    socket?.emit('admin:set_priority', { participantId, priority });
  };

  const handleKickParticipant = (participantId: string) => {
    if (confirm('Disconnect participant from audio bus?')) {
      socket?.emit('admin:kick_participant', { participantId });
      hostAudio.closePeerConnection(participantId);
    }
  };

  const handleUpdateConfig = (config: Partial<ArbitrationConfig>) => {
    socket?.emit('admin:update_config', config);
  };

  // Virtual test participant injector for testing multi-mic arbitration without multiple phones
  const handleInjectVirtualParticipant = (name: string, priority: PriorityLevel) => {
    // Generate simulated participant
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

  const filteredParticipants = participants.filter(p => {
    if (micFilter === 'active') return session?.activeSpeakerId === p.id;
    if (micFilter === 'ready') return p.state === 'READY';
    if (micFilter === 'muted') return p.isMutedByAdmin || p.isMutedSelf || session?.isMuteAll || session?.isEmergencyStop;
    if (micFilter === 'vip') return p.priority === 'VIP';
    return true;
  });

  // Quick bus slots (MIC 01, MIC 02, MIC 03)
  const quickSlots = [1, 2, 3].map(chNum => {
    const found = participants.find(p => p.channelNumber === chNum);
    return {
      channelNumber: chNum,
      participant: found || null
    };
  });

  return (
    <div className="min-h-screen bg-bg-main text-text-primary flex flex-col font-body">
      {/* ===================== TOP HEADER ===================== */}
      <header className="bg-bg-secondary border-b border-border px-4 py-2.5 flex items-center justify-between select-none">
        {/* Left Wordmark & Session */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Radio size={18} className="text-text-primary animate-pulse" />
            <h1 className="font-heading font-black text-xl tracking-widest uppercase">
              MICRO PAD
            </h1>
          </div>
          <div className="h-5 w-px bg-border" />
          <div className="flex items-center gap-3 text-xs font-mono">
            <span className="text-text-muted">SESSION:</span>
            <span className="font-bold text-text-primary">{sessionId}</span>
            <span className="px-1.5 py-0.5 border border-border text-[10px] text-text-secondary bg-bg-main">
              {session?.sessionName || 'STAGE BROADCAST'}
            </span>
          </div>
        </div>

        {/* Center Indicators */}
        <div className="hidden lg:flex items-center gap-5 text-xs font-mono">
          <div className="flex items-center gap-1.5">
            <Wifi size={13} className="text-text-primary" />
            <span className="text-text-muted">LAN IP:</span>
            <span className="font-semibold">{localIp}:5173</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Users size={13} className="text-text-primary" />
            <span className="text-text-muted">UNITS:</span>
            <span className="font-semibold">{participants.length} CONNECTED</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Cpu size={13} className="text-text-primary" />
            <span className="text-text-muted">ENGINE:</span>
            <span className={`font-semibold uppercase ${session?.mode === 'auto' ? 'text-text-primary underline' : 'text-text-secondary'}`}>
              {session?.mode || 'MANUAL'}
            </span>
          </div>
        </div>

        {/* Right Session Controls */}
        <div className="flex items-center gap-2">
          {/* QR Code Join Modal Button */}
          <button
            onClick={() => {
              setQrChannelNumber(undefined);
              setIsQRModalOpen(true);
            }}
            className="px-2.5 py-1.5 bg-bg-main border border-border text-xs font-mono text-text-primary hover:border-text-primary btn-tactile flex items-center gap-1.5"
          >
            <QrCode size={13} />
            <span>CONNECT PHONES</span>
          </button>

          {/* Mute All Toggle */}
          <button
            onClick={handleToggleMuteAll}
            className={`px-3 py-1.5 text-xs font-mono font-bold tracking-wider uppercase border btn-tactile flex items-center gap-1.5 ${
              session?.isMuteAll
                ? 'bg-text-primary text-text-inverse border-white'
                : 'bg-bg-main text-text-primary border-border hover:border-text-primary'
            }`}
          >
            <VolumeX size={13} />
            <span>{session?.isMuteAll ? 'ALL MUTED' : 'MUTE ALL'}</span>
          </button>

          {/* Emergency Stop Hard Cut */}
          <button
            onClick={handleEmergencyStop}
            className={`px-3 py-1.5 text-xs font-mono font-black tracking-widest uppercase border-2 btn-tactile flex items-center gap-1.5 ${
              session?.isEmergencyStop
                ? 'bg-text-primary text-text-inverse border-white ring-2 ring-white/30 animate-pulse'
                : 'bg-bg-main text-text-primary border-text-primary hover:bg-text-primary hover:text-text-inverse'
            }`}
          >
            <AlertOctagon size={14} />
            <span>{session?.isEmergencyStop ? 'STOPPED' : 'EMERGENCY STOP'}</span>
          </button>
        </div>
      </header>

      {/* ===================== WORKSPACE LAYOUT ===================== */}
      <div className="flex flex-1 overflow-hidden">
        {/* ===================== LEFT SIDEBAR ===================== */}
        <nav className="w-56 bg-bg-secondary border-r border-border flex flex-col p-3 gap-1 select-none">
          <div className="text-[10px] font-mono text-text-muted uppercase tracking-widest px-2 py-1 mb-1 font-bold">
            CONSOLE NAVIGATION
          </div>

          {[
            { id: 'control', label: 'CONTROL ROOM', icon: Activity, badge: null },
            { id: 'mics', label: 'MICROPHONES', icon: Radio, badge: participants.length > 0 ? String(participants.length) : null },
            { id: 'auto', label: 'AUTO ARBITRATION', icon: Cpu, badge: session?.mode === 'auto' ? 'AUTO' : null },
            { id: 'output', label: 'AUDIO OUTPUT / PA', icon: Volume2, badge: session?.isEmergencyStop ? 'STOP' : session?.isMuteAll ? 'MUTE' : null },
            { id: 'diagnostics', label: 'DIAGNOSTICS & SIM', icon: Settings, badge: null },
          ].map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleTabChange(item.id as any)}
                className={`w-full text-left px-3 py-2 text-xs font-mono tracking-wider flex items-center justify-between rounded-sm border transition-all ${
                  isActive
                    ? 'bg-text-primary text-text-inverse border-white font-bold shadow-sm'
                    : 'bg-transparent text-text-secondary border-transparent hover:bg-bg-elevated hover:text-text-primary'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon size={14} />
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span className={`text-[10px] px-1.5 py-0.2 border rounded-xs font-mono ${
                    isActive ? 'bg-black text-white border-black' : 'bg-bg-main text-text-muted border-border'
                  }`}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}

          {/* Mode Switcher Shortcut */}
          <div className="mt-auto p-3 bg-bg-main border border-border rounded-sm">
            <div className="text-[10px] font-mono text-text-muted uppercase mb-1">
              ARBITRATION MODE
            </div>
            <div className="grid grid-cols-2 gap-1 font-mono text-[11px]">
              <button
                onClick={() => handleToggleMode('manual')}
                className={`py-1 border ${
                  session?.mode === 'manual'
                    ? 'bg-text-primary text-text-inverse font-bold border-white'
                    : 'border-border text-text-secondary hover:text-text-primary'
                }`}
              >
                MANUAL
              </button>
              <button
                onClick={() => handleToggleMode('auto')}
                className={`py-1 border ${
                  session?.mode === 'auto'
                    ? 'bg-text-primary text-text-inverse font-bold border-white'
                    : 'border-border text-text-secondary hover:text-text-primary'
                }`}
              >
                AUTO
              </button>
            </div>
          </div>
        </nav>

        {/* ===================== MAIN CENTER WORKSPACE ===================== */}
        <main className="flex-1 flex flex-col p-4 gap-4 overflow-y-auto">

          {/* ============================================================== */}
          {/* TAB 1: CONTROL ROOM (MASTER AIR MONITOR & PRIMARY BUS)         */}
          {/* ============================================================== */}
          {activeTab === 'control' && (
            <div className="flex flex-col gap-4">
              {/* Page Title & Breadcrumb */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-border gap-2">
                <div>
                  <div className="text-[10px] font-mono text-text-muted uppercase tracking-widest font-bold">
                    CONSOLE // MASTER CONTROL ROOM
                  </div>
                  <h2 className="font-heading font-black text-lg tracking-wider uppercase text-text-primary">
                    LIVE AIR MONITOR &amp; PRIMARY AUDIO BUS
                  </h2>
                </div>
                <div className="flex items-center gap-2 text-xs font-mono">
                  <span className="px-2 py-1 bg-bg-elevated border border-border text-text-secondary">
                    {session?.mode === 'auto' ? 'AUTO VAD ARBITRATION' : 'MANUAL BUS OVERRIDE'}
                  </span>
                  <button
                    onClick={() => handleTabChange('mics')}
                    className="px-2.5 py-1 bg-bg-main border border-border text-text-primary hover:border-text-primary btn-tactile flex items-center gap-1.5"
                  >
                    <Radio size={12} />
                    <span>MANAGE MICS ({participants.length})</span>
                  </button>
                </div>
              </div>

              {/* Master Output Banner */}
              <section className="relative p-4 bg-bg-elevated border-2 border-border rounded-sm shadow-panel flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="absolute top-2 left-2 rack-screw opacity-60" />
                <div className="absolute top-2 right-2 rack-screw opacity-60" />

                <div className="flex-1 w-full flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-text-muted uppercase tracking-widest font-bold">
                      CURRENT MASTER BUS ROUTE
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 bg-bg-main border border-border text-text-secondary">
                      {session?.mode === 'auto' ? `AUTO // ${session.selectionReason}` : 'MANUAL OVERRIDE'}
                    </span>
                  </div>

                  <div className="flex items-baseline gap-3 my-1">
                    <span className="font-heading font-black text-3xl tracking-wider text-text-primary uppercase">
                      {session?.isEmergencyStop
                        ? '[ EMERGENCY STOP ACTIVE ]'
                        : session?.isMuteAll
                        ? '[ ALL MICROPHONES MUTED ]'
                        : activeSpeaker
                        ? `MIC ${String(activeSpeaker.channelNumber).padStart(2, '0')}`
                        : '[ NO ACTIVE SPEAKER ]'}
                    </span>
                    {activeSpeaker && !session?.isEmergencyStop && !session?.isMuteAll && (
                      <span className="font-mono text-base text-text-secondary font-medium">
                        — {activeSpeaker.name}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 text-xs font-mono text-text-muted">
                    <span>Priority: <strong className="text-text-primary">{activeSpeaker?.priority || '—'}</strong></span>
                    <span>•</span>
                    <span>Routing: <strong className="text-text-primary">{activeSpeaker ? 'EXCLUSIVE AUDIBLE' : 'CLAMPED / SILENT'}</strong></span>
                    <span>•</span>
                    <span>Hold [1, 2, 3] on keyboard for rapid switching</span>
                  </div>
                </div>

                {/* Master Hardware VU Meter */}
                <div className="w-full md:w-80 p-3 bg-bg-main border border-border rounded-sm">
                  <RetroVUMeter
                    level={session?.isEmergencyStop || session?.isMuteAll ? 0 : masterAudioLevel}
                    segments={22}
                    height="h-5"
                    showLabels={true}
                    label="MASTER PA BUS OUTPUT LEVEL"
                  />
                </div>

                {/* Master Quick Actions */}
                <div className="flex md:flex-col gap-2">
                  <button
                    onClick={async () => {
                      await hostAudio.initAudio();
                      hostAudio.playTestChime();
                    }}
                    title="Play 440Hz broadcast calibration test tone"
                    className="px-3 py-2 bg-text-primary text-text-inverse border border-white font-mono text-xs font-bold uppercase tracking-wider btn-tactile hover:bg-white/90 flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    <Volume2 size={13} />
                    <span>TEST 440Hz CHIME</span>
                  </button>

                  <button
                    onClick={() => handleSelectMic(null)}
                    disabled={!activeSpeaker}
                    className="px-3 py-2 bg-bg-main border border-border font-mono text-xs uppercase tracking-wider text-text-secondary hover:text-text-primary hover:border-text-primary btn-tactile disabled:opacity-30 disabled:pointer-events-none"
                  >
                    UNROUTE FLOOR
                  </button>
                </div>
              </section>

              {/* Primary Quick Bus (MIC 01, 02, 03) */}
              <section className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-text-secondary flex items-center gap-1.5">
                    <span>PRIMARY BROADCAST BUS</span>
                    <span className="text-[10px] text-text-muted">[HOTKEYS: 1, 2, 3]</span>
                  </h3>
                  <span className="text-[10px] font-mono text-text-muted">
                    EXCLUSIVE MANUAL OVERRIDE
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {quickSlots.map(({ channelNumber, participant }) => {
                    const isSelected = !!participant && session?.activeSpeakerId === participant.id;
                    const label = `MIC ${String(channelNumber).padStart(2, '0')}`;

                    if (!participant) {
                      return (
                        <div
                          key={channelNumber}
                          className="p-4 bg-bg-elevated border border-dashed border-border rounded-sm flex flex-col justify-between h-28 opacity-60"
                        >
                          <div className="flex justify-between items-center">
                            <span className="font-mono text-xs font-bold text-text-muted">{label}</span>
                            <span className="text-[10px] font-mono text-text-muted">EMPTY BUS</span>
                          </div>
                          <div className="text-xs font-mono text-text-muted">
                            Scan QR code to assign handset
                          </div>
                          <button
                            onClick={() => {
                              setQrChannelNumber(channelNumber);
                              setIsQRModalOpen(true);
                            }}
                            className="text-[10px] font-mono text-text-secondary hover:text-white underline text-left"
                          >
                            + Connect mobile device
                          </button>
                        </div>
                      );
                    }

                    return (
                      <MicCard
                        key={participant.id}
                        participant={participant}
                        isSelected={isSelected}
                        isQuickSlot={true}
                        stats={peerStatsMap[participant.id]}
                        trimMultiplier={channelTrimMap[participant.id] ?? 1.5}
                        onTrimChange={(val) => handleTrimChange(participant.id, val)}
                        onSelect={() => handleSelectMic(isSelected ? null : participant.id)}
                        onToggleMute={(m) => handleToggleMuteParticipant(participant.id, m)}
                        onChangePriority={(p) => handleChangePriority(participant.id, p)}
                        onKick={() => handleKickParticipant(participant.id)}
                      />
                    );
                  })}
                </div>
              </section>

              {/* Master Studio Status Overview */}
              <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="p-3 bg-bg-elevated border border-border rounded-sm flex flex-col justify-between">
                  <div>
                    <div className="text-[10px] font-mono text-text-muted uppercase">AUDIO OUTPUT STAGE</div>
                    <div className="font-mono text-sm font-bold text-text-primary mt-1">
                      {session?.isEmergencyStop ? 'EMERGENCY STOPPED' : session?.isMuteAll ? 'ALL CHANNELS MUTED' : 'PA AUDIO AUDIBLE'}
                    </div>
                    <div className="text-xs font-mono text-text-secondary mt-0.5">
                      Bluetooth / Host Output Active
                    </div>
                  </div>
                  <button
                    onClick={() => handleTabChange('output')}
                    className="mt-3 text-xs font-mono text-text-primary hover:underline flex items-center gap-1"
                  >
                    <span>Configure Output Stage</span>
                    <ArrowRight size={12} />
                  </button>
                </div>

                <div className="p-3 bg-bg-elevated border border-border rounded-sm flex flex-col justify-between">
                  <div>
                    <div className="text-[10px] font-mono text-text-muted uppercase">WIRELESS HANDSET BUS</div>
                    <div className="font-mono text-sm font-bold text-text-primary mt-1">
                      {participants.length} CONNECTED / {activeCount} ON AIR
                    </div>
                    <div className="text-xs font-mono text-text-secondary mt-0.5">
                      {readyCount} Standby • {mutedCount} Muted
                    </div>
                  </div>
                  <button
                    onClick={() => handleTabChange('mics')}
                    className="mt-3 text-xs font-mono text-text-primary hover:underline flex items-center gap-1"
                  >
                    <span>Open Channel Rack ({participants.length})</span>
                    <ArrowRight size={12} />
                  </button>
                </div>

                <div className="p-3 bg-bg-elevated border border-border rounded-sm flex flex-col justify-between">
                  <div>
                    <div className="text-[10px] font-mono text-text-muted uppercase">ARBITRATION ENGINE</div>
                    <div className="font-mono text-sm font-bold text-text-primary mt-1 uppercase">
                      {session?.mode || 'MANUAL'} MODE
                    </div>
                    <div className="text-xs font-mono text-text-secondary mt-0.5">
                      Decision: {session?.selectionReason || 'INITIAL_IDLE'}
                    </div>
                  </div>
                  <button
                    onClick={() => handleTabChange('auto')}
                    className="mt-3 text-xs font-mono text-text-primary hover:underline flex items-center gap-1"
                  >
                    <span>Tune Floor Arbitration</span>
                    <ArrowRight size={12} />
                  </button>
                </div>
              </section>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 2: MICROPHONES (TRANSMITTER CHANNEL RACK & MATRIX)         */}
          {/* ============================================================== */}
          {activeTab === 'mics' && (
            <div className="flex flex-col gap-4">
              {/* Page Title & Breadcrumb */}
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
                    className="px-3 py-1.5 bg-text-primary text-text-inverse font-mono font-bold text-xs uppercase btn-tactile hover:bg-white/90 flex items-center gap-1.5"
                  >
                    <QrCode size={13} />
                    <span>+ PAIR MOBILE HANDSET</span>
                  </button>
                </div>
              </div>

              {/* Filters & Batch Controls Bar */}
              <div className="p-3 bg-bg-elevated border border-border rounded-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-3 font-mono text-xs">
                {/* Filter Tabs */}
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
                      className={`px-2.5 py-1 rounded-xs border transition-all ${
                        micFilter === f.id
                          ? 'bg-text-primary text-text-inverse border-white font-bold'
                          : 'bg-bg-main text-text-secondary border-border hover:text-text-primary'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {/* Batch Actions */}
                <div className="flex items-center gap-2 w-full md:w-auto justify-end">
                  <button
                    onClick={handleToggleMuteAll}
                    className={`px-2.5 py-1 border text-xs uppercase btn-tactile ${
                      session?.isMuteAll
                        ? 'bg-text-primary text-text-inverse border-white'
                        : 'bg-bg-main text-text-primary border-border hover:border-text-primary'
                    }`}
                  >
                    {session?.isMuteAll ? 'UNMUTE ALL MICS' : 'MUTE ALL MICS'}
                  </button>

                  <button
                    onClick={() => handleSelectMic(null)}
                    disabled={!activeSpeaker}
                    className="px-2.5 py-1 bg-bg-main border border-border text-xs uppercase text-text-secondary hover:text-text-primary hover:border-text-primary btn-tactile disabled:opacity-30 disabled:pointer-events-none"
                  >
                    UNROUTE FLOOR
                  </button>
                </div>
              </div>

              {/* Handset Grid */}
              {filteredParticipants.length === 0 ? (
                <div className="p-12 bg-bg-elevated border border-border rounded-sm text-center flex flex-col items-center justify-center gap-3">
                  <Radio size={32} className="text-text-muted animate-pulse" />
                  <div>
                    <h4 className="font-heading font-bold text-base tracking-wider uppercase">
                      {participants.length === 0
                        ? 'NO WIRELESS TRANSMITTERS DETECTED'
                        : `NO HANDSETS MATCHING FILTER '${micFilter.toUpperCase()}'`}
                    </h4>
                    <p className="text-xs text-text-secondary font-mono mt-1 max-w-md">
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
                        className="px-4 py-2 bg-text-primary text-text-inverse font-mono font-bold text-xs uppercase btn-tactile hover:bg-white/90"
                      >
                        OPEN PAIRING QR CODE
                      </button>
                    ) : (
                      <button
                        onClick={() => setMicFilter('all')}
                        className="px-4 py-2 bg-text-primary text-text-inverse font-mono font-bold text-xs uppercase btn-tactile hover:bg-white/90"
                      >
                        RESET TO ALL HANDSETS
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
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
              <div className="mt-auto p-3 bg-bg-secondary border border-border rounded-sm flex items-center justify-between text-[11px] font-mono text-text-muted">
                <span>CHANNEL CAPACITY: 32 BUS SLOTS ALLOCATED</span>
                <span>AUDIO TRANSPORT: WEBRTC OPUS 48KHZ STEREO // LAN UDP</span>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 3: AUTO ARBITRATION                                        */}
          {/* ============================================================== */}
          {activeTab === 'auto' && (
            <div className="flex flex-col gap-4">
              {/* Page Title & Breadcrumb */}
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
                    className={`px-3 py-1.5 font-mono font-bold text-xs uppercase border btn-tactile ${
                      session?.mode === 'auto'
                        ? 'bg-text-primary text-text-inverse border-white'
                        : 'bg-bg-main text-text-primary border-border hover:border-text-primary'
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
              <div className="bg-bg-elevated border border-border p-4 rounded-sm flex flex-col gap-3 font-mono text-xs">
                <div className="pb-2 border-b border-border">
                  <h3 className="font-heading font-bold text-sm tracking-wider uppercase text-text-primary">
                    ARBITRATION PREEMPTION &amp; TIMING SPECIFICATION
                  </h3>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    Deterministic rules governing automatic floor grants across multi-speaker wireless channels.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="p-3 bg-bg-main border border-border flex flex-col gap-1.5">
                    <span className="font-bold text-text-primary">VIP (SCORE: 3)</span>
                    <span className="text-[11px] text-text-secondary">
                      Moderators &amp; Stage Chairs. Can preempt Normal and Low participants once the active speaker lock duration has passed.
                    </span>
                  </div>

                  <div className="p-3 bg-bg-main border border-border flex flex-col gap-1.5">
                    <span className="font-bold text-text-primary">NORMAL (SCORE: 2)</span>
                    <span className="text-[11px] text-text-secondary">
                      Standard audience question microphones. Contenders compete based on who starts speaking first, with lock timer protection.
                    </span>
                  </div>

                  <div className="p-3 bg-bg-main border border-border flex flex-col gap-1.5">
                    <span className="font-bold text-text-primary">LOW (SCORE: 1)</span>
                    <span className="text-[11px] text-text-secondary">
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
            <div className="flex flex-col gap-4">
              {/* Page Title & Breadcrumb */}
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
                    className="px-3 py-1.5 bg-text-primary text-text-inverse font-mono font-bold text-xs uppercase btn-tactile hover:bg-white/90 flex items-center gap-1.5"
                  >
                    <Volume2 size={13} />
                    <span>TEST 440Hz CHIME</span>
                  </button>
                </div>
              </div>

              <AudioOutputPanel
                hostAudio={hostAudio}
                activeSpeakerName={activeSpeaker ? `MIC ${String(activeSpeaker.channelNumber).padStart(2, '0')} (${activeSpeaker.name})` : null}
                isMuteAll={!!session?.isMuteAll}
                isEmergencyStop={!!session?.isEmergencyStop}
              />

              {/* Host Audio Signal Flow Schematic */}
              <div className="bg-bg-elevated border border-border p-4 rounded-sm flex flex-col gap-2 font-mono text-xs">
                <div className="pb-1 border-b border-border text-[10px] text-text-muted uppercase font-bold">
                  AUDIO SIGNAL GRAPH ROUTING SCHEMATIC
                </div>
                <div className="p-3 bg-bg-main border border-border text-[11px] leading-relaxed text-text-secondary overflow-x-auto">
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
            <div className="flex flex-col gap-4">
              {/* Page Title & Breadcrumb */}
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
                    className="px-3 py-1.5 bg-bg-main border border-border text-text-primary hover:border-text-primary font-mono text-xs uppercase btn-tactile flex items-center gap-1.5"
                  >
                    <RotateCcw size={12} />
                    <span>RESET AUDIO CONTEXT</span>
                  </button>
                </div>
              </div>

              {/* Link Health Telemetry Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono text-xs">
                <div className="p-3 bg-bg-elevated border border-border rounded-sm flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-text-muted text-[10px] uppercase font-bold">
                    <span className="flex items-center gap-1">
                      <Server size={12} />
                      <span>SIGNALING SERVER</span>
                    </span>
                    <span className="text-text-primary">ONLINE</span>
                  </div>
                  <div className="font-bold text-text-primary text-sm">
                    {socket?.connected ? 'CONNECTED (SOCKET.IO)' : 'CONNECTING...'}
                  </div>
                  <div className="text-[11px] text-text-secondary truncate">
                    Socket ID: {socket?.id || '—'}
                  </div>
                  <div className="text-[10px] text-text-muted mt-auto pt-1 border-t border-border">
                    Host LAN URL: {localIp}:3001
                  </div>
                </div>

                <div className="p-3 bg-bg-elevated border border-border rounded-sm flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-text-muted text-[10px] uppercase font-bold">
                    <span className="flex items-center gap-1">
                      <HardDrive size={12} />
                      <span>WEB AUDIO ENGINE</span>
                    </span>
                    <span className="text-text-primary">{hostAudio.getAudioContext()?.state.toUpperCase() || 'OFF'}</span>
                  </div>
                  <div className="font-bold text-text-primary text-sm">
                    {hostAudio.getAudioContext()?.state === 'running' ? '48,000 HZ ACTIVE' : 'SUSPENDED'}
                  </div>
                  <div className="text-[11px] text-text-secondary">
                    Active Audio Channels: {hostAudio.getChannelNodes().size}
                  </div>
                  <div className="text-[10px] text-text-muted mt-auto pt-1 border-t border-border">
                    Crossfade Ramp: 25ms Anti-Click
                  </div>
                </div>

                <div className="p-3 bg-bg-elevated border border-border rounded-sm flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-text-muted text-[10px] uppercase font-bold">
                    <span className="flex items-center gap-1">
                      <Wifi size={12} />
                      <span>WEBRTC MESH</span>
                    </span>
                    <span className="text-text-primary">{hostAudio.getPeerConnections().size} PEERS</span>
                  </div>
                  <div className="font-bold text-text-primary text-sm">
                    DIRECT LAN UDP
                  </div>
                  <div className="text-[11px] text-text-secondary">
                    Codec: Opus 48kHz Stereo Audio
                  </div>
                  <div className="text-[10px] text-text-muted mt-auto pt-1 border-t border-border">
                    STUN / Host ICE Candidates Buffered
                  </div>
                </div>
              </div>

              {/* WebRTC Peer Connection Table */}
              <div className="bg-bg-elevated border border-border p-4 rounded-sm flex flex-col gap-3 font-mono text-xs">
                <div className="flex items-center justify-between pb-2 border-b border-border">
                  <span className="font-heading font-bold text-sm tracking-wider uppercase text-text-primary">
                    ACTIVE WEBRTC PEER CONNECTIONS ({hostAudio.getPeerConnections().size})
                  </span>
                  <span className="text-[10px] text-text-muted">REAL-TIME HARDWARE LINK STATE</span>
                </div>

                {hostAudio.getPeerConnections().size === 0 ? (
                  <div className="p-4 bg-bg-main border border-border text-center text-text-muted text-xs">
                    No active WebRTC peer connections established. Connect handsets via QR code or inject test handsets below.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-border text-[10px] text-text-muted uppercase">
                          <th className="py-2 px-2">CH / ID</th>
                          <th className="py-2 px-2">CALL SIGN</th>
                          <th className="py-2 px-2">PEER STATE</th>
                          <th className="py-2 px-2">ICE STATE</th>
                          <th className="py-2 px-2">SIGNALING</th>
                          <th className="py-2 px-2 text-right">ACTION</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40 text-[11px]">
                        {Array.from(hostAudio.getPeerConnections().entries()).map(([pId, pc]) => {
                          const p = session?.participants[pId];
                          return (
                            <tr key={pId} className="hover:bg-bg-main">
                              <td className="py-2 px-2 font-bold text-text-primary">
                                {p ? `MIC ${String(p.channelNumber).padStart(2, '0')}` : pId.substring(0, 8)}
                              </td>
                              <td className="py-2 px-2 text-text-secondary">
                                {p?.name || 'Handset Terminal'}
                              </td>
                              <td className="py-2 px-2">
                                <span className={`px-1.5 py-0.5 border text-[10px] uppercase ${
                                  pc.connectionState === 'connected'
                                    ? 'bg-text-primary text-text-inverse border-white font-bold'
                                    : 'bg-bg-main text-text-muted border-border'
                                }`}>
                                  {pc.connectionState}
                                </span>
                              </td>
                              <td className="py-2 px-2 text-text-secondary uppercase text-[10px]">
                                {pc.iceConnectionState}
                              </td>
                              <td className="py-2 px-2 text-text-secondary uppercase text-[10px]">
                                {pc.signalingState}
                              </td>
                              <td className="py-2 px-2 text-right">
                                <button
                                  onClick={() => handleKickParticipant(pId)}
                                  className="px-2 py-0.5 border border-border text-text-secondary hover:text-white hover:border-white text-[10px] uppercase"
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
              <div className="bg-bg-elevated border border-border p-4 rounded-sm flex flex-col gap-3 font-mono text-xs">
                <div className="pb-2 border-b border-border">
                  <h3 className="font-heading font-bold text-sm tracking-wider uppercase text-text-primary">
                    VIRTUAL PARTICIPANT INJECTION TEST BENCH
                  </h3>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    Inject simulated participants to test multi-microphone priority preemption and floor locking without requiring physical phones.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="p-3 bg-bg-main border border-border flex flex-col gap-2">
                    <div className="font-bold text-text-primary">ADD TEST PARTICIPANT (VIP)</div>
                    <p className="text-[11px] text-text-muted">Simulate Moderator or Stage Chair with highest priority (Score 3).</p>
                    <button
                      onClick={() => handleInjectVirtualParticipant('Stage Moderator (VIP)', 'VIP')}
                      className="mt-auto py-2 px-3 bg-text-primary text-text-inverse font-mono font-bold text-xs uppercase btn-tactile hover:bg-white/90"
                    >
                      + INJECT VIP MIC
                    </button>
                  </div>

                  <div className="p-3 bg-bg-main border border-border flex flex-col gap-2">
                    <div className="font-bold text-text-primary">ADD TEST PARTICIPANT (NORMAL)</div>
                    <p className="text-[11px] text-text-muted">Simulate audience question microphone (Score 2).</p>
                    <button
                      onClick={() => handleInjectVirtualParticipant('Audience Floor MIC', 'Normal')}
                      className="mt-auto py-2 px-3 bg-bg-secondary border border-border text-text-primary font-mono text-xs uppercase btn-tactile hover:border-text-primary"
                    >
                      + INJECT NORMAL MIC
                    </button>
                  </div>

                  <div className="p-3 bg-bg-main border border-border flex flex-col gap-2">
                    <div className="font-bold text-text-primary">ADD TEST PARTICIPANT (LOW)</div>
                    <p className="text-[11px] text-text-muted">Simulate observer microphone (Score 1).</p>
                    <button
                      onClick={() => handleInjectVirtualParticipant('Guest Observer MIC', 'Low')}
                      className="mt-auto py-2 px-3 bg-bg-secondary border border-border text-text-primary font-mono text-xs uppercase btn-tactile hover:border-text-primary"
                    >
                      + INJECT LOW MIC
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

        </main>

        {/* ===================== RIGHT-SIDE MONITORING PANEL ===================== */}
        <aside className="w-72 bg-bg-secondary border-l border-border flex flex-col p-3 gap-4 overflow-y-auto select-none">
          {/* Status Box */}
          <section className="bg-bg-elevated border border-border p-3 rounded-sm space-y-2 text-xs font-mono">
            <div className="text-[10px] text-text-muted uppercase tracking-widest font-bold pb-1 border-b border-border">
              ARBITRATION STATUS
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">Current Speaker:</span>
              <span className="font-bold text-text-primary">
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
              <span className="text-text-primary">
                {session?.isEmergencyStop ? 'MUTED (STOP)' : session?.isMuteAll ? 'MUTED (ALL)' : 'AUDIBLE'}
              </span>
            </div>
          </section>

          {/* Real-time Eligible Queue */}
          <section className="bg-bg-elevated border border-border p-3 rounded-sm space-y-2 text-xs font-mono">
            <div className="text-[10px] text-text-muted uppercase tracking-widest font-bold pb-1 border-b border-border flex justify-between">
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
                    return (
                      <div
                        key={p.id}
                        className={`flex items-center justify-between p-1.5 border text-[11px] ${
                          session?.activeSpeakerId === p.id
                            ? 'bg-text-primary text-text-inverse font-bold border-white'
                            : 'bg-bg-main text-text-secondary border-border'
                        }`}
                      >
                        <span className="truncate max-w-[120px]">
                          MIC {String(p.channelNumber).padStart(2, '0')} {p.name}
                        </span>
                        <div className="flex items-center gap-1">
                          {p.isSpeaking && !isMuted && (
                            <span className="w-1.5 h-1.5 rounded-full bg-current animate-ping" />
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
          <section className="bg-bg-elevated border border-border p-3 rounded-sm flex-1 flex flex-col text-xs font-mono">
            <div className="text-[10px] text-text-muted uppercase tracking-widest font-bold pb-1 border-b border-border mb-2 flex justify-between">
              <span>SYSTEM LOG</span>
              <span>TIME</span>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1 max-h-72">
              {(session?.recentEvents || []).map((evt) => (
                <div key={evt.id} className="text-[10px] pb-1 border-b border-border/40">
                  <div className="flex justify-between text-text-muted">
                    <span className="font-semibold text-text-primary">{evt.message}</span>
                    <span>{evt.timestamp}</span>
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
