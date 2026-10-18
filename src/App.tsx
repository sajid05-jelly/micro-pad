import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { AdminControlRoom } from './components/AdminControlRoom.js';
import { ParticipantMobile } from './components/ParticipantMobile.js';
import { JoinPage } from './components/JoinPage.js';
import { HostAudioEngine } from './audio/HostAudioEngine.js';
import { PriorityLevel } from './types.js';

// Mobile device detection helper (iPhone, Android, tablets, or small viewport)
const isMobileDevice = (): boolean => {
  if (typeof window === 'undefined') return false;
  return (
    /iPhone|iPad|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    window.innerWidth < 768
  );
};

// Initial state resolver based on device and URL parameters
const getInitialState = () => {
  if (typeof window === 'undefined') {
    return {
      role: 'admin' as const,
      sessionId: 'MICRO-01',
      participantName: '',
      assignedChannel: undefined as number | undefined,
      assignedMicLabel: undefined as string | undefined
    };
  }

  const params = new URLSearchParams(window.location.search);
  const paramSession = params.get('session');
  const paramRole = params.get('role');
  const paramName = params.get('name');
  const paramChannel = params.get('channel');
  const paramMic = params.get('mic');

  const sessionId = paramSession ? paramSession.toUpperCase() : 'MICRO-01';
  const participantName = paramName || '';
  const assignedChannel = paramChannel ? parseInt(paramChannel, 10) : undefined;
  const assignedMicLabel = paramMic || (assignedChannel ? `MIC 0${assignedChannel}` : undefined);

  let role: 'admin' | 'mic' | 'join';
  if (paramRole === 'mic') {
    role = paramName ? 'mic' : 'join';
  } else if (paramRole === 'join') {
    role = 'join';
  } else if (paramRole === 'admin') {
    role = 'admin';
  } else if (window.location.pathname.startsWith('/join')) {
    role = 'join';
  } else if (isMobileDevice()) {
    role = 'join';
  } else {
    role = 'admin';
  }

  return { role, sessionId, participantName, assignedChannel, assignedMicLabel };
};

export default function App() {
  const [initial] = useState(getInitialState);
  const [role, setRole] = useState<'admin' | 'mic' | 'join'>(initial.role);
  const [sessionId, setSessionId] = useState<string>(initial.sessionId);
  const [participantName, setParticipantName] = useState<string>(initial.participantName);
  const [assignedChannel, setAssignedChannel] = useState<number | undefined>(initial.assignedChannel);
  const [assignedMicLabel, setAssignedMicLabel] = useState<string | undefined>(initial.assignedMicLabel);

  const [participantStream, setParticipantStream] = useState<MediaStream | null>(null);

  const [localIp, setLocalIp] = useState<string>('localhost');
  const [tunnelUrl, setTunnelUrl] = useState<string | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR'>('CONNECTING');
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const hostAudioRef = useRef<HostAudioEngine>(new HostAudioEngine());
  const socketRef = useRef<Socket | null>(null);

  // Listen to popstate or browser navigation changes
  useEffect(() => {
    const handleUrlChange = () => {
      const state = getInitialState();
      setRole(state.role);
      setSessionId(state.sessionId);
      if (state.participantName) setParticipantName(state.participantName);
      setAssignedChannel(state.assignedChannel);
      setAssignedMicLabel(state.assignedMicLabel);
    };

    window.addEventListener('popstate', handleUrlChange);
    return () => window.removeEventListener('popstate', handleUrlChange);
  }, []);

  // Fetch local LAN network IP & tunnel URL from backend server (Relative URL prevents mixed-content errors)
  useEffect(() => {
    fetch('/api/info')
      .then(res => res.json())
      .then(data => {
        if (data.localIp && data.localIp !== 'localhost' && !data.localIp.startsWith('169.254.')) {
          setLocalIp(data.localIp);
        }
        if (data.tunnelUrl) {
          setTunnelUrl(data.tunnelUrl);
        }
      })
      .catch(err => {
        console.warn('Could not reach /api/info endpoint:', err);
      });
  }, []);

  // Initialize and manage Socket.IO connection
  const initSocket = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.close();
    }

    setConnectionStatus('CONNECTING');
    setConnectionError(null);

    // Socket.IO connects to the exact same origin as the page to prevent any CORS or mixed-content blocks
    const newSocket = io(window.location.origin, {
      path: '/socket.io',
      reconnectionAttempts: 15,
      reconnectionDelay: 1500,
      timeout: 6000,
      transports: ['polling', 'websocket']
    });

    socketRef.current = newSocket;
    setSocket(newSocket);

    newSocket.on('connect', () => {
      setConnectionStatus('CONNECTED');
      setConnectionError(null);
    });

    newSocket.on('disconnect', (reason) => {
      setConnectionStatus('DISCONNECTED');
      setConnectionError(`Connection interrupted (${reason})`);
    });

    newSocket.on('connect_error', (err) => {
      setConnectionStatus('ERROR');
      setConnectionError(err.message || 'Could not connect to PA broadcast host. Tap Retry.');
    });

    newSocket.io.on('reconnect_attempt', () => {
      setConnectionStatus('CONNECTING');
    });

    newSocket.io.on('reconnect_failed', () => {
      setConnectionStatus('ERROR');
      setConnectionError('Broadcast host unreachable. Please verify Wi-Fi connection.');
    });

    newSocket.on('system:ip_info', ({ localIp: newIp, tunnelUrl: newTunnel }: { localIp: string; tunnelUrl?: string }) => {
      if (newIp && newIp !== 'localhost' && !newIp.startsWith('169.254.')) {
        setLocalIp(newIp);
      }
      if (newTunnel) {
        setTunnelUrl(newTunnel);
      }
    });

    return newSocket;
  }, []);

  useEffect(() => {
    const s = initSocket();

    // Fallback timeout: If still connecting after 5 seconds, signal error with clear retry option
    const timer = setTimeout(() => {
      if (!s.connected) {
        setConnectionStatus((curr) => {
          if (curr === 'CONNECTING') {
            setConnectionError('Host link timed out. If on local Wi-Fi, ensure device is on the same network. If using Secure Tunnel, verify tunnel URL.');
            return 'ERROR';
          }
          return curr;
        });
      }
    }, 5000);

    return () => {
      clearTimeout(timer);
      s.close();
    };
  }, [initSocket]);

  const handleRetryConnection = useCallback(() => {
    initSocket();
  }, [initSocket]);

  // Register on socket when role and socket are ready
  useEffect(() => {
    if (!socket || connectionStatus !== 'CONNECTED') return;

    if (role === 'admin') {
      socket.emit('admin:register', {
        sessionId,
        sessionName: 'MAIN BROADCAST STAGE'
      });
    } else if (role === 'mic' && participantName) {
      socket.emit('participant:join', {
        sessionId,
        name: participantName,
        priority: 'Normal',
        channelNumber: assignedChannel
      });
    }
  }, [socket, connectionStatus, role, sessionId, participantName, assignedChannel]);

  const handleJoinFromPage = (
    targetSession: string,
    name: string,
    priority: PriorityLevel,
    channelNumber?: number,
    stream?: MediaStream
  ) => {
    setSessionId(targetSession);
    setParticipantName(name);
    const chosenChannel = channelNumber ?? assignedChannel;
    setAssignedChannel(chosenChannel);

    if (stream) {
      setParticipantStream(stream);
    }

    setRole('mic');

    if (socket && socket.connected) {
      socket.emit('participant:join', {
        sessionId: targetSession,
        name,
        priority,
        channelNumber: chosenChannel
      });
    }
  };

  const handleLeaveSession = () => {
    if (participantStream) {
      participantStream.getTracks().forEach(t => t.stop());
      setParticipantStream(null);
    }
    setRole('join');
    // Clear URL parameters
    window.history.replaceState({}, '', window.location.pathname);
  };

  return (
    <div className="w-full min-h-screen bg-bg-main text-text-primary">
      {role === 'admin' ? (
        <AdminControlRoom
          socket={socket}
          sessionId={sessionId}
          localIp={localIp}
          tunnelUrl={tunnelUrl}
          hostAudio={hostAudioRef.current}
        />
      ) : role === 'mic' ? (
        <ParticipantMobile
          socket={socket}
          sessionId={sessionId}
          initialParticipantName={participantName}
          initialStream={participantStream}
          connectionStatus={connectionStatus}
          connectionError={connectionError}
          onRetryConnection={handleRetryConnection}
          onLeave={handleLeaveSession}
        />
      ) : (
        <JoinPage
          initialSessionId={sessionId}
          assignedChannel={assignedChannel}
          assignedMicLabel={assignedMicLabel}
          connectionStatus={connectionStatus}
          connectionError={connectionError}
          onRetryConnection={handleRetryConnection}
          onJoin={handleJoinFromPage}
          onOpenAdmin={() => setRole('admin')}
        />
      )}
    </div>
  );
}
