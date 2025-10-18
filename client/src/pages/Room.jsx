// client/src/pages/Room.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import io from "socket.io-client";
import "./Room.css";

const WS_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:5000";
const socket = io(WS_URL, { withCredentials: true });

export default function Room() {
  const { roomId } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const name = localStorage.getItem("userName") || search.get("name") || "";

  // security / lobby state
  const [approved, setApproved] = useState(false);
  const [lobby, setLobby] = useState([]);         // host view
  const [settings, setSettings] = useState({ locked: false, allowShare: true, allowUnmute: true });

  // AV + UI state
  const [participants, setParticipants] = useState([]); // [{name,isHost}]
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [chat, setChat] = useState([]);
  const [msg, setMsg] = useState("");
  const [recording, setRecording] = useState(false);
  const [activeSpeaker, setActiveSpeaker] = useState(""); // name
  const isHost = search.get("admin") === "true";

  const localVideo = useRef(null);
  const localStream = useRef(null);
  const mediaRecorder = useRef(null);
  const analyser = useRef(null);

  // ------ sign-in gate
  useEffect(() => {
    if (!name.trim()) {
      navigate("/login");
    }
  }, [name, navigate]);

  // ------ media init + socket flow
  useEffect(() => {
    let mounted = true;

    async function init() {
      // 1) get media
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (!mounted) return;
      localStream.current = stream;
      localVideo.current.srcObject = stream;

      // active speaker detection
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream);
      analyser.current = ctx.createAnalyser();
      analyser.current.fftSize = 512;
      src.connect(analyser.current);

      // 2) check meeting access (password already verified server-side if you add UI)
      // 3) ask to join
      socket.emit("request-join", { meetingId: roomId, name, isHost });

      socket.on("lobby-update", setLobby);
      socket.on("approved", () => setApproved(true));
      socket.on("join-reject", ({ reason }) => {
        alert(reason || "Join rejected");
        navigate("/home");
      });
      socket.on("participants", setParticipants);
      socket.on("host-settings", setSettings);
      socket.on("chat:msg", (m) => setChat((c) => [...c, m]));
    }

    init();
    return () => {
      mounted = false;
      socket.off("lobby-update");
      socket.off("approved");
      socket.off("join-reject");
      socket.off("participants");
      socket.off("host-settings");
      socket.off("chat:msg");
      socket.emit("leave");
      localStream.current?.getTracks().forEach((t) => t.stop());
    };
  }, [roomId, name, isHost, navigate]);

  // ------ active speaker tick
  useEffect(() => {
    let raf;
    const buf = new Uint8Array(analyser.current?.frequencyBinCount || 0);
    const tick = () => {
      if (analyser.current) {
        analyser.current.getByteFrequencyData(buf);
        const vol = buf.reduce((a, b) => a + b, 0) / buf.length;
        if (vol > 40) setActiveSpeaker(name);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [name]);

  // ------ controls
  const toggleMute = () => {
    if (!settings.allowUnmute && !isHost && !muted) return alert("Host disabled unmute");
    const t = localStream.current.getAudioTracks()[0];
    t.enabled = !t.enabled;
    setMuted(!t.enabled);
  };

  const toggleVideo = () => {
    const t = localStream.current.getVideoTracks()[0];
    t.enabled = !t.enabled;
    setVideoOff(!t.enabled);
  };

  const shareScreen = async () => {
    if (!settings.allowShare && !isHost) return alert("Host disabled screen sharing");
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const vTrack = display.getVideoTracks()[0];
      const [camTrack] = localStream.current.getVideoTracks();
      // replace in your PeerConnections (omitted here); we just show locally:
      localVideo.current.srcObject = display;
      vTrack.onended = () => { localVideo.current.srcObject = localStream.current; };
    } catch (e) { console.warn(e); }
  };

  const startStopRecord = () => {
    if (!recording) {
      mediaRecorder.current = new MediaRecorder(localStream.current, { mimeType: "video/webm;codecs=vp9" });
      const chunks = [];
      mediaRecorder.current.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      mediaRecorder.current.onstop = () => {
        const blob = new Blob(chunks, { type: "video/webm" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `meeting-${roomId}.webm`; a.click();
        URL.revokeObjectURL(url);
      };
      mediaRecorder.current.start(1000);
      setRecording(true);
    } else {
      mediaRecorder.current?.stop();
      setRecording(false);
    }
  };

  const sendMsg = () => {
    if (!msg.trim()) return;
    socket.emit("chat:msg", { meetingId: roomId, name, text: msg.trim() });
    setMsg("");
  };

  // host actions
  const approve = (socketId) => socket.emit("host-approve", { meetingId: roomId, socketId });
  const deny = (socketId) => socket.emit("host-deny", { meetingId: roomId, socketId });
  const toggleLock = () => socket.emit("host-settings", { meetingId: roomId, locked: !settings.locked });
  const toggleShare = () => socket.emit("host-settings", { meetingId: roomId, allowShare: !settings.allowShare });
  const toggleUnmute = () => socket.emit("host-settings", { meetingId: roomId, allowUnmute: !settings.allowUnmute });

  const leave = () => {
    socket.emit("leave");
    navigate("/home");
  };

  // render
  return (
    <div className="room-container">
      <header className="room-header">
        <div>Meeting</div>
        <span>Host: {isHost ? name : participants.find(p => p.isHost)?.name || "—"}</span>
      </header>

      {/* Lobby panel for host */}
      {isHost && lobby.length > 0 && (
        <div className="lobby-banner">
          <div>Waiting room ({lobby.length})</div>
          <div className="lobby-list">
            {lobby.map(w => (
              <div key={w.id} className="lobby-item">
                <span>{w.name}</span>
                <button onClick={() => approve(w.id)} className="btn small">Approve</button>
                <button onClick={() => deny(w.id)} className="btn small danger">Deny</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* waiting overlay for guests */}
      {!approved && !isHost ? (
        <div className="waiting">
          <div className="waiting-box">
            <h3>Waiting for host approval…</h3>
            <p>You’ll join automatically once the host admits you.</p>
            <button className="btn" onClick={leave}>Cancel</button>
          </div>
        </div>
      ) : null}

      <div className="video-grid">
        <div className={`video-tile ${activeSpeaker === name ? "active" : ""}`}>
          <video ref={localVideo} autoPlay playsInline muted />
          <div className="participant-name">{name}</div>
        </div>
        {/* Remote peers would be rendered here with real WebRTC PeerConnections */}
        {participants
          .filter((p) => p.name !== name)
          .map((p) => (
            <div key={p.name} className={`video-tile ${activeSpeaker === p.name ? "active" : ""}`}>
              <video autoPlay playsInline />
              <div className="participant-name">{p.name}{p.isHost ? " (Host)" : ""}</div>
            </div>
          ))}
      </div>

      <div className="controls-bar">
        <button className="control-button" onClick={toggleMute}>{muted ? "🔇 Unmute" : "🎙️ Mute"}</button>
        <button className="control-button" onClick={toggleVideo}>{videoOff ? "📷 Start Video" : "📹 Stop Video"}</button>
        <button className="control-button" onClick={shareScreen}>🖥️ Share Screen</button>
        <button className="control-button" onClick={startStopRecord}>{recording ? "⏹ Stop" : "📼 Record"}</button>
        <button className="control-button">✋ Raise Hand</button>
        <button className="control-button danger" onClick={leave}>🚪 Leave</button>
      </div>

      {/* Chat docked */}
      <div className="chat-dock">
        <div className="chat-messages">
          {chat.map((m, i) => (
            <div key={i} className="chat-line"><strong>{m.name}:</strong> {m.text}</div>
          ))}
        </div>
        <div className="chat-input-row">
          <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Message…" onKeyDown={(e)=>e.key==="Enter"&&sendMsg()} />
          <button className="btn" onClick={sendMsg}>Send</button>
        </div>
      </div>

      {/* Host security footer */}
      {isHost && (
        <div className="host-bar">
          <button className="btn" onClick={toggleLock}>{settings.locked ? "🔒 Unlock" : "🔒 Lock"}</button>
          <button className="btn" onClick={toggleShare}>{settings.allowShare ? "✅ Allow Share" : "🚫 Share Disabled"}</button>
          <button className="btn" onClick={toggleUnmute}>{settings.allowUnmute ? "✅ Allow Unmute" : "🚫 Unmute Disabled"}</button>
        </div>
      )}
    </div>
  );
}
