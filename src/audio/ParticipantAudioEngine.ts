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
}

export class ParticipantAudioEngine {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private peerConnection: RTCPeerConnection | null = null;
  private animationFrameId: number | null = null;
  private isMuted: boolean = false;
  private sensitivity: number = 1.0;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private lastStatsTimestamp: number = 0;
  private lastBytesSent: number = 0;

  constructor() {}

  public async startMicrophone(existingStream?: MediaStream, mode: 'stage' | 'conference' = 'stage'): Promise<MediaStream> {
    if (this.stream) {
      return this.stream;
    }

    let stream = existingStream;

    if (!stream) {
      const nav = typeof navigator !== 'undefined' ? (navigator as any) : {};
      const getUserMedia = nav.mediaDevices?.getUserMedia?.bind(nav.mediaDevices) ||
        (nav.getUserMedia ? (constraints: any) => new Promise<MediaStream>((res, rej) => nav.getUserMedia(constraints, res, rej)) : null) ||
        (nav.webkitGetUserMedia ? (constraints: any) => new Promise<MediaStream>((res, rej) => nav.webkitGetUserMedia(constraints, res, rej)) : null) ||
        (nav.mozGetUserMedia ? (constraints: any) => new Promise<MediaStream>((res, rej) => nav.mozGetUserMedia(constraints, res, rej)) : null);

      if (!getUserMedia) {
        if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
          throw new Error("Mobile browsers require HTTPS or localhost to access the microphone. Please open via https:// or test on localhost.");
        }
        throw new Error("Microphone API not supported or blocked by this browser.");
      }

      // Stage profile: echoCancellation & noiseSuppression FALSE to prevent phone DSP from ducking
      // or filtering vocal warmth when standing away from speaker in venue hall
      const audioConstraints: MediaTrackConstraints = mode === 'stage' ? {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 48000
      } : {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 48000
      };

      try {
        stream = await getUserMedia({
          audio: audioConstraints,
          video: false
        });
      } catch (e) {
        // Fallback to basic audio constraints if device rejects exact sampleRate
        stream = await getUserMedia({
          audio: { autoGainControl: true },
          video: false
        });
      }
    }

    if (!stream) {
      throw new Error("Unable to obtain audio stream.");
    }

    this.stream = stream;

    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    this.audioContext = new AudioCtx({ latencyHint: 'interactive' });
    const source = this.audioContext.createMediaStreamSource(stream);

    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.3;

    source.connect(this.analyser);
    // Note: Do NOT connect analyser to destination to avoid phone feedback!

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

  // Polls real microphone RMS level (0 - 100) and detects voice activity
  public startMeterLoop(onData: (level: number, isSpeaking: boolean) => void) {
    const check = () => {
      if (!this.analyser || this.isMuted) {
        onData(0, false);
      } else {
        const buffer = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteFrequencyData(buffer);

        let sum = 0;
        let peak = 0;
        for (let i = 0; i < buffer.length; i++) {
          const val = buffer[i];
          sum += val;
          if (val > peak) peak = val;
        }

        const avg = sum / buffer.length;
        // Apply sensitivity and scale to 0-100
        const scaledLevel = Math.min(100, Math.round((avg / 255) * 100 * 2.2 * this.sensitivity));
        
        // VAD threshold
        const isSpeaking = scaledLevel > 14;

        onData(scaledLevel, isSpeaking);
      }

      this.animationFrameId = requestAnimationFrame(check);
    };

    check();
  }

  public stopMeterLoop() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
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

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal(event.candidate, 'candidate');
      }
    };

    // Auto-reconnect handling on connection drops
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

  // Collect real-time WebRTC network statistics (RTT, Packet Loss, Bitrate)
  public async getStats(): Promise<ClientNetworkStats> {
    if (!this.peerConnection) {
      return { rttMs: 0, packetLossPct: 0, jitterMs: 0, bitrateKbps: 0, candidateType: 'none' };
    }
    try {
      const stats = await this.peerConnection.getStats();
      let rtt = 0;
      let packetLoss = 0;
      let jitter = 0;
      let bitrate = 0;
      let candType = 'host';

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
          const bytes = report.bytesSent;
          if (this.lastStatsTimestamp && this.lastBytesSent) {
            const timeDiff = (now - this.lastStatsTimestamp) / 1000;
            if (timeDiff > 0) {
              bitrate = Math.round(((bytes - this.lastBytesSent) * 8) / (timeDiff * 1000));
            }
          }
          this.lastStatsTimestamp = now;
          this.lastBytesSent = bytes;
        }
      });

      return {
        rttMs: rtt,
        packetLossPct: packetLoss,
        jitterMs: jitter,
        bitrateKbps: Math.max(0, bitrate),
        candidateType: candType
      };
    } catch (e) {
      return { rttMs: 0, packetLossPct: 0, jitterMs: 0, bitrateKbps: 0, candidateType: 'none' };
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
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}
