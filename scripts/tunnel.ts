import { spawn } from 'child_process';
import http from 'http';

console.log('====================================================');
console.log('[MICRO PAD] LAUNCHING SECURE ZERO-WARNING HTTPS TUNNEL');
console.log('Target: Local Vite dev server on port 5173');
console.log('====================================================\n');

// Detect if cloudflared or localtunnel should be used
const tunnelProcess = spawn('npx', ['--yes', 'cloudflared', 'tunnel', '--url', 'http://127.0.0.1:5173'], {
  shell: true,
  stdio: ['ignore', 'pipe', 'pipe']
});

let registered = false;

function registerTunnelWithServer(tunnelUrl: string) {
  if (registered) return;
  registered = true;

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
  });

  req.on('error', (e) => {
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
});

process.on('SIGINT', () => {
  tunnelProcess.kill('SIGINT');
  process.exit(0);
});

process.on('SIGTERM', () => {
  tunnelProcess.kill('SIGTERM');
  process.exit(0);
});
