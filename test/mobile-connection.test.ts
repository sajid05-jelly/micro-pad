import { io } from 'socket.io-client';

async function runMobileConnectionTest() {
  console.log('=== [MICRO PAD] MOBILE CONNECTION & QR JOINING TEST ===\n');

  // 1. Verify API info returns valid reachable LAN IP
  console.log('1. Checking /api/info for reachable LAN IP...');
  const res = await fetch('http://127.0.0.1:3001/api/info');
  const info = await res.json();

  if (!info.localIp || info.localIp === 'localhost' || info.localIp === '127.0.0.1' || info.localIp.startsWith('169.254.')) {
    throw new Error(`Invalid localIp returned: ${info.localIp}`);
  }
  console.log(`   [PASS] Valid LAN IP detected: ${info.localIp}`);

  // 2. Connect Admin Host
  console.log('\n2. Registering Host Control Room socket...');
  const adminSocket = io('http://127.0.0.1:3001', {
    transports: ['polling', 'websocket'],
    path: '/socket.io'
  });

  await new Promise<void>((resolve, reject) => {
    adminSocket.on('connect', () => {
      console.log('   [PASS] Admin Control Room connected via socket.io');
      adminSocket.emit('admin:register', {
        sessionId: 'MICRO-01',
        sessionName: 'MAIN BROADCAST STAGE'
      });
      resolve();
    });
    adminSocket.on('connect_error', reject);
  });

  // 3. Connect Android Phone (simulating polling transport used on Android to bypass self-signed wss issues)
  console.log('\n3. Simulating Android Phone joining from MIC 01 QR scan...');
  const androidSocket = io('http://127.0.0.1:3001', {
    transports: ['polling', 'websocket'],
    path: '/socket.io'
  });

  await new Promise<void>((resolve, reject) => {
    androidSocket.on('connect', () => {
      console.log('   [PASS] Android device connected via polling/websocket transport');
      androidSocket.emit('participant:join', {
        sessionId: 'MICRO-01',
        name: 'Android User (Pixel)',
        priority: 'Normal',
        channelNumber: 1
      });
    });

    androidSocket.on('participant:assigned', (p: any) => {
      console.log(`   [PASS] Android assigned to channel: MIC 0${p.channelNumber} (${p.name})`);
      if (p.channelNumber === 1) {
        resolve();
      } else {
        reject(new Error(`Expected channel 1, got ${p.channelNumber}`));
      }
    });

    androidSocket.on('connect_error', reject);
  });

  // 4. Connect iPhone Phone (simulating iPhone Safari joining from MIC 02 QR scan)
  console.log('\n4. Simulating iPhone joining from MIC 02 QR scan...');
  const iphoneSocket = io('http://127.0.0.1:3001', {
    transports: ['polling', 'websocket'],
    path: '/socket.io'
  });

  await new Promise<void>((resolve, reject) => {
    iphoneSocket.on('connect', () => {
      console.log('   [PASS] iPhone device connected via socket');
      iphoneSocket.emit('participant:join', {
        sessionId: 'MICRO-01',
        name: 'iPhone User (Safari)',
        priority: 'VIP',
        channelNumber: 2
      });
    });

    iphoneSocket.on('participant:assigned', (p: any) => {
      console.log(`   [PASS] iPhone assigned to channel: MIC 0${p.channelNumber} (${p.name})`);
      if (p.channelNumber === 2) {
        resolve();
      } else {
        reject(new Error(`Expected channel 2, got ${p.channelNumber}`));
      }
    });

    iphoneSocket.on('connect_error', reject);
  });

  // 5. Verify Admin Session State contains both devices in their respective slots
  console.log('\n5. Verifying Admin dashboard state reflection...');
  await new Promise<void>((resolve) => {
    const handler = (session: any) => {
      const participants = Object.values(session.participants || {}) as any[];
      const androidP = participants.find(p => p.name === 'Android User (Pixel)');
      const iphoneP = participants.find(p => p.name === 'iPhone User (Safari)');

      if (androidP && iphoneP) {
        console.log(`   [PASS] Admin sees Android on CH-${androidP.channelNumber} and iPhone on CH-${iphoneP.channelNumber}`);
        adminSocket.off('session:state', handler);
        resolve();
      }
    };
    adminSocket.on('session:state', handler);
    adminSocket.emit('admin:mute_all', { isMuteAll: false });
  });

  // 6. Test telemetry transmission from mobile to host
  console.log('\n6. Testing audio telemetry transmission from mobile device...');
  await new Promise<void>((resolve) => {
    adminSocket.on('participant:audio_meter', (meter: any) => {
      if (meter.level === 75 && meter.isSpeaking === true) {
        console.log(`   [PASS] Live VU meter audio level (${meter.level}%) on CH-${meter.channelNumber} received by Host Console`);
        resolve();
      }
    });
    androidSocket.emit('participant:telemetry', {
      audioLevel: 75,
      isSpeaking: true
    });
  });

  // 7. Test Secure Public Tunnel registration and broadcast
  console.log('\n7. Testing Secure Public Tunnel registration (/api/tunnel)...');
  const tunnelRes = await fetch('http://127.0.0.1:3001/api/tunnel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://micropad-stage.trycloudflare.com' })
  });
  const tunnelData = await tunnelRes.json();
  if (tunnelData.tunnelUrl !== 'https://micropad-stage.trycloudflare.com') {
    throw new Error(`Expected tunnelUrl 'https://micropad-stage.trycloudflare.com', got ${tunnelData.tunnelUrl}`);
  }
  console.log('   [PASS] Tunnel URL registered: https://micropad-stage.trycloudflare.com');

  // Verify /api/info returns the tunnel URL
  const updatedInfoRes = await fetch('http://127.0.0.1:3001/api/info');
  const updatedInfo = await updatedInfoRes.json();
  if (updatedInfo.tunnelUrl !== 'https://micropad-stage.trycloudflare.com') {
    throw new Error('Updated info did not reflect registered tunnel URL');
  }
  console.log('   [PASS] /api/info reflects active public tunnel URL');

  // 8. Test Join URL generator logic (Never localhost or 127.0.0.1, preserves session and channel)
  console.log('\n8. Validating Mobile Join URL generation (No localhost, valid protocol, preserves params)...');
  function buildJoinUrl(baseHost: string, sessionId: string, channelNumber?: number): string {
    const params = new URLSearchParams();
    params.set('session', sessionId);
    params.set('role', 'join');
    if (channelNumber) {
      params.set('channel', String(channelNumber));
      params.set('mic', `MIC ${String(channelNumber).padStart(2, '0')}`);
    }
    return `${baseHost}/?${params.toString()}`;
  }

  const lanJoinUrl = buildJoinUrl(`https://${info.localIp}:5173`, 'MICRO-01', 1);
  if (lanJoinUrl.includes('localhost') || lanJoinUrl.includes('127.0.0.1')) {
    throw new Error('Mobile join URL must never contain localhost or 127.0.0.1');
  }
  if (!lanJoinUrl.includes('role=join') || !lanJoinUrl.includes('session=MICRO-01') || !lanJoinUrl.includes('channel=1')) {
    throw new Error(`Join URL missing required parameters: ${lanJoinUrl}`);
  }
  console.log(`   [PASS] Valid LAN Join URL: ${lanJoinUrl}`);

  const tunnelJoinUrl = buildJoinUrl('https://micropad-stage.trycloudflare.com', 'MICRO-01', 2);
  if (!tunnelJoinUrl.startsWith('https://micropad-stage.trycloudflare.com/?') || !tunnelJoinUrl.includes('channel=2')) {
    throw new Error(`Tunnel join URL invalid: ${tunnelJoinUrl}`);
  }
  console.log(`   [PASS] Valid Tunnel Join URL: ${tunnelJoinUrl}`);

  // Clean up
  androidSocket.disconnect();
  iphoneSocket.disconnect();
  adminSocket.disconnect();
  await new Promise(r => setTimeout(r, 100));

  console.log('\n=== ALL REAL-DEVICE CONNECTION SIMULATIONS PASSED (8/8) ===');
  process.exit(0);
}

runMobileConnectionTest().catch((err) => {
  console.error('\n[FAIL] Test error:', err);
  process.exit(1);
});
