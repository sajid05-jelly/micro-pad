import React, { useState, useEffect } from 'react';

/**
 * Detects whether the current client is a handheld mobile phone.
 * Tablets (iPads, Galaxy Tabs) and desktop/laptop displays are excluded.
 */
export const isMobilePhone = (): boolean => {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isMobileUA = /Android.*Mobile|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const hasTouch = 'ontouchstart' in window || Boolean(navigator.maxTouchPoints && navigator.maxTouchPoints > 0);
  
  // Handheld phones have a narrow dimension typically <= 520px (accounting for DPR)
  const shortestDimension = Math.min(window.innerWidth, window.innerHeight);
  const isPhoneScreen = shortestDimension <= 520;

  return Boolean(isMobileUA || (hasTouch && isPhoneScreen));
};

export const RotatePhonePrompt: React.FC = () => {
  const [isPortraitPhone, setIsPortraitPhone] = useState<boolean>(false);
  const [dismissed, setDismissed] = useState<boolean>(false);

  useEffect(() => {
    const checkOrientation = () => {
      const isPhone = isMobilePhone();
      if (!isPhone) {
        setIsPortraitPhone(false);
        return;
      }

      const isPortrait = window.innerHeight > window.innerWidth;
      setIsPortraitPhone(isPortrait);

      // Reset dismissed state whenever the phone is rotated to horizontal
      // so if they rotate back to portrait, the helpful guide re-appears
      if (!isPortrait) {
        setDismissed(false);
      }
    };

    checkOrientation();

    window.addEventListener('resize', checkOrientation, { passive: true });
    window.addEventListener('orientationchange', checkOrientation, { passive: true });

    if (window.screen && window.screen.orientation) {
      window.screen.orientation.addEventListener('change', checkOrientation);
    }

    return () => {
      window.removeEventListener('resize', checkOrientation);
      window.removeEventListener('orientationchange', checkOrientation);
      if (window.screen && window.screen.orientation) {
        window.screen.orientation.removeEventListener('change', checkOrientation);
      }
    };
  }, []);

  if (!isPortraitPhone || dismissed) {
    return null;
  }

  return (
    <div
      role="alert"
      aria-live="polite"
      className="fixed inset-0 z-50 bg-[#05080f]/95 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center select-none transition-opacity duration-300 animate-fadeIn"
    >
      {/* Ambient Radial Accent */}
      <div className="absolute w-72 h-72 rounded-full bg-sky-500/10 blur-[80px] pointer-events-none -z-10" />

      {/* Animated Rotating Phone Device Graphic */}
      <div className="relative mb-6 flex items-center justify-center w-28 h-28">
        {/* Curved Rotation Guide Arrows */}
        <svg
          className="absolute inset-0 w-full h-full text-sky-400/40 animate-spin-slow"
          viewBox="0 0 100 100"
          fill="none"
        >
          <circle
            cx="50"
            cy="50"
            r="44"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray="14 12"
          />
        </svg>

        {/* Smartphone Body with -90deg rotation animation */}
        <div className="animate-rotate-phone w-14 h-24 rounded-2xl border-2 border-sky-400 bg-sky-950/40 shadow-[0_0_25px_rgba(14,165,233,0.35)] flex flex-col items-center justify-between p-1.5 relative">
          {/* Top Speaker / Camera Notch */}
          <div className="w-4 h-1 bg-sky-400/80 rounded-full" />
          
          {/* Screen Content Cue */}
          <div className="w-full flex-1 my-1.5 rounded-lg bg-sky-500/10 border border-sky-400/30 flex items-center justify-center">
            <span className="text-[9px] font-mono font-bold text-sky-300 tracking-tighter">MIC MAX</span>
          </div>

          {/* Bottom Home Indicator */}
          <div className="w-5 h-0.5 bg-sky-400/60 rounded-full" />
        </div>
      </div>

      {/* Badge */}
      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-500/10 border border-sky-400/30 text-sky-400 text-[10px] font-mono font-bold tracking-widest uppercase mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
        ROTATE DEVICE
      </div>

      {/* Main Title */}
      <h2 className="text-white text-2xl font-bold tracking-tight mb-2">
        USE HORIZONTAL MODE
      </h2>

      {/* Clear Guidance Text in English and Tamil */}
      <p className="text-slate-300 text-xs sm:text-sm max-w-xs mb-2 leading-relaxed">
        Please rotate your phone horizontally to landscape for the full Tape Deck console.
      </p>
      <p className="text-slate-400 text-[11px] max-w-xs mb-8 leading-relaxed">
        சிறந்த அனுபவத்திற்கு உங்கள் மொபைலை கிடைமட்டமாக (Horizontal) திருப்பவும்
      </p>

      {/* Override button for users who have portrait lock on */}
      <button
        onClick={() => setDismissed(true)}
        className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white text-xs font-mono transition-all active:scale-95"
      >
        Continue in Portrait anyway &rarr;
      </button>
    </div>
  );
};
