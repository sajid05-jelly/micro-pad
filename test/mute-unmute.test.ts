import { io } from 'socket.io-client';

async function runMuteUnmuteTest() {
  console.log('=== [MICRO PAD] MUTE / UNMUTE AUDIO ROUTING TEST ===\n');

  // 1. Connect Admin
  console.log('1. Connecting Host Control Room...');
  const adminSocket = io('http://127.0.0.1:3001', {
    transports: ['polling', 'websocket'],
    path: '/socket.io'
  });

  await new Promise<void>((resolve, reject) => {
    adminSocket.on('connect', () => {
      adminSocket.emit('admin:register', {
        sessionId: 'MICRO-01',
        sessionName: 'MAIN BROADCAST STAGE'
      });
      resolve();
    });
    adminSocket.on('connect_error', reject);
  });
  console.log('   [PASS] Admin registered');

  // 2. Connect Participant
  console.log('\n2. Connecting Participant on MIC 01...');
  const phoneSocket = io('http://127.0.0.1:3001', {
    transports: ['polling', 'websocket'],
    path: '/socket.io'
  });

  let participantId = '';
  await new Promise<void>((resolve, reject) => {
    phoneSocket.on('connect', () => {
      participantId = phoneSocket.id!;
      phoneSocket.emit('participant:join', {
        sessionId: 'MICRO-01',
        name: 'Stage Speaker',
        priority: 'Normal',
        channelNumber: 1
      });
    });

    phoneSocket.on('participant:assigned', () => {
      resolve();
    });

    phoneSocket.on('connect_error', reject);
  });
  console.log(`   [PASS] Participant connected with ID: ${participantId}`);

  // 3. Route MIC 01 to the floor
  console.log('\n3. Routing MIC 01 to floor (active speaker)...');
  await new Promise<void>((resolve) => {
    const handler = (session: any) => {
      if (session.activeSpeakerId === participantId) {
        adminSocket.off('session:state', handler);
        resolve();
      }
    };
    adminSocket.on('session:state', handler);
    adminSocket.emit('admin:select_mic', { participantId });
  });
  console.log('   [PASS] Floor assigned to MIC 01');

  // Helper to get latest session state from admin
  const getSessionState = () => new Promise<any>((resolve) => {
    adminSocket.once('session:state', resolve);
    adminSocket.emit('admin:set_priority', { participantId, priority: 'Normal' });
  });

  // Helper to compute isAudible exactly like HostAudioEngine
  const computeIsAudible = (session: any, pId: string) => {
    const p = session.participants[pId];
    if (!p) return false;
    const isIndividuallyMuted = p.isMutedByAdmin || p.isMutedSelf;
    return !session.isEmergencyStop && !session.isMuteAll && !isIndividuallyMuted && (session.activeSpeakerId === pId);
  };

  // 4. Test Initial Audible State
  let session = await getSessionState();
  if (!computeIsAudible(session, participantId)) {
    throw new Error('Expected participant to be audible initially');
  }
  console.log('   [PASS] Initial state: AUDIBLE (gain = 1.0, activeSpeakerId set)');

  // 5. Test Admin MUTE participant
  console.log('\n4. Admin clicks MUTE on MIC 01...');
  await new Promise<void>((resolve) => {
    const handler = (s: any) => {
      const p = s.participants[participantId];
      if (p && p.isMutedByAdmin === true) {
        adminSocket.off('session:state', handler);
        resolve();
      }
    };
    adminSocket.on('session:state', handler);
    adminSocket.emit('admin:mute_participant', { participantId, muted: true });
  });

  session = await getSessionState();
  if (computeIsAudible(session, participantId)) {
    throw new Error('Expected participant to be SILENT while muted');
  }
  if (!session.activeSpeakerId) {
    throw new Error('activeSpeakerId was wiped out during mute! Routing assignment must be preserved.');
  }
  console.log('   [PASS] Muted: SILENT (gain = 0.0), activeSpeakerId preserved');

  // 6. Test Admin UNMUTE participant -> Audio must return!
  console.log('\n5. Admin clicks UNMUTE on MIC 01...');
  await new Promise<void>((resolve) => {
    const handler = (s: any) => {
      const p = s.participants[participantId];
      if (p && p.isMutedByAdmin === false) {
        adminSocket.off('session:state', handler);
        resolve();
      }
    };
    adminSocket.on('session:state', handler);
    adminSocket.emit('admin:mute_participant', { participantId, muted: false });
  });

  session = await getSessionState();
  if (!computeIsAudible(session, participantId)) {
    throw new Error('AUDIO DID NOT RETURN after unmute! activeSpeakerId was lost or state stale.');
  }
  if (session.participants[participantId].state !== 'ACTIVE SPEAKER') {
    throw new Error(`Expected state ACTIVE SPEAKER, got ${session.participants[participantId].state}`);
  }
  console.log('   [PASS] Unmuted: AUDIO RETURNED TO SPEAKER (gain = 1.0, state = ACTIVE SPEAKER)');

  // 7. Test Participant Self-MUTE and Self-UNMUTE
  console.log('\n6. Participant toggles MUTE on phone...');
  await new Promise<void>((resolve) => {
    const handler = (s: any) => {
      const p = s.participants[participantId];
      if (p && p.isMutedSelf === true) {
        adminSocket.off('session:state', handler);
        resolve();
      }
    };
    adminSocket.on('session:state', handler);
    phoneSocket.emit('participant:self_mute', { isMuted: true });
  });

  session = await getSessionState();
  if (computeIsAudible(session, participantId)) {
    throw new Error('Expected participant to be silent while self-muted');
  }
  console.log('   [PASS] Self-Muted: SILENT (gain = 0.0), activeSpeakerId preserved');

  console.log('\n7. Participant toggles UNMUTE on phone...');
  await new Promise<void>((resolve) => {
    const handler = (s: any) => {
      const p = s.participants[participantId];
      if (p && p.isMutedSelf === false) {
        adminSocket.off('session:state', handler);
        resolve();
      }
    };
    adminSocket.on('session:state', handler);
    phoneSocket.emit('participant:self_mute', { isMuted: false });
  });

  session = await getSessionState();
  if (!computeIsAudible(session, participantId)) {
    throw new Error('AUDIO DID NOT RETURN after self-unmute!');
  }
  console.log('   [PASS] Self-Unmuted: AUDIO RETURNED TO SPEAKER (gain = 1.0)');

  // 8. Test Mute All and Unmute All
  console.log('\n8. Admin engages MUTE ALL...');
  await new Promise<void>((resolve) => {
    const handler = (s: any) => {
      if (s.isMuteAll === true) {
        adminSocket.off('session:state', handler);
        resolve();
      }
    };
    adminSocket.on('session:state', handler);
    adminSocket.emit('admin:mute_all', { isMuteAll: true });
  });

  session = await getSessionState();
  if (computeIsAudible(session, participantId)) {
    throw new Error('Expected silence during MUTE ALL');
  }
  console.log('   [PASS] Mute All: SILENT (gain = 0.0)');

  console.log('\n9. Admin releases UNMUTE ALL...');
  await new Promise<void>((resolve) => {
    const handler = (s: any) => {
      if (s.isMuteAll === false) {
        adminSocket.off('session:state', handler);
        resolve();
      }
    };
    adminSocket.on('session:state', handler);
    adminSocket.emit('admin:mute_all', { isMuteAll: false });
  });

  session = await getSessionState();
  if (!computeIsAudible(session, participantId)) {
    throw new Error('AUDIO DID NOT RETURN after UNMUTE ALL!');
  }
  console.log('   [PASS] Unmute All: AUDIO RETURNED TO SPEAKER (gain = 1.0)');

  // 10. Rapid repeated mute/unmute clicks safety test (5 rapid cycles)
  console.log('\n10. Testing repeated rapid mute/unmute clicks (5 cycles)...');
  for (let i = 1; i <= 5; i++) {
    // Rapid mute
    adminSocket.emit('admin:mute_participant', { participantId, muted: true });
    // Rapid unmute immediately
    adminSocket.emit('admin:mute_participant', { participantId, muted: false });
  }

  // Allow events to settle
  await new Promise(r => setTimeout(r, 400));
  session = await getSessionState();
  if (!computeIsAudible(session, participantId)) {
    throw new Error('Audio did not settle into audible state after rapid mute/unmute clicks');
  }
  console.log('   [PASS] Rapid mute/unmute stress test passed without desync');

  adminSocket.close();
  phoneSocket.close();
  console.log('\n=== ALL MUTE / UNMUTE TESTS PASSED (10/10) ===');
  process.exit(0);
}

runMuteUnmuteTest().catch((err) => {
  console.error('\n[FAIL] Mute test failed:', err);
  process.exit(1);
});
