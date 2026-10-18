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
      className={`relative flex flex-col p-3 transition-all border ${
        isSelected
          ? 'bg-text-primary text-text-inverse border-text-primary shadow-lg ring-2 ring-white/20'
          : 'bg-bg-elevated text-text-primary border-border hover:border-border-focus'
      } rounded-sm`}
    >
      {/* Corner screw styling for retro hardware feel */}
      <div className="absolute top-1.5 left-1.5 rack-screw opacity-60" />
      <div className="absolute top-1.5 right-1.5 rack-screw opacity-60" />

      {/* Card Header: Channel & State */}
      <div className="flex items-center justify-between mt-1 mb-2">
        <div className="flex items-center gap-2">
          <span className={`font-mono text-xs font-bold tracking-wider px-1.5 py-0.5 border ${
            isSelected 
              ? 'bg-black text-white border-black' 
              : 'bg-bg-main text-text-primary border-border'
          }`}>
            {micLabel}
          </span>
          {isQuickSlot && (
            <span className={`text-[10px] font-mono px-1 border ${
              isSelected ? 'border-black text-black' : 'border-border text-text-muted'
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
                ? isSelected ? 'bg-black animate-ping' : 'bg-white animate-pulse'
                : participant.state === 'MUTED'
                ? 'bg-text-muted'
                : participant.state === 'READY'
                ? isSelected ? 'bg-black' : 'bg-text-primary'
                : 'border border-text-muted bg-transparent'
            }`}
          />
          <span className={`text-[10px] font-mono uppercase tracking-wider font-semibold ${
            isSelected ? 'text-black' : 'text-text-secondary'
          }`}>
            {participant.state}
          </span>
        </div>
      </div>

      {/* Participant Name & Priority */}
      <div className="flex items-baseline justify-between mb-2">
        <div className="truncate max-w-[140px]">
          <h4 className="font-heading font-semibold text-sm truncate flex items-center gap-1">
            <User size={12} className={isSelected ? 'text-black' : 'text-text-muted'} />
            {participant.name}
          </h4>
          <span className={`text-[10px] font-mono ${isSelected ? 'text-black/70' : 'text-text-muted'}`}>
            ID: {participant.id.substring(0, 6)}
          </span>
        </div>

        {/* Priority Badge button */}
        <button
          onClick={cyclePriority}
          title="Click to cycle priority: VIP -> Normal -> Low"
          className={`flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 border transition-colors ${
            isSelected
              ? 'border-black bg-black/10 text-black hover:bg-black hover:text-white'
              : 'border-border bg-bg-main text-text-secondary hover:text-text-primary hover:border-text-primary'
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
          height="h-3.5"
          showLabels={false}
          label={isMuted ? 'SIGNAL: MUTED' : participant.isSpeaking ? 'VOICE DETECTED' : 'SIGNAL'}
        />
      </div>

      {/* RF & Wi-Fi Link Quality */}
      <div className={`flex items-center justify-between text-[10px] font-mono px-1.5 py-0.5 rounded border ${
        isSelected ? 'border-black/30 bg-black/5 text-black' : 'border-border/60 bg-bg-main text-text-secondary'
      }`}>
        <div className="flex items-center gap-1">
          <Wifi size={10} className={stats && stats.packetLossPct > 10 ? 'animate-pulse text-red-500' : ''} />
          <span>{stats && stats.rttMs > 0 ? `${stats.rttMs}ms` : 'LINK OK'}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={stats && stats.packetLossPct > 5 ? 'font-bold underline' : ''}>
            LOSS: {stats ? `${stats.packetLossPct}%` : '0%'}
          </span>
          {stats && stats.jitterMs > 0 && (
            <span>±{stats.jitterMs}ms</span>
          )}
        </div>
      </div>

      {/* Pre-Amp Channel Gain Trim */}
      {onTrimChange && (
        <div className={`flex items-center justify-between text-[10px] font-mono mt-1 px-1.5 py-0.5 border ${
          isSelected ? 'border-black/30 text-black' : 'border-border/60 text-text-secondary'
        }`}>
          <span>TRIM: {trimMultiplier.toFixed(1)}x ({trimMultiplier >= 1 ? '+' : ''}{Math.round(20 * Math.log10(trimMultiplier))}dB)</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onTrimChange(Math.max(0.5, Number((trimMultiplier - 0.25).toFixed(2))))}
              className={`px-1 font-bold border ${isSelected ? 'border-black hover:bg-black hover:text-white' : 'border-border hover:border-text-primary'}`}
              title="Decrease channel trim (-2dB)"
            >
              -
            </button>
            <button
              onClick={() => onTrimChange(Math.min(3.5, Number((trimMultiplier + 0.25).toFixed(2))))}
              className={`px-1 font-bold border ${isSelected ? 'border-black hover:bg-black hover:text-white' : 'border-border hover:border-text-primary'}`}
              title="Increase channel trim (+2dB)"
            >
              +
            </button>
          </div>
        </div>
      )}

      {/* Controls Bar */}
      <div className="grid grid-cols-3 gap-1.5 mt-2 pt-2 border-t border-dashed border-border/40">
        {/* Route / Broadcast button */}
        <button
          onClick={onSelect}
          className={`col-span-2 py-1 px-2 text-xs font-mono font-bold tracking-wider uppercase border btn-tactile flex items-center justify-center gap-1.5 ${
            isSelected
              ? 'bg-black text-white border-black hover:bg-black/90'
              : 'bg-text-primary text-text-inverse border-white hover:bg-white/90'
          }`}
        >
          <Radio size={12} className={isSelected ? 'animate-pulse' : ''} />
          {isSelected ? 'ON AIR' : 'ROUTE'}
        </button>

        {/* Mute button */}
        <button
          onClick={() => onToggleMute(!isMuted)}
          title={isMuted ? 'Unmute participant' : 'Mute participant'}
          className={`py-1 px-1.5 text-xs border btn-tactile flex items-center justify-center ${
            isMuted
              ? isSelected 
                ? 'bg-black text-white border-black' 
                : 'bg-text-muted text-white border-text-muted'
              : isSelected
              ? 'border-black text-black hover:bg-black/10'
              : 'border-border bg-bg-main text-text-secondary hover:text-text-primary'
          }`}
        >
          {isMuted ? <MicOff size={13} /> : <Mic size={13} />}
        </button>
      </div>

      {/* Kick/Disconnect small footer action */}
      <div className="flex justify-end mt-1.5">
        <button
          onClick={onKick}
          title="Disconnect participant"
          className={`text-[9px] font-mono flex items-center gap-1 opacity-60 hover:opacity-100 transition-opacity ${
            isSelected ? 'text-black' : 'text-text-muted hover:text-text-primary'
          }`}
        >
          <PowerOff size={9} />
          <span>EJECT</span>
        </button>
      </div>
    </div>
  );
};
