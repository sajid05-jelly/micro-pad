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

export const MicCard: React.FC<MicCardProps> = ({
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
      className={`relative flex flex-col p-3.5 transition-all border rounded-xl ${
        isSelected
          ? 'bg-burgundy-deep/90 text-text-primary border-gold shadow-lg shadow-gold/10 ring-1 ring-gold/40'
          : 'bg-bg-card text-text-primary border-border hover:border-gold/40'
      }`}
    >
      {/* Card Header: Channel & State */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`font-mono text-xs font-bold tracking-wider px-2 py-0.5 rounded border ${
            isSelected 
              ? 'bg-gold text-bg-main border-gold shadow-sm' 
              : 'bg-bg-main text-text-primary border-border'
          }`}>
            {micLabel}
          </span>
          {isQuickSlot && (
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
              isSelected ? 'border-gold/50 text-gold' : 'border-border text-text-muted'
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
                ? 'bg-gold animate-ping shadow-[0_0_8px_rgba(214,179,106,0.8)]'
                : participant.state === 'MUTED'
                ? 'bg-text-muted'
                : participant.state === 'READY'
                ? 'bg-gold/80'
                : 'border border-text-muted bg-transparent'
            }`}
          />
          <span className={`text-[10px] font-mono uppercase tracking-wider font-semibold ${
            isSelected ? 'text-gold' : 'text-text-secondary'
          }`}>
            {participant.state}
          </span>
        </div>
      </div>

      {/* Participant Name & Priority */}
      <div className="flex items-baseline justify-between mb-2.5">
        <div className="truncate max-w-[140px]">
          <h4 className="font-heading font-semibold text-sm truncate flex items-center gap-1.5 text-text-primary">
            <User size={13} className={isSelected ? 'text-gold' : 'text-text-muted'} />
            {participant.name}
          </h4>
          <span className={`text-[10px] font-mono ${isSelected ? 'text-gold/80' : 'text-text-muted'}`}>
            ID: {participant.id.substring(0, 6)}
          </span>
        </div>

        {/* Priority Badge button */}
        <button
          onClick={cyclePriority}
          title="Click to cycle priority: VIP -> Normal -> Low"
          className={`flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
            isSelected
              ? 'border-gold/60 bg-gold/15 text-gold hover:bg-gold hover:text-bg-main'
              : 'border-border bg-bg-main text-text-secondary hover:text-gold hover:border-gold/50'
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
          ? 'border-red-500/70 bg-burgundy-glow/60 text-red-300 font-bold animate-pulse'
          : isSelected 
          ? 'border-gold/30 bg-burgundy-subtle text-gold/90' 
          : 'border-border/60 bg-bg-main text-text-secondary'
      }`}>
        <div className="flex items-center gap-1">
          {stats?.isClipping ? (
            <span className="text-red-400 font-bold">⚠️ CLIPPING</span>
          ) : (
            <>
              <Wifi size={10} className={stats && stats.packetLossPct > 5 ? 'animate-pulse text-red-400' : 'text-gold/70'} />
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
          isSelected ? 'border-gold/20 text-gold/90' : 'border-border/60 text-text-secondary'
        }`}>
          <span>TRIM: {trimMultiplier.toFixed(1)}x ({trimMultiplier >= 1 ? '+' : ''}{Math.round(20 * Math.log10(trimMultiplier))}dB)</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onTrimChange(Math.max(0.5, Number((trimMultiplier - 0.25).toFixed(2))))}
              className={`px-1.5 font-bold border rounded ${isSelected ? 'border-gold/40 hover:bg-gold hover:text-bg-main' : 'border-border hover:border-gold hover:text-gold'}`}
              title="Decrease channel trim (-2dB)"
            >
              -
            </button>
            <button
              onClick={() => onTrimChange(Math.min(3.5, Number((trimMultiplier + 0.25).toFixed(2))))}
              className={`px-1.5 font-bold border rounded ${isSelected ? 'border-gold/40 hover:bg-gold hover:text-bg-main' : 'border-border hover:border-gold hover:text-gold'}`}
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
          className={`col-span-2 py-1.5 px-2 text-xs font-mono font-bold tracking-wider uppercase rounded-lg border btn-tactile flex items-center justify-center gap-1.5 shadow-sm ${
            isSelected
              ? 'bg-gold text-bg-main border-gold hover:bg-gold-light'
              : 'bg-burgundy-deep text-text-primary border-border hover:border-gold/60 hover:text-gold'
          }`}
        >
          <Radio size={12} className={isSelected ? 'animate-pulse' : ''} />
          {isSelected ? 'ON AIR' : 'ROUTE'}
        </button>

        {/* Mute button */}
        <button
          onClick={() => onToggleMute(!isMuted)}
          title={isMuted ? 'Unmute participant' : 'Mute participant'}
          className={`py-1.5 px-1.5 text-xs rounded-lg border btn-tactile flex items-center justify-center transition-colors ${
            isMuted
              ? 'bg-burgundy-glow text-red-300 border-red-500/40 shadow-sm'
              : isSelected
              ? 'border-gold/50 bg-burgundy-deep text-gold hover:bg-gold hover:text-bg-main'
              : 'border-border bg-bg-main text-text-secondary hover:text-gold hover:border-gold/50'
          }`}
        >
          {isMuted ? <MicOff size={13} /> : <Mic size={13} />}
        </button>
      </div>

      {/* Kick/Disconnect small footer action */}
      <div className="flex justify-end mt-2">
        <button
          onClick={onKick}
          title="Disconnect participant"
          className="text-[9px] font-mono flex items-center gap-1 opacity-60 hover:opacity-100 transition-opacity text-text-muted hover:text-red-400"
        >
          <PowerOff size={9} />
          <span>EJECT</span>
        </button>
      </div>
    </div>
  );
};
