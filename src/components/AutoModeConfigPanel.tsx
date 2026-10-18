import React from 'react';
import { ArbitrationConfig, SelectionReason } from '../types.js';
import { Cpu, Sliders, ShieldCheck, HelpCircle } from 'lucide-react';

interface AutoModeConfigPanelProps {
  config: ArbitrationConfig;
  onUpdateConfig: (newConfig: Partial<ArbitrationConfig>) => void;
  selectionReason: SelectionReason;
  mode: 'manual' | 'auto';
  onToggleMode: (mode: 'manual' | 'auto') => void;
}

export const AutoModeConfigPanel: React.FC<AutoModeConfigPanelProps> = ({
  config,
  onUpdateConfig,
  selectionReason,
  mode,
  onToggleMode
}) => {
  return (
    <div className="bg-bg-elevated border border-border p-4 rounded-sm flex flex-col gap-4 font-body">
      <div className="flex items-center justify-between pb-2 border-b border-border">
        <div className="flex items-center gap-2">
          <Cpu size={16} className="text-text-primary" />
          <h3 className="font-heading font-semibold text-sm tracking-wider uppercase">
            AUTO MODE // ARBITRATION ENGINE
          </h3>
        </div>

        {/* Mode Switcher Toggle */}
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-text-secondary uppercase">
            MODE: {mode}
          </span>
          <button
            onClick={() => onToggleMode(mode === 'auto' ? 'manual' : 'auto')}
            className={`px-3 py-1 text-xs font-mono font-bold tracking-wider uppercase border btn-tactile ${
              mode === 'auto'
                ? 'bg-text-primary text-text-inverse border-white'
                : 'bg-bg-secondary text-text-primary border-border hover:border-text-primary'
            }`}
          >
            {mode === 'auto' ? 'AUTO ARBITRATION ON' : 'SWITCH TO AUTO'}
          </button>
        </div>
      </div>

      {/* Active Decision Banner */}
      <div className="p-3 bg-bg-main border border-border flex items-center justify-between text-xs font-mono">
        <div>
          <span className="text-text-muted uppercase text-[10px] block">CURRENT ARBITRATION REASON</span>
          <span className="font-bold text-text-primary text-sm tracking-wider">
            {selectionReason}
          </span>
        </div>
        <div className="text-right text-[11px] text-text-secondary">
          {selectionReason === 'HIGHER_PRIORITY' && 'Preempted by speaker with higher priority level'}
          {selectionReason === 'SILENCE_TIMEOUT' && 'Floor yielded after speaker silence duration exceeded'}
          {selectionReason === 'FIRST_ELIGIBLE_SPEAKER' && 'First speaker to trigger voice activity on empty floor'}
          {selectionReason === 'CURRENT_SPEAKER_LOCK' && 'Floor held by active speaker lock timer'}
          {selectionReason === 'ADMIN_OVERRIDE' && 'Manual administrator command took immediate precedence'}
          {selectionReason === 'MANUAL_SELECTION' && 'Active speaker set exclusively via manual control'}
          {selectionReason === 'INITIAL_IDLE' && 'Standing by for incoming speech activity'}
        </div>
      </div>

      {/* Sliders for Timing & Sensitivity */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
        {/* Silence Timeout */}
        <div className="p-3 bg-bg-main border border-border flex flex-col gap-2">
          <div className="flex justify-between items-center">
            <span className="text-text-primary font-semibold">SILENCE TIMEOUT</span>
            <span className="text-text-secondary">{config.silenceTimeoutMs} ms</span>
          </div>
          <input
            type="range"
            min={400}
            max={4000}
            step={100}
            value={config.silenceTimeoutMs}
            onChange={(e) => onUpdateConfig({ silenceTimeoutMs: Number(e.target.value) })}
            className="w-full accent-white bg-bg-secondary cursor-pointer"
          />
          <span className="text-[10px] text-text-muted">
            Duration of silence before releasing the floor to contenders or idle.
          </span>
        </div>

        {/* Speaker Lock Duration */}
        <div className="p-3 bg-bg-main border border-border flex flex-col gap-2">
          <div className="flex justify-between items-center">
            <span className="text-text-primary font-semibold">SPEAKER FLOOR LOCK</span>
            <span className="text-text-secondary">{config.speakerLockMs} ms</span>
          </div>
          <input
            type="range"
            min={500}
            max={5000}
            step={100}
            value={config.speakerLockMs}
            onChange={(e) => onUpdateConfig({ speakerLockMs: Number(e.target.value) })}
            className="w-full accent-white bg-bg-secondary cursor-pointer"
          />
          <span className="text-[10px] text-text-muted">
            Guaranteed floor time preventing immediate preemption on short pauses.
          </span>
        </div>

        {/* Cooldown Timer */}
        <div className="p-3 bg-bg-main border border-border flex flex-col gap-2">
          <div className="flex justify-between items-center">
            <span className="text-text-primary font-semibold">SWITCH COOLDOWN</span>
            <span className="text-text-secondary">{config.switchCooldownMs} ms</span>
          </div>
          <input
            type="range"
            min={200}
            max={2000}
            step={100}
            value={config.switchCooldownMs}
            onChange={(e) => onUpdateConfig({ switchCooldownMs: Number(e.target.value) })}
            className="w-full accent-white bg-bg-secondary cursor-pointer"
          />
          <span className="text-[10px] text-text-muted">
            Minimum pause between consecutive switches to prevent acoustic ping-pong.
          </span>
        </div>

        {/* VAD Sensitivity */}
        <div className="p-3 bg-bg-main border border-border flex flex-col gap-2">
          <div className="flex justify-between items-center">
            <span className="text-text-primary font-semibold">VAD ENERGY THRESHOLD</span>
            <span className="text-text-secondary">{config.vadThreshold} % RMS</span>
          </div>
          <input
            type="range"
            min={5}
            max={40}
            step={1}
            value={config.vadThreshold}
            onChange={(e) => onUpdateConfig({ vadThreshold: Number(e.target.value) })}
            className="w-full accent-white bg-bg-secondary cursor-pointer"
          />
          <span className="text-[10px] text-text-muted">
            Microphone energy level required to register speech activity over room ambience.
          </span>
        </div>
      </div>

      {/* Engineering notes on acoustic limitations */}
      <div className="p-3 bg-bg-main border border-border text-xs text-text-secondary space-y-1">
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-text-muted uppercase tracking-widest font-bold">
          <HelpCircle size={12} />
          <span>ACOUSTIC ROOM COUPLING LIMITATION</span>
        </div>
        <p className="text-[11px] leading-relaxed">
          Standard VAD measures acoustic sound energy at the handset microphone. In loud event halls with high PA loudspeaker spill, multiple handsets can pick up the hall reverberation. For stage panels, assign the moderator as <strong className="text-text-primary">VIP priority</strong> or toggle to <strong className="text-text-primary">MANUAL MODE</strong> for deterministic broadcast control.
        </p>
      </div>
    </div>
  );
};
