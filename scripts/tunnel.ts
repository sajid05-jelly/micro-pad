import { spawn } from 'child_process';
import http from 'http';

console.log('====================================================');
console.log('[MICRO PAD] LAUNCHING SECURE ZERO-WARNING HTTPS TUNNEL');
console.log('Target: Local Vite dev server on port 5173');
console.log('====================================================\n');

// Detect if cloudflared should be launched
const tunnelProcess = spawn('npx --yes cloudflared tunnel --url http://127.0.0.1:5173', [], {
  shell: true,
  stdio: ['ignore', 'pipe', 'pipe']
});

let registered = false;
let currentTunnelUrl: string | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;

function sendHeartbeat() {
  if (!currentTunnelUrl) return;
  const postData = JSON.stringify({ url: currentTunnelUrl });
  const req = http.request({
    hostname: '127.0.0.1',
    port: 3001,
    path: '/api/tunnel/heartbeat',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  }, (res) => {
    let body = '';
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => {
      try {
        const json = JSON.parse(body);
        if (json.active === false && currentTunnelUrl) {
          registered = false;
          registerTunnelWithServer(currentTunnelUrl);
        }
      } catch {}
    });
  });
  req.on('error', () => {});
  req.write(postData);
  req.end();
}

function decommissionTunnel() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  try {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3001,
      path: '/api/tunnel',
      method: 'DELETE'
    });
    req.on('error', () => {});
    req.end();
  } catch {}
}

function registerTunnelWithServer(tunnelUrl: string) {
  if (registered) return;
  registered = true;
  currentTunnelUrl = tunnelUrl;

  console.log('\n====================================================');
  console.log('[MICRO PAD] SECURE TUNNEL ESTABLISHED SUCCESSFULLY!');
  console.log(`-> Public HTTPS URL: ${tunnelUrl}`);
  console.log('-> Trusted by iOS Safari & Android Chrome natively (Green Lock)');
  console.log('-> Scan QR code in Admin Control Room to join instantly');
  console.log('====================================================\n');

  // Notify backend server on port 3001
  const postData = JSON.stringify({ url: tunnelUrl });
  const req = http.request({
    hostname: '127.0.0.1',
    port: 3001,
    path: '/api/tunnel',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  }, (res) => {
    res.on('data', () => {});
    // Start heartbeat every 10s
    if (!heartbeatInterval) {
      heartbeatInterval = setInterval(sendHeartbeat, 10000);
    }
  });

  req.on('error', () => {
    // Backend may still be spinning up, retry in 1.5s
    setTimeout(() => {
      registered = false;
      registerTunnelWithServer(tunnelUrl);
    }, 1500);
  });

  req.write(postData);
  req.end();
}

const urlRegex = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/g;

function handleOutput(data: Buffer) {
  const text = data.toString();
  process.stdout.write(text);

  const match = text.match(urlRegex);
  if (match && match.length > 0) {
    const url = match[0];
    registerTunnelWithServer(url);
  }
}

tunnelProcess.stdout.on('data', handleOutput);
tunnelProcess.stderr.on('data', handleOutput);

tunnelProcess.on('exit', (code) => {
  console.log(`[MICRO PAD] Tunnel process exited with code ${code}`);
  decommissionTunnel();
});

process.on('SIGINT', () => {
  decommissionTunnel();
  tunnelProcess.kill('SIGINT');
  process.exit(0);
});

process.on('SIGTERM', () => {
  decommissionTunnel();
  tunnelProcess.kill('SIGTERM');
  process.exit(0);
});
