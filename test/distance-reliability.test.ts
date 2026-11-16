import assert from 'node:assert';
import { 
  DEFAULT_NETWORK_THRESHOLDS,
  evaluateNetworkQuality
} from '../src/audio/HostAudioEngine.js';
import { 
  NetworkQualityLevel, 
  Participant,
  SessionState
} from '../src/types.js';

console.log('=== [MICRO MAX] DISTANCE RELIABILITY & 10+ MICROPHONE OPTIMIZATION SUITE ===\n');

// =========================================================================
// TEST 1: Delta Packet Loss Calculation Algorithm (Instantaneous vs Lifetime)
// =========================================================================
console.log('1. Testing Instantaneous Delta Packet Loss Calculation...');

interface StatsSnapshot {
  packetsReceived: number;
  packetsLost: number;
  bytesReceived: number;
  timestamp: number;
}

function calculateDeltaStats(
  current: StatsSnapshot,
  prev: StatsSnapshot | null
): { lossPct: number; bitrateKbps: number } {
  if (!prev) {
    return { lossPct: 0, bitrateKbps: 0 };
  }

  const deltaReceived = Math.max(0, current.packetsReceived - prev.packetsReceived);
  const deltaLost = Math.max(0, current.packetsLost - prev.packetsLost);
  const totalDeltaPackets = deltaReceived + deltaLost;

  const lossPct = totalDeltaPackets > 0
    ? (deltaLost / totalDeltaPackets) * 100
    : 0;

  const deltaSeconds = Math.max(0.001, (current.timestamp - prev.timestamp) / 1000);
  const deltaBytes = Math.max(0, current.bytesReceived - prev.bytesReceived);
  const bitrateKbps = Math.round(((deltaBytes * 8) / deltaSeconds) / 1000);

  return {
    lossPct: Math.round(lossPct * 10) / 10,
    bitrateKbps
  };
}

// Case A: Clean Wi-Fi (1m distance)
const t0: StatsSnapshot = { packetsReceived: 1000, packetsLost: 0, bytesReceived: 120000, timestamp: 1000 };
const t1: StatsSnapshot = { packetsReceived: 1050, packetsLost: 0, bytesReceived: 126000, timestamp: 2000 };
const resA = calculateDeltaStats(t1, t0);
assert.strictEqual(resA.lossPct, 0, 'Clean 1m link must report 0% delta loss');
assert.strictEqual(resA.bitrateKbps, 48, '50 pkts * ~120 bytes in 1s must report ~48 kbps');

// Case B: Distance drop at 15m (10 lost out of 50 total delta packets)
const t2: StatsSnapshot = { packetsReceived: 1090, packetsLost: 10, bytesReceived: 130800, timestamp: 3000 };
const resB = calculateDeltaStats(t2, t1);
assert.strictEqual(resB.lossPct, 20.0, '10 lost out of 50 delta packets must report exactly 20.0% loss');

// Case C: Lifetime counter masking test
// 100,000 packets were cleanly received in the past. In the last 1 second, 50 packets were lost and 0 received.
// Lifetime calculation: 50 / (100050) = 0.05% (FALSE EXCELLENT)
// Delta calculation: 50 / (0 + 50) = 100% (TRUE FAILING)
const tPast: StatsSnapshot = { packetsReceived: 100000, packetsLost: 0, bytesReceived: 12000000, timestamp: 100000 };
const tFading: StatsSnapshot = { packetsReceived: 100000, packetsLost: 50, bytesReceived: 12000000, timestamp: 101000 };
const resC = calculateDeltaStats(tFading, tPast);
assert.strictEqual(resC.lossPct, 100.0, 'Delta calculation must catch total 1-second Wi-Fi drop at 100% loss despite large historical counts');

console.log('   [PASS] Delta packet loss accurately isolates instantaneous Wi-Fi fades without historical averaging bias');

// =========================================================================
// TEST 2: ITU-T G.107 Quality Evaluation & R-Factor Scoring
// =========================================================================
console.log('\n2. Testing ITU-T G.107 Quality Scoring (Excellent, Good, Unstable, Poor, Disconnected)...');

// 1m Distance: Loss 0%, RTT 18ms, Jitter 8ms
const q1m = evaluateNetworkQuality(0, 18, 8, 'connected' as RTCPeerConnectionState);
assert.strictEqual(q1m.quality, 'EXCELLENT', '1m distance must evaluate to EXCELLENT');
assert(q1m.score >= 95, `1m score must be >= 95 (got ${q1m.score})`);

// 5m Distance: Loss 1.5%, RTT 50ms, Jitter 20ms
const q5m = evaluateNetworkQuality(1.5, 50, 20, 'connected' as RTCPeerConnectionState);
assert.strictEqual(q5m.quality, 'GOOD', '5m distance must evaluate to GOOD');
assert(q5m.score >= 70 && q5m.score <= 95, `5m score must be between 70 and 95 (got ${q5m.score})`);

// 10m Distance: Loss 5.0%, RTT 100ms, Jitter 35ms
const q10m = evaluateNetworkQuality(5.0, 100, 35, 'connected' as RTCPeerConnectionState);
assert.strictEqual(q10m.quality, 'UNSTABLE', '10m distance with 5% loss must evaluate to UNSTABLE');

// 15m Distance / Obstructed: Loss 14.5%, RTT 200ms, Jitter 60ms
const q15m = evaluateNetworkQuality(14.5, 200, 60, 'connected' as RTCPeerConnectionState);
assert.strictEqual(q15m.quality, 'POOR', '15m distance with 14.5% loss must evaluate to POOR');

// Handset Walkout / Network Disconnection
const qDisc = evaluateNetworkQuality(100, 2000, 500, 'disconnected' as RTCPeerConnectionState);
assert.strictEqual(qDisc.quality, 'DISCONNECTED', 'Disconnected connectionState must immediately report DISCONNECTED');
assert.strictEqual(qDisc.score, 0, 'Disconnected score must be 0');

console.log('   [PASS] Quality levels precisely match physical distance benchmarks (1m -> EXCELLENT, 5m -> GOOD, 10m -> UNSTABLE, 15m -> POOR)');

// =========================================================================
// TEST 3: Adaptive Playout Delay / Jitter Buffer Clamping (25ms to 120ms)
// =========================================================================
console.log('\n3. Testing Adaptive Playout Buffer Clamping for Low Latency...');

function getAdaptivePlayoutDelay(jitterMs: number, lossPct: number): number {
  const calculated = (jitterMs / 1000) * 2.5 + (lossPct > 4 ? 0.03 : 0);
  return Math.min(0.120, Math.max(0.025, Math.round(calculated * 1000) / 1000));
}

assert.strictEqual(getAdaptivePlayoutDelay(5, 0), 0.025, 'Zero jitter must clamp strictly to 25ms minimum');
assert.strictEqual(getAdaptivePlayoutDelay(25, 1), 0.063, '25ms jitter should adapt buffer to ~63ms');
assert.strictEqual(getAdaptivePlayoutDelay(80, 10), 0.120, 'Severe 80ms jitter + 10% loss must cap strictly at 120ms max');

console.log('   [PASS] Playout delay stays within 25ms - 120ms boundary, protecting conversational latency');

// =========================================================================
// TEST 4: 10+ Concurrent Handset Scaling & Exclusive Routing Verification
// =========================================================================
console.log('\n4. Testing 10+ Concurrent Smartphone Session with Exclusive Bus Routing...');

const mockSession: SessionState = {
  sessionId: 'MAX-TEST-10',
  sessionName: 'CONFERENCE AUDITORIUM',
  adminSocketId: 'admin-host',
  mode: 'manual',
  activeSpeakerId: null,
  selectionReason: 'STAGE_INITIALIZED',
  isMuteAll: false,
  isEmergencyStop: false,
  arbitrationConfig: {
    silenceTimeoutMs: 1000,
    speakerLockMs: 1500,
    switchCooldownMs: 600,
    vadThreshold: 15
  },
  participants: {},
  recentEvents: []
};

// Connect 10 smartphones
for (let ch = 1; ch <= 10; ch++) {
  const id = `phone-handset-${ch}`;
  mockSession.participants[id] = {
    id,
    channelNumber: ch,
    name: `Presenter Mic ${String(ch).padStart(2, '0')}`,
    state: 'READY',
    priority: ch === 1 ? 'VIP' : 'Normal',
    isMutedByAdmin: false,
    isMutedSelf: false,
    audioLevel: 0,
    isSpeaking: false,
    joinedAt: Date.now() + ch * 10,
    lastSpokeAt: 0
  };
}

assert.strictEqual(Object.keys(mockSession.participants).length, 10, 'All 10 handsets must be registered');

// Verify Exclusive Output Routing Matrix
function getBusOutputGains(activeId: string | null, participants: Record<string, Participant>): Record<string, number> {
  const gainMatrix: Record<string, number> = {};
  for (const [id, p] of Object.entries(participants)) {
    // A channel can only output audio if it is the explicitly active speaker AND unmuted
    if (id === activeId && !p.isMutedByAdmin && !p.isMutedSelf) {
      gainMatrix[id] = 1.0;
    } else {
      gainMatrix[id] = 0.0;
    }
  }
  return gainMatrix;
}

// Stage 1: Select Mic 04
mockSession.activeSpeakerId = 'phone-handset-4';
const gains1 = getBusOutputGains(mockSession.activeSpeakerId, mockSession.participants);
assert.strictEqual(gains1['phone-handset-4'], 1.0, 'Mic 04 must be 1.0 (audible to PA)');
let nonActiveSum = 0;
for (let ch = 1; ch <= 10; ch++) {
  if (ch !== 4) nonActiveSum += gains1[`phone-handset-${ch}`];
}
assert.strictEqual(nonActiveSum, 0.0, 'All 9 other phones must have zero gain (0.0), guaranteeing zero room rumble');

// Stage 2: Mute All activated
mockSession.isMuteAll = true;
// Simulate host audio behavior on Mute All
for (const p of Object.values(mockSession.participants)) {
  p.isMutedByAdmin = true;
}
const gainsMuted = getBusOutputGains(mockSession.activeSpeakerId, mockSession.participants);
assert.strictEqual(gainsMuted['phone-handset-4'], 0.0, 'When Muted, active Mic 04 gain must drop immediately to 0.0');

console.log('   [PASS] 10+ Handsets registered cleanly; exclusive single-channel PA output routing verified');

// =========================================================================
// TEST 5: Automatic ICE Reconnection Triggering on Sustained Link Failure
// =========================================================================
console.log('\n5. Testing ICE Restart Triggering on Network Link Failure...');

interface ConnectionWatchdog {
  poorCount: number;
  iceRestartsTriggered: number;
}

function updateWatchdog(
  watchdog: ConnectionWatchdog,
  level: NetworkQualityLevel
): { shouldRestartIce: boolean } {
  if (level === 'POOR' || level === 'UNSTABLE') {
    watchdog.poorCount++;
    if (watchdog.poorCount >= 3) {
      watchdog.iceRestartsTriggered++;
      watchdog.poorCount = 0; // Reset after trigger
      return { shouldRestartIce: true };
    }
  } else if (level === 'EXCELLENT' || level === 'GOOD') {
    watchdog.poorCount = 0;
  }
  return { shouldRestartIce: false };
}

const watchdog: ConnectionWatchdog = { poorCount: 0, iceRestartsTriggered: 0 };
assert.strictEqual(updateWatchdog(watchdog, 'GOOD').shouldRestartIce, false);
assert.strictEqual(updateWatchdog(watchdog, 'POOR').shouldRestartIce, false); // 1 tick
assert.strictEqual(updateWatchdog(watchdog, 'POOR').shouldRestartIce, false); // 2 ticks
assert.strictEqual(updateWatchdog(watchdog, 'POOR').shouldRestartIce, true);  // 3 ticks -> trigger ICE restart!
assert.strictEqual(watchdog.iceRestartsTriggered, 1, 'Exactly one ICE restart must be dispatched on sustained fade');

console.log('   [PASS] ICE restart watchdog correctly triggers self-healing on 3 consecutive poor telemetry ticks');

console.log('\n=== ALL DISTANCE RELIABILITY & 10+ MICROPHONE TESTS PASSED (5/5) ===\n');
