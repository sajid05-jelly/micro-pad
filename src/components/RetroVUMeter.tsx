import React, { useEffect, useState } from 'react';

interface RetroVUMeterProps {
  level: number; // 0 to 100
  segments?: number;
  height?: string;
  showLabels?: boolean;
  isPeak?: boolean;
  label?: string;
  numericValue?: string;
}

export const RetroVUMeter: React.FC<RetroVUMeterProps> = ({
  level,
  segments = 16,
  height = 'h-4',
  showLabels = false,
  isPeak = false,
  label,
  numericValue
}) => {
  const [peakHold, setPeakHold] = useState(0);

  useEffect(() => {
    if (level > peakHold) {
      setPeakHold(level);
    } else {
      const timer = setTimeout(() => {
        setPeakHold(prev => Math.max(0, prev - 3));
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [level, peakHold]);

  const activeCount = Math.round((level / 100) * segments);
  const peakSegmentIndex = Math.min(segments - 1, Math.floor((peakHold / 100) * segments));

  return (
    <div className="w-full flex flex-col gap-1 font-mono select-none">
      {label && (
        <div className="flex justify-between items-center text-[10px] text-text-secondary uppercase tracking-widest">
          <span>{label}</span>
          <span className="font-bold">{numericValue ?? (level > 0 ? `-${Math.round((100 - level) * 0.4)} dB` : '-INF dB')}</span>
        </div>
      )}

      {/* Meter Bar */}
      <div className={`w-full ${height} bg-bg-main border border-border flex items-center p-0.5 gap-0.5 relative`}>
        {Array.from({ length: segments }).map((_, i) => {
          const isActive = i < activeCount;
          const isPeakBar = i === peakSegmentIndex && peakHold > 5;
          const isOverload = i >= segments - 2;

          return (
            <div
              key={i}
              className={`flex-1 h-full transition-all duration-75 ${
                isActive
                  ? isOverload
                    ? 'bg-text-primary' // Monochrome overload indicator
                    : 'bg-text-secondary'
                  : isPeakBar
                  ? 'bg-text-muted border-b border-text-primary'
                  : 'bg-[#151515]'
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
          <span className="text-text-primary font-bold">+3</span>
        </div>
      )}
    </div>
  );
};
