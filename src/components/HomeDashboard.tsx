import React, { useRef, useEffect } from 'react';
import { WifiOff } from 'lucide-react';
import { RotatePhonePrompt } from './RotatePhonePrompt.js';

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

        // Attach move and end listeners ONLY while dragging for maximum 120fps performance
        window.addEventListener('mousemove', onMove, { passive: false });
        window.addEventListener('mouseup', onEnd);
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onEnd);
      };

      const onMove = (e: MouseEvent | TouchEvent) => {
        if (!reel.isDragging) return;

        // Prevent default scrolling when dragging reels on mobile touch screens
        if (e.cancelable) {
          e.preventDefault();
        }

        const currentPointerAngle = getAngleFromEvent(e);
        let deltaAngle = currentPointerAngle - reel.lastPointerAngle;

        // Handle angle wrapping (jumping from 180 to -180) to ensure continuous rotation
        if (deltaAngle > 180) deltaAngle -= 360;
        if (deltaAngle < -180) deltaAngle += 360;

        reel.angle = (reel.angle + deltaAngle) % 360;
        reel.lastPointerAngle = currentPointerAngle;
      };

      const onEnd = () => {
        reel.isDragging = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onEnd);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend', onEnd);
      };

      // Attach touch/mouse start to the specific container
      container.addEventListener('mousedown', onStart);
      container.addEventListener('touchstart', onStart, { passive: false });

      cleanups.push(() => {
        container.removeEventListener('mousedown', onStart);
        container.removeEventListener('touchstart', onStart);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onEnd);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend', onEnd);
      });
    });

    // Hardware-Accelerated 120 FPS Animation Loop
    let animId: number;
    let lastTime = performance.now();

    const animate = (currentTime: number) => {
      const delta = Math.min((currentTime - lastTime) / 16.67, 2.5);
      lastTime = currentTime;

      reels.forEach(reel => {
        if (!reel.isDragging) {
          reel.angle = (reel.angle + 0.8 * delta) % 360;
        }
        if (reel.element) {
          // Hardware-accelerated translateZ(0) prevents main-thread re-rasterization
          reel.element.style.transform = `rotate(${reel.angle}deg) translateZ(0)`;
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
    <div className="fixed inset-0 w-full h-full h-[100dvh] overflow-hidden bg-transparent px-3 py-2 sm:px-6 sm:py-3 md:px-8 md:py-4 flex flex-col justify-center items-center font-sans text-white select-none touch-none overscroll-none">
      {/* Mobile-Only Orientation Lock Prompt: prompts user to use horizontal/landscape mode */}
      <RotatePhonePrompt />

      {/* Vertical Brand Mark on Left (Bottom-to-Top orientation, proportioned to fit screen height) */}
      <div className="fixed left-0 top-0 bottom-0 w-16 md:w-20 lg:w-24 z-0 pointer-events-none select-none hidden md:flex items-center justify-center">
        <span className="font-heading font-black text-3xl sm:text-4xl md:text-5xl lg:text-6xl tracking-[0.2em] uppercase text-transparent bg-clip-text bg-gradient-to-r from-sky-400/40 via-white/20 to-white/5 whitespace-nowrap transform -rotate-90 origin-center drop-shadow-[0_0_25px_rgba(14,165,233,0.18)]">
          MIC MAX
        </span>
      </div>

      {/* Offline Alert Banner (Only shown if offline/error) */}
      {connectionStatus !== 'CONNECTED' && connectionStatus !== 'CONNECTING' && (
        <div className="relative z-20 max-w-md w-full mx-auto mb-1.5 sm:mb-2 px-3 py-1 bg-white/5 backdrop-blur-md border border-red-500/40 text-red-300 rounded-full text-xs font-mono flex items-center justify-between gap-3 shadow-lg flex-shrink-0">
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
      <div className="deck-container bg-white/[0.015] backdrop-blur-[30px] rounded-[1.75rem] md:rounded-[2.25rem] border border-white/5 p-3 sm:p-4 md:p-5 lg:p-6 shadow-[0_20px_50px_rgba(0,0,0,0.5),inset_0_2px_0_rgba(255,255,255,0.05)] relative overflow-hidden flex flex-col justify-between max-h-[92vh] max-h-[92dvh] my-auto">

        {/* Deck Hardware Screws (Realistic 3D Phillips Head) */}
        <div className="absolute top-3 left-3 sm:top-3.5 sm:left-3.5 md:top-4 md:left-4 w-3.5 h-3.5 rounded-full bg-gradient-to-br from-slate-400 to-slate-700 shadow-[inset_0_1px_2px_rgba(255,255,255,0.8),0_1px_2px_rgba(0,0,0,0.8)] flex items-center justify-center border border-slate-800 z-20">
          <div className="absolute w-[60%] h-[1px] bg-slate-900 shadow-[0_1px_0_rgba(255,255,255,0.3)] rotate-45"></div>
          <div className="absolute w-[60%] h-[1px] bg-slate-900 shadow-[0_1px_0_rgba(255,255,255,0.3)] -rotate-45"></div>
        </div>
        <div className="absolute top-3 right-3 sm:top-3.5 sm:right-3.5 md:top-4 md:right-4 w-3.5 h-3.5 rounded-full bg-gradient-to-br from-slate-400 to-slate-700 shadow-[inset_0_1px_2px_rgba(255,255,255,0.8),0_1px_2px_rgba(0,0,0,0.8)] flex items-center justify-center border border-slate-800 z-20">
          <div className="absolute w-[60%] h-[1px] bg-slate-900 shadow-[0_1px_0_rgba(255,255,255,0.3)] rotate-45"></div>
          <div className="absolute w-[60%] h-[1px] bg-slate-900 shadow-[0_1px_0_rgba(255,255,255,0.3)] -rotate-45"></div>
        </div>
        <div className="absolute bottom-3 left-3 sm:bottom-3.5 sm:left-3.5 md:bottom-4 md:left-4 w-3.5 h-3.5 rounded-full bg-gradient-to-br from-slate-400 to-slate-700 shadow-[inset_0_1px_2px_rgba(255,255,255,0.8),0_1px_2px_rgba(0,0,0,0.8)] flex items-center justify-center border border-slate-800 z-20">
          <div className="absolute w-[60%] h-[1px] bg-slate-900 shadow-[0_1px_0_rgba(255,255,255,0.3)] rotate-45"></div>
          <div className="absolute w-[60%] h-[1px] bg-slate-900 shadow-[0_1px_0_rgba(255,255,255,0.3)] -rotate-45"></div>
        </div>
        <div className="absolute bottom-3 right-3 sm:bottom-3.5 sm:right-3.5 md:bottom-4 md:right-4 w-3.5 h-3.5 rounded-full bg-gradient-to-br from-slate-400 to-slate-700 shadow-[inset_0_1px_2px_rgba(255,255,255,0.8),0_1px_2px_rgba(0,0,0,0.8)] flex items-center justify-center border border-slate-800 z-20">
          <div className="absolute w-[60%] h-[1px] bg-slate-900 shadow-[0_1px_0_rgba(255,255,255,0.3)] rotate-45"></div>
          <div className="absolute w-[60%] h-[1px] bg-slate-900 shadow-[0_1px_0_rgba(255,255,255,0.3)] -rotate-45"></div>
        </div>

        {/* MAIN CASSETTE WINDOW (Top Section) */}
        <div className="bg-[#03050a] rounded-xl md:rounded-2xl border border-white/5 shadow-[inset_0_10px_40px_rgba(0,0,0,0.8)] relative flex flex-col md:flex-row mb-2.5 sm:mb-3 md:mb-4 overflow-hidden">
          
          {/* Full-Height Complete Center Divider Line */}
          <div className="hidden md:block absolute left-1/2 top-0 bottom-0 -translate-x-1/2 w-[1px] bg-white/10 pointer-events-none z-20"></div>

          {/* LEFT REEL COMPARTMENT (Start a Session) */}
          <div className="flex-1 w-full relative z-10 flex flex-col items-center text-center p-2.5 sm:p-3 md:p-4 lg:p-5 border-b md:border-b-0 border-white/10 transition-all duration-300 hover:bg-white/[0.02] hover:shadow-[inset_0_0_35px_rgba(255,255,255,0.06),0_0_30px_rgba(255,255,255,0.1)] group cursor-default">
            
            {/* Interactive Spinning Tape Reel */}
            <div
              id="reel-left"
              ref={leftReelRef}
              className="w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 lg:w-32 lg:h-32 xl:w-36 xl:h-36 rounded-full border-[4px] md:border-[5px] border-[#1e293b] bg-[#0a1122] flex items-center justify-center shadow-[0_0_25px_rgba(0,0,0,0.8),inset_0_4px_12px_rgba(0,0,0,0.6)] relative mb-1.5 sm:mb-2 md:mb-2.5 cursor-grab active:cursor-grabbing touch-none select-none group-hover:border-white/30 group-hover:shadow-[0_0_30px_rgba(255,255,255,0.15)] transition-all duration-300 flex-shrink-0"
            >
              {/* Rotating Wrapper */}
              <div className="reel-element absolute inset-0 w-full h-full pointer-events-none rounded-full flex items-center justify-center">
                {/* Minimal Cyan Edge Light */}
                <div className="absolute inset-[2px] rounded-full border-t-[2.5px] border-r-[1px] border-cyan-400 opacity-60 shadow-[inset_0_0_12px_rgba(34,211,238,0.2)]"></div>
                {/* Dashed Spokes */}
                <div className="absolute inset-[2px] rounded-full border-[10px] md:border-[12px] border-dashed border-[#1e293b]/60"></div>
              </div>
              {/* Center Spindle (Static) */}
              <div className="w-7 h-7 sm:w-8 sm:h-8 md:w-9 md:h-9 bg-white/5 rounded-full border border-white/15 flex items-center justify-center shadow-inner z-10 pointer-events-none">
                <div className="w-1.5 h-1.5 md:w-2 md:h-2 bg-black rounded-full"></div>
              </div>
            </div>

            {/* Text Content */}
            <div className="mb-2 sm:mb-2.5">
              <span className="text-slate-300 text-[8px] sm:text-[9px] md:text-[10px] font-bold tracking-widest uppercase block mb-0.5">For Event Hosts & Stage</span>
              <h3 className="text-white text-base sm:text-lg md:text-xl font-semibold mb-0.5">Start a Session</h3>
              <p className="text-slate-400 text-[10px] sm:text-[11px] md:text-xs max-w-[240px] mx-auto line-clamp-1 md:line-clamp-2">Host a live event from this device. Connect this laptop to your PA speaker.</p>
            </div>

            {/* Black and White Action Button */}
            <button
              onClick={onStartSession}
              className="bg-white text-black hover:bg-slate-200 font-bold px-4 sm:px-5 md:px-6 py-1.5 sm:py-2 md:py-2.5 rounded-lg md:rounded-xl text-xs sm:text-sm transition-all border border-white shadow-[0_0_15px_rgba(255,255,255,0.2)] hover:shadow-[0_0_25px_rgba(255,255,255,0.4)] w-full max-w-[200px] active:scale-[0.98]"
            >
              START SESSION &rarr;
            </button>
          </div>

          {/* RIGHT REEL COMPARTMENT (Join as Microphone) */}
          <div className="flex-1 w-full relative z-10 flex flex-col items-center text-center p-2.5 sm:p-3 md:p-4 lg:p-5 transition-all duration-300 hover:bg-white/[0.02] hover:shadow-[inset_0_0_35px_rgba(255,255,255,0.06),0_0_30px_rgba(255,255,255,0.1)] group cursor-default">
            
            {/* Interactive Spinning Tape Reel */}
            <div
              id="reel-right"
              ref={rightReelRef}
              className="w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 lg:w-32 lg:h-32 xl:w-36 xl:h-36 rounded-full border-[4px] md:border-[5px] border-[#1e293b] bg-[#0a1122] flex items-center justify-center shadow-[0_0_25px_rgba(0,0,0,0.8),inset_0_4px_12px_rgba(0,0,0,0.6)] relative mb-1.5 sm:mb-2 md:mb-2.5 cursor-grab active:cursor-grabbing touch-none select-none group-hover:border-white/30 group-hover:shadow-[0_0_30px_rgba(255,255,255,0.15)] transition-all duration-300 flex-shrink-0"
            >
              {/* Rotating Wrapper */}
              <div className="reel-element absolute inset-0 w-full h-full pointer-events-none rounded-full flex items-center justify-center">
                {/* Minimal Cyan Edge Light */}
                <div className="absolute inset-[2px] rounded-full border-t-[2.5px] border-r-[1px] border-cyan-400 opacity-60 shadow-[inset_0_0_12px_rgba(34,211,238,0.2)]"></div>
                {/* Dashed Spokes */}
                <div className="absolute inset-[2px] rounded-full border-[10px] md:border-[12px] border-dashed border-[#1e293b]/60"></div>
              </div>
              {/* Center Spindle (Static) */}
              <div className="w-7 h-7 sm:w-8 sm:h-8 md:w-9 md:h-9 bg-white/5 rounded-full border border-white/15 flex items-center justify-center shadow-inner z-10 pointer-events-none">
                <div className="w-1.5 h-1.5 md:w-2 md:h-2 bg-black rounded-full"></div>
              </div>
            </div>

            {/* Text Content */}
            <div className="mb-2 sm:mb-2.5">
              <span className="text-slate-400 text-[8px] sm:text-[9px] md:text-[10px] font-bold tracking-widest uppercase block mb-0.5">For Speakers & Participants</span>
              <h3 className="text-white text-base sm:text-lg md:text-xl font-semibold mb-0.5">Join as Microphone</h3>
              <p className="text-slate-400 text-[10px] sm:text-[11px] md:text-xs max-w-[240px] mx-auto line-clamp-1 md:line-clamp-2">Speak directly into your phone and be heard clearly through the main PA speaker.</p>
            </div>

            {/* Black and White Action Button */}
            <button
              onClick={onJoinSession}
              className="bg-black/60 hover:bg-white hover:text-black text-white px-4 sm:px-5 md:px-6 py-1.5 sm:py-2 md:py-2.5 rounded-lg md:rounded-xl text-xs sm:text-sm font-semibold transition-all border border-white/20 hover:border-white shadow-[0_0_15px_rgba(0,0,0,0.5)] hover:shadow-[0_0_20px_rgba(255,255,255,0.2)] w-full max-w-[200px] active:scale-[0.98]"
            >
              CONNECT MIC &rarr;
            </button>
          </div>

        </div>

        {/* CONTROL DECK (Bottom Section: Open Control Room) */}
        <div className="bg-black/20 rounded-lg md:rounded-xl p-2.5 sm:p-3 md:p-3.5 border border-white/5 hover:border-white/30 hover:bg-white/[0.02] hover:shadow-[0_0_25px_rgba(255,255,255,0.1),inset_0_1px_2px_rgba(255,255,255,0.1)] flex flex-col md:flex-row items-center justify-between gap-2.5 md:gap-4 shadow-[inset_0_10px_20px_rgba(0,0,0,0.2)] transition-all duration-300 group cursor-default flex-shrink-0">
          
          <div className="flex items-center gap-3 md:gap-4 text-center md:text-left">
            {/* Mixer / Equalizer Icon */}
            <div className="w-9 h-9 md:w-10 md:h-10 rounded-lg bg-white/5 border border-white/5 group-hover:border-white/20 group-hover:shadow-[0_0_12px_rgba(255,255,255,0.1)] flex-shrink-0 items-center justify-center shadow-inner hidden md:flex backdrop-blur-sm transition-all duration-300">
              <svg className="w-5 h-5 text-white/80 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"></path>
              </svg>
            </div>
            <div>
              <span className="text-slate-400 text-[8px] sm:text-[9px] md:text-[10px] font-bold tracking-widest uppercase block mb-0.5">For Sound Engineers</span>
              <h3 className="text-white text-sm md:text-base font-semibold mb-0.5">Open Control Room</h3>
              <p className="text-slate-400 text-[10px] sm:text-[11px] md:text-xs max-w-md line-clamp-1">Manage all active microphones, switch channels (MIC 1, 2, 3), toggle Auto-Voice switching, and adjust master PA volume.</p>
            </div>
          </div>

          {/* Deck Action Button */}
          <button
            onClick={onOpenControlRoom}
            className="bg-black/60 hover:bg-white hover:text-black text-white px-4 sm:px-5 md:px-6 py-2 sm:py-2.5 rounded-lg md:rounded-xl text-xs sm:text-sm font-semibold transition-all border border-white/20 hover:border-white shadow-[0_0_15px_rgba(0,0,0,0.5)] hover:shadow-[0_0_20px_rgba(255,255,255,0.2)] flex-shrink-0 flex items-center justify-center gap-1.5 w-full md:w-auto active:scale-[0.98]"
          >
            ENTER CONTROL ROOM &rarr;
          </button>

        </div>

      </div>
    </div>
  );
};
