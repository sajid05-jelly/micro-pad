import React from 'react';
import { 
  Radio, 
  Smartphone, 
  Sliders, 
  Wifi, 
  WifiOff, 
  RefreshCw, 
  ArrowRight, 
  Volume2, 
  Sparkles,
  QrCode,
  ShieldCheck
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
    <div className="min-h-screen bg-bg-main text-text-primary flex flex-col font-body selection:bg-white selection:text-black">
      {/* Top Bar with Connection Pill */}
      <header className="border-b border-border/70 px-4 sm:px-8 py-3.5 flex items-center justify-between bg-bg-secondary/50 backdrop-blur-sm">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-md bg-white text-black flex items-center justify-center font-bold shadow-sm">
            <Radio size={18} className="animate-pulse" />
          </div>
          <div>
            <span className="font-heading font-black text-lg sm:text-xl tracking-wider uppercase text-text-primary">
              MICRO MAX
            </span>
            <span className="hidden sm:inline-block ml-2 text-[10px] font-mono uppercase px-1.5 py-0.5 border border-border text-text-secondary rounded">
              v2.0
            </span>
          </div>
        </div>

        {/* Backend Connectivity Status */}
        <div className="flex items-center gap-2 font-mono text-xs">
          {connectionStatus === 'CONNECTED' ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-950/30 border border-green-500/40 text-green-400 rounded-full text-[11px] font-medium">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span>SERVER READY</span>
            </div>
          ) : connectionStatus === 'CONNECTING' ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-yellow-950/30 border border-yellow-500/40 text-yellow-300 rounded-full text-[11px]">
              <RefreshCw size={11} className="animate-spin" />
              <span>CONNECTING...</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 px-2.5 py-1 bg-red-950/30 border border-red-500/40 text-red-300 rounded-full text-[11px]">
                <WifiOff size={11} />
                <span>OFFLINE</span>
              </div>
              <button
                onClick={onRetryConnection}
                className="px-2 py-0.5 bg-white text-black font-bold text-[10px] uppercase rounded hover:bg-neutral-200"
              >
                RETRY
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Hero & Action Cards */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-8 py-8 sm:py-12 flex flex-col justify-center">
        {/* Hero Title */}
        <div className="text-center max-w-2xl mx-auto mb-10 sm:mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-bg-elevated border border-border text-xs font-mono uppercase tracking-widest text-text-secondary rounded-full mb-4">
            <Sparkles size={13} className="text-white" />
            <span>WIRELESS PA MICROPHONE SYSTEM</span>
          </div>
          <h1 className="font-heading font-black text-3xl sm:text-5xl tracking-tight uppercase text-text-primary mb-3">
            MICRO MAX
          </h1>
          <p className="text-lg sm:text-xl text-text-secondary font-normal leading-relaxed">
            Your phone is now a wireless microphone.
          </p>
          <p className="text-xs sm:text-sm text-text-muted font-mono mt-1">
            Zero cables. Zero apps to install. Near-zero delay.
          </p>
        </div>

        {/* 3 Main Action Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 sm:gap-6 mb-12">
          {/* Card 1: Start a Session */}
          <div className="relative group p-6 rounded-lg bg-bg-elevated border-2 border-border hover:border-white transition-all duration-200 flex flex-col justify-between shadow-xl">
            <div>
              <div className="w-12 h-12 rounded-lg bg-white text-black flex items-center justify-center mb-4 shadow-md group-hover:scale-105 transition-transform">
                <Radio size={24} />
              </div>
              <div className="text-[11px] font-mono uppercase tracking-widest text-text-muted mb-1">
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
              className="w-full py-3 px-4 bg-white text-black font-heading font-bold text-xs uppercase tracking-wider rounded flex items-center justify-center gap-2 hover:bg-neutral-200 transition-colors shadow-sm"
            >
              <span>Start Session</span>
              <ArrowRight size={14} />
            </button>
          </div>

          {/* Card 2: Join a Session */}
          <div className="relative group p-6 rounded-lg bg-bg-elevated border-2 border-border hover:border-white transition-all duration-200 flex flex-col justify-between shadow-xl">
            <div>
              <div className="w-12 h-12 rounded-lg bg-bg-main border border-border text-white flex items-center justify-center mb-4 shadow-md group-hover:scale-105 transition-transform">
                <Smartphone size={24} />
              </div>
              <div className="text-[11px] font-mono uppercase tracking-widest text-text-muted mb-1">
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
              className="w-full py-3 px-4 bg-bg-main border border-border text-white font-heading font-bold text-xs uppercase tracking-wider rounded flex items-center justify-center gap-2 hover:border-white hover:bg-bg-secondary transition-colors"
            >
              <span>Connect Microphone</span>
              <ArrowRight size={14} />
            </button>
          </div>

          {/* Card 3: Open Control Room */}
          <div className="relative group p-6 rounded-lg bg-bg-elevated border-2 border-border hover:border-white transition-all duration-200 flex flex-col justify-between shadow-xl">
            <div>
              <div className="w-12 h-12 rounded-lg bg-bg-main border border-border text-white flex items-center justify-center mb-4 shadow-md group-hover:scale-105 transition-transform">
                <Sliders size={24} />
              </div>
              <div className="text-[11px] font-mono uppercase tracking-widest text-text-muted mb-1">
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
              className="w-full py-3 px-4 bg-bg-main border border-border text-white font-heading font-bold text-xs uppercase tracking-wider rounded flex items-center justify-center gap-2 hover:border-white hover:bg-bg-secondary transition-colors"
            >
              <span>Enter Control Room</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </div>

        {/* Super Simple 3-Step Guide (Easy for anyone to understand) */}
        <div className="border border-border/70 rounded-lg p-6 bg-bg-secondary/40 backdrop-blur-sm">
          <div className="text-xs font-mono font-bold uppercase tracking-widest text-text-muted mb-4 text-center">
            HOW IT WORKS IN 3 SIMPLE STEPS
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center sm:text-left">
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-white text-black font-mono font-bold flex items-center justify-center text-sm shrink-0">
                1
              </div>
              <div>
                <h3 className="font-bold text-sm text-text-primary">Host Starts Session</h3>
                <p className="text-xs text-text-secondary mt-0.5">
                  Connect your laptop to any PA speaker or projector sound.
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-white text-black font-mono font-bold flex items-center justify-center text-sm shrink-0">
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
              <div className="w-8 h-8 rounded-full bg-white text-black font-mono font-bold flex items-center justify-center text-sm shrink-0">
                3
              </div>
              <div>
                <h3 className="font-bold text-sm text-text-primary">Tap & Speak Live</h3>
                <p className="text-xs text-text-secondary mt-0.5">
                  Tap Unmute. Your voice plays instantly through the PA speaker!
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/60 py-4 px-4 text-center text-xs font-mono text-text-muted">
        MICRO MAX // WIRELESS MICROPHONE & PA BROADCAST SYSTEM
      </footer>
    </div>
  );
};
