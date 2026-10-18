# MICRO PAD // Futuristic Retro Monochrome Wireless Microphone & PA System

> **A real-time, local-network wireless microphone and audio distribution console.**  
> Built for laptops connected to venue Bluetooth/Wired PA speakers with multi-handset streaming, exclusive routing, and intelligent Voice Activity Detection (VAD) floor arbitration.

---

## 1. System Overview

MICRO PAD transforms smartphones into low-latency wireless microphones for events, stage panels, classroom lectures, and community PA systems without requiring any expensive cloud subscriptions or paid third-party infrastructure.

### Architecture Highlights:
- **Signaling Server:** Node.js + Express + Socket.IO (Port `3001`).
- **Real-Time Audio Transport:** WebRTC (`RTCPeerConnection`) with native browser Opus audio codec.
- **Console Audio Routing:** Web Audio API with per-channel `GainNode`, 25ms clickless exponential crossfade, and hardware VU analysers.
- **Visual Design:** Strict **Monochrome Future / Retro Broadcast** aesthetic (Black, White, Neutral Greys `#080808` to `#F5F5F5`).
- **Arbitration Engine:** Real-time priority arbitration, floor lock duration, silence timeouts, cooldown damping, and instant manual admin override.

---

## 2. Quick Start

### Prerequisites
- Node.js (v18+ recommended, v20+ supported)
- Modern browser (Chrome, Edge, Safari, Firefox)

### Start Development Server
```bash
npm install
npm run dev
```

This single command launches:
1. **Backend Signaling & Arbitration Server:** `http://localhost:3001` (and `http://<LAN_IP>:3001`)
2. **Frontend Console (Vite):** `http://localhost:5173` (and `http://<LAN_IP>:5173`)

---

## 3. Connecting Physical Smartphones on the Same Network

1. Make sure your laptop and smartphone are connected to the same Wi-Fi router or laptop mobile hotspot.
2. In the Admin Control Room header, click **CONNECT PHONES**.
3. A pairing QR code will be displayed showing your local network IP (e.g., `http://172.20.10.5:5173/?session=MICRO-01&role=mic`).
4. Point your smartphone camera at the screen and tap the link to join directly as a wireless microphone transmitter.

---

## 4. Key Keyboard Controls (Admin Console)

- **`1`**: Route floor immediately to **MIC 01**
- **`2`**: Route floor immediately to **MIC 02**
- **`3`**: Route floor immediately to **MIC 03**
- **Emergency Audio Stop**: Top right button cuts all audio output instantly.

---

## 5. Automated Tests

Run the arbitration test suite:
```bash
npm test
```
Verifies:
- Exclusive microphone routing
- Higher-priority preemption
- Floor lock timers
- Silence timeouts and floor release
- Deterministic FIFO tie-breaking
- Emergency stop audio clamping

---

## 6. Real-World Limitations & Best Practices

- **Bluetooth Speaker Latency:** Bluetooth A2DP audio profiles add ~80–180ms of internal physical buffering on the speaker hardware. For time-critical stage monitoring, plug a 3.5mm AUX or USB interface directly into the host laptop.
- **Room Feedback:** In loud venue halls, high loudspeaker volume can be picked up by handset microphones. Maintain reasonable distance between the handsets and the loudspeakers or use directional speaking technique.
