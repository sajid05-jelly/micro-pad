import React, { useRef, useEffect } from 'react';
import { WifiOff } from 'lucide-react';

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
  const leftReelRef = useRef<HTMLDivElement>(null);
  const rightReelRef = useRef<HTMLDivElement>(null);

  // JS Logic for Infinite Continuous Drag and Auto-Spin
  useEffect(() => {
    const leftContainer = leftReelRef.current;
    const rightContainer = rightReelRef.current;
    if (!leftContainer || !rightContainer) return;

    const reels = [
      {
        container: leftContainer,
        element: leftContainer.querySelector<HTMLElement>('.reel-element'),
        angle: 0,
        isDragging: false,
        center: { x: 0, y: 0 },
        lastPointerAngle: 0
      },
      {
        container: rightContainer,
        element: rightContainer.querySelector<HTMLElement>('.reel-element'),
        angle: 0,
        isDragging: false,
        center: { x: 0, y: 0 },
        lastPointerAngle: 0
      }
    ];

    const cleanups: (() => void)[] = [];

    reels.forEach(reel => {
      const container = reel.container;
      if (!container) return;

      const updateCenter = () => {
        const rect = container.getBoundingClientRect();
        reel.center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      };

      const getAngleFromEvent = (e: MouseEvent | TouchEvent) => {
        const clientX = 'touches' in e && e.touches.length > 0 ? e.touches[0].clientX : (e as MouseEvent).clientX;
        const clientY = 'touches' in e && e.touches.length > 0 ? e.touches[0].clientY : (e as MouseEvent).clientY;
        return Math.atan2(clientY - reel.center.y, clientX - reel.center.x) * (180 / Math.PI);
      };

      const onStart = (e: MouseEvent | TouchEvent) => {
        reel.isDragging = true;
        updateCenter();
        reel.lastPointerAngle = getAngleFromEvent(e);
      };

      const onMove = (e: MouseEvent | TouchEvent) => {
        if (!reel.isDragging) return;

        // Prevent default scrolling when dragging reels on mobile
        if (e.cancelable) {
          e.preventDefault();
        }

        const currentPointerAngle = getAngleFromEvent(e);
        let deltaAngle = currentPointerAngle - reel.lastPointerAngle;

        // Handle angle wrapping (jumping from 180 to -180) to ensure continuous rotation
        if (deltaAngle > 180) deltaAngle -= 360;
        if (deltaAngle < -180) deltaAngle += 360;

        reel.angle += deltaAngle;
        reel.lastPointerAngle = currentPointerAngle;
      };

      const onEnd = () => {
        reel.isDragging = false;
      };

      // Mouse Events
      container.addEventListener('mousedown', onStart);
      window.addEventListener('mousemove', onMove, { passive: false });
      window.addEventListener('mouseup', onEnd);

      // Touch Events
      container.addEventListener('touchstart', onStart, { passive: false });
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', onEnd);

      cleanups.push(() => {
        container.removeEventListener('mousedown', onStart);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onEnd);

        container.removeEventListener('touchstart', onStart);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend', onEnd);
      });
    });

    // Animation Loop for Auto-Spin & Applying Angles
    let animId: number;
    const animate = () => {
      reels.forEach(reel => {
        if (!reel.isDragging) {
          reel.angle += 0.8; // Auto spin speed
        }
        if (reel.element) {
          reel.element.style.transform = `rotate(${reel.angle}deg)`;
        }
      });
      animId = requestAnimationFrame(animate);
    };
    animId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animId);
      cleanups.forEach(c => c());
    };
  }, []);

  return (
    <div className="min-h-screen bg-transparent p-4 md:p-10 flex flex-col justify-center items-center font-sans text-white relative">
      {/* Huge Vertical Brand Mark on Left (Bottom-to-Top orientation) */}
      <div className="fixed left-0 top-0 bottom-0 w-24 md:w-32 lg:w-40 z-0 pointer-events-none select-none hidden md:flex items-center justify-center">
        <span className="font-heading font-black text-5xl md:text-6xl lg:text-7xl xl:text-8xl 2xl:text-9xl tracking-[0.3em] uppercase text-transparent bg-clip-text bg-gradient-to-r from-sky-400/40 via-white/20 to-white/5 whitespace-nowrap transform -rotate-90 origin-center drop-shadow-[0_0_30px_rgba(14,165,233,0.18)]">
          MIC MAX
        </span>
      </div>

      {/* Offline Alert Banner (Only shown if offline/error) */}
      {connectionStatus !== 'CONNECTED' && connectionStatus !== 'CONNECTING' && (
        <div className="relative z-20 max-w-md w-full mx-auto mb-6 px-4 py-2 bg-white/5 backdrop-blur-md border border-red-500/40 text-red-300 rounded-full text-xs font-mono flex items-center justify-between gap-3 shadow-lg">
          <div className="flex items-center gap-2">
            <WifiOff size={13} className="text-red-400" />
            <span>CONSOLE OFFLINE</span>
          </div>
          <button
            onClick={onRetryConnection}
            className="px-2.5 py-0.5 bg-sky-500 text-white font-bold text-[10px] uppercase rounded hover:bg-sky-400 transition-colors"
          >
            RETRY
          </button>
        </div>
      )}

      {/* UNIFIED TAPE RECORDER DECK */}
      <div className="w-full max-w-5xl bg-white/[0.015] backdrop-blur-[40px] rounded-[2.5rem] border border-white/5 p-6 md:p-10 shadow-[0_20px_50px_rgba(0,0,0,0.5),inset_0_2px_0_rgba(255,255,255,0.05)] relative overflow-hidden">

        {/* Deck Hardware Screws (Realistic 3D Phillips Head) */}
        <div className="absolute top-5 left-5 w-4 h-4 rounded-full bg-gradient-to-br from-slate-400 to-slate-700 shadow-[inset_0_1px_2px_rgba(255,255,255,0.8),0_1px_2px_rgba(0,0,0,0.8)] flex items-center justify-center border border-slate-800 z-20">
          <div className="absolute w-[60%] h-[1px] bg-slate-900 shadow-[0_1px_0_rgba(255,255,255,0.3)] rotate-45"></div>
          <div className="absolute w-[60%] h-[1px] bg-slate-900 shadow-[0_1px_0_rgba(255,255,255,0.3)] -rotate-45"></div>
        </div>
        <div className="absolute top-5 right-5 w-4 h-4 rounded-full bg-gradient-to-br from-slate-400 to-slate-700 shadow-[inset_0_1px_2px_rgba(255,255,255,0.8),0_1px_2px_rgba(0,0,0,0.8)] flex items-center justify-center border border-slate-800 z-20">
          <div className="absolute w-[60%] h-[1px] bg-slate-900 shadow-[0_1px_0_rgba(255,255,255,0.3)] rotate-45"></div>
          <div className="absolute w-[60%] h-[1px] bg-slate-900 shadow-[0_1px_0_rgba(255,255,255,0.3)] -rotate-45"></div>
        </div>
        <div className="absolute bottom-5 left-5 w-4 h-4 rounded-full bg-gradient-to-br from-slate-400 to-slate-700 shadow-[inset_0_1px_2px_rgba(255,255,255,0.8),0_1px_2px_rgba(0,0,0,0.8)] flex items-center justify-center border border-slate-800 z-20">
          <div className="absolute w-[60%] h-[1px] bg-slate-900 shadow-[0_1px_0_rgba(255,255,255,0.3)] rotate-45"></div>
          <div className="absolute w-[60%] h-[1px] bg-slate-900 shadow-[0_1px_0_rgba(255,255,255,0.3)] -rotate-45"></div>
        </div>
        <div className="absolute bottom-5 right-5 w-4 h-4 rounded-full bg-gradient-to-br from-slate-400 to-slate-700 shadow-[inset_0_1px_2px_rgba(255,255,255,0.8),0_1px_2px_rgba(0,0,0,0.8)] flex items-center justify-center border border-slate-800 z-20">
          <div className="absolute w-[60%] h-[1px] bg-slate-900 shadow-[0_1px_0_rgba(255,255,255,0.3)] rotate-45"></div>
          <div className="absolute w-[60%] h-[1px] bg-slate-900 shadow-[0_1px_0_rgba(255,255,255,0.3)] -rotate-45"></div>
        </div>

        {/* MAIN CASSETTE WINDOW (Top Section) */}
        <div className="bg-[#03050a] rounded-3xl border border-white/5 shadow-[inset_0_10px_40px_rgba(0,0,0,0.8)] relative flex flex-col md:flex-row mb-8 overflow-hidden">
          
          {/* Full-Height Complete Center Divider Line */}
          <div className="hidden md:block absolute left-1/2 top-0 bottom-0 -translate-x-1/2 w-[1px] bg-white/10 pointer-events-none z-20"></div>

          {/* LEFT REEL COMPARTMENT (Start a Session) */}
          <div className="flex-1 w-full relative z-10 flex flex-col items-center text-center p-6 md:p-10 border-b md:border-b-0 md:border-r border-white/10 transition-all duration-300 hover:bg-white/[0.02] hover:shadow-[inset_0_0_35px_rgba(255,255,255,0.06),0_0_30px_rgba(255,255,255,0.1)] group cursor-default">
            
            {/* Interactive Spinning Tape Reel */}
            <div
              id="reel-left"
              ref={leftReelRef}
              className="w-40 h-40 md:w-48 md:h-48 rounded-full border-[6px] border-[#1e293b] bg-[#0a1122] flex items-center justify-center shadow-[0_0_30px_rgba(0,0,0,0.8),inset_0_5px_15px_rgba(0,0,0,0.6)] relative mb-6 cursor-grab active:cursor-grabbing touch-none select-none group-hover:border-white/30 group-hover:shadow-[0_0_35px_rgba(255,255,255,0.15)] transition-all duration-300"
            >
              {/* Rotating Wrapper */}
              <div className="reel-element absolute inset-0 w-full h-full pointer-events-none rounded-full flex items-center justify-center">
                {/* Minimal Cyan Edge Light */}
                <div className="absolute inset-[2px] rounded-full border-t-[3px] border-r-[1px] border-cyan-400 opacity-60 shadow-[inset_0_0_15px_rgba(34,211,238,0.2)]"></div>
                {/* Dashed Spokes */}
                <div className="absolute inset-[2px] rounded-full border-[15px] border-dashed border-[#1e293b]/60"></div>
              </div>
              {/* Center Spindle (Static) */}
              <div className="w-10 h-10 md:w-12 md:h-12 bg-white/5 rounded-full border-2 border-white/10 flex items-center justify-center shadow-inner z-10 pointer-events-none">
                <div className="w-2 h-2 md:w-3 md:h-3 bg-black rounded-full"></div>
              </div>
            </div>

            {/* Text Content */}
            <div className="mb-6">
              <span className="text-slate-300 text-[10px] md:text-xs font-bold tracking-widest uppercase block mb-2">For Event Hosts & Stage</span>
              <h3 className="text-white text-xl md:text-2xl font-semibold mb-2">Start a Session</h3>
              <p className="text-slate-400 text-xs md:text-sm max-w-[250px] mx-auto">Host a live event from this device. Connect this laptop to your PA speaker.</p>
            </div>

            {/* Black and White Action Button */}
            <button
              onClick={onStartSession}
              className="bg-white text-black hover:bg-slate-200 font-bold px-6 md:px-8 py-3 rounded-xl text-sm md:text-base transition-all border border-white shadow-[0_0_20px_rgba(255,255,255,0.25)] hover:shadow-[0_0_35px_rgba(255,255,255,0.5)] w-full max-w-[220px] active:scale-[0.98]"
            >
              START SESSION &rarr;
            </button>
          </div>

          {/* RIGHT REEL COMPARTMENT (Join as Microphone) */}
          <div className="flex-1 w-full relative z-10 flex flex-col items-center text-center p-6 md:p-10 transition-all duration-300 hover:bg-white/[0.02] hover:shadow-[inset_0_0_35px_rgba(255,255,255,0.06),0_0_30px_rgba(255,255,255,0.1)] group cursor-default">
            
            {/* Interactive Spinning Tape Reel */}
            <div
              id="reel-right"
              ref={rightReelRef}
              className="w-40 h-40 md:w-48 md:h-48 rounded-full border-[6px] border-[#1e293b] bg-[#0a1122] flex items-center justify-center shadow-[0_0_30px_rgba(0,0,0,0.8),inset_0_5px_15px_rgba(0,0,0,0.6)] relative mb-6 cursor-grab active:cursor-grabbing touch-none select-none group-hover:border-white/30 group-hover:shadow-[0_0_35px_rgba(255,255,255,0.15)] transition-all duration-300"
            >
              {/* Rotating Wrapper */}
              <div className="reel-element absolute inset-0 w-full h-full pointer-events-none rounded-full flex items-center justify-center">
                {/* Minimal Cyan Edge Light */}
                <div className="absolute inset-[2px] rounded-full border-t-[3px] border-r-[1px] border-cyan-400 opacity-60 shadow-[inset_0_0_15px_rgba(34,211,238,0.2)]"></div>
                {/* Dashed Spokes */}
                <div className="absolute inset-[2px] rounded-full border-[15px] border-dashed border-[#1e293b]/60"></div>
              </div>
              {/* Center Spindle (Static) */}
              <div className="w-10 h-10 md:w-12 md:h-12 bg-white/5 rounded-full border-2 border-white/10 flex items-center justify-center shadow-inner z-10 pointer-events-none">
                <div className="w-2 h-2 md:w-3 md:h-3 bg-black rounded-full"></div>
              </div>
            </div>

            {/* Text Content */}
            <div className="mb-6">
              <span className="text-slate-400 text-[10px] md:text-xs font-bold tracking-widest uppercase block mb-2">For Speakers & Participants</span>
              <h3 className="text-white text-xl md:text-2xl font-semibold mb-2">Join as Microphone</h3>
              <p className="text-slate-400 text-xs md:text-sm max-w-[250px] mx-auto">Speak directly into your phone and be heard clearly through the main PA speaker.</p>
            </div>

            {/* Black and White Action Button */}
            <button
              onClick={onJoinSession}
              className="bg-black/60 hover:bg-white hover:text-black text-white px-6 md:px-8 py-3 rounded-xl text-sm md:text-base font-semibold transition-all border border-white/20 hover:border-white shadow-[0_0_15px_rgba(0,0,0,0.5)] hover:shadow-[0_0_25px_rgba(255,255,255,0.25)] w-full max-w-[220px] active:scale-[0.98]"
            >
              CONNECT MIC &rarr;
            </button>
          </div>

        </div>

        {/* CONTROL DECK (Bottom Section: Open Control Room) */}
        <div className="bg-black/20 rounded-2xl p-6 border border-white/5 hover:border-white/30 hover:bg-white/[0.02] hover:shadow-[0_0_30px_rgba(255,255,255,0.12),inset_0_1px_2px_rgba(255,255,255,0.1)] flex flex-col md:flex-row items-center justify-between gap-6 shadow-[inset_0_10px_20px_rgba(0,0,0,0.2)] transition-all duration-300 group cursor-default">
          
          <div className="flex items-center gap-6 text-center md:text-left">
            {/* Mixer / Equalizer Icon */}
            <div className="w-16 h-16 rounded-xl bg-white/5 border border-white/5 group-hover:border-white/20 group-hover:shadow-[0_0_15px_rgba(255,255,255,0.1)] flex-shrink-0 items-center justify-center shadow-inner hidden md:flex backdrop-blur-sm transition-all duration-300">
              <svg className="w-8 h-8 text-white/80 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"></path>
              </svg>
            </div>
            <div>
              <span className="text-slate-400 text-[10px] md:text-xs font-bold tracking-widest uppercase block mb-1">For Sound Engineers</span>
              <h3 className="text-white text-lg md:text-xl font-semibold mb-1">Open Control Room</h3>
              <p className="text-slate-400 text-xs md:text-sm max-w-md">Manage all active microphones, switch channels (MIC 1, 2, 3), toggle Auto-Voice switching, and adjust master PA volume.</p>
            </div>
          </div>

          {/* Deck Action Button */}
          <button
            onClick={onOpenControlRoom}
            className="bg-black/60 hover:bg-white hover:text-black text-white px-6 md:px-8 py-4 rounded-xl text-sm md:text-base font-semibold transition-all border border-white/20 hover:border-white shadow-[0_0_15px_rgba(0,0,0,0.5)] hover:shadow-[0_0_25px_rgba(255,255,255,0.25)] flex-shrink-0 flex items-center justify-center gap-2 w-full md:w-auto active:scale-[0.98]"
          >
            ENTER CONTROL ROOM &rarr;
          </button>

        </div>

      </div>
    </div>
  );
};
