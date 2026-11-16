import React from 'react';
import { Participant, PriorityLevel } from '../types.js';
import { RetroVUMeter } from './RetroVUMeter.js';
import { Mic, MicOff, Shield, Radio, PowerOff, User, Wifi } from 'lucide-react';
import { PeerNetworkStats } from '../audio/HostAudioEngine.js';

interface MicCardProps {
  participant: Participant;
  isSelected: boolean;
  onSelect: () => void;
  onToggleMute: (muted: boolean) => void;
  onChangePriority: (priority: PriorityLevel) => void;
  onKick: () => void;
  isQuickSlot?: boolean;
  stats?: PeerNetworkStats;
  trimMultiplier?: number;
  onTrimChange?: (trim: number) => void;
}

export const MicCard = React.memo<MicCardProps>(({
  participant,
  isSelected,
  onSelect,
  onToggleMute,
  onChangePriority,
  onKick,
  isQuickSlot = false,
  stats,
  trimMultiplier = 1.5,
  onTrimChange
}) => {
  const isMuted = participant.isMutedByAdmin || participant.isMutedSelf;
  const micLabel = `MIC ${String(participant.channelNumber).padStart(2, '0')}`;

  const cyclePriority = () => {
    const sequence: PriorityLevel[] = ['VIP', 'Normal', 'Low'];
    const nextIdx = (sequence.indexOf(participant.priority) + 1) % sequence.length;
    onChangePriority(sequence[nextIdx]);
  };

  return (
    <div
      className={`relative flex flex-col p-3.5 transition-all rounded-2xl w-full min-w-0 ${
        isSelected
          ? 'liquid-glass-active text-text-primary'
          : 'liquid-glass text-text-primary hover:border-accent-blue/40'
      }`}
    >
      {/* Card Header: Channel & State */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`font-mono text-xs font-bold tracking-wider px-2 py-0.5 rounded border ${
            isSelected 
              ? 'bg-accent-blue text-white border-accent-blue shadow-sm' 
              : 'bg-bg-secondary text-text-primary border-border'
          }`}>
            {micLabel}
          </span>
          {isQuickSlot && (
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
              isSelected ? 'border-accent-blue/50 text-accent-blue' : 'border-border text-text-muted'
            }`}>
              BUS
            </span>
          )}
        </div>

        {/* State Badge */}
        <div className="flex items-center gap-1.5">
          <div
            className={`w-2 h-2 rounded-full ${
              participant.state === 'ACTIVE SPEAKER'
                ? 'bg-accent-blue animate-ping shadow-[0_0_8px_rgba(52,120,246,0.8)]'
                : participant.state === 'MUTED'
                ? 'bg-text-muted'
                : participant.state === 'READY'
                ? 'bg-emerald-400'
                : 'border border-text-muted bg-transparent'
            }`}
          />
          <span className={`text-[10px] font-mono uppercase tracking-wider font-semibold ${
            isSelected ? 'text-accent-blue' : 'text-text-secondary'
          }`}>
            {participant.state}
          </span>
        </div>
      </div>

      {/* Participant Name & Priority */}
      <div className="flex items-baseline justify-between mb-2.5">
        <div className="truncate max-w-[140px]">
          <h4 className="font-heading font-semibold text-sm truncate flex items-center gap-1.5 text-text-primary">
            <User size={13} className={isSelected ? 'text-accent-blue' : 'text-text-muted'} />
            {participant.name}
          </h4>
          <span className={`text-[10px] font-mono ${isSelected ? 'text-accent-blue/80' : 'text-text-muted'}`}>
            ID: {participant.id.substring(0, 6)}
          </span>
        </div>

        {/* Priority Badge button */}
        <button
          onClick={cyclePriority}
          title="Click to cycle priority: VIP -> Normal -> Low"
          className={`flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
            isSelected
              ? 'border-accent-blue/60 bg-accent-blue/15 text-accent-blue hover:bg-accent-blue hover:text-white'
              : 'border-border bg-bg-secondary text-text-secondary hover:text-text-primary hover:border-border-hover'
          }`}
        >
          <Shield size={10} />
          <span>{participant.priority}</span>
        </button>
      </div>

      {/* Real-time Hardware VU Meter */}
      <div className="my-1.5">
        <RetroVUMeter
          level={isMuted ? 0 : participant.audioLevel}
          segments={14}
          height="h-3"
          showLabels={false}
          label={isMuted ? 'SIGNAL: MUTED' : participant.isSpeaking ? 'VOICE DETECTED' : 'SIGNAL'}
        />
      </div>

      {/* RF & Wi-Fi Link Quality & Clipping Alert */}
      <div className={`flex items-center justify-between text-[10px] font-mono px-2 py-1 rounded border mt-1 ${
        stats?.isClipping
          ? 'border-red-500/70 bg-red-950/40 text-red-300 font-bold animate-pulse'
          : isSelected 
          ? 'border-accent-blue/30 bg-bg-secondary text-text-secondary' 
          : 'border-border/60 bg-bg-secondary text-text-secondary'
      }`}>
        <div className="flex items-center gap-1">
          {stats?.isClipping ? (
            <span className="text-red-400 font-bold">⚠️ CLIPPING</span>
          ) : (
            <>
              <Wifi size={10} className={stats && stats.packetLossPct > 5 ? 'animate-pulse text-red-400' : 'text-accent-blue/70'} />
              <span>{stats && stats.rttMs > 0 ? `${stats.rttMs}ms` : 'LINK OK'}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className={stats && stats.packetLossPct > 5 ? 'font-bold underline text-red-400' : ''}>
            LOSS: {stats ? `${stats.packetLossPct}%` : '0%'}
          </span>
          {stats && stats.jitterMs > 0 && (
            <span>±{stats.jitterMs}ms</span>
          )}
        </div>
      </div>

      {/* Pre-Amp Channel Gain Trim */}
      {onTrimChange && (
        <div className={`flex items-center justify-between text-[10px] font-mono mt-1.5 px-2 py-0.5 rounded border ${
          isSelected ? 'border-accent-blue/20 text-text-secondary' : 'border-border/60 text-text-secondary'
        }`}>
          <span>TRIM: {trimMultiplier.toFixed(1)}x ({trimMultiplier >= 1 ? '+' : ''}{Math.round(20 * Math.log10(trimMultiplier))}dB)</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onTrimChange(Math.max(0.5, Number((trimMultiplier - 0.25).toFixed(2))))}
              className={`px-1.5 font-bold border rounded ${isSelected ? 'border-accent-blue/40 hover:bg-accent-blue hover:text-white' : 'border-border hover:border-border-hover hover:text-text-primary'}`}
              title="Decrease channel trim (-2dB)"
            >
              -
            </button>
            <button
              onClick={() => onTrimChange(Math.min(3.5, Number((trimMultiplier + 0.25).toFixed(2))))}
              className={`px-1.5 font-bold border rounded ${isSelected ? 'border-accent-blue/40 hover:bg-accent-blue hover:text-white' : 'border-border hover:border-border-hover hover:text-text-primary'}`}
              title="Increase channel trim (+2dB)"
            >
              +
            </button>
          </div>
        </div>
      )}

      {/* Controls Bar */}
      <div className="grid grid-cols-3 gap-2 mt-2.5 pt-2 border-t border-border/60">
        {/* Route / Broadcast button */}
        <button
          onClick={onSelect}
          className={`col-span-2 py-2 px-2 text-xs font-mono font-bold tracking-wider uppercase rounded-lg border btn-tactile flex items-center justify-center gap-1.5 shadow-sm min-h-[38px] ${
            isSelected
              ? 'bg-accent-blue text-white border-accent-blue hover:bg-accent-blue-hover'
              : 'bg-bg-secondary text-text-primary border-border hover:border-border-hover hover:text-white'
          }`}
        >
          <Radio size={12} className={isSelected ? 'animate-pulse' : ''} />
          {isSelected ? 'ON AIR' : 'ROUTE'}
        </button>

        {/* Mute button */}
        <button
          onClick={() => onToggleMute(!isMuted)}
          title={isMuted ? 'Unmute participant' : 'Mute participant'}
          className={`py-2 px-1.5 text-xs rounded-lg border btn-tactile flex items-center justify-center transition-colors min-h-[38px] ${
            isMuted
              ? 'bg-red-950/50 text-red-300 border-red-500/50 shadow-sm'
              : isSelected
              ? 'border-accent-blue/50 bg-bg-secondary text-accent-blue hover:bg-accent-blue hover:text-white'
              : 'border-border bg-bg-secondary text-text-secondary hover:text-text-primary hover:border-border-hover'
          }`}
        >
          {isMuted ? <MicOff size={14} /> : <Mic size={14} />}
        </button>
      </div>

      {/* Kick/Disconnect small footer action */}
      <div className="flex justify-end mt-2">
        <button
          onClick={onKick}
          title="Disconnect participant"
          className="text-[9px] font-mono flex items-center gap-1 opacity-60 hover:opacity-100 transition-opacity text-text-muted hover:text-red-400 py-1"
        >
          <PowerOff size={9} />
          <span>EJECT</span>
        </button>
      </div>
    </div>
  );
}, (prev, next) => {
  return (
    prev.isSelected === next.isSelected &&
    prev.isQuickSlot === next.isQuickSlot &&
    prev.trimMultiplier === next.trimMultiplier &&
    prev.participant.id === next.participant.id &&
    prev.participant.name === next.participant.name &&
    prev.participant.state === next.participant.state &&
    prev.participant.priority === next.participant.priority &&
    prev.participant.channelNumber === next.participant.channelNumber &&
    prev.participant.isSpeaking === next.participant.isSpeaking &&
    prev.participant.isMutedByAdmin === next.participant.isMutedByAdmin &&
    prev.participant.isMutedSelf === next.participant.isMutedSelf &&
    Math.round((prev.participant.audioLevel || 0) / 4) === Math.round((next.participant.audioLevel || 0) / 4) &&
    prev.stats?.isClipping === next.stats?.isClipping &&
    prev.stats?.packetLossPct === next.stats?.packetLossPct &&
    prev.stats?.rttMs === next.stats?.rttMs
  );
});
