import React, { useEffect, useState, useRef } from 'react';
import { HostAudioEngine } from '../audio/HostAudioEngine.js';
import { RetroVUMeter } from './RetroVUMeter.js';

interface MasterVUMeterProps {
  hostAudio: HostAudioEngine;
  isMuted: boolean;
  activeSpeakerAudioLevel?: number;
}

/**
 * Isolated Master VU Meter Component.
 * Runs its own RAF audio polling loop without triggering re-renders in the parent AdminControlRoom.
 * Throttles state updates to ~20 FPS and only updates when visual segment changes.
 */
export const MasterVUMeter: React.FC<MasterVUMeterProps> = React.memo(({
  hostAudio,
  isMuted,
  activeSpeakerAudioLevel = 0
}) => {
  const [meterLevel, setMeterLevel] = useState(0);
  const activeLevelRef = useRef(activeSpeakerAudioLevel);
  activeLevelRef.current = activeSpeakerAudioLevel;
  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;

  useEffect(() => {
    let animId: number;
    let lastFlush = 0;

    const poll = (time: number) => {
      // Throttle meter state updates to ~20 FPS (every 50ms)
      if (time - lastFlush >= 50) {
        lastFlush = time;
        if (isMutedRef.current) {
          setMeterLevel(0);
        } else {
          const hostLvl = hostAudio.getMasterLevel();
          const targetLvl = Math.max(hostLvl, activeLevelRef.current);
          setMeterLevel(prev => {
            // Only update state if change is >= 1% to prevent wasteful React renders
            if (Math.abs(prev - targetLvl) >= 1) {
              return targetLvl;
            }
            return prev;
          });
        }
      }
      animId = requestAnimationFrame(poll);
    };

    animId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(animId);
  }, [hostAudio]);

  return (
    <RetroVUMeter
      level={isMuted ? 0 : meterLevel}
      segments={22}
      height="h-5"
      showLabels={true}
      label="MASTER PA OUTPUT LEVEL"
    />
  );
});
