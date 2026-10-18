import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import os from 'os';
import { 
  SessionState, 
  Participant, 
  ArbitrationConfig, 
  SelectionReason, 
  PriorityLevel,
  SystemEvent 
} from '../src/types.js';

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Helper to get local IPv4 address for QR code / LAN access
export function getLocalIp(): string {
  const interfaces = os.networkInterfaces();
  const candidates: { address: string; priority: number }[] = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const addr = iface.address;
        // Ignore APIPA link-local (169.254.x.x) and loopback
        if (addr.startsWith('169.254.') || addr.startsWith('127.')) {
          continue;
        }

        let priority = 1;
        const lowerName = name.toLowerCase();
        // Give higher priority to Wi-Fi, WLAN, or Ethernet
        if (lowerName.includes('wi-fi') || lowerName.includes('wlan') || lowerName.includes('wireless')) {
          priority = 10;
        } else if (lowerName.includes('ethernet') || lowerName.includes('eth')) {
          priority = 8;
        }

        // Standard private IPv4 ranges: 192.168.x.x, 10.x.x.x, 172.16-31.x.x
        if (addr.startsWith('192.168.') || addr.startsWith('10.') || /^172\.(1[6-9]|2\d|3[01])\./.test(addr)) {
          priority += 5;
        }

        candidates.push({ address: addr, priority });
      }
    }
  }

  candidates.sort((a, b) => b.priority - a.priority);
  return candidates.length > 0 ? candidates[0].address : '172.20.10.5';
}

const localIp = getLocalIp();
const PORT = 3001;

// Default arbitration configuration
const defaultArbitrationConfig: ArbitrationConfig = {
  silenceTimeoutMs: 1200,
  speakerLockMs: 1500,
  switchCooldownMs: 800,
  vadThreshold: 15
};

// Global session repository (keyed by sessionId)
const sessions: Record<string, SessionState> = {};

// Default initial session
const DEFAULT_SESSION_ID = 'MICRO-01';
sessions[DEFAULT_SESSION_ID] = {
  sessionId: DEFAULT_SESSION_ID,
  sessionName: 'MAIN BROADCAST STAGE',
  adminSocketId: null,
  mode: 'manual',
  activeSpeakerId: null,
  selectionReason: 'INITIAL_IDLE',
  isMuteAll: false,
  isEmergencyStop: false,
  arbitrationConfig: defaultArbitrationConfig,
  participants: {},
  recentEvents: [
    {
      id: 'evt-init',
      timestamp: new Date().toLocaleTimeString(),
      type: 'INFO',
      message: 'BROADCAST HOST INITIALIZED',
      details: `LAN Node listening on ${localIp}:${PORT}`
    }
  ]
};

function logEvent(session: SessionState, type: SystemEvent['type'], message: string, details?: string) {
  const event: SystemEvent = {
    id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    timestamp: new Date().toLocaleTimeString(),
    type,
    message,
    details
  };
  session.recentEvents.unshift(event);
  if (session.recentEvents.length > 50) {
    session.recentEvents.pop();
  }
  return event;
}

// Next available channel number generator (1 -> MIC 01, 2 -> MIC 02, etc.)
function getNextChannelNumber(session: SessionState): number {
  const used = new Set(Object.values(session.participants).map(p => p.channelNumber));
  for (let i = 1; i <= 32; i++) {
    if (!used.has(i)) return i;
  }
  return Object.keys(session.participants).length + 1;
}

// Numeric score for priority: VIP = 3, Normal = 2, Low = 1
const priorityScore: Record<PriorityLevel, number> = {
  VIP: 3,
  Normal: 2,
  Low: 1
};

// Timestamp tracking for Auto Arbitration
interface ArbitrationState {
  speakerBecameActiveAt: number;
  lastFloorChangeAt: number;
}
const sessionArbitrationState: Record<string, ArbitrationState> = {
  [DEFAULT_SESSION_ID]: {
    speakerBecameActiveAt: 0,
    lastFloorChangeAt: 0
  }
};

/**
 * AUTO MODE ARBITRATION ENGINE
 * Runs periodically to evaluate audio activity, speaker locks, priority levels, and silence timeouts.
 */
function evaluateAutoArbitration(sessionId: string) {
  const session = sessions[sessionId];
  if (!session || session.mode !== 'auto' || session.isEmergencyStop || session.isMuteAll) {
    return;
  }

  const now = Date.now();
  const arbState = sessionArbitrationState[sessionId] || {
    speakerBecameActiveAt: 0,
    lastFloorChangeAt: 0
  };

  const eligibleParticipants = Object.values(session.participants).filter(p => 
    p.state !== 'DISCONNECTED' && 
    p.state !== 'PERMISSION DENIED' && 
    !p.isMutedByAdmin && 
    !p.isMutedSelf
  );

  const currentSpeaker = session.activeSpeakerId ? session.participants[session.activeSpeakerId] : null;

  // 1. Check if current speaker went silent past silence timeout
  if (currentSpeaker) {
    const isCurrentSpeaking = currentSpeaker.isSpeaking;
    const silenceDuration = now - currentSpeaker.lastSpokeAt;

    if (!isCurrentSpeaking && silenceDuration > session.arbitrationConfig.silenceTimeoutMs) {
      // Current speaker silence timeout exceeded
      // Find another active speaker or yield floor
      const activeContenders = eligibleParticipants.filter(p => p.id !== currentSpeaker.id && p.isSpeaking);

      if (activeContenders.length > 0) {
        // Pick best contender (highest priority, then earliest joinedAt)
        activeContenders.sort((a, b) => {
          const scoreDiff = priorityScore[b.priority] - priorityScore[a.priority];
          if (scoreDiff !== 0) return scoreDiff;
          return a.joinedAt - b.joinedAt;
        });

        const nextSpeaker = activeContenders[0];
        session.activeSpeakerId = nextSpeaker.id;
        session.selectionReason = 'SILENCE_TIMEOUT';
        arbState.speakerBecameActiveAt = now;
        arbState.lastFloorChangeAt = now;

        updateParticipantStates(session);
        logEvent(session, 'ACTION', `FLOOR SWITCH -> MIC ${String(nextSpeaker.channelNumber).padStart(2, '0')}`, `Silence timeout on previous speaker (${silenceDuration}ms). New speaker: ${nextSpeaker.name}`);
        broadcastSessionState(sessionId);
        return;
      } else {
        // Floor becomes idle
        session.activeSpeakerId = null;
        session.selectionReason = 'SILENCE_TIMEOUT';
        arbState.speakerBecameActiveAt = 0;
        arbState.lastFloorChangeAt = now;

        updateParticipantStates(session);
        logEvent(session, 'INFO', `FLOOR RELEASED -> IDLE`, `Silence timeout exceeded (${silenceDuration}ms). No active speech detected.`);
        broadcastSessionState(sessionId);
        return;
      }
    }
  }

  // 2. Cooldown check: prevent rapid fluttering between speakers
  if (now - arbState.lastFloorChangeAt < session.arbitrationConfig.switchCooldownMs) {
    return;
  }

  // 3. Find speaking candidates
  const speakingContenders = eligibleParticipants.filter(p => p.isSpeaking);

  if (speakingContenders.length === 0) {
    return; // No one speaking, keep current state until silence timeout
  }

  // 4. Sort contenders by priority (descending), then earliest joinedAt
  speakingContenders.sort((a, b) => {
    const scoreDiff = priorityScore[b.priority] - priorityScore[a.priority];
    if (scoreDiff !== 0) return scoreDiff;
    return a.joinedAt - b.joinedAt;
  });

  const topContender = speakingContenders[0];

  if (!currentSpeaker) {
    // Floor was empty, grant to top contender
    session.activeSpeakerId = topContender.id;
    session.selectionReason = 'FIRST_ELIGIBLE_SPEAKER';
    arbState.speakerBecameActiveAt = now;
    arbState.lastFloorChangeAt = now;

    updateParticipantStates(session);
    logEvent(session, 'ACTION', `FLOOR GRANTED -> MIC ${String(topContender.channelNumber).padStart(2, '0')}`, `First active speech detected by ${topContender.name}`);
    broadcastSessionState(sessionId);
    return;
  }

  // If current speaker is already top contender, maintain lock
  if (currentSpeaker.id === topContender.id) {
    return;
  }

  // 5. Preemption Check: does top contender have strictly higher priority?
  const currentPriorityScore = priorityScore[currentSpeaker.priority];
  const contenderPriorityScore = priorityScore[topContender.priority];
  const speakerLockedDuration = now - arbState.speakerBecameActiveAt;

  if (contenderPriorityScore > currentPriorityScore) {
    // Higher priority preemption: allowed if speaker lock expired or current speaker is not speaking
    if (!currentSpeaker.isSpeaking || speakerLockedDuration >= session.arbitrationConfig.speakerLockMs) {
      session.activeSpeakerId = topContender.id;
      session.selectionReason = 'HIGHER_PRIORITY';
      arbState.speakerBecameActiveAt = now;
      arbState.lastFloorChangeAt = now;

      updateParticipantStates(session);
      logEvent(session, 'ACTION', `PRIORITY PREEMPTION -> MIC ${String(topContender.channelNumber).padStart(2, '0')}`, `${topContender.name} (${topContender.priority}) preempted ${currentSpeaker.name} (${currentSpeaker.priority})`);
      broadcastSessionState(sessionId);
      return;
    }
  }

  // 6. Same priority check: respect current speaker lock
  if (speakerLockedDuration < session.arbitrationConfig.speakerLockMs) {
    // Floor is locked to current speaker
    return;
  }
}

// Update all participant state flags depending on activeSpeakerId and mute status
function updateParticipantStates(session: SessionState) {
  for (const p of Object.values(session.participants)) {
    if (p.state === 'DISCONNECTED' || p.state === 'PERMISSION DENIED') continue;

    if (session.isEmergencyStop || session.isMuteAll || p.isMutedByAdmin || p.isMutedSelf) {
      p.state = 'MUTED';
    } else if (session.activeSpeakerId === p.id) {
      p.state = 'ACTIVE SPEAKER';
    } else {
      p.state = 'READY';
    }
  }
}

function broadcastSessionState(sessionId: string) {
  const session = sessions[sessionId];
  if (session) {
    io.to(sessionId).emit('session:state', session);
  }
}

// Periodic arbitration tick (every 100ms)
setInterval(() => {
  for (const sessionId of Object.keys(sessions)) {
    evaluateAutoArbitration(sessionId);
  }
}, 100);

// Active public HTTPS tunnel state (backed by heartbeat and probe verification)
interface TunnelState {
  url: string;
  lastHeartbeat: number;
  verified: boolean;
}

let activeTunnel: TunnelState | null = (process.env.TUNNEL_URL || process.env.PUBLIC_URL)
  ? { url: (process.env.TUNNEL_URL || process.env.PUBLIC_URL)!.trim().replace(/\/+$/, ''), lastHeartbeat: Date.now(), verified: true }
  : null;

// Tunnel health watchdog: auto-decommission stale tunnels if no heartbeat for 25s
setInterval(() => {
  if (activeTunnel && (Date.now() - activeTunnel.lastHeartbeat > 25000)) {
    console.log(`[MICRO PAD] Tunnel auto-expired (no heartbeat in 25s): ${activeTunnel.url}`);
    activeTunnel = null;
    io.emit('system:ip_info', {
      localIp: getLocalIp(),
      clientPort: 5173,
      tunnelUrl: null
    });
  }
}, 5000);

// Root route helper: redirects browsers accessing port 3001 directly to the Vite frontend on port 5173
app.get('/', (_req, res) => {
  const currentIp = getLocalIp();
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MICRO PAD // Broadcast Console</title>
  <meta http-equiv="refresh" content="2;url=http://${currentIp}:5173/">
  <style>
    body { background: #0c0d0e; color: #f2f5f8; font-family: 'IBM Plex Mono', monospace, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; text-align: center; }
    .card { background: #16181b; border: 2px solid #282a2e; padding: 32px; border-radius: 4px; max-width: 480px; width: 100%; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
    h1 { font-size: 20px; letter-spacing: 2px; margin-bottom: 8px; }
    p { color: #8a919e; font-size: 13px; line-height: 1.6; }
    .btn { display: inline-block; margin-top: 20px; padding: 12px 24px; background: #fff; color: #000; font-weight: bold; text-decoration: none; border: 1px solid #fff; text-transform: uppercase; letter-spacing: 1px; font-size: 12px; }
    .btn:hover { background: #e0e0e0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>MICRO PAD // BROADCAST GATEWAY</h1>
    <p>Redirecting to Control Room console...</p>
    <a class="btn" href="http://${currentIp}:5173/">OPEN CONSOLE (PORT 5173) &rarr;</a>
  </div>
</body>
</html>`);
});

// API health and info endpoints for local network discovery
app.get('/api/health', (_req, res) => {
  res.json({ status: 'OK', timestamp: Date.now() });
});

// Register or update secure public tunnel URL dynamically
app.post('/api/tunnel', (req, res) => {
  const { url } = req.body || {};
  if (typeof url === 'string' && url.trim().length > 0) {
    const cleaned = url.trim().replace(/\/+$/, '');
    activeTunnel = {
      url: cleaned,
      lastHeartbeat: Date.now(),
      verified: true
    };
    io.emit('system:ip_info', {
      localIp: getLocalIp(),
      clientPort: 5173,
      tunnelUrl: activeTunnel.url
    });
    console.log(`[MICRO PAD] Registered Secure Public Tunnel: ${activeTunnel.url}`);
  }
  res.json({ status: 'OK', tunnelUrl: activeTunnel ? activeTunnel.url : null });
});

// Heartbeat endpoint to maintain active tunnel freshness
app.post('/api/tunnel/heartbeat', (req, res) => {
  const { url } = req.body || {};
  if (typeof url === 'string' && url.trim().length > 0) {
    const cleaned = url.trim().replace(/\/+$/, '');
    if (!activeTunnel || activeTunnel.url === cleaned) {
      activeTunnel = {
        url: cleaned,
        lastHeartbeat: Date.now(),
        verified: true
      };
      return res.json({ status: 'OK', active: true });
    }
  } else if (activeTunnel) {
    activeTunnel.lastHeartbeat = Date.now();
    return res.json({ status: 'OK', active: true });
  }
  res.json({ status: 'OFFLINE', active: false });
});

// Decommission active tunnel immediately on process shutdown
app.delete('/api/tunnel', (_req, res) => {
  if (activeTunnel) {
    console.log(`[MICRO PAD] Tunnel decommissioned: ${activeTunnel.url}`);
    activeTunnel = null;
    io.emit('system:ip_info', {
      localIp: getLocalIp(),
      clientPort: 5173,
      tunnelUrl: null
    });
  }
  res.json({ status: 'OK', tunnelUrl: null });
});

// Live verification probe for candidate tunnel URL
app.get('/api/tunnel/verify', async (req, res) => {
  const candidateUrl = (req.query.url as string) || (activeTunnel ? activeTunnel.url : null);
  if (!candidateUrl) {
    return res.json({ reachable: false, error: 'NO_URL_SPECIFIED' });
  }

  try {
    const parsed = new URL(candidateUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);

    const target = `${parsed.origin}/api/health`;
    const response = await fetch(target, { signal: controller.signal });
    clearTimeout(timeout);

    if (response.ok) {
      if (activeTunnel && activeTunnel.url === parsed.origin) {
        activeTunnel.verified = true;
        activeTunnel.lastHeartbeat = Date.now();
      }
      return res.json({ reachable: true, status: response.status, url: parsed.origin });
    } else {
      return res.json({ reachable: false, status: response.status, error: `HTTP_${response.status}` });
    }
  } catch (err: any) {
    return res.json({
      reachable: false,
      error: err.name === 'AbortError' ? 'TIMEOUT_3500MS' : (err.code || err.message || 'ERR_NAME_NOT_RESOLVED')
    });
  }
});

app.get('/api/info', (_req, res) => {
  const currentIp = getLocalIp();
  res.json({
    status: 'ONLINE',
    system: 'MICRO PAD BROADCAST ENGINE',
    localIp: currentIp,
    port: PORT,
    clientPort: 5173,
    tunnelUrl: activeTunnel ? activeTunnel.url : null,
    activeSessions: Object.keys(sessions).length,
    sessions: Object.values(sessions).map(s => ({
      id: s.sessionId,
      name: s.sessionName,
      participantCount: Object.keys(s.participants).length,
      mode: s.mode,
      activeSpeaker: s.activeSpeakerId ? s.participants[s.activeSpeakerId]?.name : null
    }))
  });
});

io.on('connection', (socket: Socket) => {
  let userSessionId: string | null = null;
  let isHostAdmin = false;
  let participantId: string | null = null;

  // Immediately notify client of server LAN IP and any active tunnel URL
  socket.emit('system:ip_info', { 
    localIp: getLocalIp(),
    clientPort: 5173,
    tunnelUrl: activeTunnel ? activeTunnel.url : null
  });

  // --- HOST ADMIN REGISTRATION ---
  socket.on('admin:register', ({ sessionId, sessionName }: { sessionId: string; sessionName?: string }) => {
    userSessionId = sessionId || DEFAULT_SESSION_ID;
    isHostAdmin = true;

    if (!sessions[userSessionId]) {
      sessions[userSessionId] = {
        sessionId: userSessionId,
        sessionName: sessionName || 'BROADCAST SESSION',
        adminSocketId: socket.id,
        mode: 'manual',
        activeSpeakerId: null,
        selectionReason: 'INITIAL_IDLE',
        isMuteAll: false,
        isEmergencyStop: false,
        arbitrationConfig: defaultArbitrationConfig,
        participants: {},
        recentEvents: []
      };
      sessionArbitrationState[userSessionId] = {
        speakerBecameActiveAt: 0,
        lastFloorChangeAt: 0
      };
    } else {
      sessions[userSessionId].adminSocketId = socket.id;
      if (sessionName) sessions[userSessionId].sessionName = sessionName;
    }

    socket.join(userSessionId);
    logEvent(sessions[userSessionId], 'INFO', 'ADMIN CONSOLE CONNECTED', `Admin socket assigned: ${socket.id.substring(0, 6)}`);

    // Auto-route first ready participant if floor is empty
    if (!sessions[userSessionId].activeSpeakerId) {
      const readyP = Object.values(sessions[userSessionId].participants).find(p => p.state === 'READY');
      if (readyP) {
        sessions[userSessionId].activeSpeakerId = readyP.id;
        sessions[userSessionId].selectionReason = 'FIRST_ELIGIBLE_SPEAKER';
        logEvent(sessions[userSessionId], 'ACTION', `BUS AUTO-ENGAGED -> CH-${String(readyP.channelNumber).padStart(2, '0')}`, `${readyP.name} active on main bus`);
      }
    }

    updateParticipantStates(sessions[userSessionId]);
    socket.emit('session:state', sessions[userSessionId]);
    socket.emit('system:ip_info', { localIp, clientPort: 5173, tunnelUrl: activeTunnel ? activeTunnel.url : null });
  });

  // --- PARTICIPANT JOIN ---
  socket.on('participant:join', ({ 
    sessionId, 
    name, 
    priority, 
    channelNumber: reqChannel 
  }: { 
    sessionId: string; 
    name: string; 
    priority?: PriorityLevel;
    channelNumber?: number;
  }) => {
    userSessionId = sessionId || DEFAULT_SESSION_ID;
    participantId = socket.id;

    if (!sessions[userSessionId]) {
      // Auto-create session if participant arrives first
      sessions[userSessionId] = {
        sessionId: userSessionId,
        sessionName: 'EVENT STAGE',
        adminSocketId: null,
        mode: 'manual',
        activeSpeakerId: null,
        selectionReason: 'INITIAL_IDLE',
        isMuteAll: false,
        isEmergencyStop: false,
        arbitrationConfig: defaultArbitrationConfig,
        participants: {},
        recentEvents: []
      };
      sessionArbitrationState[userSessionId] = {
        speakerBecameActiveAt: 0,
        lastFloorChangeAt: 0
      };
    }

    const session = sessions[userSessionId];
    let channelNumber: number;
    const requestedChannel = reqChannel ? Number(reqChannel) : undefined;
    const usedChannels = new Set(Object.values(session.participants).map(p => p.channelNumber));
    if (requestedChannel && !usedChannels.has(requestedChannel)) {
      channelNumber = requestedChannel;
    } else {
      channelNumber = getNextChannelNumber(session);
    }

    const participant: Participant = {
      id: socket.id,
      channelNumber,
      name: name.trim() || `MIC ${String(channelNumber).padStart(2, '0')}`,
      state: 'CONNECTING',
      priority: priority || 'Normal',
      isMutedByAdmin: false,
      isMutedSelf: false,
      audioLevel: 0,
      isSpeaking: false,
      joinedAt: Date.now(),
      lastSpokeAt: 0
    };

    session.participants[socket.id] = participant;
    socket.join(userSessionId);

    logEvent(session, 'INFO', `NEW MIC ONLINE -> CH-${String(channelNumber).padStart(2, '0')}`, `${participant.name} joined as priority ${participant.priority}`);
    
    // Notify participant of their assigned channel
    socket.emit('participant:assigned', participant);

    // Notify host to establish WebRTC peer connection
    if (session.adminSocketId) {
      io.to(session.adminSocketId).emit('webrtc:peer_joined', { participantId: socket.id });
    }

    updateParticipantStates(session);
    broadcastSessionState(userSessionId);
  });

  // --- PARTICIPANT PERMISSION / READY STATUS ---
  socket.on('participant:status', ({ state }: { state: Participant['state'] }) => {
    if (userSessionId && participantId && sessions[userSessionId]?.participants[participantId]) {
      const session = sessions[userSessionId];
      const p = session.participants[participantId];
      p.state = state;

      // Auto-route first ready mic if no speaker is selected yet
      if (!session.activeSpeakerId && state === 'READY') {
        session.activeSpeakerId = p.id;
        session.selectionReason = 'FIRST_ELIGIBLE_SPEAKER';
        logEvent(session, 'ACTION', `BUS AUTO-ENGAGED -> CH-${String(p.channelNumber).padStart(2, '0')}`, `${p.name} active on main bus`);
      }

      updateParticipantStates(session);
      broadcastSessionState(userSessionId);
    }
  });

  // --- REAL-TIME AUDIO TELEMETRY (VAD & LEVEL METER) ---
  socket.on('participant:telemetry', ({ audioLevel, isSpeaking }: { audioLevel: number; isSpeaking: boolean }) => {
    if (userSessionId && participantId && sessions[userSessionId]?.participants[participantId]) {
      const p = sessions[userSessionId].participants[participantId];
      p.audioLevel = Math.min(100, Math.max(0, audioLevel));
      
      const prevSpeaking = p.isSpeaking;
      p.isSpeaking = isSpeaking && !p.isMutedByAdmin && !p.isMutedSelf && !sessions[userSessionId].isMuteAll && !sessions[userSessionId].isEmergencyStop;

      if (p.isSpeaking) {
        p.lastSpokeAt = Date.now();
      }

      // Fast broadcast audio meter to admin console for smooth VU meter needle
      const adminId = sessions[userSessionId].adminSocketId;
      if (adminId) {
        io.to(adminId).emit('participant:audio_meter', {
          id: p.id,
          channelNumber: p.channelNumber,
          level: p.audioLevel,
          isSpeaking: p.isSpeaking
        });
      }

      // Instantaneous auto-arbitration evaluation on speech state change
      if (sessions[userSessionId].mode === 'auto' && prevSpeaking !== p.isSpeaking) {
        evaluateAutoArbitration(userSessionId);
      }
    }
  });

  // --- WEBRTC SIGNALING (OFFER, ANSWER, ICE CANDIDATES) ---
  socket.on('webrtc:signal', ({ to, sessionId, signal, type }: { to?: string; sessionId?: string; signal: any; type: string }) => {
    let target = to;
    const sessId = sessionId || userSessionId;
    if (!target && sessId && sessions[sessId]?.adminSocketId) {
      target = sessions[sessId].adminSocketId!;
    }
    if (target) {
      io.to(target).emit('webrtc:signal', {
        from: socket.id,
        signal,
        type
      });
    }
  });

  // --- ADMIN COMMAND: EXCLUSIVE MIC SELECTION (MIC 01, MIC 02, etc.) ---
  socket.on('admin:select_mic', ({ participantId: targetId }: { participantId: string | null }) => {
    if (!userSessionId || !sessions[userSessionId]) return;
    const session = sessions[userSessionId];

    session.activeSpeakerId = targetId;
    session.selectionReason = targetId ? 'MANUAL_SELECTION' : 'INITIAL_IDLE';

    const target = targetId ? session.participants[targetId] : null;
    const label = target ? `MIC ${String(target.channelNumber).padStart(2, '0')} (${target.name})` : 'NONE (MUTE OUT)';
    logEvent(session, 'ACTION', `ROUTING SWITCH -> ${label}`, 'Manual admin selection executed');

    updateParticipantStates(session);
    broadcastSessionState(userSessionId);
  });

  // --- ADMIN COMMAND: SWITCH MANUAL / AUTO MODE ---
  socket.on('admin:set_mode', ({ mode }: { mode: 'manual' | 'auto' }) => {
    if (!userSessionId || !sessions[userSessionId]) return;
    const session = sessions[userSessionId];
    session.mode = mode;
    logEvent(session, 'ACTION', `SYSTEM MODE SET -> ${mode.toUpperCase()}`, `Arbitration engine ${mode === 'auto' ? 'ENGAGED' : 'DISENGAGED'}`);
    
    if (mode === 'manual' && session.activeSpeakerId) {
      session.selectionReason = 'MANUAL_SELECTION';
    }
    
    broadcastSessionState(userSessionId);
  });

  // --- ADMIN COMMAND: MUTE SPECIFIC PARTICIPANT ---
  socket.on('admin:mute_participant', ({ participantId: targetId, muted }: { participantId: string; muted: boolean }) => {
    if (!userSessionId || !sessions[userSessionId]) return;
    const session = sessions[userSessionId];
    const target = session.participants[targetId];
    if (target) {
      target.isMutedByAdmin = muted;
      logEvent(session, 'ACTION', `MIC ${String(target.channelNumber).padStart(2, '0')} ${muted ? 'MUTED' : 'UNMUTED'}`, `By Admin`);

      updateParticipantStates(session);
      broadcastSessionState(userSessionId);
    }
  });

  // --- ADMIN COMMAND: MUTE ALL ---
  socket.on('admin:mute_all', ({ isMuteAll }: { isMuteAll: boolean }) => {
    if (!userSessionId || !sessions[userSessionId]) return;
    const session = sessions[userSessionId];
    session.isMuteAll = isMuteAll;
    logEvent(session, 'WARN', isMuteAll ? 'MUTE-ALL ENGAGED' : 'MUTE-ALL RELEASED', 'All audio lines clamped');

    updateParticipantStates(session);
    broadcastSessionState(userSessionId);
  });

  // --- ADMIN COMMAND: EMERGENCY STOP ---
  socket.on('admin:emergency_stop', ({ isEmergencyStop }: { isEmergencyStop: boolean }) => {
    if (!userSessionId || !sessions[userSessionId]) return;
    const session = sessions[userSessionId];
    session.isEmergencyStop = isEmergencyStop;
    logEvent(session, 'WARN', isEmergencyStop ? 'EMERGENCY AUDIO STOP ACTIVE' : 'EMERGENCY STOP CLEARED', 'Hard audio cut activated');

    if (isEmergencyStop) {
      session.activeSpeakerId = null;
    }

    updateParticipantStates(session);
    broadcastSessionState(userSessionId);
  });

  // --- ADMIN COMMAND: SET PRIORITY ---
  socket.on('admin:set_priority', ({ participantId: targetId, priority }: { participantId: string; priority: PriorityLevel }) => {
    if (!userSessionId || !sessions[userSessionId]) return;
    const session = sessions[userSessionId];
    const target = session.participants[targetId];
    if (target) {
      target.priority = priority;
      logEvent(session, 'ACTION', `PRIORITY CHANGED -> MIC ${String(target.channelNumber).padStart(2, '0')}`, `Set to ${priority}`);
      broadcastSessionState(userSessionId);
    }
  });

  // --- ADMIN COMMAND: UPDATE ARBITRATION CONFIG ---
  socket.on('admin:update_config', (config: Partial<ArbitrationConfig>) => {
    if (!userSessionId || !sessions[userSessionId]) return;
    const session = sessions[userSessionId];
    session.arbitrationConfig = { ...session.arbitrationConfig, ...config };
    logEvent(session, 'ACTION', 'ARBITRATION CONFIG UPDATED', JSON.stringify(session.arbitrationConfig));
    broadcastSessionState(userSessionId);
  });

  // --- ADMIN COMMAND: KICK PARTICIPANT ---
  socket.on('admin:kick_participant', ({ participantId: targetId }: { participantId: string }) => {
    if (!userSessionId || !sessions[userSessionId]) return;
    const session = sessions[userSessionId];
    const target = session.participants[targetId];
    if (target) {
      logEvent(session, 'WARN', `DISCONNECTED MIC ${String(target.channelNumber).padStart(2, '0')}`, `${target.name} removed by admin`);
      io.to(targetId).emit('participant:kicked');
      delete session.participants[targetId];
      if (session.activeSpeakerId === targetId) {
        session.activeSpeakerId = null;
      }
      updateParticipantStates(session);
      broadcastSessionState(userSessionId);
    }
  });

  // --- PARTICIPANT SELF-MUTE ---
  socket.on('participant:self_mute', ({ isMuted }: { isMuted: boolean }) => {
    if (userSessionId && participantId && sessions[userSessionId]?.participants[participantId]) {
      const p = sessions[userSessionId].participants[participantId];
      p.isMutedSelf = isMuted;

      updateParticipantStates(sessions[userSessionId]);
      broadcastSessionState(userSessionId);
    }
  });

  // --- DISCONNECT ---
  socket.on('disconnect', () => {
    if (userSessionId && sessions[userSessionId]) {
      const session = sessions[userSessionId];

      if (isHostAdmin) {
        logEvent(session, 'WARN', 'ADMIN HOST DISCONNECTED', `Admin socket closed`);
        session.adminSocketId = null;
      } else if (participantId && session.participants[participantId]) {
        const p = session.participants[participantId];
        logEvent(session, 'WARN', `MIC OFFLINE -> CH-${String(p.channelNumber).padStart(2, '0')}`, `${p.name} disconnected`);
        
        if (session.activeSpeakerId === participantId) {
          session.activeSpeakerId = null;
          session.selectionReason = 'INITIAL_IDLE';
        }

        delete session.participants[participantId];
        updateParticipantStates(session);
        broadcastSessionState(userSessionId);
      }
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================================`);
  console.log(`[MICRO PAD] BROADCAST SYSTEM READY // RETRO HARDWARE CONSOLE`);
  console.log(`======================================================================`);
  console.log(`1. HOST CONTROL ROOM (Laptop):`);
  console.log(`   ➜ http://localhost:5173/`);
  console.log(`\n2. MOBILE PARTICIPANTS (Scan QR or open directly on phone):`);
  console.log(`   ➜ http://${localIp}:5173/`);
  console.log(`\n3. BACKEND SIGNALING & ARBITRATION SERVER:`);
  console.log(`   ➜ http://${localIp}:${PORT}/`);
  if (activeTunnel) {
    console.log(`\n4. PUBLIC SECURE TUNNEL (Zero Warning for iOS / Android):`);
    console.log(`   ➜ ${activeTunnel.url}`);
  }
  console.log(`\nℹ NETWORK / HOTSPOT ADVISORY:`);
  console.log(`   • Phone and laptop must be on the same Wi-Fi / Hotspot.`);
  console.log(`   • In Windows Settings > Network > Wi-Fi, ensure your hotspot is`);
  console.log(`     set to "Private network" so Windows Firewall allows LAN connections.`);
  console.log(`   • For automated zero-warning access without firewall changes: npm run dev:tunnel`);
  console.log(`======================================================================\n`);
});
