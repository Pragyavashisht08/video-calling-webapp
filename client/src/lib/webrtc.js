// Minimal mesh WebRTC helper
export class MeshRTC {
  constructor(localStream, onTrack, onPeerDisconnect, sendSignal) {
    this.localStream = localStream;
    this.peers = new Map(); // peerId -> RTCPeerConnection
    this.onTrack = onTrack;
    this.onPeerDisconnect = onPeerDisconnect;
    this.sendSignal = sendSignal;
    this.rtcConfig = {
      iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }]
    };
  }
  ensurePeer(peerId) {
    if (this.peers.has(peerId)) return this.peers.get(peerId);
    const pc = new RTCPeerConnection(this.rtcConfig);
    this.localStream?.getTracks().forEach(t => pc.addTrack(t, this.localStream));
    pc.ontrack = (ev) => {
      const [stream] = ev.streams;
      this.onTrack(peerId, stream);
    };
    pc.onicecandidate = (ev) => {
      if (ev.candidate) this.sendSignal('signal-ice', { to: peerId, candidate: ev.candidate });
    };
    pc.onconnectionstatechange = () => {
      if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
        this.peers.delete(peerId);
        this.onPeerDisconnect?.(peerId);
      }
    };
    this.peers.set(peerId, pc);
    return pc;
  }
  async handleOffer(from, description) {
    const pc = this.ensurePeer(from);
    await pc.setRemoteDescription(description);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.sendSignal('signal-answer', { to: from, description: pc.localDescription });
  }
  async handleAnswer(from, description) {
    const pc = this.ensurePeer(from);
    await pc.setRemoteDescription(description);
  }
  async handleIce(from, candidate) {
    const pc = this.ensurePeer(from);
    await pc.addIceCandidate(candidate);
  }
  async dial(peerId) {
    const pc = this.ensurePeer(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.sendSignal('signal-offer', { to: peerId, description: pc.localDescription });
  }
  replaceTracks(stream) {
    this.localStream = stream;
    for (const [, pc] of this.peers) {
      const senders = pc.getSenders();
      for (const track of stream.getTracks()) {
        const sender = senders.find(s => s.track && s.track.kind === track.kind);
        if (sender) sender.replaceTrack(track);
        else pc.addTrack(track, stream);
      }
    }
  }
}
