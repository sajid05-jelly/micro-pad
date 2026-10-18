import React, { useState } from 'react';
import { PriorityLevel } from '../types.js';
import { Radio, Shield, User, ArrowRight, ShieldAlert, AlertTriangle, RefreshCw, Wifi, WifiOff } from 'lucide-react';

interface JoinPageProps {
  initialSessionId?: string;
  assignedChannel?: number;
  assignedMicLabel?: string;
  connectionStatus: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  connectionError?: string | null;
  onRetryConnection: () => void;
  onJoin: (sessionId: string, name: string, priority: PriorityLevel, channelNumber?: number, stream?: MediaStream) => void;
  onOpenAdmin: () => void;
}

export const JoinPage: React.FC<JoinPageProps> = ({
  initialSessionId = 'MICRO-01',
  assignedChannel,
  assignedMicLabel,
  connectionStatus,
  connectionError,
  onRetryConnection,
  onJoin,
  onOpenAdmin
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
    <div className="min-h-screen bg-bg-main text-text-primary flex items-center justify-center p-4">
      <div className="relative w-full max-w-md bg-bg-elevated border-2 border-border p-6 rounded-sm shadow-2xl">
        {/* Hardware rack screws */}
        <div className="absolute top-2 left-2 rack-screw" />
        <div className="absolute top-2 right-2 rack-screw" />
        <div className="absolute bottom-2 left-2 rack-screw" />
        <div className="absolute bottom-2 right-2 rack-screw" />

        {/* Brand Header */}
        <div className="text-center pb-4 border-b border-border mb-4">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 bg-bg-main border border-border text-[10px] font-mono tracking-widest uppercase mb-2">
            <Radio size={12} className="text-text-primary" />
            <span>WIRELESS TRANSMITTER GATEWAY</span>
          </div>
          <h1 className="font-heading font-black text-2xl tracking-widest uppercase text-text-primary">
            MICRO PAD
          </h1>
          <p className="text-xs text-text-secondary font-mono mt-1">
            Turn your smartphone into a wireless PA microphone
          </p>
        </div>

        {/* Server Connection Status Indicator */}
        {connectionStatus !== 'CONNECTED' && (
          <div className="mb-4 p-3 bg-bg-main border-2 border-border rounded-sm font-mono text-xs space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {connectionStatus === 'CONNECTING' ? (
                  <>
                    <Wifi size={13} className="text-text-primary animate-pulse" />
                    <span className="font-bold text-text-primary uppercase tracking-wider">CONNECTING TO CONSOLE...</span>
                  </>
                ) : (
                  <>
                    <WifiOff size={13} className="text-text-primary" />
                    <span className="font-bold text-text-primary uppercase tracking-wider">CONSOLE OFFLINE</span>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={onRetryConnection}
                className="px-2.5 py-1 bg-text-primary text-text-inverse font-bold text-[10px] uppercase btn-tactile hover:bg-white/90 flex items-center gap-1 shrink-0"
                title="Retry connecting to console"
              >
                <RefreshCw size={10} className={connectionStatus === 'CONNECTING' ? 'animate-spin' : ''} />
                <span>{connectionStatus === 'CONNECTING' ? 'RETRY' : 'RETRY'}</span>
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
          <div className="mb-4 p-3 bg-bg-main border-2 border-border rounded-sm flex items-center justify-between font-mono text-xs">
            <div className="flex items-center gap-2">
              <Radio size={14} className="text-text-primary animate-pulse" />
              <span className="text-text-secondary uppercase">ASSIGNED SLOT:</span>
            </div>
            <div className="font-bold text-text-primary px-2.5 py-1 bg-text-primary text-text-inverse border border-white">
              {assignedMicLabel}
            </div>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="mb-4 p-2.5 bg-bg-main border-2 border-border text-xs font-mono text-text-primary flex items-start gap-2">
            <ShieldAlert size={16} className="mt-0.5 shrink-0" />
            <div className="space-y-1">
              <div className="font-bold uppercase tracking-wider">AUDIO SETUP REQUIRED</div>
              <div className="text-text-secondary font-body">{error}</div>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 font-mono text-xs">
          {/* Session ID Input */}
          <div className="space-y-1">
            <label className="text-[10px] text-text-muted uppercase tracking-wider block">
              EVENT SESSION CODE
            </label>
            <input
              type="text"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value.toUpperCase())}
              placeholder="E.G. MICRO-01"
              required
              className="w-full bg-bg-main border border-border text-text-primary p-2.5 rounded-sm font-mono text-sm tracking-widest uppercase focus:border-text-primary"
            />
          </div>

          {/* Participant Call Sign */}
          <div className="space-y-1">
            <label className="text-[10px] text-text-muted uppercase tracking-wider block">
              PARTICIPANT NAME / CALL SIGN
            </label>
            <div className="relative">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="E.G. PROF. SHARMA / SPEAKER 1"
                required
                className="w-full bg-bg-main border border-border text-text-primary p-2.5 rounded-sm font-mono text-sm focus:border-text-primary"
              />
              <User size={14} className="absolute right-3 top-3 text-text-muted" />
            </div>
          </div>

          {/* Priority Selection */}
          <div className="space-y-1">
            <label className="text-[10px] text-text-muted uppercase tracking-wider block">
              SPEAKER ROLE / PRIORITY
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['VIP', 'Normal', 'Low'] as PriorityLevel[]).map((level) => (
                <button
                  type="button"
                  key={level}
                  onClick={() => setPriority(level)}
                  className={`py-2 px-1 text-center border font-mono text-xs uppercase btn-tactile ${
                    priority === level
                      ? 'bg-text-primary text-text-inverse border-white font-bold'
                      : 'bg-bg-main text-text-secondary border-border hover:border-text-primary'
                  }`}
                >
                  {level === 'VIP' ? 'VIP / LEAD' : level}
                </button>
              ))}
            </div>
          </div>

          {/* Guidelines */}
          <div className="p-3 bg-bg-main border border-border text-[11px] font-body text-text-secondary space-y-1">
            <div className="font-mono text-[9px] text-text-muted uppercase tracking-wider font-semibold">
              PRE-FLIGHT CHECK
            </div>
            <p>&bull; Tapping Connect Transmitter will request microphone access.</p>
            <p>&bull; Keep device on the same local Wi-Fi / hotspot network as the PA host.</p>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isRequestingMic}
            className="w-full py-3 bg-text-primary text-text-inverse font-mono font-bold text-sm tracking-wider uppercase border border-white btn-tactile hover:bg-white/90 flex items-center justify-center gap-2 shadow-md disabled:opacity-50"
          >
            <span>{isRequestingMic ? 'INITIALIZING MIC...' : 'CONNECT TRANSMITTER'}</span>
            <ArrowRight size={16} />
          </button>
        </form>

        {/* Switch to Admin Mode Link */}
        <div className="mt-6 pt-4 border-t border-border flex items-center justify-between text-[11px] font-mono">
          <span className="text-text-muted">Sound Engineer / Admin?</span>
          <button
            onClick={onOpenAdmin}
            className="text-text-primary hover:underline uppercase tracking-wider"
          >
            Open Control Room &rarr;
          </button>
        </div>
      </div>
    </div>
  );
};
