// Unit tests for Micro Pad Audio Arbitration & Exclusive Routing Engine
import { 
  SessionState, 
  Participant, 
  ArbitrationConfig, 
  SelectionReason, 
  PriorityLevel 
} from '../src/types.js';

interface ArbitrationState {
  speakerBecameActiveAt: number;
  lastFloorChangeAt: number;
}

const priorityScore: Record<PriorityLevel, number> = {
  VIP: 3,
  Normal: 2,
  Low: 1
};

export function evaluateAutoArbitration(
  session: SessionState,
  arbState: ArbitrationState,
  currentTime: number
): { session: SessionState; arbState: ArbitrationState; changed: boolean } {
  if (session.mode !== 'auto' || session.isEmergencyStop || session.isMuteAll) {
    return { session, arbState, changed: false };
  }

  const eligible = Object.values(session.participants).filter(p => 
    p.state !== 'DISCONNECTED' && 
    p.state !== 'PERMISSION DENIED' && 
    !p.isMutedByAdmin && 
    !p.isMutedSelf
  );

  const currentSpeaker = session.activeSpeakerId ? session.participants[session.activeSpeakerId] : null;

  // 1. Silence timeout check
  if (currentSpeaker) {
    const isSpeaking = currentSpeaker.isSpeaking;
    const silenceDuration = currentTime - currentSpeaker.lastSpokeAt;

    if (!isSpeaking && silenceDuration > session.arbitrationConfig.silenceTimeoutMs) {
      const activeContenders = eligible.filter(p => p.id !== currentSpeaker.id && p.isSpeaking);

      if (activeContenders.length > 0) {
        activeContenders.sort((a, b) => {
          const scoreDiff = priorityScore[b.priority] - priorityScore[a.priority];
          if (scoreDiff !== 0) return scoreDiff;
          return a.joinedAt - b.joinedAt;
        });

        session.activeSpeakerId = activeContenders[0].id;
        session.selectionReason = 'SILENCE_TIMEOUT';
        arbState.speakerBecameActiveAt = currentTime;
        arbState.lastFloorChangeAt = currentTime;
        return { session, arbState, changed: true };
      } else {
        session.activeSpeakerId = null;
        session.selectionReason = 'SILENCE_TIMEOUT';
        arbState.speakerBecameActiveAt = 0;
        arbState.lastFloorChangeAt = currentTime;
        return { session, arbState, changed: true };
      }
    }
  }

  // 2. Cooldown check
  if (currentTime - arbState.lastFloorChangeAt < session.arbitrationConfig.switchCooldownMs) {
    return { session, arbState, changed: false };
  }

  // 3. Speaking contenders
  const speakingContenders = eligible.filter(p => p.isSpeaking);
  if (speakingContenders.length === 0) {
    return { session, arbState, changed: false };
  }

  // 4. Sort by priority, then earliest joinedAt
  speakingContenders.sort((a, b) => {
    const scoreDiff = priorityScore[b.priority] - priorityScore[a.priority];
    if (scoreDiff !== 0) return scoreDiff;
    return a.joinedAt - b.joinedAt;
  });

  const topContender = speakingContenders[0];

  if (!currentSpeaker) {
    session.activeSpeakerId = topContender.id;
    session.selectionReason = 'FIRST_ELIGIBLE_SPEAKER';
    arbState.speakerBecameActiveAt = currentTime;
    arbState.lastFloorChangeAt = currentTime;
    return { session, arbState, changed: true };
  }

  if (currentSpeaker.id === topContender.id) {
    return { session, arbState, changed: false };
  }

  // 5. Preemption check
  const currentScore = priorityScore[currentSpeaker.priority];
  const contenderScore = priorityScore[topContender.priority];
  const speakerLockedDuration = currentTime - arbState.speakerBecameActiveAt;

  if (contenderScore > currentScore) {
    if (!currentSpeaker.isSpeaking || speakerLockedDuration >= session.arbitrationConfig.speakerLockMs) {
      session.activeSpeakerId = topContender.id;
      session.selectionReason = 'HIGHER_PRIORITY';
      arbState.speakerBecameActiveAt = currentTime;
      arbState.lastFloorChangeAt = currentTime;
      return { session, arbState, changed: true };
    }
  }

  return { session, arbState, changed: false };
}

function runTests() {
  console.log('=== [MICRO PAD] STARTING ARBITRATION TEST SUITE ===');
  let passed = 0;
  let total = 0;

  function assert(condition: boolean, desc: string) {
    total++;
    if (condition) {
      console.log(`[PASS] ${desc}`);
      passed++;
    } else {
      console.error(`[FAIL] ${desc}`);
      process.exitCode = 1;
    }
  }

  const baseConfig: ArbitrationConfig = {
    silenceTimeoutMs: 1200,
    speakerLockMs: 1500,
    switchCooldownMs: 800,
    vadThreshold: 15
  };

  const createParticipant = (id: string, name: string, priority: PriorityLevel, channel: number, joinedAt = 1000): Participant => ({
    id,
    name,
    channelNumber: channel,
    state: 'READY',
    priority,
    isMutedByAdmin: false,
    isMutedSelf: false,
    audioLevel: 0,
    isSpeaking: false,
    joinedAt,
    lastSpokeAt: 0
  });

  // TEST 1: First eligible speaker floor grant
  {
    const session: SessionState = {
      sessionId: 'TEST-1',
      sessionName: 'Test',
      adminSocketId: 'admin-1',
      mode: 'auto',
      activeSpeakerId: null,
      selectionReason: 'INITIAL_IDLE',
      isMuteAll: false,
      isEmergencyStop: false,
      arbitrationConfig: baseConfig,
      participants: {
        'p1': { ...createParticipant('p1', 'Speaker 1', 'Normal', 1), isSpeaking: true }
      },
      recentEvents: []
    };
    const arbState: ArbitrationState = { speakerBecameActiveAt: 0, lastFloorChangeAt: 0 };
    const res = evaluateAutoArbitration(session, arbState, 2000);
    assert(res.session.activeSpeakerId === 'p1', 'Auto mode grants floor to first eligible speaker');
    assert(res.session.selectionReason === 'FIRST_ELIGIBLE_SPEAKER', 'Selection reason is FIRST_ELIGIBLE_SPEAKER');
  }

  // TEST 2: Higher priority preemption
  {
    const session: SessionState = {
      sessionId: 'TEST-2',
      sessionName: 'Test',
      adminSocketId: 'admin-1',
      mode: 'auto',
      activeSpeakerId: 'p1',
      selectionReason: 'FIRST_ELIGIBLE_SPEAKER',
      isMuteAll: false,
      isEmergencyStop: false,
      arbitrationConfig: baseConfig,
      participants: {
        'p1': { ...createParticipant('p1', 'Speaker 1', 'Normal', 1), isSpeaking: true, lastSpokeAt: 2000 },
        'p2': { ...createParticipant('p2', 'VIP Chair', 'VIP', 2), isSpeaking: true, lastSpokeAt: 4000 }
      },
      recentEvents: []
    };
    // Speaker lock expired (became active at 1000, current time 3000, lock 1500ms)
    const arbState: ArbitrationState = { speakerBecameActiveAt: 1000, lastFloorChangeAt: 1000 };
    const res = evaluateAutoArbitration(session, arbState, 3000);
    assert(res.session.activeSpeakerId === 'p2', 'VIP participant preempts Normal priority participant');
    assert(res.session.selectionReason === 'HIGHER_PRIORITY', 'Selection reason is HIGHER_PRIORITY');
  }

  // TEST 3: Speaker lock prevents premature preemption
  {
    const session: SessionState = {
      sessionId: 'TEST-3',
      sessionName: 'Test',
      adminSocketId: 'admin-1',
      mode: 'auto',
      activeSpeakerId: 'p1',
      selectionReason: 'FIRST_ELIGIBLE_SPEAKER',
      isMuteAll: false,
      isEmergencyStop: false,
      arbitrationConfig: baseConfig,
      participants: {
        'p1': { ...createParticipant('p1', 'Speaker 1', 'Normal', 1), isSpeaking: true, lastSpokeAt: 1000 },
        'p2': { ...createParticipant('p2', 'Speaker 2', 'VIP', 2), isSpeaking: true, lastSpokeAt: 1200 }
      },
      recentEvents: []
    };
    // Active since 1000, current time 1300 (< 1500ms speakerLockMs)
    const arbState: ArbitrationState = { speakerBecameActiveAt: 1000, lastFloorChangeAt: 1000 };
    const res = evaluateAutoArbitration(session, arbState, 1300);
    assert(res.session.activeSpeakerId === 'p1', 'Speaker lock holds floor against higher priority when still speaking');
  }

  // TEST 4: Silence timeout yields floor to idle
  {
    const session: SessionState = {
      sessionId: 'TEST-4',
      sessionName: 'Test',
      adminSocketId: 'admin-1',
      mode: 'auto',
      activeSpeakerId: 'p1',
      selectionReason: 'FIRST_ELIGIBLE_SPEAKER',
      isMuteAll: false,
      isEmergencyStop: false,
      arbitrationConfig: baseConfig,
      participants: {
        'p1': { ...createParticipant('p1', 'Speaker 1', 'Normal', 1), isSpeaking: false, lastSpokeAt: 1000 }
      },
      recentEvents: []
    };
    // Current time 2500 (silence duration 1500ms > 1200ms silenceTimeoutMs)
    const arbState: ArbitrationState = { speakerBecameActiveAt: 1000, lastFloorChangeAt: 1000 };
    const res = evaluateAutoArbitration(session, arbState, 2500);
    assert(res.session.activeSpeakerId === null, 'Floor yielded to null after silence timeout');
    assert(res.session.selectionReason === 'SILENCE_TIMEOUT', 'Reason recorded as SILENCE_TIMEOUT');
  }

  // TEST 5: Simultaneous speech tie-breaking (FIFO by joinedAt)
  {
    const session: SessionState = {
      sessionId: 'TEST-5',
      sessionName: 'Test',
      adminSocketId: 'admin-1',
      mode: 'auto',
      activeSpeakerId: null,
      selectionReason: 'INITIAL_IDLE',
      isMuteAll: false,
      isEmergencyStop: false,
      arbitrationConfig: baseConfig,
      participants: {
        'p1': { ...createParticipant('p1', 'Speaker 1', 'Normal', 1, 1000), isSpeaking: true },
        'p2': { ...createParticipant('p2', 'Speaker 2', 'Normal', 2, 1200), isSpeaking: true }
      },
      recentEvents: []
    };
    const arbState: ArbitrationState = { speakerBecameActiveAt: 0, lastFloorChangeAt: 0 };
    const res = evaluateAutoArbitration(session, arbState, 2000);
    assert(res.session.activeSpeakerId === 'p1', 'Deterministic tie-break favors earlier connected participant');
  }

  // TEST 6: Emergency Stop and Mute All clamp audio
  {
    const session: SessionState = {
      sessionId: 'TEST-6',
      sessionName: 'Test',
      adminSocketId: 'admin-1',
      mode: 'auto',
      activeSpeakerId: 'p1',
      selectionReason: 'FIRST_ELIGIBLE_SPEAKER',
      isMuteAll: false,
      isEmergencyStop: true, // Emergency Stop active
      arbitrationConfig: baseConfig,
      participants: {
        'p1': { ...createParticipant('p1', 'Speaker 1', 'VIP', 1), isSpeaking: true }
      },
      recentEvents: []
    };
    const arbState: ArbitrationState = { speakerBecameActiveAt: 1000, lastFloorChangeAt: 1000 };
    const res = evaluateAutoArbitration(session, arbState, 2000);
    assert(res.changed === false, 'Emergency stop inhibits any arbitration changes');
  }

  console.log(`=== TEST SUMMARY: ${passed}/${total} PASSED ===`);
}

runTests();
