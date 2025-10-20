// client/src/pages/Room.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { io } from "socket.io-client";
import {
  Video, Mic, MicOff, Monitor, PhoneOff, Shield, Users, Lock, UserCheck
} from "lucide-react";
import "./Room.css";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";

// one persistent socket connection for this page
const socket = io(SERVER_URL, {
  transports: ["websocket"], // avoids long-polling CORS weirdness
  withCredentials: true,
  autoConnect: true,
});

export default function Room() {
  const { id: meetingId } = useParams();
  const qs = useMemo(() => new URLSearchParams(window.location.search), []);
  const displayName = (qs.get("name") || localStorage.getItem("userName") || "You").trim();
  const isHost = qs.get("admin") === "true";

  // media
  const localVideoRef = useRef(null);
  const [localStream, setLocalStream] = useState(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);

  // peers
  const peersRef = useRef(new Map());      // socketId -> RTCPeerConnection
  const streamsRef = useRef(new Map());    // socketId -> MediaStream
  const [participants, setParticipants] = useState([]); // [{id,name,role...}]

  // simple toasts + beep
  const beeperRef = useRef(null);
  function beep() {
    try {
      if (!beeperRef.current) {
        const ctx = new AudioContext();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine"; o.frequency.value = 880;
        o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
        o.start(); o.stop(ctx.currentTime + 0.12);
        beeperRef.current = ctx; // keep context alive
      } else {
        const ctx = beeperRef.current;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine"; o.frequency.value = 880;
        o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
        o.start(); o.stop(ctx.currentTime + 0.12);
      }
    } catch {}
  }
  function toast(text, type = "info") {
    const box = document.createElement("div");
    box.className = `notification ${type}`;
    box.textContent = text;
    document.body.appendChild(box);
    setTimeout(() => box.classList.add("show"), 10);
    setTimeout(() => { box.classList.remove("show"); setTimeout(() => box.remove(), 250); }, 2500);
  }

  // attach local media
  useEffect(() => {
    let mounted = true;

    async function getMedia() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        });
        if (!mounted) return;

        setLocalStream(stream);
        // autoplay-policy: local video must be muted to auto play
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          localVideoRef.current.muted = true;
          localVideoRef.current.playsInline = true;
          localVideoRef.current.autoplay = true;
        }
      } catch (err) {
        toast("Could not access camera/microphone. Check permissions.", "error");
        console.error(err);
      }
    }

    getMedia();
    return () => { mounted = false; };
  }, []);

  // join the room once socket connected & we have localStream (for host we also want immediate tracks ready)
  useEffect(() => {
    if (!localStream) return;

    socket.emit(
      "request-join",
      { meetingId, name: displayName, isHost },
      (ack) => {
        if (!ack?.ok) {
          toast(ack?.error || "Unable to join meeting", "error");
          return;
        }
        if (ack.waiting) {
          toast("Waiting for host approval…", "info");
        } else {
          toast(`Joined as ${ack.role}`, "success");
        }
      }
    );
  }, [localStream, meetingId, displayName, isHost]);

  // helpers to build peer connections
  function createPeer(remoteId) {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    // forward our local tracks
    if (localStream) {
      localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit("webrtc:signal", { to: remoteId, data: { candidate: e.candidate } });
      }
    };

    pc.ontrack = (e) => {
      // attach remote stream
      let ms = streamsRef.current.get(remoteId);
      if (!ms) {
        ms = new MediaStream();
        streamsRef.current.set(remoteId, ms);
        // render video element if not present yet
        ensureRemoteVideo(remoteId, ms);
      }
      ms.addTrack(e.track);
    };

    peersRef.current.set(remoteId, pc);
    return pc;
  }

  function ensureRemoteVideo(remoteId, stream) {
    const elId = `remote-${remoteId}`;
    let v = document.getElementById(elId);
    if (!v) {
      v = document.createElement("video");
      v.id = elId;
      v.playsInline = true;
      v.autoplay = true;
      v.muted = false;
      v.className = "remote-video";
      const grid = document.getElementById("video-grid");
      grid?.appendChild(v);
    }
    v.srcObject = stream;
  }

  // socket listeners
  useEffect(() => {
    // participants list changed -> start offers to anyone we don't have a peer with
    function onParticipants(list) {
      setParticipants(list);
      list.forEach(async (p) => {
        if (p.id === socket.id) return;
        if (!peersRef.current.has(p.id)) {
          const pc = createPeer(p.id);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit("webrtc:signal", { to: p.id, data: { sdp: offer } });
        }
      });
    }

    async function onSignal({ from, data }) {
      let pc = peersRef.current.get(from);
      if (!pc) pc = createPeer(from);

      if (data.sdp) {
        const desc = new RTCSessionDescription(data.sdp);
        await pc.setRemoteDescription(desc);
        if (desc.type === "offer") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit("webrtc:signal", { to: from, data: { sdp: answer } });
        }
      } else if (data.candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) {
          // ignore if race condition
        }
      }
    }

    function onApproved() {
      toast("You were admitted by host", "success");
      beep();
    }

    function onNotify(payload) {
      // { type: "join"|"leave"|"end", text }
      beep();
      toast(payload?.text || "Notification", payload?.type === "end" ? "error" : "info");
    }

    function onRoomEnded() {
      toast("Meeting ended", "error");
      cleanupAllPeers();
      // navigate home after a brief grace period
      setTimeout(() => (window.location.href = "/"), 800);
    }

    function onForceLeave() {
      cleanupAllPeers();
      setTimeout(() => (window.location.href = "/"), 200);
    }

    function cleanupAllPeers() {
      peersRef.current.forEach((pc) => pc.close());
      peersRef.current.clear();
      streamsRef.current.clear();
      const grid = document.getElementById("video-grid");
      if (grid) {
        [...grid.querySelectorAll("video.remote-video")].forEach((el) => el.remove());
      }
    }

    socket.on("participants", onParticipants);
    socket.on("webrtc:signal", onSignal);
    socket.on("approved", onApproved);
    socket.on("notify", onNotify);
    socket.on("room:ended", onRoomEnded);
    socket.on("force-leave", onForceLeave);

    return () => {
      socket.off("participants", onParticipants);
      socket.off("webrtc:signal", onSignal);
      socket.off("approved", onApproved);
      socket.off("notify", onNotify);
      socket.off("room:ended", onRoomEnded);
      socket.off("force-leave", onForceLeave);
    };
  }, [localStream]);

  // mic/cam toggles
  function toggleMic() {
    const on = !micOn;
    setMicOn(on);
    localStream?.getAudioTracks().forEach((t) => (t.enabled = on));
  }
  function toggleCam() {
    const on = !camOn;
    setCamOn(on);
    localStream?.getVideoTracks().forEach((t) => (t.enabled = on));
    // keep local element showing last frame even if track disabled
  }

  function leave() {
    socket.emit("leave");
    window.history.length > 1 ? window.history.back() : (window.location.href = "/");
  }

  function hostEnd() {
    if (!isHost) return;
    socket.emit("host:end-meeting", { meetingId });
  }

  // basic UI
  return (
    <div className="room-wrap">
      <header className="room-bar">
        <div className="brand">
          <Video size={18} />
          <span>{meetingId}</span>
          {isHost ? (
            <span className="role role-host"><Shield size={14}/> Host</span>
          ) : (
            <span className="role"><Users size={14}/> Guest</span>
          )}
        </div>
        <div className="bar-right">
          {participants?.length ? (
            <span className="pill"><Users size={14}/> {participants.length}</span>
          ) : null}
          <span className="pill"><Lock size={14}/> {isHost ? "You can end meeting" : "Protected"}</span>
        </div>
      </header>

      <main className="stage">
        <div id="video-grid" className="grid">
          <div className="tile self">
            <video ref={localVideoRef} className="self-video" playsInline autoPlay muted />
            <div className="label">{displayName} (You)</div>
          </div>
          {/* remote tiles will be appended dynamically */}
        </div>
      </main>

      <footer className="controls">
        <button className={`control ${micOn ? "on" : "off"}`} onClick={toggleMic} title="Toggle Mic">
          {micOn ? <Mic size={18}/> : <MicOff size={18}/>}
        </button>
        <button className={`control ${camOn ? "on" : "off"}`} onClick={toggleCam} title="Toggle Camera">
          <Video size={18}/>
        </button>
        <button className="control" title="Screen share (browser UI)" onClick={async () => {
          try {
            const scr = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            // replace outgoing video track for all peers
            peersRef.current.forEach((pc) => {
              const senders = pc.getSenders().filter((s) => s.track && s.track.kind === "video");
              if (senders[0]) senders[0].replaceTrack(scr.getVideoTracks()[0]);
            });
            const [vtrack] = scr.getVideoTracks();
            vtrack.onended = () => {
              // revert to camera when sharing stops
              if (localStream) {
                const [camTrack] = localStream.getVideoTracks();
                peersRef.current.forEach((pc) => {
                  const senders = pc.getSenders().filter((s) => s.track && s.track.kind === "video");
                  if (senders[0]) senders[0].replaceTrack(camTrack);
                });
              }
            };
          } catch (e) {
            // user canceled
          }
        }}>
          <Monitor size={18}/>
        </button>

        <div className="spacer" />

        {isHost ? (
          <button className="danger" onClick={hostEnd} title="End meeting for everyone">
            <PhoneOff size={18}/> End
          </button>
        ) : (
          <button className="danger" onClick={leave} title="Leave meeting">
            <PhoneOff size={18}/> Leave
          </button>
        )}
      </footer>
    </div>
  );
}
