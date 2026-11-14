import React, { useState } from 'react';
import { PriorityLevel } from '../types.js';
import { Radio, User, ArrowRight, ShieldAlert, RefreshCw, Wifi, WifiOff } from 'lucide-react';

interface JoinPageProps {
  initialSessionId?: string;
  assignedChannel?: number;
  assignedMicLabel?: string;
  connectionStatus: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  connectionError?: string | null;
  onRetryConnection: () => void;
  onJoin: (sessionId: string, name: string, priority: PriorityLevel, channelNumber?: number, stream?: MediaStream) => void;
  onOpenAdmin: () => void;
  onGoHome?: () => void;
}

export const JoinPage: React.FC<JoinPageProps> = ({
  initialSessionId = 'MICRO-01',
  assignedChannel,
  assignedMicLabel,
  connectionStatus,
  connectionError,
  onRetryConnection,
  onJoin,
  onOpenAdmin,
  onGoHome
}) => {
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [name, setName] = useState('');
  const [priority, setPriority] = useState<PriorityLevel>('Normal');
  const [error, setError] = useState<string | null>(null);
  const [isRequestingMic, setIsRequestingMic] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionId.trim()) {
      setError('Please provide a valid broadcast session ID');
      return;
    }
    if (!name.trim()) {
      setError('Please enter your participant call sign / name');
      return;
    }
    if (connectionStatus === 'ERROR' || connectionStatus === 'DISCONNECTED') {
      setError('Console is offline. Tap "RETRY" above to connect to host before starting transmitter.');
      return;
    }

    setIsRequestingMic(true);
    setError(null);

    // Request microphone permission directly in this user tap event gesture
    try {
      const nav = typeof navigator !== 'undefined' ? (navigator as any) : {};
      const getUserMedia = nav.mediaDevices?.getUserMedia?.bind(nav.mediaDevices) ||
        (nav.getUserMedia ? (constraints: any) => new Promise<MediaStream>((res, rej) => nav.getUserMedia(constraints, res, rej)) : null);

      let stream: MediaStream | undefined = undefined;

      if (getUserMedia) {
        try {
          stream = await getUserMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: true
            },
            video: false
          });
        } catch {
          try {
            stream = await getUserMedia({ audio: true, video: false });
          } catch (innerErr) {
            console.warn('[JoinPage] Microphone capture deferred to mobile transmitter:', innerErr);
          }
        }
      }

      setIsRequestingMic(false);
      onJoin(sessionId.trim().toUpperCase(), name.trim(), priority, assignedChannel, stream);
    } catch (err: any) {
      setIsRequestingMic(false);
      console.warn('Microphone permission request error:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError('Microphone permission is required. Please tap "Allow" when prompted by your browser.');
      } else {
        setError(`Microphone access error: ${err.message || 'Could not access audio device'}. Tap Connect Transmitter to retry.`);
      }
    }
  };

  return (
    <div className="min-h-screen bg-transparent text-text-primary flex items-center justify-center p-4 relative font-body">
      <div className="relative z-10 w-full max-w-md liquid-glass p-6 sm:p-8 rounded-3xl shadow-card">
        {/* Brand Header */}
        <div className="text-center pb-4 border-b border-border/80 mb-5">
          <div className="inline-flex items-center gap-2 px-3 py-1 liquid-glass-subtle text-[10px] font-mono tracking-widest uppercase mb-3 text-accent-blue rounded-full shadow-sm">
            <Radio size={12} />
            <span>JOIN AS MICROPHONE</span>
          </div>
          <h1 className="font-heading font-black text-2xl sm:text-3xl tracking-widest uppercase text-text-primary">
            MICRO MAX
          </h1>
          <p className="text-xs text-text-secondary font-mono mt-1.5">
            Turn your smartphone into a wireless PA microphone
          </p>
        </div>

        {/* Server Connection Status Indicator */}
        {connectionStatus !== 'CONNECTED' && (
          <div className="mb-4 p-3 liquid-glass-subtle rounded-xl font-mono text-xs space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {connectionStatus === 'CONNECTING' ? (
                  <>
                    <Wifi size={13} className="text-accent-blue animate-pulse" />
                    <span className="font-bold text-text-primary uppercase tracking-wider">CONNECTING TO CONSOLE...</span>
                  </>
                ) : (
                  <>
                    <WifiOff size={13} className="text-red-400" />
                    <span className="font-bold text-red-300 uppercase tracking-wider">CONSOLE OFFLINE</span>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={onRetryConnection}
                className="px-2.5 py-1 bg-accent-blue text-white font-bold text-[10px] uppercase rounded hover:bg-accent-blue-hover flex items-center gap-1 shrink-0 transition-colors"
                title="Retry connecting to console"
              >
                <RefreshCw size={10} className={connectionStatus === 'CONNECTING' ? 'animate-spin' : ''} />
                <span>RETRY</span>
              </button>
            </div>
            <p className="text-[11px] text-text-secondary font-body">
              {connectionError || (connectionStatus === 'CONNECTING'
                ? 'Establishing link with host PA console. Please wait...'
                : 'Could not connect to PA console. If on Wi-Fi, ensure your phone is connected to the same hotspot/network.')}
            </p>
          </div>
        )}

        {/* Assigned Microphone Slot Badge (when joining via direct slot QR code) */}
        {assignedMicLabel && (
          <div className="mb-4 p-3 liquid-glass-subtle border border-accent-blue/30 rounded-xl flex items-center justify-between font-mono text-xs shadow-sm">
            <div className="flex items-center gap-2">
              <Radio size={14} className="text-accent-blue animate-pulse" />
              <span className="text-text-secondary uppercase">ASSIGNED SLOT:</span>
            </div>
            <div className="font-bold text-white px-2.5 py-1 bg-accent-blue rounded border border-accent-blue shadow-sm">
              {assignedMicLabel}
            </div>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="mb-4 p-3 bg-red-950/40 border border-red-500/50 text-xs font-mono text-text-primary flex items-start gap-2.5 rounded-xl">
            <ShieldAlert size={16} className="mt-0.5 shrink-0 text-red-400" />
            <div className="space-y-1">
              <div className="font-bold uppercase tracking-wider text-red-300">AUDIO SETUP REQUIRED</div>
              <div className="text-text-secondary font-body leading-relaxed">{error}</div>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 font-mono text-xs">
          {/* Session ID Input */}
          <div className="space-y-1.5">
            <label className="text-[10px] text-text-muted uppercase tracking-wider block font-semibold">
              SESSION CODE
            </label>
            <input
              type="text"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value.toUpperCase())}
              placeholder="E.G. MICRO-01"
              required
              className="w-full bg-bg-secondary border border-border text-text-primary p-3 rounded-xl font-mono text-sm tracking-widest uppercase focus:border-accent-blue transition-colors outline-none"
            />
          </div>

          {/* Participant Call Sign */}
          <div className="space-y-1.5">
            <label className="text-[10px] text-text-muted uppercase tracking-wider block font-semibold">
              YOUR NAME
            </label>
            <div className="relative">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="E.G. ALEX / SPEAKER 1"
                required
                className="w-full bg-bg-secondary border border-border text-text-primary p-3 rounded-xl font-mono text-sm focus:border-accent-blue transition-colors outline-none"
              />
              <User size={15} className="absolute right-3.5 top-3.5 text-text-muted" />
            </div>
          </div>

          {/* Priority Selection */}
          <div className="space-y-1.5">
            <label className="text-[10px] text-text-muted uppercase tracking-wider block font-semibold">
              ROLE / PRIORITY
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['VIP', 'Normal', 'Low'] as PriorityLevel[]).map((level) => (
                <button
                  type="button"
                  key={level}
                  onClick={() => setPriority(level)}
                  className={`py-2 px-1 text-center border font-mono text-xs uppercase rounded-lg transition-all ${
                    priority === level
                      ? 'bg-accent-blue text-white border-accent-blue font-bold shadow-sm'
                      : 'bg-bg-secondary text-text-secondary border-border hover:border-border-hover'
                  }`}
                >
                  {level === 'VIP' ? 'VIP / LEAD' : level}
                </button>
              ))}
            </div>
          </div>

          {/* Guidelines */}
          <div className="p-3 bg-bg-secondary border border-border rounded-xl text-[11px] font-body text-text-secondary space-y-1">
            <div className="font-mono text-[9px] text-accent-blue uppercase tracking-wider font-semibold">
              BEFORE YOU CONNECT
            </div>
            <p>&bull; Tap Connect Microphone and allow browser microphone permission when asked.</p>
            <p>&bull; Stay connected to the same Wi-Fi / hotspot as the speaker laptop.</p>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isRequestingMic}
            className="w-full py-3.5 bg-accent-blue text-white font-heading font-semibold text-sm tracking-wider uppercase border border-accent-blue rounded-xl hover:bg-accent-blue-hover flex items-center justify-center gap-2 shadow-blue-glow disabled:opacity-50 transition-all active:scale-[0.99]"
          >
            <span>{isRequestingMic ? 'STARTING MIC...' : 'CONNECT MICROPHONE'}</span>
            <ArrowRight size={16} />
          </button>
        </form>

        {/* Navigation Links */}
        <div className="mt-6 pt-4 border-t border-border/80 flex items-center justify-between text-[11px] font-mono">
          {onGoHome ? (
            <button
              onClick={onGoHome}
              className="text-text-muted hover:text-text-primary uppercase tracking-wider transition-colors"
            >
              &larr; Home
            </button>
          ) : (
            <span className="text-text-muted">Host or Sound Tech?</span>
          )}
          <button
            onClick={onOpenAdmin}
            className="text-accent-blue hover:text-accent-blue-light uppercase tracking-wider transition-colors"
          >
            Open Control Room &rarr;
          </button>
        </div>
      </div>
    </div>
  );
};
