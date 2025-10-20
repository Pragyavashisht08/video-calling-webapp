// client/src/pages/Room.jsx
import React, { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import io from "socket.io-client";
import "./Room.css";

const WS_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";
const socket = io(WS_URL, { withCredentials: true });

function beep(freq = 880, duration = 120) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    o.connect(g);
    g.connect(ctx.destination);
    g.gain.setValueAtTime(0.001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
    o.start();
    setTimeout(() => {
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.02);
      o.stop(); ctx.close();
    }, duration);
  } catch {}
}

function toast(message, type = "info") {
  const el = document.createElement("div");
  el.className = `notification ${type}`;
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, 2800);
}

export default function Room() {
  const { roomId } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();

  const name = (localStorage.getItem("userName") || search.get("name") || "").trim();
  const isHost = search.get("admin") === "true";

  useEffect(() => { if (!name) navigate("/home"); }, [name, navigate]);

  // state
  const [approved, setApproved] = useState(isHost);
  const [lobby, setLobby] = useState([]);
  const [settings, setSettings] = useState({ locked: false, allowShare: true, allowUnmute: true });
  const [participants, setParticipants] = useState([]);
  const [chat, setChat] = useState([]);
  const [msg, setMsg] = useState("");
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [recording, setRecording] = useState(false);
  const [activeSpeaker, setActiveSpeaker] = useState("");
  const [myId, setMyId] = useState("");
  const [isSharing, setIsSharing] = useState(false);

  // media + rtc
  const localVideo = useRef(null);
  const localStream = useRef(null);
  const displayStreamRef = useRef(null);
  const analyser = useRef(null);

  const peers = useRef(new Map());         // id -> RTCPeerConnection
  const remoteStreams = useRef(new Map()); // id -> MediaStream
  const remoteVideoEls = useRef(new Map()); // id -> <video>

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (!mounted) return;
        localStream.current = stream;
        localVideo.current.srcObject = stream;

        // active speaker meter
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const src = ctx.createMediaStreamSource(stream);
        analyser.current = ctx.createAnalyser();
        analyser.current.fftSize = 512;
        src.connect(analyser.current);

        socket.on("connect", () => setMyId(socket.id));

        socket.on("lobby-update", (list) => {
          setLobby(list);
          if (isHost && list.length) {
            beep(740, 160);
            toast(`${list[list.length - 1]?.name || "Someone"} requested to join`, "info");
          }
        });

        socket.on("approved", () => { setApproved(true); beep(1040, 120); toast("You're approved. Joining…", "success"); });
        socket.on("join-reject", ({ reason }) => { toast(reason || "Join rejected", "error"); navigate("/home"); });

        socket.on("host-settings", setSettings);

        // participants
        let prevIds = new Set();
        socket.on("participants", async (list) => {
          setParticipants(list);
          const ids = new Set(list.map(p => p.id));

          // notifications
          const joined = [...ids].filter(id => !prevIds.has(id));
          const left = [...prevIds].filter(id => !ids.has(id));
          const byId = Object.fromEntries(list.map(p => [p.id, p]));
          joined.forEach(id => { if (id !== myId) { beep(920,120); toast(`${byId[id]?.name || "Guest"} joined`, "success"); } });
          left.forEach(id => { const nm = remoteStreams.current.get(id)?.__name || "A participant"; beep(480,120); toast(`${nm} left`, "info"); });
          prevIds = ids;

          // ensure peers exist for current ids
          for (const p of list) {
            if (p.id === myId) continue;
            if (!peers.current.has(p.id)) await createPeer(p.id);
          }
          // close for removed
          for (const [pid] of peers.current) if (!ids.has(pid)) closePeer(pid);

          // anti-glare: lower socket id becomes offerer
          for (const p of list) {
            if (p.id === myId) continue;
            if (myId && p.id && myId < p.id) {
              const pc = peers.current.get(p.id);
              if (pc && !pc.currentRemoteDescription) {
                try {
                  const offer = await pc.createOffer();
                  await pc.setLocalDescription(offer);
                  socket.emit("webrtc:signal", { to: p.id, data: { sdp: offer } });
                } catch {}
              }
            }
          }
        });

        socket.on("webrtc:signal", async ({ from, data }) => {
          let pc = peers.current.get(from);
          if (!pc) { await createPeer(from); pc = peers.current.get(from); }
          try {
            if (data.sdp) {
              const desc = new RTCSessionDescription(data.sdp);
              await pc.setRemoteDescription(desc);
              if (desc.type === "offer") {
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                socket.emit("webrtc:signal", { to: from, data: { sdp: answer } });
              }
            } else if (data.candidate) {
              try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch {}
            }
          } catch {}
        });

        socket.on("chat:msg", (m) => setChat(c => [...c, m]));

        socket.on("room:ended", () => {
          beep(360, 300);
          toast("Meeting ended by host", "info");
          setTimeout(() => navigate("/"), 400);
        });

        socket.emit("request-join", { meetingId: roomId, name, isHost });
      } catch {
        toast("Camera/Microphone permission required", "error");
        navigate("/home");
      }
    }

    init();

    // active speaker pulse for local user
    let raf;
    const buf = new Uint8Array(analyser.current?.frequencyBinCount || 0);
    const tick = () => {
      if (analyser.current) {
        analyser.current.getByteFrequencyData(buf);
        const vol = buf.reduce((a, b) => a + b, 0) / (buf.length || 1);
        setActiveSpeaker(vol > 40 ? name : "");
      }
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      mounted = false;
      cancelAnimationFrame(raf);
      socket.emit("leave");
      socket.off();
      for (const [pid] of peers.current) closePeer(pid);
      peers.current.clear();
      remoteStreams.current.clear();
      stopScreenShare(true); // ensure we restore/cleanup
      localStream.current?.getTracks().forEach(t => t.stop());
    };
  }, [roomId, name, isHost, navigate, myId]);

  async function createPeer(remoteId) {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });

    if (localStream.current) localStream.current.getTracks().forEach(t => pc.addTrack(t, localStream.current));

    pc.onicecandidate = (e) => { if (e.candidate) socket.emit("webrtc:signal", { to: remoteId, data: { candidate: e.candidate } }); };

    pc.ontrack = (e) => {
      let stream = remoteStreams.current.get(remoteId);
      if (!stream) {
        stream = new MediaStream();
        stream.__name = participants.find(p => p.id === remoteId)?.name || "Guest";
        remoteStreams.current.set(remoteId, stream);
      }
      e.streams[0]?.getTracks().forEach(t => stream.addTrack(t));
      const el = remoteVideoEls.current.get(remoteId);
      if (el && el.srcObject !== stream) el.srcObject = stream;
    };

    pc.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) closePeer(remoteId);
    };

    peers.current.set(remoteId, pc);
    return pc;
  }

  function closePeer(remoteId) {
    const pc = peers.current.get(remoteId);
    if (pc) { try { pc.close(); } catch {} }
    peers.current.delete(remoteId);
    const el = remoteVideoEls.current.get(remoteId);
    if (el) { el.srcObject = null; remoteVideoEls.current.delete(remoteId); }
    remoteStreams.current.delete(remoteId);
  }

  // controls
  const toggleMute = () => {
    const t = localStream.current?.getAudioTracks?.()[0];
    if (!t) return;
    if (!settings.allowUnmute && !isHost && t.enabled === false) { toast("Host disabled unmute", "error"); return; }
    t.enabled = !t.enabled;
    setMuted(!t.enabled);
  };

  const toggleVideo = () => {
    const t = localStream.current?.getVideoTracks?.()[0];
    if (!t) return;
    t.enabled = !t.enabled; setVideoOff(!t.enabled);
  };

  const startScreenShare = async () => {
    if (!settings.allowShare && !isHost) { toast("Host disabled screen sharing", "error"); return; }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      displayStreamRef.current = display;
      const vTrack = display.getVideoTracks()[0];

      // replace outgoing video for all peers
      for (const [, pc] of peers.current) {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === "video");
        if (sender) await sender.replaceTrack(vTrack);
      }
      // show locally
      localVideo.current.srcObject = display;

      setIsSharing(true);

      vTrack.onended = () => stopScreenShare();
    } catch {}
  };

  const stopScreenShare = async (duringCleanup = false) => {
    if (!isSharing && !displayStreamRef.current) return;

    // stop display tracks
    displayStreamRef.current?.getTracks?.().forEach(t => t.stop());
    displayStreamRef.current = null;

    // restore camera
    const cam = localStream.current?.getVideoTracks?.()[0];
    if (cam) {
      for (const [, pc] of peers.current) {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === "video");
        if (sender) { try { await sender.replaceTrack(cam); } catch {} }
      }
      localVideo.current.srcObject = localStream.current;
    }
    if (!duringCleanup) { setIsSharing(false); toast("Stopped screen sharing", "info"); }
  };

  const startStopRecord = () => {
    if (!recording) {
      const rec = new MediaRecorder(localStream.current, { mimeType: "video/webm;codecs=vp9" });
      const chunks = [];
      rec.ondataavailable = e => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: "video/webm" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `meeting-${roomId}.webm`; a.click();
        URL.revokeObjectURL(url);
      };
      rec.start(1000);
      (window).__rec = rec;
      setRecording(true);
      toast("Recording started (local)", "info");
    } else {
      (window).__rec?.stop();
      setRecording(false);
      toast("Recording saved", "success");
    }
  };

  const sendMsg = () => { if (!msg.trim()) return; socket.emit("chat:msg", { meetingId: roomId, name, text: msg.trim() }); setMsg(""); };

  // host actions
  const approve = (socketId) => socket.emit("host-approve", { meetingId: roomId, socketId });
  const deny = (socketId) => socket.emit("host-deny", { meetingId: roomId, socketId });
  const toggleLock = () => socket.emit("host-settings", { meetingId: roomId, locked: !settings.locked });
  const toggleShare = () => socket.emit("host-settings", { meetingId: roomId, allowShare: !settings.allowShare });
  const toggleUnmute = () => socket.emit("host-settings", { meetingId: roomId, allowUnmute: !settings.allowUnmute });

  const endMeeting = () => {
    if (!isHost) return;
    if (confirm("End meeting for everyone?")) socket.emit("host:end-meeting", { roomId });
  };

  const leave = () => { socket.emit("leave"); navigate("/home"); };

  return (
    <div className="room-container">
      <header className="room-header">
        <div className="room-title">Meeting</div>
        <div className="room-right">
          <span className="room-pill">{isHost ? "Host" : "Guest"}: {name}</span>
          <span className="room-pill">{participants.length || 1} in call</span>
          <span className={`room-pill ${settings.locked ? "danger" : ""}`}>{settings.locked ? "Locked" : "Unlocked"}</span>
          {isHost
            ? <button className="btn btn-danger" onClick={endMeeting}>End</button>
            : <button className="btn" onClick={leave}>Leave</button>}
        </div>
      </header>

      {isHost && lobby.length > 0 && (
        <div className="lobby-banner">
          <div className="lobby-title">Waiting room ({lobby.length})</div>
          <div className="lobby-list">
            {lobby.map(w => (
              <div key={w.id} className="lobby-item">
                <span>{w.name}</span>
                <div className="lobby-actions">
                  <button className="btn small" onClick={() => approve(w.id)}>Approve</button>
                  <button className="btn small danger" onClick={() => deny(w.id)}>Deny</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!approved && !isHost && (
        <div className="waiting">
          <div className="waiting-box">
            <h3>Waiting for host approval…</h3>
            <p>You’ll join automatically once the host admits you.</p>
            <button className="btn" onClick={leave}>Cancel</button>
          </div>
        </div>
      )}

      <div className="video-grid">
        <div className={`video-tile ${activeSpeaker === name ? "active" : ""}`}>
          <video ref={localVideo} autoPlay playsInline muted onCanPlay={(e)=>e.currentTarget.play().catch(()=>{})}/>
          <div className="participant-name">{name} {isHost ? "(Host)" : ""}</div>
        </div>

        {participants.filter(p => p.id !== myId).map(p => (
          <RemoteTile
            key={p.id}
            pid={p.id}
            name={p.name}
            active={activeSpeaker === p.name}
            remoteVideoEls={remoteVideoEls}
            remoteStreams={remoteStreams}
          />
        ))}
      </div>

      <div className="controls-bar">
        <button className="control-button" onClick={toggleMute}>{muted ? "🔇 Unmute" : "🎙️ Mute"}</button>
        <button className="control-button" onClick={toggleVideo}>{videoOff ? "📷 Start Video" : "📹 Stop Video"}</button>
        {!isSharing
          ? <button className="control-button" onClick={startScreenShare}>🖥️ Share Screen</button>
          : <button className="control-button" onClick={() => stopScreenShare()}>🛑 Stop Share</button>}
        <button className="control-button" onClick={startStopRecord}>{recording ? "⏹ Stop" : "📼 Record"}</button>
        <button className="control-button" onClick={() => toast("Hand raised ✋", "info")}>✋ Raise Hand</button>
        {!isHost && <button className="control-button danger" onClick={leave}>🚪 Leave</button>}
      </div>

      <div className="chat-dock">
        <div className="chat-messages">
          {chat.map((m, i) => (
            <div key={i} className="chat-line"><strong className="chat-name">{m.name}:</strong> <span className="chat-text">{m.text}</span></div>
          ))}
        </div>
        <div className="chat-input-row">
          <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Message…" onKeyDown={(e)=>e.key==="Enter"&&sendMsg()} />
          <button className="btn" onClick={sendMsg}>Send</button>
        </div>
      </div>

      {isHost && (
        <div className="host-bar">
          <button className="btn" onClick={toggleLock}>{settings.locked ? "🔓 Unlock" : "🔒 Lock"}</button>
          <button className="btn" onClick={toggleShare}>{settings.allowShare ? "✅ Allow Share" : "🚫 Share Disabled"}</button>
          <button className="btn" onClick={toggleUnmute}>{settings.allowUnmute ? "✅ Allow Unmute" : "🚫 Unmute Disabled"}</button>
        </div>
      )}
    </div>
  );
}

function RemoteTile({ pid, name, active, remoteVideoEls, remoteStreams }) {
  const ref = useRef(null);
  useEffect(() => {
    remoteVideoEls.current.set(pid, ref.current);
    const s = remoteStreams.current.get(pid);
    if (s && ref.current && ref.current.srcObject !== s) ref.current.srcObject = s;
    return () => { remoteVideoEls.current.delete(pid); if (ref.current) ref.current.srcObject = null; };
  }, [pid, remoteStreams, remoteVideoEls]);
  return (
    <div className={`video-tile ${active ? "active" : ""}`}>
      <video ref={ref} autoPlay playsInline onCanPlay={(e)=>e.currentTarget.play().catch(()=>{})}/>
      <div className="participant-name">{name}</div>
    </div>
  );
}
