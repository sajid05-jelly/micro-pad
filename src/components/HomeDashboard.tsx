import React from 'react';
import { 
  Radio, 
  Smartphone, 
  Sliders, 
  WifiOff, 
  RefreshCw, 
  ArrowRight
} from 'lucide-react';

interface HomeDashboardProps {
  sessionId: string;
  connectionStatus: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  connectionError?: string | null;
  onRetryConnection: () => void;
  onStartSession: () => void;
  onJoinSession: () => void;
  onOpenControlRoom: () => void;
}

export const HomeDashboard: React.FC<HomeDashboardProps> = ({
  sessionId,
  connectionStatus,
  connectionError,
  onRetryConnection,
  onStartSession,
  onJoinSession,
  onOpenControlRoom
}) => {
  return (
    <div className="min-h-screen bg-bg-main text-text-primary flex flex-col font-body relative overflow-hidden">
      {/* Antigravity Ambient Glow & Dotted Halftone Texture */}
      <div className="absolute inset-0 antigravity-glow pointer-events-none" />
      <div className="absolute inset-0 antigravity-halftone pointer-events-none" />

      {/* Top Bar with Minimalist Brand & Status */}
      <header className="relative z-10 border-b border-border/80 px-4 sm:px-8 py-3.5 flex items-center justify-between bg-bg-secondary/40 backdrop-blur-md">
        <div className="flex items-center gap-3">
          {/* Audio Brand Mark */}
          <div className="w-8 h-8 rounded-lg bg-bg-card border border-border text-accent-blue flex items-center justify-center shadow-sm">
            <Radio size={16} />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-heading font-black text-lg sm:text-xl tracking-widest uppercase text-text-primary">
              MICRO MAX
            </span>
            <span className="hidden sm:inline-block text-[10px] font-mono uppercase px-1.5 py-0.5 border border-border text-text-muted rounded">
              v2.0
            </span>
          </div>
        </div>

        {/* Backend Connectivity Status */}
        <div className="flex items-center gap-2 font-mono text-xs">
          {connectionStatus === 'CONNECTED' ? (
            <div className="flex items-center gap-2 px-3 py-1 bg-bg-card border border-border text-text-primary rounded-full text-[11px] font-medium shadow-sm">
              <span className="w-2 h-2 rounded-full bg-accent-blue animate-pulse" />
              <span>SERVER READY</span>
            </div>
          ) : connectionStatus === 'CONNECTING' ? (
            <div className="flex items-center gap-1.5 px-3 py-1 bg-bg-card border border-border text-text-secondary rounded-full text-[11px]">
              <RefreshCw size={11} className="animate-spin text-accent-blue" />
              <span>CONNECTING...</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-3 py-1 bg-bg-card border border-red-500/40 text-red-300 rounded-full text-[11px]">
                <WifiOff size={11} />
                <span>OFFLINE</span>
              </div>
              <button
                onClick={onRetryConnection}
                className="px-2.5 py-1 bg-accent-blue text-white font-bold text-[10px] uppercase rounded hover:bg-accent-blue-hover transition-colors"
              >
                RETRY
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Hero & Action Cards */}
      <main className="relative z-10 flex-1 max-w-5xl w-full mx-auto px-4 sm:px-8 py-10 sm:py-16 flex flex-col justify-center">
        {/* Hero Title */}
        <div className="text-center max-w-2xl mx-auto mb-10 sm:mb-14">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 bg-bg-card border border-border text-xs font-mono uppercase tracking-widest text-text-secondary rounded-full mb-4 shadow-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-blue" />
            <span>WIRELESS PA MICROPHONE SYSTEM</span>
          </div>
          <h1 className="font-heading font-black text-3xl sm:text-5xl tracking-tight uppercase text-text-primary mb-3">
            MICRO MAX
          </h1>
          <p className="text-lg sm:text-xl text-text-secondary font-normal leading-relaxed">
            Your phone is now a wireless microphone.
          </p>
          <p className="text-xs sm:text-sm text-text-muted font-mono mt-1.5">
            Zero cables. Zero apps to install. Near-zero delay.
          </p>
        </div>

        {/* 3 Main Action Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 sm:gap-6 mb-12">
          {/* Card 1: Start a Session (Primary Action) */}
          <div className="relative group p-6 rounded-xl bg-bg-card border border-border hover:border-accent-blue/50 transition-all duration-200 flex flex-col justify-between shadow-card">
            <div>
              <div className="w-11 h-11 rounded-lg bg-bg-secondary border border-border text-accent-blue flex items-center justify-center mb-4 shadow-sm group-hover:scale-105 transition-transform">
                <Radio size={20} />
              </div>
              <div className="text-[11px] font-mono uppercase tracking-widest text-text-muted mb-1.5">
                FOR EVENT HOSTS & STAGE
              </div>
              <h2 className="font-heading font-bold text-xl text-text-primary mb-2">
                Start a Session
              </h2>
              <p className="text-xs sm:text-sm text-text-secondary leading-relaxed mb-6">
                Host a live event from this device. Connect this laptop to your PA speaker and show the QR code for others to speak.
              </p>
            </div>
            <button
              onClick={onStartSession}
              className="w-full py-3 px-4 bg-accent-blue text-white font-heading font-semibold text-xs uppercase tracking-wider rounded-lg flex items-center justify-center gap-2 hover:bg-accent-blue-hover transition-all shadow-blue-glow active:scale-[0.99]"
            >
              <span>Start Session</span>
              <ArrowRight size={14} />
            </button>
          </div>

          {/* Card 2: Join a Session */}
          <div className="relative group p-6 rounded-xl bg-bg-card border border-border hover:border-border-hover transition-all duration-200 flex flex-col justify-between shadow-card">
            <div>
              <div className="w-11 h-11 rounded-lg bg-bg-secondary border border-border text-text-secondary group-hover:text-text-primary flex items-center justify-center mb-4 shadow-sm group-hover:scale-105 transition-transform">
                <Smartphone size={20} />
              </div>
              <div className="text-[11px] font-mono uppercase tracking-widest text-text-muted mb-1.5">
                FOR SPEAKERS & PARTICIPANTS
              </div>
              <h2 className="font-heading font-bold text-xl text-text-primary mb-2">
                Join as Microphone
              </h2>
              <p className="text-xs sm:text-sm text-text-secondary leading-relaxed mb-6">
                Speak directly into your phone and be heard clearly through the room’s main PA speaker. No setup required.
              </p>
            </div>
            <button
              onClick={onJoinSession}
              className="w-full py-3 px-4 bg-bg-secondary border border-border text-text-primary font-heading font-semibold text-xs uppercase tracking-wider rounded-lg flex items-center justify-center gap-2 hover:bg-bg-elevated hover:border-border-hover transition-all"
            >
              <span>Connect Microphone</span>
              <ArrowRight size={14} />
            </button>
          </div>

          {/* Card 3: Open Control Room */}
          <div className="relative group p-6 rounded-xl bg-bg-card border border-border hover:border-border-hover transition-all duration-200 flex flex-col justify-between shadow-card">
            <div>
              <div className="w-11 h-11 rounded-lg bg-bg-secondary border border-border text-text-secondary group-hover:text-text-primary flex items-center justify-center mb-4 shadow-sm group-hover:scale-105 transition-transform">
                <Sliders size={20} />
              </div>
              <div className="text-[11px] font-mono uppercase tracking-widest text-text-muted mb-1.5">
                FOR SOUND ENGINEERS
              </div>
              <h2 className="font-heading font-bold text-xl text-text-primary mb-2">
                Open Control Room
              </h2>
              <p className="text-xs sm:text-sm text-text-secondary leading-relaxed mb-6">
                Manage all active microphones, switch channels (MIC 1, 2, 3), toggle Auto-Voice switching, and adjust master PA volume.
              </p>
            </div>
            <button
              onClick={onOpenControlRoom}
              className="w-full py-3 px-4 bg-bg-secondary border border-border text-text-primary font-heading font-semibold text-xs uppercase tracking-wider rounded-lg flex items-center justify-center gap-2 hover:bg-bg-elevated hover:border-border-hover transition-all"
            >
              <span>Enter Control Room</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </div>

        {/* 3-Step Explanation Section */}
        <div className="border border-border rounded-xl p-6 bg-bg-card shadow-card">
          <div className="text-xs font-mono font-bold uppercase tracking-widest text-text-muted mb-4 text-center">
            HOW IT WORKS IN 3 SIMPLE STEPS
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center sm:text-left">
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-bg-secondary border border-border text-accent-blue font-mono font-bold flex items-center justify-center text-sm shrink-0">
                1
              </div>
              <div>
                <h3 className="font-bold text-sm text-text-primary">Host Starts Session</h3>
                <p className="text-xs text-text-secondary mt-0.5">
                  Connect your laptop to any PA speaker or sound system.
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-bg-secondary border border-border text-accent-blue font-mono font-bold flex items-center justify-center text-sm shrink-0">
                2
              </div>
              <div>
                <h3 className="font-bold text-sm text-text-primary">Scan QR Code</h3>
                <p className="text-xs text-text-secondary mt-0.5">
                  Anyone can scan the screen QR code with their phone camera.
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-bg-secondary border border-border text-accent-blue font-mono font-bold flex items-center justify-center text-sm shrink-0">
                3
              </div>
              <div>
                <h3 className="font-bold text-sm text-text-primary">Tap & Speak Live</h3>
                <p className="text-xs text-text-secondary mt-0.5">
                  Tap Unmute. Your voice plays instantly through the PA speaker.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-border/80 py-4 px-4 text-center text-xs font-mono text-text-muted">
        MICRO MAX // WIRELESS MICROPHONE & PA BROADCAST SYSTEM
      </footer>
    </div>
  );
};
