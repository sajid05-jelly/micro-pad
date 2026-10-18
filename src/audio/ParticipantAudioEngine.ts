// Participant Audio Engine: Captures real phone microphone, analyzes local audio levels/VAD,
// optimizes Opus codec for 128kbps broadcast audio, and streams audio to host console over WebRTC.

export function optimizeOpusSDP(sdp: string): string {
  // Enforce Opus 128kbps, in-band forward error correction, 10ms low latency packaging, constant bitrate (no DTX dropouts)
  return sdp.replace(/a=fmtp:(\d+)(.*)/g, (match, pt) => {
    if (sdp.includes(`a=rtpmap:${pt} opus/48000`)) {
      return `a=fmtp:${pt} minptime=10;useinbandfec=1;maxaveragebitrate=128000;stereo=0;sprop-stereo=0;cbr=1`;
    }
    return match;
  });
}

export interface ClientNetworkStats {
  rttMs: number;
  packetLossPct: number;
  jitterMs: number;
  bitrateKbps: number;
  candidateType: string;
  bytesSent: number;
  packetsSent: number;
}

export interface AudioLevelData {
  rms: number;          // Linear RMS: 0.0 to 1.0+
  db: number;           // dBFS: -60 to 0 (or -Infinity)
  levelPct: number;     // Normalized visual percentage: 0 to 100
  isSpeaking: boolean;  // Voice activity threshold
  peak: number;         // Peak amplitude: 0.0 to 1.0
  rawRms: number;       // Raw pre-sensitivity RMS
}

export interface MicrophoneDiagnostics {
  isSecureContext: boolean;
  hasGetUserMedia: boolean;
  audioContextState: AudioContextState | 'none';
  trackCount: number;
  trackLabel: string;
  trackReadyState: MediaStreamTrackState | 'none';
  trackEnabled: boolean;
  trackMuted: boolean;
  sampleRate: number;
  inputDevices: { deviceId: string; label: string }[];
}

export interface LocalMicTestResult {
  rms: number;
  peak: number;
  db: number;
  levelPct: number;
  isVoiceDetected: boolean;
  samplePreview: number[];
  deviceLabel: string;
}

export class ParticipantAudioEngine {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private muteSinkNode: GainNode | null = null;
  private timeDomainBuffer: Float32Array | null = null;
  private peerConnection: RTCPeerConnection | null = null;
  private animationFrameId: number | null = null;
  private isMuted: boolean = false;
  private sensitivity: number = 1.0;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private lastStatsTimestamp: number = 0;
  private lastBytesSent: number = 0;
  private totalPacketsSent: number = 0;

  constructor() {}

  /**
   * Resumes or initializes the AudioContext inside a user gesture handler.
   * Mobile browsers (Safari/Chrome) strictly suspend AudioContexts until user interacts.
   */
  public async resumeAudioContext(): Promise<AudioContextState> {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return 'closed';
      this.audioContext = new AudioCtx({ latencyHint: 'interactive' });
    }

    if (this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch (err) {
        console.warn('[ParticipantAudioEngine] AudioContext resume failed:', err);
      }
    }

    return this.audioContext.state;
  }

  /**
   * Captures the microphone stream directly from a user click handler.
   * Validates secure context, getUserMedia presence, track readiness, and connects to AnalyserNode.
   */
  public async startMicrophone(
    existingStream?: MediaStream,
    mode: 'stage' | 'conference' = 'stage'
  ): Promise<MediaStream> {
    // 1. Verify Secure Context requirement
    const isSecure = typeof window !== 'undefined' ? window.isSecureContext : true;
    const isLocalhost = typeof window !== 'undefined' && 
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

    if (!isSecure && !isLocalhost) {
      throw new Error(
        "Mobile browsers strictly require HTTPS to access the microphone. Current link is unencrypted HTTP. Open via secure HTTPS link."
      );
    }

    // 2. Verify getUserMedia availability
    if (!navigator?.mediaDevices?.getUserMedia) {
      throw new Error(
        "navigator.mediaDevices.getUserMedia is unavailable in this browser context. Please ensure you are using Safari or Chrome on HTTPS."
      );
    }

    let stream = existingStream;

    // Check if existingStream is still valid and live
    if (stream) {
      const tracks = stream.getAudioTracks();
      if (tracks.length === 0 || tracks[0].readyState !== 'live') {
        stream = undefined; // Force re-acquisition
      }
    }

    // 3. Acquire fresh audio stream if not provided or expired
    if (!stream) {
      const audioConstraints: MediaTrackConstraints = mode === 'stage' ? {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true
      } : {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      };

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
          video: false
        });
      } catch (err: any) {
        // Fallback to basic audio constraint if device rejects custom flags
        console.warn('[ParticipantAudioEngine] Fallback to basic audio: true:', err);
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false
        });
      }
    }

    if (!stream) {
      throw new Error("Unable to capture microphone audio stream.");
    }

    // 4. Verify captured audio tracks
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      throw new Error("Audio stream captured but contains zero audio tracks.");
    }

    const primaryTrack = audioTracks[0];
    if (primaryTrack.readyState !== 'live') {
      throw new Error(`Microphone track readyState is "${primaryTrack.readyState}" (expected "live").`);
    }

    primaryTrack.enabled = !this.isMuted;
    this.stream = stream;

    // 5. Initialize / Resume AudioContext
    await this.resumeAudioContext();

    if (!this.audioContext) {
      throw new Error("Failed to initialize Web Audio AudioContext.");
    }

    // 6. Connect MediaStream to AnalyserNode
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {}
    }
    if (this.muteSinkNode) {
      try {
        this.muteSinkNode.disconnect();
      } catch {}
    }

    this.sourceNode = this.audioContext.createMediaStreamSource(stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.2;
    this.timeDomainBuffer = new Float32Array(this.analyser.fftSize);

    // CRITICAL FOR WEBKIT & CHROMIUM (iOS Safari & Android Chrome):
    // Web Audio rendering is pull-driven by AudioContext.destination.
    // If a node graph has no path terminating at destination, mobile browsers suspend sample pulling
    // from the MediaStreamAudioSourceNode to conserve device battery.
    // We connect: sourceNode -> analyser -> muteSinkNode (gain = 0.0) -> destination.
    // This forces the audio engine to pull live microphone samples continuously into the AnalyserNode,
    // while keeping phone speaker output 100% silent (ZERO feedback)!
    this.muteSinkNode = this.audioContext.createGain();
    this.muteSinkNode.gain.setValueAtTime(0.0, this.audioContext.currentTime);

    this.sourceNode.connect(this.analyser);
    this.analyser.connect(this.muteSinkNode);
    this.muteSinkNode.connect(this.audioContext.destination);

    // 7. Attach track to active WebRTC peer connection sender if already connected
    if (this.peerConnection) {
      const senders = this.peerConnection.getSenders();
      const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
      if (audioSender) {
        await audioSender.replaceTrack(primaryTrack);
      } else {
        this.peerConnection.addTrack(primaryTrack, stream);
      }
    }

    console.log(`[ParticipantAudioEngine] Microphone live: "${primaryTrack.label || 'Default Mic'}" (${this.audioContext.state}, ${this.audioContext.sampleRate}Hz)`);
    return stream;
  }

  public setSensitivity(multiplier: number) {
    this.sensitivity = Math.max(0.2, Math.min(3.0, multiplier));
  }

  public setMute(muted: boolean) {
    this.isMuted = muted;
    if (this.stream) {
      this.stream.getAudioTracks().forEach(track => {
        track.enabled = !muted;
      });
    }
  }

  public getIsMuted(): boolean {
    return this.isMuted;
  }

  public getStream(): MediaStream | null {
    return this.stream;
  }

  public getAudioContext(): AudioContext | null {
    return this.audioContext;
  }

  // Switch between 'stage' (uncompressed venue acoustics) and 'conference' (aggressive noise gating)
  public async switchProfile(mode: 'stage' | 'conference') {
    if (!this.stream) return;
    const track = this.stream.getAudioTracks()[0];
    if (track && typeof track.applyConstraints === 'function') {
      try {
        await track.applyConstraints(mode === 'stage' ? {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true
        } : {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        });
      } catch (e) {
        console.warn('Could not apply track constraints dynamically:', e);
      }
    }
  }

  /**
   * Starts high-resolution RMS time-domain meter loop.
   * Calculates true Root Mean Square from float audio samples: RMS = sqrt(sum(x^2)/N).
   * Maps to precise logarithmic dBFS (-60 to 0 dB) and normalized meter percentage (0 - 100%).
   */
  public startMeterLoop(onData: (data: AudioLevelData) => void) {
    this.stopMeterLoop();

    const check = () => {
      // If muted or analyser not ready
      if (!this.analyser || this.isMuted) {
        onData({
          rms: 0,
          db: -Infinity,
          levelPct: 0,
          isSpeaking: false,
          peak: 0,
          rawRms: 0
        });
        this.animationFrameId = requestAnimationFrame(check);
        return;
      }

      // Check AudioContext state
      if (this.audioContext && this.audioContext.state === 'suspended') {
        onData({
          rms: 0,
          db: -Infinity,
          levelPct: 0,
          isSpeaking: false,
          peak: 0,
          rawRms: 0
        });
        this.animationFrameId = requestAnimationFrame(check);
        return;
      }

      const buffer = this.timeDomainBuffer || new Float32Array(this.analyser.fftSize);
      if (typeof this.analyser.getFloatTimeDomainData === 'function') {
        this.analyser.getFloatTimeDomainData(buffer as any);
      } else {
        // Fallback for legacy webkit browsers
        const byteBuf = new Uint8Array(this.analyser.fftSize);
        this.analyser.getByteTimeDomainData(byteBuf);
        for (let i = 0; i < byteBuf.length; i++) {
          buffer[i] = (byteBuf[i] - 128) / 128.0;
        }
      }

      let sumSquares = 0;
      let peak = 0;
      const len = buffer.length;

      for (let i = 0; i < len; i++) {
        const sample = buffer[i];
        const abs = Math.abs(sample);
        if (abs > peak) peak = abs;
        sumSquares += sample * sample;
      }

      const rawRms = Math.sqrt(sumSquares / len);
      const scaledRms = rawRms * this.sensitivity;

      let db = -Infinity;
      let levelPct = 0;

      // Noise floor threshold (ambient silence)
      if (scaledRms > 0.0002) {
        db = 20 * Math.log10(scaledRms);
        // Map -60 dBFS (silence) to 0 dBFS (max peak) -> 0% to 100%
        levelPct = Math.max(0, Math.min(100, Math.round(((db + 60) / 60) * 100)));
      }

      // Voice Activity Threshold: > 12% on normalized meter (approx -52 dBFS)
      const isSpeaking = levelPct > 12;

      onData({
        rms: scaledRms,
        db: isFinite(db) ? Math.round(db * 10) / 10 : -Infinity,
        levelPct,
        isSpeaking,
        peak: Math.round(peak * 100) / 100,
        rawRms: Math.round(rawRms * 1000) / 1000
      });

      this.animationFrameId = requestAnimationFrame(check);
    };

    this.animationFrameId = requestAnimationFrame(check);
  }

  public stopMeterLoop() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Diagnostic inspector for physical device troubleshooting
   */
  public async getDiagnostics(): Promise<MicrophoneDiagnostics> {
    const isSecureContext = typeof window !== 'undefined' ? window.isSecureContext : false;
    const hasGetUserMedia = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
    const audioContextState = this.audioContext ? this.audioContext.state : 'none';

    let trackCount = 0;
    let trackLabel = 'None';
    let trackReadyState: MediaStreamTrackState | 'none' = 'none';
    let trackEnabled = false;
    let trackMuted = false;

    if (this.stream) {
      const tracks = this.stream.getAudioTracks();
      trackCount = tracks.length;
      if (tracks.length > 0) {
        trackLabel = tracks[0].label || 'Default Microphone';
        trackReadyState = tracks[0].readyState;
        trackEnabled = tracks[0].enabled;
        trackMuted = tracks[0].muted;
      }
    }

    const sampleRate = this.audioContext ? this.audioContext.sampleRate : 0;

    let inputDevices: { deviceId: string; label: string }[] = [];
    if (navigator?.mediaDevices?.enumerateDevices) {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        inputDevices = devices
          .filter(d => d.kind === 'audioinput')
          .map((d, idx) => ({
            deviceId: d.deviceId,
            label: d.label || `Microphone ${idx + 1}`
          }));
      } catch {}
    }

    return {
      isSecureContext,
      hasGetUserMedia,
      audioContextState,
      trackCount,
      trackLabel,
      trackReadyState,
      trackEnabled,
      trackMuted,
      sampleRate,
      inputDevices
    };
  }

  /**
   * ISOLATED LOCAL MICROPHONE TEST (Section B)
   * Captures microphone directly, reads real-time time-domain float samples,
   * calculates RMS/dBFS/peak, and extracts sample waveforms without touching WebRTC or server.
   */
  public async startLocalTest(onSample: (res: LocalMicTestResult) => void): Promise<() => void> {
    const isSecure = typeof window !== 'undefined' ? window.isSecureContext : true;
    const isLocalhost = typeof window !== 'undefined' && 
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

    if (!isSecure && !isLocalhost) {
      throw new Error("Local test requires HTTPS or localhost for microphone capture.");
    }

    if (!navigator?.mediaDevices?.getUserMedia) {
      throw new Error("getUserMedia is not supported by this browser.");
    }

    // Capture microphone with standard constraints
    let testStream: MediaStream;
    try {
      testStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          autoGainControl: true
        },
        video: false
      });
    } catch {
      testStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false
      });
    }

    const tracks = testStream.getAudioTracks();
    if (tracks.length === 0 || tracks[0].readyState !== 'live') {
      throw new Error("Local microphone track could not be opened.");
    }

    const deviceLabel = tracks[0].label || 'Default Mobile Microphone';

    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const testCtx = new AudioCtx({ latencyHint: 'interactive' });
    if (testCtx.state === 'suspended') {
      await testCtx.resume();
    }

    const testSource = testCtx.createMediaStreamSource(testStream);
    const testAnalyser = testCtx.createAnalyser();
    testAnalyser.fftSize = 512;
    testAnalyser.smoothingTimeConstant = 0.2;

    // Pull-through zero-gain sink to destination
    const testSink = testCtx.createGain();
    testSink.gain.setValueAtTime(0.0, testCtx.currentTime);

    testSource.connect(testAnalyser);
    testAnalyser.connect(testSink);
    testSink.connect(testCtx.destination);

    const buffer = new Float32Array(testAnalyser.fftSize);
    let animId: number | null = null;
    let isStopped = false;

    const tick = () => {
      if (isStopped) return;
      if (testCtx.state === 'suspended') {
        testCtx.resume().catch(() => {});
      }

      testAnalyser.getFloatTimeDomainData(buffer as any);

      let sumSquares = 0;
      let peak = 0;
      for (let i = 0; i < buffer.length; i++) {
        const s = buffer[i];
        const abs = Math.abs(s);
        if (abs > peak) peak = abs;
        sumSquares += s * s;
      }

      const rms = Math.sqrt(sumSquares / buffer.length);
      let db = -Infinity;
      let levelPct = 0;

      if (rms > 0.0002) {
        db = 20 * Math.log10(rms);
        levelPct = Math.max(0, Math.min(100, Math.round(((db + 60) / 60) * 100)));
      }

      // Voice detected threshold: RMS > 0.012 (~ -38 dBFS)
      const isVoiceDetected = rms > 0.012;
      const samplePreview = Array.from(buffer.slice(0, 8)).map(v => Math.round(v * 1000) / 1000);

      onSample({
        rms: Math.round(rms * 10000) / 10000,
        peak: Math.round(peak * 100) / 100,
        db: isFinite(db) ? Math.round(db * 10) / 10 : -Infinity,
        levelPct,
        isVoiceDetected,
        samplePreview,
        deviceLabel
      });

      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);

    return () => {
      isStopped = true;
      if (animId !== null) cancelAnimationFrame(animId);
      testStream.getTracks().forEach(t => t.stop());
      try { testSource.disconnect(); } catch {}
      try { testAnalyser.disconnect(); } catch {}
      try { testSink.disconnect(); } catch {}
      try { testCtx.close(); } catch {}
    };
  }

  // WebRTC initialization as caller (participant -> host) with Opus optimization
  public async initWebRTC(
    sendSignal: (signal: any, type: string) => void
  ): Promise<RTCPeerConnection> {
    if (this.peerConnection) {
      this.peerConnection.close();
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    if (this.stream) {
      this.stream.getAudioTracks().forEach(track => {
        pc.addTrack(track, this.stream!);
      });
    }

    // Explicitly configure audio transceiver as sendonly
    try {
      const transceivers = pc.getTransceivers();
      const audioTx = transceivers.find(t => t.sender.track && t.sender.track.kind === 'audio');
      if (audioTx) {
        audioTx.direction = 'sendonly';
      }
    } catch {}

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal(event.candidate, 'candidate');
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        console.warn(`[WebRTC] Participant connection ${pc.connectionState}, standing by for renegotiation...`);
      }
    };

    const offer = await pc.createOffer({
      offerToReceiveAudio: false,
      offerToReceiveVideo: false
    });

    const tunedOffer = new RTCSessionDescription({
      type: offer.type,
      sdp: optimizeOpusSDP(offer.sdp || '')
    });

    await pc.setLocalDescription(tunedOffer);
    sendSignal(tunedOffer, 'offer');

    this.peerConnection = pc;
    return pc;
  }

  public async handleAnswer(answer: RTCSessionDescriptionInit) {
    if (this.peerConnection) {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      for (const cand of this.pendingCandidates) {
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(cand));
        } catch (e) {
          console.warn('Participant drained candidate failed:', e);
        }
      }
      this.pendingCandidates = [];
    }
  }

  public async handleCandidate(candidate: RTCIceCandidateInit) {
    if (!this.peerConnection || !this.peerConnection.remoteDescription) {
      this.pendingCandidates.push(candidate);
      return;
    }
    try {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.warn('Participant addIceCandidate failed:', e);
    }
  }

  // Collect real-time WebRTC network statistics (RTT, Packet Loss, Bitrate, Bytes Sent)
  public async getStats(): Promise<ClientNetworkStats> {
    if (!this.peerConnection) {
      return { 
        rttMs: 0, 
        packetLossPct: 0, 
        jitterMs: 0, 
        bitrateKbps: 0, 
        candidateType: 'none',
        bytesSent: 0,
        packetsSent: 0
      };
    }
    try {
      const stats = await this.peerConnection.getStats();
      let rtt = 0;
      let packetLoss = 0;
      let jitter = 0;
      let bitrate = 0;
      let candType = 'host';
      let bytesSent = 0;
      let packetsSent = 0;

      stats.forEach((report: any) => {
        if (report.type === 'candidate-pair' && (report.state === 'succeeded' || report.nominated)) {
          rtt = Math.round((report.currentRoundTripTime || 0) * 1000);
        }
        if (report.type === 'remote-inbound-rtp' && report.kind === 'audio') {
          jitter = Math.round((report.jitter || 0) * 1000);
          if (report.packetsLost && report.packetsReceived) {
            const total = report.packetsLost + report.packetsReceived;
            packetLoss = total > 0 ? Math.round((report.packetsLost / total) * 100) : 0;
          }
        }
        if (report.type === 'outbound-rtp' && report.kind === 'audio') {
          const now = report.timestamp;
          bytesSent = report.bytesSent || 0;
          packetsSent = report.packetsSent || 0;

          if (this.lastStatsTimestamp && this.lastBytesSent) {
            const timeDiff = (now - this.lastStatsTimestamp) / 1000;
            if (timeDiff > 0) {
              bitrate = Math.round(((bytesSent - this.lastBytesSent) * 8) / (timeDiff * 1000));
            }
          }
          this.lastStatsTimestamp = now;
          this.lastBytesSent = bytesSent;
          this.totalPacketsSent = packetsSent;
        }
      });

      return {
        rttMs: rtt,
        packetLossPct: packetLoss,
        jitterMs: jitter,
        bitrateKbps: Math.max(0, bitrate),
        candidateType: candType,
        bytesSent,
        packetsSent
      };
    } catch (e) {
      return { 
        rttMs: 0, 
        packetLossPct: 0, 
        jitterMs: 0, 
        bitrateKbps: 0, 
        candidateType: 'none',
        bytesSent: 0,
        packetsSent: 0
      };
    }
  }

  public stop() {
    this.stopMeterLoop();
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch {}
      this.audioContext = null;
    }
  }
}
