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
