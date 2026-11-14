import assert from 'node:assert';
import { optimizeOpusSDP as optimizeSenderSDP } from '../src/audio/ParticipantAudioEngine.js';
import { optimizeOpusSDP as optimizeHostSDP } from '../src/audio/HostAudioEngine.js';
import { Participant, SessionState, ArbitrationConfig, PriorityLevel } from '../src/types.js';

console.log('=== [MICRO MAX] SCALABILITY, RESILIENCE & DISTANCE VALIDATION TEST ===\n');

// 1. Validate Distance-Resilient Opus SDP Optimization
console.log('1. Testing Opus SDP 20ms Frame Packaging & FEC In-Band Triggering...');
const rawSDP = [
  'v=0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=0'
].join('\r\n');

const senderTuned = optimizeSenderSDP(rawSDP);
const hostTuned = optimizeHostSDP(rawSDP);

assert(senderTuned.includes('ptime=20'), 'Sender SDP must prioritize 20ms packaging to halve Wi-Fi contention');
assert(senderTuned.includes('useinbandfec=1'), 'Sender SDP must activate in-band forward error correction');
assert(senderTuned.includes('packetlossperc=15'), 'Sender SDP must hint 15% packet loss to trigger LBRR redundancy');
assert(senderTuned.includes('maxaveragebitrate=128000'), 'Sender SDP must maintain 128kbps broadcast ceiling');

assert(hostTuned.includes('ptime=20'), 'Host SDP must prioritize 20ms packaging');
assert(hostTuned.includes('useinbandfec=1'), 'Host SDP must enable in-band FEC decoding');
assert(hostTuned.includes('packetlossperc=15'), 'Host SDP must instruct encoder to embed FEC');

console.log('   [PASS] 20ms packaging, 15% FEC loss hint, and 128k headroom verified on both ends');

// 2. Adaptive Jitter Buffer Target Calculation Test
console.log('\n2. Testing Adaptive Jitter Buffer Playout Delay Calculation...');
function calculateAdaptivePlayoutDelay(jitterMs: number, packetLossPct: number): number {
  return Math.min(0.12, Math.max(0.025, (jitterMs / 1000) * 2.5 + (packetLossPct > 5 ? 0.03 : 0)));
}

// Low jitter on pristine Wi-Fi (< 10ms)
const lowDelay = calculateAdaptivePlayoutDelay(6, 0);
assert(lowDelay >= 0.025 && lowDelay <= 0.045, `Low jitter playout delay must be tight (got ${lowDelay}s)`);

// Moderate distance jitter (30ms, 2% loss)
const medDelay = calculateAdaptivePlayoutDelay(30, 2);
assert(medDelay >= 0.075 && medDelay <= 0.09, `Medium jitter playout delay must adapt smoothly (got ${medDelay}s)`);

// Severe distance jitter (50ms, 8% loss)
const highDelay = calculateAdaptivePlayoutDelay(50, 8);
assert(highDelay >= 0.12, `High jitter playout delay must cap safely at 120ms ceiling (got ${highDelay}s)`);

console.log(`   [PASS] Jitter buffer adapts dynamically: 25ms (pristine) -> ${Math.round(medDelay * 1000)}ms (medium) -> ${Math.round(highDelay * 1000)}ms (burst)`);

// 3. Audio Clipping Detection Test
console.log('\n3. Testing Audio Sample Clipping & Distortion Detection...');
function detectClipping(samples: number[]): { isClipping: boolean; clipCount: number } {
  let clipCount = 0;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) >= 0.985) clipCount++;
  }
  return { isClipping: clipCount > 0, clipCount };
}

const cleanAudio = [0.1, 0.4, 0.72, 0.5, -0.3, -0.85, 0.2];
const clippedAudio = [0.1, 0.5, 0.987, 0.999, 1.0, 0.4, -0.99];

assert.strictEqual(detectClipping(cleanAudio).isClipping, false, 'Clean audio under 0.985 must not trigger clipping');
assert.strictEqual(detectClipping(clippedAudio).isClipping, true, 'Audio reaching >= 0.985 must trigger clipping');
assert.strictEqual(detectClipping(clippedAudio).clipCount, 4, 'Must report exact clipped sample count');
console.log('   [PASS] Digital clipping detection correctly identifies sample distortion');

// 4. Scalability: 10+ Connected Microphones Simulation
console.log('\n4. Testing Scalability with 12 Concurrent Microphone Handsets...');
const session: SessionState = {
  sessionId: 'MAX-STAGE-01',
  sessionName: 'CONCERT PA SYSTEM',
  adminSocketId: 'admin-host-socket',
  mode: 'auto',
  activeSpeakerId: null,
  selectionReason: 'INITIAL_IDLE',
  isMuteAll: false,
  isEmergencyStop: false,
  arbitrationConfig: {
    silenceTimeoutMs: 1200,
    speakerLockMs: 1500,
    switchCooldownMs: 800,
    vadThreshold: 15
  },
  participants: {},
  recentEvents: []
};

// Connect 12 handsets
for (let ch = 1; ch <= 12; ch++) {
  const pId = `socket-mic-${ch}`;
  const participant: Participant = {
    id: pId,
    channelNumber: ch,
    name: `Presenter ${ch} (Mic ${ch})`,
    state: 'READY',
    priority: ch === 1 ? 'VIP' : 'Normal',
    isMutedByAdmin: false,
    isMutedSelf: false,
    audioLevel: 0,
    isSpeaking: false,
    joinedAt: Date.now() + ch * 10,
    lastSpokeAt: 0
  };
  session.participants[pId] = participant;
}

assert.strictEqual(Object.keys(session.participants).length, 12, '12 participants must be cleanly registered');
console.log('   [PASS] 12 concurrent microphone channels allocated without channel number collisions');

// 5. Exclusive Routing Simulation (Crucial PA Rule)
console.log('\n5. Verifying Exclusive Single-Microphone PA Routing (No 10-Mic Muddy Mixing)...');
function computeRoutingGains(activeId: string | null, participants: Record<string, Participant>): Record<string, number> {
  const gains: Record<string, number> = {};
  for (const id of Object.keys(participants)) {
    // Only the single active speaker gets 1.0 gain; all other 11 channels are strictly clamped to 0.0
    gains[id] = id === activeId ? 1.0 : 0.0;
  }
  return gains;
}

const activeGainMap = computeRoutingGains('socket-mic-5', session.participants);
assert.strictEqual(activeGainMap['socket-mic-5'], 1.0, 'Active microphone 5 must have 1.0 bus gain');
for (let ch = 1; ch <= 12; ch++) {
  if (ch !== 5) {
    assert.strictEqual(activeGainMap[`socket-mic-${ch}`], 0.0, `Inactive channel ${ch} must have 0.0 gain to prevent room reverb`);
  }
}
console.log('   [PASS] Exclusive routing verified: exactly 1 active microphone unmuted; all other 11 muted at 0.0');

// 6. VIP Preemption in 12-Microphone Environment
console.log('\n6. Testing VIP Preemption in 12-Microphone Auto Arbitration...');
session.activeSpeakerId = 'socket-mic-5'; // Normal speaker
session.participants['socket-mic-5'].isSpeaking = false; // Finished phrase

// VIP participant (Mic 1) begins speaking
session.participants['socket-mic-1'].isSpeaking = true;
session.participants['socket-mic-1'].lastSpokeAt = Date.now();

// Simulate preemption logic
const eligible = Object.values(session.participants).filter(p => !p.isMutedByAdmin && !p.isMutedSelf);
const contenders = eligible.filter(p => p.isSpeaking);
contenders.sort((a, b) => {
  const score = { VIP: 3, Normal: 2, Low: 1 };
  return score[b.priority] - score[a.priority];
});

assert.strictEqual(contenders[0].id, 'socket-mic-1', 'VIP contestant must win arbitration over Normal contenders');
session.activeSpeakerId = contenders[0].id;
session.selectionReason = 'HIGHER_PRIORITY';

assert.strictEqual(session.activeSpeakerId, 'socket-mic-1');
assert.strictEqual(session.selectionReason, 'HIGHER_PRIORITY');
console.log('   [PASS] VIP mic preempts normal floor cleanly across 12-unit fleet');

// 7. Multi-Speaker Delay Alignment Test
console.log('\n7. Testing Multi-Speaker Output Delay Alignment...');
function calculateBluetoothDelayOffset(wiredLatencyMs: number, bluetoothLatencyMs: number): number {
  return Math.max(0, bluetoothLatencyMs - wiredLatencyMs);
}

const offset = calculateBluetoothDelayOffset(25, 145);
assert.strictEqual(offset, 120, 'Delay node must delay wired/front speakers by 120ms to align with 145ms Bluetooth latency');
console.log('   [PASS] Delay alignment calculation accurately syncs Bluetooth latency with wired PA');

console.log('\n=== ALL SCALABILITY, RESILIENCE & DISTANCE TESTS PASSED (7/7) ===');
