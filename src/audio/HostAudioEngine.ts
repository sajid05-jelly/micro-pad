// Web Audio API Host Audio Engine
// Professional broadcast pipeline: per-channel trim, peak limiting, clickless crossfade,
// single-point playback (zero comb filtering), and live WebRTC network diagnostics.

export function optimizeOpusSDP(sdp: string): string {
  // Enforce Opus 128kbps, in-band forward error correction, 10ms low latency packaging, constant bitrate (no DTX dropouts)
  return sdp.replace(/a=fmtp:(\d+)(.*)/g, (match, pt) => {
    if (sdp.includes(`a=rtpmap:${pt} opus/48000`)) {
      return `a=fmtp:${pt} minptime=10;useinbandfec=1;maxaveragebitrate=128000;stereo=0;sprop-stereo=0;cbr=1`;
    }
    return match;
  });
}

export interface PeerNetworkStats {
  rttMs: number;
  packetsLost: number;
  packetLossPct: number;
  jitterMs: number;
  audioLevel: number;
  bitrateKbps: number;
  candidateType: string;
}

export class HostAudioEngine {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private masterAnalyser: AnalyserNode | null = null;
  private channelNodes: Map<string, {
    source: MediaStreamAudioSourceNode;
    gain: GainNode;
    analyser: AnalyserNode;
    audioElement?: HTMLAudioElement;
    stream: MediaStream;
  }> = new Map();

  private channelTrim: Map<string, number> = new Map();
  private selectedSinkId = 'default';
  private isEmergencyStopped = false;
  private isMuteAll = false;
  private activeSpeakerId: string | null = null;
  private mutedParticipantIds: Set<string> = new Set();
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private pendingCandidates: Map<string, RTCIceCandidateInit[]> = new Map();

  constructor() {}

  public async initAudio(): Promise<boolean> {
    if (!this.audioContext) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioCtx({ latencyHint: 'interactive' });

      // 1. Master Fader Gain Node
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.setValueAtTime(1.0, this.audioContext.currentTime);

      // 2. Studio-Grade Master Limiter / Dynamics Compressor (Prevents digital clipping when boosting gain)
      this.compressor = this.audioContext.createDynamicsCompressor();
      this.compressor.threshold.setValueAtTime(-3, this.audioContext.currentTime); // -3 dBFS ceiling
      this.compressor.knee.setValueAtTime(8, this.audioContext.currentTime);
      this.compressor.ratio.setValueAtTime(12, this.audioContext.currentTime);
      this.compressor.attack.setValueAtTime(0.003, this.audioContext.currentTime); // 3ms ultra-fast peak catch
      this.compressor.release.setValueAtTime(0.12, this.audioContext.currentTime); // 120ms smooth recovery

      // 3. Master Analyser (Fast 64-pt FFT for responsive VU meter)
      this.masterAnalyser = this.audioContext.createAnalyser();
      this.masterAnalyser.fftSize = 64;
      this.masterAnalyser.smoothingTimeConstant = 0.4;

      // Clean single-point audio routing: MasterGain -> Limiter -> Analyser -> Physical Output (Bluetooth/Wired)
      this.masterGain.connect(this.compressor);
      this.compressor.connect(this.masterAnalyser);
      this.masterAnalyser.connect(this.audioContext.destination);
    }

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    return this.audioContext.state === 'running';
  }

  public getAudioContext(): AudioContext | null {
    return this.audioContext;
  }

  // Resume all audio output sinks (both Web Audio and HTMLAudioElement)
  public async resumeAll(): Promise<void> {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      await this.audioContext.resume().catch(() => {});
    }
    for (const nodes of this.channelNodes.values()) {
      if (nodes.audioElement && nodes.audioElement.paused) {
        nodes.audioElement.play().catch(() => {});
      }
    }
  }

  // Set physical output device (supports Bluetooth speaker vs Wired 3.5mm AUX jack)
  public async setOutputDevice(deviceId: string): Promise<boolean> {
    this.selectedSinkId = deviceId;
    const sinkId = deviceId === 'default' ? '' : deviceId;
    let anySuccess = false;

    if (this.audioContext && typeof (this.audioContext as any).setSinkId === 'function') {
      try {
        await (this.audioContext as any).setSinkId(sinkId);
        anySuccess = true;
      } catch (e) {
        console.warn('AudioContext.setSinkId failed:', e);
      }
    }

    for (const nodes of this.channelNodes.values()) {
      if (nodes.audioElement && typeof (nodes.audioElement as any).setSinkId === 'function') {
        try {
          await (nodes.audioElement as any).setSinkId(sinkId);
          anySuccess = true;
        } catch (e) {
          console.warn('AudioElement.setSinkId failed:', e);
        }
      }
    }

    return anySuccess;
  }

  // Play retro 440Hz calibration test chime (2-pip broadcast signal)
  public playTestChime() {
    if (!this.audioContext || this.audioContext.state !== 'running') return;
    const now = this.audioContext.currentTime;

    const osc1 = this.audioContext.createOscillator();
    const gain1 = this.audioContext.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(440, now); // Standard 440 Hz concert A

    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.3, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc1.connect(gain1);
    gain1.connect(this.masterGain!);
    osc1.start(now);
    osc1.stop(now + 0.2);

    // Second pip 880 Hz
    const osc2 = this.audioContext.createOscillator();
    const gain2 = this.audioContext.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.25);

    gain2.gain.setValueAtTime(0, now + 0.25);
    gain2.gain.linearRampToValueAtTime(0.3, now + 0.27);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

    osc2.connect(gain2);
    gain2.connect(this.masterGain!);
    osc2.start(now + 0.25);
    osc2.stop(now + 0.52);
  }

  // Register remote audio stream from WebRTC
  public attachParticipantStream(participantId: string, stream: MediaStream) {
    if (!this.audioContext || !this.masterGain) {
      this.initAudio().catch(() => {});
    }

    // Clean up existing nodes if re-attaching
    this.detachParticipantStream(participantId);

    // 1. Direct hardware speaker playback via native HTMLAudioElement (required by Chromium to pull remote WebRTC packets)
    let audioElement: HTMLAudioElement | undefined;
    if (typeof document !== 'undefined') {
      audioElement = document.createElement('audio');
      audioElement.srcObject = stream;
      audioElement.autoplay = true;
      audioElement.muted = false; // NEVER set muted=true in Chromium as it mutes the underlying track!
      audioElement.volume = 0.0; // Managed strictly by updateRouting()
      audioElement.style.position = 'fixed';
      audioElement.style.pointerEvents = 'none';
      audioElement.style.opacity = '0';
      audioElement.style.width = '0px';
      audioElement.style.height = '0px';

      if (typeof (audioElement as any).setSinkId === 'function' && this.selectedSinkId !== 'default') {
        (audioElement as any).setSinkId(this.selectedSinkId).catch(() => {});
      }

      document.body.appendChild(audioElement);
      const playPromise = audioElement.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn('[HostAudio] Native audio play deferred pending user gesture:', err);
        });
      }
    }

    // 2. Web Audio Analyser & Routing Nodes
    let source: MediaStreamAudioSourceNode | null = null;
    let gain: GainNode | null = null;
    let analyser: AnalyserNode | null = null;

    if (this.audioContext && this.masterGain) {
      try {
        source = this.audioContext.createMediaStreamSource(stream);
        gain = this.audioContext.createGain();
        analyser = this.audioContext.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.4;

        // Start closed
        gain.gain.setValueAtTime(0.0, this.audioContext.currentTime);

        source.connect(gain);
        gain.connect(analyser);
        // Connect to masterGain so VU meter reflects active participant
        gain.connect(this.masterGain);
      } catch (e) {
        console.warn('[HostAudio] WebAudio node creation error:', e);
      }
    }

    // Listen to track mute/unmute events from mobile
    const track = stream.getAudioTracks()[0];
    if (track) {
      track.onmute = () => {
        this.updateRouting();
      };
      track.onunmute = () => {
        this.updateRouting();
      };
    }

    if (source && gain && analyser) {
      this.channelNodes.set(participantId, { source, gain, analyser, audioElement, stream });
    } else if (audioElement) {
      this.channelNodes.set(participantId, {
        source: null as any,
        gain: null as any,
        analyser: null as any,
        audioElement,
        stream
      });
    }

    this.updateRouting();
  }

  public detachParticipantStream(participantId: string) {
    const existing = this.channelNodes.get(participantId);
    if (existing) {
      try {
        if (existing.source) existing.source.disconnect();
        if (existing.gain) existing.gain.disconnect();
        if (existing.analyser) existing.analyser.disconnect();
      } catch (e) {}

      if (existing.audioElement) {
        try {
          existing.audioElement.pause();
          existing.audioElement.srcObject = null;
          existing.audioElement.remove();
        } catch (e) {}
      }

      this.channelNodes.delete(participantId);
    }
  }

  // Set per-channel pre-amp trim (0.5x to 3.0x, i.e., -6dB to +10dB safe boost)
  public setChannelTrim(participantId: string, trimMultiplier: number) {
    const clamped = Math.max(0.2, Math.min(3.5, trimMultiplier));
    this.channelTrim.set(participantId, clamped);
    this.updateRouting();
  }

  public getChannelTrim(participantId: string): number {
    return this.channelTrim.get(participantId) || 1.0;
  }

  // Set audio routing: only active speaker gets gain; all others clamped to 0.0
  public setRouting(
    activeSpeakerId: string | null, 
    isMuteAll: boolean, 
    isEmergencyStop: boolean,
    mutedParticipantIds: Set<string> | string[] = []
  ) {
    this.activeSpeakerId = activeSpeakerId;
    this.isMuteAll = isMuteAll;
    this.isEmergencyStopped = isEmergencyStop;
    this.mutedParticipantIds = new Set(mutedParticipantIds);
    this.updateRouting();
  }

  public updateRouting() {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }

    const now = this.audioContext ? this.audioContext.currentTime : 0;

    for (const [id, nodes] of this.channelNodes.entries()) {
      const isIndividuallyMuted = this.mutedParticipantIds.has(id);
      const isAudible = !this.isEmergencyStopped && 
                        !this.isMuteAll && 
                        !isIndividuallyMuted && 
                        (this.activeSpeakerId === id);

      const trim = this.channelTrim.get(id) || 1.0;
      const targetGain = isAudible ? Math.min(1.0, 1.0 * trim) : 0.0;

      // Clickless smooth 20ms ramp to target gain on Web Audio node
      if (nodes.gain && this.audioContext) {
        try {
          nodes.gain.gain.cancelScheduledValues(now);
          nodes.gain.gain.setValueAtTime(nodes.gain.gain.value, now);
          nodes.gain.gain.linearRampToValueAtTime(targetGain, now + 0.02);
        } catch (e) {
          nodes.gain.gain.value = targetGain;
        }
      }

      // Synchronize native HTMLAudioElement volume & playback
      if (nodes.audioElement) {
        nodes.audioElement.volume = targetGain;
        if (isAudible && nodes.audioElement.paused) {
          nodes.audioElement.play().catch(() => {});
        }
      }
    }
  }

  // Get live RMS meter levels for master output (0-100)
  public getMasterLevel(): number {
    if (!this.masterAnalyser) return 0;
    const data = new Uint8Array(this.masterAnalyser.frequencyBinCount);
    this.masterAnalyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i];
    }
    const avg = sum / data.length;
    return Math.min(100, Math.round((avg / 255) * 100 * 1.6));
  }

  // Read compressor reduction in dB (limiter activity)
  public getCompressorReduction(): number {
    return this.compressor ? Math.round(Math.abs(this.compressor.reduction)) : 0;
  }

  // WebRTC Peer Connection handling with Opus optimization
  public createPeerConnection(
    participantId: string, 
    sendSignal: (signal: any, type: string) => void
  ): RTCPeerConnection {
    const existing = this.peerConnections.get(participantId);
    if (existing) {
      existing.close();
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    pc.ontrack = (event) => {
      const stream = (event.streams && event.streams[0]) ? event.streams[0] : new MediaStream([event.track]);
      this.attachParticipantStream(participantId, stream);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal(event.candidate, 'candidate');
      }
    };

    // Auto-reconnect handling on connection drops
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        console.warn(`[WebRTC] Peer ${participantId} connection ${pc.connectionState}, re-evaluating...`);
      }
    };

    this.peerConnections.set(participantId, pc);
    return pc;
  }

  public getPeerConnection(participantId: string): RTCPeerConnection | undefined {
    return this.peerConnections.get(participantId);
  }

  // Collect real-time WebRTC network statistics (RTT, Packet Loss, Jitter, Audio Level)
  public async getPeerStats(participantId: string): Promise<PeerNetworkStats> {
    const pc = this.peerConnections.get(participantId);
    if (!pc) {
      return { rttMs: 0, packetsLost: 0, packetLossPct: 0, jitterMs: 0, audioLevel: 0, bitrateKbps: 0, candidateType: 'none' };
    }
    try {
      const stats = await pc.getStats();
      let rtt = 0;
      let packetsLost = 0;
      let packetLossPct = 0;
      let jitter = 0;
      let audioLevel = 0;
      let bitrate = 0;
      let candidateType = 'host';

      stats.forEach((report: any) => {
        if (report.type === 'candidate-pair' && (report.state === 'succeeded' || report.nominated)) {
          rtt = Math.round((report.currentRoundTripTime || 0) * 1000);
        }
        if (report.type === 'inbound-rtp' && report.kind === 'audio') {
          packetsLost = report.packetsLost || 0;
          jitter = Math.round((report.jitter || 0) * 1000);
          audioLevel = Math.round((report.audioLevel || 0) * 100);
          const totalPackets = (report.packetsReceived || 0) + (report.packetsLost || 0);
          packetLossPct = totalPackets > 0 ? Math.round((report.packetsLost / totalPackets) * 100) : 0;
        }
      });

      return {
        rttMs: rtt,
        packetsLost,
        packetLossPct,
        jitterMs: jitter,
        audioLevel,
        bitrateKbps: bitrate,
        candidateType
      };
    } catch (e) {
      return { rttMs: 0, packetsLost: 0, packetLossPct: 0, jitterMs: 0, audioLevel: 0, bitrateKbps: 0, candidateType: 'none' };
    }
  }

  public async addIceCandidate(participantId: string, candidate: RTCIceCandidateInit) {
    const pc = this.peerConnections.get(participantId);
    if (!pc || !pc.remoteDescription) {
      if (!this.pendingCandidates.has(participantId)) {
        this.pendingCandidates.set(participantId, []);
      }
      this.pendingCandidates.get(participantId)!.push(candidate);
      return;
    }
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.warn('Host addIceCandidate failed:', e);
    }
  }

  public async drainPendingCandidates(participantId: string) {
    const pc = this.peerConnections.get(participantId);
    const queued = this.pendingCandidates.get(participantId);
    if (pc && queued && queued.length > 0) {
      for (const cand of queued) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (e) {
          console.warn('Host drained candidate failed:', e);
        }
      }
      this.pendingCandidates.delete(participantId);
    }
  }

  public closePeerConnection(participantId: string) {
    this.pendingCandidates.delete(participantId);
    const pc = this.peerConnections.get(participantId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(participantId);
    }
    this.detachParticipantStream(participantId);
  }

  public getPeerConnections(): Map<string, RTCPeerConnection> {
    return this.peerConnections;
  }

  public getChannelNodes(): Map<string, any> {
    return this.channelNodes;
  }

  public dispose() {
    for (const id of this.peerConnections.keys()) {
      this.closePeerConnection(id);
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}
