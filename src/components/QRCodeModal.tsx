import React, { useEffect, useState } from 'react';
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
  ArrowRight
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

  // Sync resolved IP and tunnel defaults
  useEffect(() => {
    if (localIp && localIp !== 'localhost' && localIp !== '127.0.0.1' && !localIp.startsWith('169.254.')) {
      setResolvedIp(localIp);
    } else if (isOpen) {
      fetch('/api/info')
        .then(r => r.json())
        .then(data => {
          if (data.localIp && data.localIp !== 'localhost' && !data.localIp.startsWith('169.254.')) {
            setResolvedIp(data.localIp);
          }
          if (data.tunnelUrl && !customTunnel) {
            setCustomTunnel(data.tunnelUrl);
            setConnectionMode('tunnel');
          }
        })
        .catch(() => {});
    }
  }, [localIp, isOpen]);

  // Set default mode to tunnel if active
  useEffect(() => {
    if (tunnelUrl) {
      setCustomTunnel(tunnelUrl);
      setConnectionMode('tunnel');
    }
  }, [tunnelUrl]);

  // Compute join URL with valid LAN IP (Never localhost or 127.0.0.1)
  const effectiveIp = (resolvedIp && resolvedIp !== 'localhost' && resolvedIp !== '127.0.0.1' && !resolvedIp.startsWith('169.254.'))
    ? resolvedIp
    : (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'
        ? window.location.hostname
        : '172.20.10.5');

  const protocol = (typeof window !== 'undefined' && window.location.protocol === 'http:') ? 'http:' : 'https:';

  const params = new URLSearchParams();
  params.set('session', sessionId);
  params.set('role', 'join'); // Explicitly open Participant Join Page
  if (channelNumber) {
    params.set('channel', String(channelNumber));
    params.set('mic', `MIC ${String(channelNumber).padStart(2, '0')}`);
  }

  // Determine effective base host
  let effectiveBaseHost = `${protocol}//${effectiveIp}:5173`;
  const activeTunnel = customTunnel.trim() || tunnelUrl;

  if (connectionMode === 'tunnel' && activeTunnel) {
    let cleanTunnel = activeTunnel.trim().replace(/\/+$/, '');
    if (!cleanTunnel.startsWith('http://') && !cleanTunnel.startsWith('https://')) {
      cleanTunnel = `https://${cleanTunnel}`;
    }
    effectiveBaseHost = cleanTunnel;
  }

  const joinUrl = `${effectiveBaseHost}/?${params.toString()}`;

  useEffect(() => {
    if (isOpen) {
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
    }
  }, [isOpen, joinUrl]);

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

        {/* QR Code Container */}
        <div className="flex flex-col items-center justify-center p-3 bg-white rounded-sm my-2">
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="Session Join QR Code" className="w-52 h-52 object-contain" />
          ) : (
            <div className="w-52 h-52 flex items-center justify-center font-mono text-xs text-black">
              GENERATING MATRIX...
            </div>
          )}
          <span className="font-mono text-[10px] text-black tracking-widest mt-1 uppercase font-semibold text-center">
            {channelNumber
              ? `SCAN WITH DEFAULT PHONE CAMERA // SLOT: MIC ${String(channelNumber).padStart(2, '0')}`
              : `SCAN WITH DEFAULT PHONE CAMERA // SESSION: ${sessionId}`}
          </span>
        </div>

        {/* Tunnel Configuration Input (When Tunnel mode is selected) */}
        {connectionMode === 'tunnel' && (
          <div className="my-2 p-2.5 bg-bg-main border border-border rounded-sm space-y-2 text-xs font-mono">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-text-muted uppercase tracking-wider font-bold flex items-center gap-1">
                <ShieldCheck size={12} className="text-green-400" />
                <span>TRUSTED HTTPS TUNNEL (GREEN PADLOCK // NO WARNINGS)</span>
              </span>
              {activeTunnel && (
                <span className="text-[10px] text-green-400 font-bold uppercase tracking-wider">
                  ACTIVE
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
                {isApplyingTunnel ? 'SAVING...' : 'APPLY'}
              </button>
            </form>

            <div className="text-[10px] text-text-secondary leading-relaxed">
              Run <code className="text-text-primary bg-bg-secondary px-1 py-0.5 border border-border">npm run tunnel</code> in terminal, or paste your ngrok / Cloudflare tunnel URL above. Provides a globally trusted SSL certificate recognized by all iPhones &amp; Androids.
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
              <span className="text-text-primary font-bold">LAN WI-FI NOTICE: </span>
              Phone must be on the same local Wi-Fi or mobile hotspot. For zero certificate prompts and instant connection, use <button onClick={() => setConnectionMode('tunnel')} className="text-text-primary underline font-bold">Secure Tunnel mode</button>.
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
