import React, { useEffect, useState, useRef } from 'react';

interface RetroVUMeterProps {
  level: number; // 0 to 100
  segments?: number;
  height?: string;
  showLabels?: boolean;
  isPeak?: boolean;
  label?: string;
  numericValue?: string;
}

export const RetroVUMeter: React.FC<RetroVUMeterProps> = React.memo(({
  level,
  segments = 16,
  height = 'h-4',
  showLabels = false,
  isPeak = false,
  label,
  numericValue
}) => {
  const [peakHold, setPeakHold] = useState(0);
  const peakRef = useRef(0);
  const levelRef = useRef(level);
  levelRef.current = level;

  useEffect(() => {
    if (level > peakRef.current) {
      peakRef.current = level;
      setPeakHold(level);
    }
  }, [level]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (peakRef.current > levelRef.current) {
        peakRef.current = Math.max(levelRef.current, peakRef.current - 4);
        setPeakHold(peakRef.current);
      }
    }, 100);
    return () => clearInterval(interval);
  }, []);

  const activeCount = Math.round((level / 100) * segments);
  const peakSegmentIndex = Math.min(segments - 1, Math.floor((peakHold / 100) * segments));

  return (
    <div className="w-full flex flex-col gap-1.5 font-mono select-none">
      {label && (
        <div className="flex justify-between items-center text-[10px] text-text-secondary uppercase tracking-widest">
          <span>{label}</span>
          <span className="font-bold text-accent-blue">{numericValue ?? (level > 0 ? `-${Math.round((100 - level) * 0.4)} dB` : '-INF dB')}</span>
        </div>
      )}

      {/* Meter Bar */}
      <div className={`w-full ${height} bg-bg-secondary border border-border rounded-md flex items-center p-0.5 gap-0.5 relative shadow-inner`}>
        {Array.from({ length: segments }).map((_, i) => {
          const isActive = i < activeCount;
          const isPeakBar = i === peakSegmentIndex && peakHold > 5;
          const isOverload = i >= segments - 2;

          return (
            <div
              key={i}
              className={`flex-1 h-full rounded-xs transition-all duration-75 ${
                isActive
                  ? isOverload
                    ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.7)]'
                    : 'bg-accent-blue shadow-[0_0_6px_rgba(52,120,246,0.5)]'
                  : isPeakBar
                  ? 'bg-accent-blue/50 border-b border-accent-blue'
                  : 'bg-[#18181D]'
              }`}
            />
          );
        })}
      </div>

      {showLabels && (
        <div className="flex justify-between text-[9px] text-text-muted font-mono tracking-tighter px-0.5">
          <span>-40</span>
          <span>-20</span>
          <span>-10</span>
          <span>-6</span>
          <span>-3</span>
          <span>0</span>
          <span className="text-red-400 font-bold">+3</span>
        </div>
      )}
    </div>
  );
});
