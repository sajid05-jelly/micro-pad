import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { X, Copy, Check, ExternalLink, QrCode, Smartphone, Wifi, Lock, ShieldCheck, AlertTriangle, RefreshCw, Radio } from 'lucide-react';
import { getApiUrl } from '../config.js';

interface QRCodeModalProps {
  sessionId: string;
  localIp: string;
  tunnelUrl?: string | null;
  channelNumber?: number;
  isOpen: boolean;
  onClose: () => void;
}

export const QRCodeModal: React.FC<QRCodeModalProps> = ({
  sessionId,
  localIp,
  tunnelUrl: initialTunnelUrl,
  channelNumber,
  isOpen,
  onClose
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [connectionMode, setConnectionMode] = useState<'tunnel' | 'lan'>('tunnel');
  const [customTunnel, setCustomTunnel] = useState<string>('');
  const [activeTunnel, setActiveTunnel] = useState<string | null>(initialTunnelUrl || null);
  const [isApplyingTunnel, setIsApplyingTunnel] = useState<boolean>(false);
  
  // Real reachability probe state for public tunnel
  const [probeStatus, setProbeStatus] = useState<'idle' | 'probing' | 'verified' | 'offline'>('idle');
  const [probeError, setProbeError] = useState<string | null>(null);

  // Sync initialTunnelUrl when parent updates
  useEffect(() => {
    if (initialTunnelUrl && !activeTunnel) {
      setActiveTunnel(initialTunnelUrl);
    }
  }, [initialTunnelUrl, activeTunnel]);

  // If on localhost or private IP with active tunnel, default to tunnel
  useEffect(() => {
    if (activeTunnel) {
      setConnectionMode('tunnel');
    } else if (localIp && localIp !== 'localhost') {
      setConnectionMode('lan');
    }
  }, [activeTunnel, localIp]);

  // Active reachability probe to ensure the tunnel is live before showing QR code to event users
  const verifyTunnel = async (targetTunnel: string | null) => {
    if (!targetTunnel) {
      setProbeStatus('idle');
      return;
    }
    setProbeStatus('probing');
    setProbeError(null);

    try {
      const probeTarget = targetTunnel.replace(/\/$/, '') + '/api/info';
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(probeTarget, { 
        method: 'GET',
        mode: 'cors',
        signal: controller.signal 
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        setProbeStatus('verified');
      } else {
        setProbeStatus('offline');
        setProbeError(`HTTP ${res.status}`);
      }
    } catch (err: any) {
      // If CORS or timeout, attempt a zero-cors fallback probe
      try {
        const pingTarget = targetTunnel.replace(/\/$/, '') + '/';
        const controller2 = new AbortController();
        const timeoutId2 = setTimeout(() => controller2.abort(), 3000);
        await fetch(pingTarget, { mode: 'no-cors', signal: controller2.signal });
        clearTimeout(timeoutId2);
        setProbeStatus('verified');
      } catch (innerErr: any) {
        setProbeStatus('offline');
        setProbeError(innerErr.name === 'AbortError' ? 'Probe timed out (4s)' : 'Host unreachable');
      }
    }
  };

  useEffect(() => {
    if (connectionMode === 'tunnel' && activeTunnel) {
      verifyTunnel(activeTunnel);
    }
  }, [connectionMode, activeTunnel]);

  // Determine the exact URL for mobile participants to join
  let baseUrl = '';
  if (connectionMode === 'tunnel' && activeTunnel) {
    baseUrl = activeTunnel.replace(/\/$/, '');
  } else {
    // Determine proper protocol and port
    const port = window.location.port ? `:${window.location.port}` : '';
    const protocol = window.location.protocol;
    // When using LAN mode, use standard HTTP on 5173 to avoid browser untrusted SSL errors
    const effectiveProtocol = localIp && localIp !== 'localhost' ? 'http:' : protocol;
    const effectivePort = port || ':5173';
    baseUrl = `${effectiveProtocol}//${localIp}${effectivePort}`;
  }

  // Construct query params including specific channel slot if selected
  const queryParams = new URLSearchParams({
    role: 'join',
    session: sessionId
  });
  if (channelNumber !== undefined) {
    queryParams.set('channel', String(channelNumber));
    queryParams.set('mic', `MIC ${String(channelNumber).padStart(2, '0')}`);
  }
  const joinUrl = `${baseUrl}/join?${queryParams.toString()}`;

  useEffect(() => {
    if (!isOpen) return;

    // Generate high-contrast clean SVG data URL for fast QR scanning on phone cameras
    QRCode.toDataURL(joinUrl, {
      width: 260,
      margin: 1.5,
      color: {
        dark: '#050505',
        light: '#FFFFFF'
      },
      errorCorrectionLevel: 'M'
    })
      .then(url => setQrDataUrl(url))
      .catch(err => console.error('Error generating QR code:', err));
  }, [joinUrl, isOpen]);

  const copyToClipboard = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleApplyTunnel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customTunnel.trim()) return;
    
    let formatted = customTunnel.trim();
    if (!formatted.startsWith('http://') && !formatted.startsWith('https://')) {
      formatted = 'https://' + formatted;
    }
    
    setIsApplyingTunnel(true);
    try {
      // Inform the server about the custom tunnel URL
      await fetch(getApiUrl('/api/info'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tunnelUrl: formatted })
      });
      setActiveTunnel(formatted);
      setConnectionMode('tunnel');
      await verifyTunnel(formatted);
    } catch (err) {
      console.warn('Could not post tunnel to backend, using local state:', err);
      setActiveTunnel(formatted);
      setConnectionMode('tunnel');
      await verifyTunnel(formatted);
    } finally {
      setIsApplyingTunnel(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 overflow-y-auto">
      <div className="relative w-full max-w-lg bg-bg-card border border-border text-text-primary p-6 sm:p-7 rounded-2xl shadow-card my-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3.5 border-b border-border mb-4">
          <div className="flex items-center gap-2.5">
            <QrCode size={18} className="text-accent-blue" />
            <h3 className="font-heading font-black text-base tracking-wider uppercase text-text-primary">
              {channelNumber ? `CONNECT PHONE // MIC ${String(channelNumber).padStart(2, '0')}` : 'SCAN TO CONNECT MICROPHONE'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-text-secondary hover:text-text-primary border border-transparent hover:border-border rounded-lg transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Mode Selector: Secure Tunnel vs Local LAN */}
        <div className="grid grid-cols-2 gap-2 mb-3.5 font-mono text-xs">
          <button
            type="button"
            onClick={() => setConnectionMode('tunnel')}
            className={`py-2 px-2 text-center border font-mono text-[11px] font-semibold tracking-wider uppercase rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              connectionMode === 'tunnel'
                ? 'bg-accent-blue text-white border-accent-blue shadow-sm'
                : 'bg-bg-secondary text-text-secondary border-border hover:border-border-hover'
            }`}
          >
            <Lock size={12} />
            <span>SECURE TUNNEL (RECOMMENDED)</span>
          </button>
          <button
            type="button"
            onClick={() => setConnectionMode('lan')}
            className={`py-2 px-2 text-center border font-mono text-[11px] font-semibold tracking-wider uppercase rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              connectionMode === 'lan'
                ? 'bg-accent-blue text-white border-accent-blue shadow-sm'
                : 'bg-bg-secondary text-text-secondary border-border hover:border-border-hover'
            }`}
          >
            <Wifi size={12} />
            <span>LOCAL WI-FI (LAN IP)</span>
          </button>
        </div>

        {/* QR Code Container / Status Screen */}
        <div className="flex flex-col items-center justify-center p-4 bg-white rounded-xl my-2 min-h-[240px] shadow-inner">
          {connectionMode === 'tunnel' && probeStatus === 'probing' ? (
            <div className="w-52 h-52 flex flex-col items-center justify-center font-mono text-xs text-[#050505] space-y-2">
              <RefreshCw size={24} className="animate-spin text-[#050505]" />
              <span className="font-bold tracking-wider">VERIFYING TUNNEL REACHABILITY...</span>
            </div>
          ) : connectionMode === 'tunnel' && probeStatus === 'offline' ? (
            <div className="w-full p-4 bg-bg-card border border-border rounded-xl text-center space-y-2 text-[#050505]">
              <div className="flex justify-center">
                <AlertTriangle size={32} className="text-amber-500" />
              </div>
              <div className="font-heading font-bold text-xs uppercase text-text-primary tracking-wider">
                TUNNEL OFFLINE // DNS UNRESOLVED
              </div>
              <p className="font-mono text-[11px] text-text-secondary leading-relaxed">
                The tunnel endpoint <span className="text-accent-blue underline font-bold">{activeTunnel}</span> could not be reached.
                {probeError ? ` (${probeError})` : ''}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => verifyTunnel(activeTunnel)}
                  className="px-3 py-1.5 bg-accent-blue text-white font-mono font-semibold text-xs uppercase rounded-lg hover:bg-accent-blue-hover"
                >
                  RE-CHECK REACHABILITY
                </button>
                <button
                  type="button"
                  onClick={() => setConnectionMode('lan')}
                  className="px-3 py-1.5 bg-bg-secondary border border-border text-text-primary font-mono font-semibold text-xs uppercase rounded-lg hover:border-border-hover"
                >
                  SWITCH TO LOCAL WI-FI
                </button>
              </div>
              <div className="text-[10px] text-text-muted font-mono pt-2">
                Run <code className="text-accent-blue bg-bg-secondary px-1 py-0.5 border border-border rounded">npm run tunnel</code> to provision a fresh public HTTPS URL.
              </div>
            </div>
          ) : connectionMode === 'tunnel' && (!activeTunnel || probeStatus === 'idle') ? (
            <div className="w-full p-4 bg-bg-card border border-border rounded-xl text-center space-y-2">
              <div className="flex justify-center">
                <Radio size={32} className="text-text-secondary" />
              </div>
              <div className="font-heading font-bold text-xs uppercase text-text-primary tracking-wider">
                NO ACTIVE TUNNEL DETECTED
              </div>
              <p className="font-mono text-[11px] text-text-secondary leading-relaxed">
                Run <code className="text-accent-blue bg-bg-secondary px-1 py-0.5 border border-border rounded">npm run tunnel</code> in terminal to create a free, trusted HTTPS link recognized by all phone cameras, or switch to Local Wi-Fi.
              </p>
              <button
                type="button"
                onClick={() => setConnectionMode('lan')}
                className="mt-2 px-3 py-1.5 bg-accent-blue text-white font-mono font-semibold text-xs uppercase rounded-lg hover:bg-accent-blue-hover"
              >
                USE LOCAL WI-FI (LAN IP)
              </button>
            </div>
          ) : qrDataUrl ? (
            <>
              <img src={qrDataUrl} alt="Session Join QR Code" className="w-52 h-52 object-contain" />
              <span className="font-mono text-[10px] text-[#050505] tracking-widest mt-1.5 uppercase font-semibold text-center">
                {channelNumber
                  ? `SCAN WITH PHONE CAMERA // SLOT: MIC ${String(channelNumber).padStart(2, '0')}`
                  : `SCAN WITH PHONE CAMERA // SESSION: ${sessionId}`}
              </span>
            </>
          ) : (
            <div className="w-52 h-52 flex items-center justify-center font-mono text-xs text-[#050505]">
              GENERATING MATRIX...
            </div>
          )}
        </div>

        {/* Tunnel Configuration Input (When Tunnel mode is selected) */}
        {connectionMode === 'tunnel' && (
          <div className="my-2.5 p-3 bg-bg-secondary border border-border rounded-xl space-y-2 text-xs font-mono">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-text-muted uppercase tracking-wider font-bold flex items-center gap-1.5">
                <ShieldCheck size={13} className={probeStatus === 'verified' ? 'text-accent-blue' : 'text-text-muted'} />
                <span>TRUSTED HTTPS TUNNEL (ZERO WARNINGS)</span>
              </span>
              {probeStatus === 'verified' ? (
                <span className="text-[10px] text-accent-blue font-bold uppercase tracking-wider flex items-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent-blue animate-pulse" />
                  VERIFIED ONLINE
                </span>
              ) : probeStatus === 'probing' ? (
                <span className="text-[10px] text-yellow-400 font-bold uppercase tracking-wider">
                  CHECKING...
                </span>
              ) : activeTunnel ? (
                <span className="text-[10px] text-red-400 font-bold uppercase tracking-wider">
                  UNREACHABLE
                </span>
              ) : (
                <span className="text-[10px] text-text-muted font-bold uppercase tracking-wider">
                  STANDBY
                </span>
              )}
            </div>

            <form onSubmit={handleApplyTunnel} className="flex gap-2">
              <input
                type="text"
                value={customTunnel}
                onChange={(e) => setCustomTunnel(e.target.value)}
                placeholder="E.G. https://xxxx.trycloudflare.com OR ngrok URL"
                className="flex-1 bg-bg-card border border-border text-text-primary px-3 py-1.5 text-xs font-mono rounded-lg focus:border-accent-blue outline-none"
              />
              <button
                type="submit"
                disabled={isApplyingTunnel}
                className="px-3.5 py-1.5 bg-accent-blue text-white font-semibold text-xs uppercase rounded-lg hover:bg-accent-blue-hover shrink-0 transition-colors"
              >
                {isApplyingTunnel ? 'TESTING...' : 'APPLY & VERIFY'}
              </button>
            </form>

            <div className="text-[10px] text-text-secondary leading-relaxed">
              Run <code className="text-accent-blue bg-bg-card px-1 py-0.5 border border-border rounded">npm run tunnel</code> in terminal, or paste your ngrok / Cloudflare tunnel URL above.
            </div>
          </div>
        )}

        {/* Network & Pairing URL Info */}
        <div className="my-2.5 p-3 bg-bg-secondary border border-border rounded-xl space-y-2">
          <div className="flex items-center justify-between text-xs font-mono bg-bg-card p-2.5 border border-border rounded-lg">
            <span className="truncate max-w-[280px] text-text-primary font-mono text-[11px]">{joinUrl}</span>
            <button
              onClick={copyToClipboard}
              className="flex items-center gap-1.5 px-3 py-1 bg-accent-blue text-white font-semibold rounded-md text-[11px] hover:bg-accent-blue-hover shrink-0 transition-colors shadow-sm"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? 'COPIED' : 'COPY'}
            </button>
          </div>

          {connectionMode === 'lan' && (
            <div className="text-[10px] font-mono text-text-muted leading-relaxed">
              <span className="text-accent-blue font-bold">LOCAL WI-FI NOTICE: </span>
              Phone and laptop must be connected to the same Wi-Fi or mobile hotspot. Served over standard HTTP on port 5173 to avoid browser certificate blocks. For zero warnings and mobile browser camera access from any network, use <button onClick={() => setConnectionMode('tunnel')} className="text-accent-blue underline font-bold">Secure Tunnel mode</button>.
            </div>
          )}
        </div>

        {/* Mobile quick test in new window */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-1.5 text-[10px] text-text-muted font-mono">
            <Smartphone size={12} />
            <span>Camera QR Scanner &bull; Safari &bull; Chrome</span>
          </div>
          <a
            href={joinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs font-mono text-accent-blue hover:underline"
          >
            <span>Open in Tab</span>
            <ExternalLink size={12} />
          </a>
        </div>
      </div>
    </div>
  );
};
