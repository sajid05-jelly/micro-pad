import React, { useEffect, useState, useCallback } from 'react';
import QRCode from 'qrcode';
import { 
  QrCode, 
  Copy, 
  Check, 
  ExternalLink, 
  X, 
  Smartphone, 
  Wifi, 
  ShieldCheck, 
  AlertTriangle,
  Lock,
  Globe,
  Radio,
  RefreshCw
} from 'lucide-react';

interface QRCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  localIp: string;
  tunnelUrl?: string | null;
  channelNumber?: number;
}

export const QRCodeModal: React.FC<QRCodeModalProps> = ({
  isOpen,
  onClose,
  sessionId,
  localIp,
  tunnelUrl,
  channelNumber
}) => {
  const [connectionMode, setConnectionMode] = useState<'tunnel' | 'lan'>('lan');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [resolvedIp, setResolvedIp] = useState<string>(localIp || '');
  const [customTunnel, setCustomTunnel] = useState<string>('');
  const [isApplyingTunnel, setIsApplyingTunnel] = useState(false);

  // Live probe state for Secure Tunnel mode (prevents displaying fake green ACTIVE or generating broken QR codes)
  const [probeStatus, setProbeStatus] = useState<'idle' | 'probing' | 'verified' | 'offline'>('idle');
  const [probeError, setProbeError] = useState<string | null>(null);

  // Refresh server info
  const refreshServerInfo = useCallback(() => {
    fetch('/api/info')
      .then(r => r.json())
      .then(data => {
        if (data.localIp && data.localIp !== 'localhost' && !data.localIp.startsWith('169.254.')) {
          setResolvedIp(data.localIp);
        }
        if (data.tunnelUrl) {
          setCustomTunnel(data.tunnelUrl);
        }
      })
      .catch(() => {});
  }, []);

  // Sync resolved IP and tunnel defaults
  useEffect(() => {
    if (localIp && localIp !== 'localhost' && localIp !== '127.0.0.1' && !localIp.startsWith('169.254.')) {
      setResolvedIp(localIp);
    }
    if (isOpen) {
      refreshServerInfo();
    }
  }, [localIp, isOpen, refreshServerInfo]);

  // Set default mode to tunnel if active
  useEffect(() => {
    if (tunnelUrl) {
      setCustomTunnel(tunnelUrl);
      setConnectionMode('tunnel');
    }
  }, [tunnelUrl]);

  // Active tunnel target
  const activeTunnel = customTunnel.trim() || (tunnelUrl ? tunnelUrl.trim() : '');

  // Verify candidate tunnel reachability
  const verifyTunnel = useCallback(async (candidate: string) => {
    if (!candidate) {
      setProbeStatus('idle');
      setProbeError(null);
      return;
    }
    setProbeStatus('probing');
    setProbeError(null);

    let clean = candidate.trim().replace(/\/+$/, '');
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      clean = `https://${clean}`;
    }

    try {
      const res = await fetch(`/api/tunnel/verify?url=${encodeURIComponent(clean)}`);
      const data = await res.json();
      if (data.reachable) {
        setProbeStatus('verified');
        setProbeError(null);
      } else {
        setProbeStatus('offline');
        setProbeError(data.error || 'UNREACHABLE');
      }
    } catch (err: any) {
      setProbeStatus('offline');
      setProbeError(err.message || 'NETWORK_ERROR');
    }
  }, []);

  // Trigger verification probe whenever switching to tunnel mode or updating tunnel URL
  useEffect(() => {
    if (isOpen && connectionMode === 'tunnel') {
      if (activeTunnel) {
        verifyTunnel(activeTunnel);
      } else {
        setProbeStatus('idle');
      }
    }
  }, [isOpen, connectionMode, activeTunnel, verifyTunnel]);

  // Compute join URL with valid LAN IP (Never localhost or 127.0.0.1)
  const effectiveIp = (resolvedIp && resolvedIp !== 'localhost' && resolvedIp !== '127.0.0.1' && !resolvedIp.startsWith('169.254.'))
    ? resolvedIp
    : (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'
        ? window.location.hostname
        : '172.20.10.5');

  const params = new URLSearchParams();
  params.set('session', sessionId);
  params.set('role', 'join'); // Explicitly open Participant Join Page
  if (channelNumber) {
    params.set('channel', String(channelNumber));
    params.set('mic', `MIC ${String(channelNumber).padStart(2, '0')}`);
  }

  // Determine effective base host
  // In LAN mode, standard HTTP is used so mobile browsers connect without NET::ERR_CERT_AUTHORITY_INVALID
  let effectiveBaseHost = `http://${effectiveIp}:5173`;

  if (connectionMode === 'tunnel' && activeTunnel) {
    let cleanTunnel = activeTunnel.trim().replace(/\/+$/, '');
    if (!cleanTunnel.startsWith('http://') && !cleanTunnel.startsWith('https://')) {
      cleanTunnel = `https://${cleanTunnel}`;
    }
    effectiveBaseHost = cleanTunnel;
  }

  const joinUrl = `${effectiveBaseHost}/join?${params.toString()}`;

  // Generate QR code only when URL is ready and verified (in tunnel mode, only if verified)
  const isQrReady = connectionMode === 'lan' || (connectionMode === 'tunnel' && probeStatus === 'verified');

  useEffect(() => {
    if (isOpen && isQrReady) {
      QRCode.toDataURL(joinUrl, {
        width: 320,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      })
        .then(url => setQrDataUrl(url))
        .catch(err => console.error('Failed to generate QR code', err));
    } else {
      setQrDataUrl('');
    }
  }, [isOpen, joinUrl, isQrReady]);

  const handleApplyTunnel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customTunnel.trim()) return;
    setIsApplyingTunnel(true);
    let clean = customTunnel.trim().replace(/\/+$/, '');
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      clean = `https://${clean}`;
    }
    try {
      await fetch('/api/tunnel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: clean })
      });
      setCustomTunnel(clean);
      setConnectionMode('tunnel');
      await verifyTunnel(clean);
    } catch (e) {
      console.warn('Could not post tunnel URL to backend:', e);
    } finally {
      setIsApplyingTunnel(false);
    }
  };

  if (!isOpen) return null;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(joinUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-lg bg-bg-elevated border-2 border-border text-text-primary p-6 rounded-sm shadow-2xl my-auto">
        {/* Hardware rack screws */}
        <div className="absolute top-2 left-2 rack-screw" />
        <div className="absolute top-2 right-2 rack-screw" />
        <div className="absolute bottom-2 left-2 rack-screw" />
        <div className="absolute bottom-2 right-2 rack-screw" />

        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-border mb-3">
          <div className="flex items-center gap-2">
            <QrCode size={18} className="text-text-primary" />
            <h3 className="font-heading font-bold text-base tracking-wider uppercase">
              {channelNumber ? `PAIR TRANSMITTER // MIC ${String(channelNumber).padStart(2, '0')}` : 'PAIR TRANSMITTER // GATEWAY'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-text-secondary hover:text-white border border-transparent hover:border-border"
          >
            <X size={16} />
          </button>
        </div>

        {/* Mode Selector: Secure Tunnel (Zero Warning) vs Local LAN */}
        <div className="grid grid-cols-2 gap-2 mb-3 font-mono text-xs">
          <button
            type="button"
            onClick={() => setConnectionMode('tunnel')}
            className={`py-2 px-2 text-center border font-mono text-[11px] font-bold tracking-wider uppercase flex items-center justify-center gap-1.5 ${
              connectionMode === 'tunnel'
                ? 'bg-text-primary text-text-inverse border-white'
                : 'bg-bg-main text-text-secondary border-border hover:border-text-primary'
            }`}
          >
            <Lock size={12} />
            <span>SECURE TUNNEL (RECOMMENDED)</span>
          </button>
          <button
            type="button"
            onClick={() => setConnectionMode('lan')}
            className={`py-2 px-2 text-center border font-mono text-[11px] font-bold tracking-wider uppercase flex items-center justify-center gap-1.5 ${
              connectionMode === 'lan'
                ? 'bg-text-primary text-text-inverse border-white'
                : 'bg-bg-main text-text-secondary border-border hover:border-text-primary'
            }`}
          >
            <Wifi size={12} />
            <span>LOCAL WI-FI (LAN IP)</span>
          </button>
        </div>

        {/* QR Code Container / Status Screen */}
        <div className="flex flex-col items-center justify-center p-3 bg-white rounded-sm my-2 min-h-[240px]">
          {connectionMode === 'tunnel' && probeStatus === 'probing' ? (
            <div className="w-52 h-52 flex flex-col items-center justify-center font-mono text-xs text-black space-y-2">
              <RefreshCw size={24} className="animate-spin text-black" />
              <span className="font-bold tracking-wider">VERIFYING TUNNEL REACHABILITY...</span>
            </div>
          ) : connectionMode === 'tunnel' && probeStatus === 'offline' ? (
            <div className="w-full p-4 bg-bg-secondary border border-border rounded-sm text-center space-y-2">
              <div className="flex justify-center">
                <AlertTriangle size={32} className="text-yellow-400" />
              </div>
              <div className="font-heading font-bold text-xs uppercase text-text-primary tracking-wider">
                TUNNEL OFFLINE // DNS UNRESOLVED
              </div>
              <p className="font-mono text-[11px] text-text-secondary leading-relaxed">
                The tunnel endpoint <span className="text-text-primary underline font-bold">{activeTunnel}</span> could not be reached.
                {probeError ? ` (${probeError})` : ''}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => verifyTunnel(activeTunnel)}
                  className="px-3 py-1.5 bg-text-primary text-text-inverse font-mono font-bold text-xs uppercase btn-tactile hover:bg-white/90"
                >
                  RE-CHECK REACHABILITY
                </button>
                <button
                  type="button"
                  onClick={() => setConnectionMode('lan')}
                  className="px-3 py-1.5 bg-bg-main border border-border text-text-primary font-mono font-bold text-xs uppercase btn-tactile hover:border-text-primary"
                >
                  SWITCH TO LOCAL WI-FI
                </button>
              </div>
              <div className="text-[10px] text-text-muted font-mono pt-2">
                Run <code className="text-text-primary bg-bg-elevated px-1 py-0.5 border border-border">npm run tunnel</code> to provision a fresh public HTTPS URL.
              </div>
            </div>
          ) : connectionMode === 'tunnel' && (!activeTunnel || probeStatus === 'idle') ? (
            <div className="w-full p-4 bg-bg-secondary border border-border rounded-sm text-center space-y-2">
              <div className="flex justify-center">
                <Radio size={32} className="text-text-secondary" />
              </div>
              <div className="font-heading font-bold text-xs uppercase text-text-primary tracking-wider">
                NO ACTIVE TUNNEL DETECTED
              </div>
              <p className="font-mono text-[11px] text-text-secondary leading-relaxed">
                Run <code className="text-text-primary bg-bg-elevated px-1 py-0.5 border border-border">npm run tunnel</code> in terminal to create a free, trusted HTTPS link recognized by all phone cameras, or switch to Local Wi-Fi.
              </p>
              <button
                type="button"
                onClick={() => setConnectionMode('lan')}
                className="mt-2 px-3 py-1.5 bg-text-primary text-text-inverse font-mono font-bold text-xs uppercase btn-tactile hover:bg-white/90"
              >
                USE LOCAL WI-FI (LAN IP)
              </button>
            </div>
          ) : qrDataUrl ? (
            <>
              <img src={qrDataUrl} alt="Session Join QR Code" className="w-52 h-52 object-contain" />
              <span className="font-mono text-[10px] text-black tracking-widest mt-1 uppercase font-semibold text-center">
                {channelNumber
                  ? `SCAN WITH PHONE CAMERA // SLOT: MIC ${String(channelNumber).padStart(2, '0')}`
                  : `SCAN WITH PHONE CAMERA // SESSION: ${sessionId}`}
              </span>
            </>
          ) : (
            <div className="w-52 h-52 flex items-center justify-center font-mono text-xs text-black">
              GENERATING MATRIX...
            </div>
          )}
        </div>

        {/* Tunnel Configuration Input (When Tunnel mode is selected) */}
        {connectionMode === 'tunnel' && (
          <div className="my-2 p-2.5 bg-bg-main border border-border rounded-sm space-y-2 text-xs font-mono">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-text-muted uppercase tracking-wider font-bold flex items-center gap-1">
                <ShieldCheck size={12} className={probeStatus === 'verified' ? 'text-green-400' : 'text-text-muted'} />
                <span>TRUSTED HTTPS TUNNEL (ZERO WARNINGS)</span>
              </span>
              {probeStatus === 'verified' ? (
                <span className="text-[10px] text-green-400 font-bold uppercase tracking-wider flex items-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
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
                className="flex-1 bg-bg-secondary border border-border text-text-primary px-2.5 py-1 text-xs font-mono focus:border-text-primary"
              />
              <button
                type="submit"
                disabled={isApplyingTunnel}
                className="px-3 py-1 bg-text-primary text-text-inverse font-bold text-xs uppercase btn-tactile hover:bg-white/90 shrink-0"
              >
                {isApplyingTunnel ? 'TESTING...' : 'APPLY & VERIFY'}
              </button>
            </form>

            <div className="text-[10px] text-text-secondary leading-relaxed">
              Run <code className="text-text-primary bg-bg-secondary px-1 py-0.5 border border-border">npm run tunnel</code> in terminal, or paste your ngrok / Cloudflare tunnel URL above.
            </div>
          </div>
        )}

        {/* Network & Pairing URL Info */}
        <div className="my-2 p-2.5 bg-bg-main border border-border rounded-sm space-y-2">
          <div className="flex items-center justify-between text-xs font-mono bg-bg-secondary p-2 border border-border">
            <span className="truncate max-w-[280px] text-text-primary font-mono text-[11px]">{joinUrl}</span>
            <button
              onClick={copyToClipboard}
              className="flex items-center gap-1 px-2.5 py-1 bg-text-primary text-text-inverse font-bold rounded-sm text-[11px] btn-tactile hover:bg-white/90 shrink-0"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? 'COPIED' : 'COPY'}
            </button>
          </div>

          {connectionMode === 'lan' && (
            <div className="text-[10px] font-mono text-text-muted leading-relaxed">
              <span className="text-text-primary font-bold">LOCAL WI-FI NOTICE: </span>
              Phone and laptop must be connected to the same Wi-Fi or mobile hotspot. Served over standard HTTP on port 5173 to avoid browser certificate blocks. For zero warnings and mobile browser camera access from any network, use <button onClick={() => setConnectionMode('tunnel')} className="text-text-primary underline font-bold">Secure Tunnel mode</button>.
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
            className="flex items-center gap-1 text-xs font-mono text-text-primary hover:underline"
          >
            <span>Open in Tab</span>
            <ExternalLink size={12} />
          </a>
        </div>
      </div>
    </div>
  );
};
