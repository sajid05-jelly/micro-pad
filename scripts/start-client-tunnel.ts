import { spawn } from 'child_process';

const vite = spawn('npx', ['vite', '--host', '0.0.0.0', '--port', '5173'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, VITE_NO_SSL: 'true', TUNNEL: 'true' }
});

vite.on('exit', (code) => {
  process.exit(code ?? 0);
});

process.on('SIGINT', () => {
  vite.kill('SIGINT');
  process.exit(0);
});

process.on('SIGTERM', () => {
  vite.kill('SIGTERM');
  process.exit(0);
});
