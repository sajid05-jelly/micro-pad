export type ParticipantState = 
  | 'CONNECTING' 
  | 'READY' 
  | 'ACTIVE SPEAKER' 
  | 'MUTED' 
  | 'DISCONNECTED' 
  | 'PERMISSION DENIED' 
  | 'RECONNECTING';

export type PriorityLevel = 'VIP' | 'Normal' | 'Low';

export type SelectionReason = 
  | 'FIRST_ELIGIBLE_SPEAKER'
  | 'HIGHER_PRIORITY'
  | 'CURRENT_SPEAKER_LOCK'
  | 'SILENCE_TIMEOUT'
  | 'ADMIN_OVERRIDE'
  | 'MANUAL_SELECTION'
  | 'MUTED_PREEMPTION'
  | 'INITIAL_IDLE';

export interface Participant {
  id: string; // Socket ID
  channelNumber: number; // 1 -> MIC 01, 2 -> MIC 02
  name: string;
  state: ParticipantState;
  priority: PriorityLevel;
  isMutedByAdmin: boolean;
  isMutedSelf: boolean;
  audioLevel: number; // 0 - 100
  isSpeaking: boolean;
  joinedAt: number;
  lastSpokeAt: number;
}

export interface ArbitrationConfig {
  silenceTimeoutMs: number; // e.g. 1500ms
  speakerLockMs: number;    // e.g. 1200ms
  switchCooldownMs: number; // e.g. 600ms
  vadThreshold: number;     // e.g. 15 (0-100)
}

export interface SystemEvent {
  id: string;
  timestamp: string;
  type: 'INFO' | 'WARN' | 'ACTION' | 'AUDIO';
  message: string;
  details?: string;
}

export interface SessionState {
  sessionId: string;
  sessionName: string;
  adminSocketId: string | null;
  mode: 'manual' | 'auto';
  activeSpeakerId: string | null;
  selectionReason: SelectionReason;
  isMuteAll: boolean;
  isEmergencyStop: boolean;
  arbitrationConfig: ArbitrationConfig;
  participants: Record<string, Participant>;
  recentEvents: SystemEvent[];
}

export type NetworkQualityLevel = 'EXCELLENT' | 'GOOD' | 'UNSTABLE' | 'POOR' | 'DISCONNECTED' | 'FAIR';

export interface NetworkThresholdConfig {
  lossExcellentMax: number;   // default: 1.0%
  lossGoodMax: number;        // default: 3.0%
  lossUnstableMax: number;    // default: 8.0%
  rttExcellentMax: number;    // default: 40ms
  rttGoodMax: number;         // default: 80ms
  rttUnstableMax: number;     // default: 140ms
  jitterExcellentMax: number; // default: 15ms
  jitterGoodMax: number;      // default: 30ms
  jitterUnstableMax: number;  // default: 50ms
}

export interface AudioCaptureSettings {
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  highpassFilter: boolean;
  sensitivity: number;
}

export interface SpeakerOutputConfig {
  id: string;
  name: string;
  deviceId: string;
  delayMs: number;
  volume: number;
  isMuted: boolean;
  isBluetooth: boolean;
}
