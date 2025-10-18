// server/src/index.js 
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import crypto from "crypto";

import { rooms, getOrCreateRoom, serializeRoom } from "./room.js";

const app = express();
const server = http.createServer(app);

// Socket.IO bound to the SAME HTTP server on port 4000
const io = new Server(server, {
  // default path is "/socket.io"—client should use the same (no custom path needed)
  cors: { origin: ["http://localhost:5173"], credentials: true },
});

app.use(helmet());
app.use(express.json());
app.use(cookieParser());
app.use(cors({ origin: "http://localhost:5173", credentials: true }));

const limiter = rateLimit({ windowMs: 60_000, max: 180 });
app.use(limiter);

// In-memory meeting registry (REST layer)
// meetingId -> { title, createdBy, pwdHash, requiresApproval, scheduledFor, ...runtime kept in rooms.js }
const meetings = new Map();
const newMeetingId = () => crypto.randomBytes(6).toString("base64url");

// --- tiny helper: require a user name for modifying endpoints
function requireName(req, res, next) {
  const name = (req.headers["x-user-name"] || "").trim();
  if (!name) return res.status(401).json({ ok: false, error: "Unauthorized: x-user-name required" });
  req.userName = name;
  next();
}

// ========== REST API ==========

// Create (host/creator only; must provide x-user-name)
app.post("/api/meetings/create", requireName, async (req, res) => {
  const { title, password, scheduledFor, requiresApproval } = req.body || {};
  const meetingId = newMeetingId();
  const pwdHash = password ? await bcrypt.hash(password, 10) : null;

  meetings.set(meetingId, {
    meetingId,
    title: title || `${req.userName}'s Meeting`,
    createdBy: req.userName,
    pwdHash,
    requiresApproval: !!requiresApproval,
    scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
  });

  // Pre-warm a runtime room shell (optional, nice DX)
  getOrCreateRoom({
    id: meetingId,
    title: meetings.get(meetingId).title,
    createdBy: req.userName,
    requiresApproval: !!requiresApproval,
    password: !!pwdHash,
    scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
  });

  res.json({ ok: true, meetingId });
});

// Public list (no auth to avoid 401 spam in your UI)
app.get("/api/meetings/upcoming", (_req, res) => {
  const list = [...meetings.values()].map((m) => ({
    _id: m.meetingId,
    meetingId: m.meetingId,
    title: m.title,
    scheduledFor: m.scheduledFor,
    createdBy: m.createdBy,
    requiresApproval: !!m.requiresApproval,
    password: m.pwdHash ? "set" : "",
  }));
  res.json({ ok: true, meetings: list });
});

// Delete (only creator can delete)
// client: fetch(`/api/meetings/${id}`, { method:'DELETE', headers:{'x-user-name': <name>} })
app.delete("/api/meetings/:id", requireName, (req, res) => {
  const id = req.params.id;
  const m = meetings.get(id);
  if (!m) return res.status(404).json({ ok: false, error: "Not found" });
  if (m.createdBy !== req.userName) return res.status(403).json({ ok: false, error: "Forbidden" });

  meetings.delete(id);
  rooms.delete(id);
  res.json({ ok: true });
});

// Quick password check (optional; used if you prompt for password on join)
app.post("/api/meetings/check", (req, res) => {
  const { meetingId, password } = req.body || {};
  const m = meetings.get(meetingId);
  if (!m) return res.status(404).json({ ok: false, error: "Not found" });
  if (!m.pwdHash) return res.json({ ok: true, locked: false, title: m.title });

  bcrypt.compare(password || "", m.pwdHash).then((good) => {
    if (!good) return res.status(401).json({ ok: false, error: "Bad password" });
    res.json({ ok: true, locked: false, title: m.title });
  });
});

// ========== Socket.IO ==========
io.on("connection", (socket) => {
  let joinedMeetingId = null;

  // Simple SFU/MCU-agnostic signaling pass-through (if you use WebRTC signaling)
  socket.on("webrtc:signal", ({ to, data }) => {
    io.to(to).emit("webrtc:signal", { from: socket.id, data });
  });

  // Join request (host or guest)
  socket.on("request-join", async ({ meetingId, name, isHost, password }, cb = () => {}) => {
    // If meeting exists in REST memory
    let meta = meetings.get(meetingId);

    // Host can auto-create a live room shell if runtime lost (e.g., server restart)
    if (!meta && isHost) {
      meta = {
        meetingId,
        title: `${name}'s Meeting`,
        createdBy: name,
        pwdHash: null,
        requiresApproval: false,
        scheduledFor: null,
      };
      meetings.set(meetingId, meta);
    }

    if (!meta) {
      cb({ ok: false, error: "Meeting not found" });
      return socket.emit("join-reject", { reason: "Meeting not found" });
    }

    // Password check if set
    if (meta.pwdHash) {
      const ok = await bcrypt.compare(password || "", meta.pwdHash);
      if (!ok) {
        cb({ ok: false, error: "Wrong password" });
        return socket.emit("join-reject", { reason: "Wrong password" });
      }
    }

    // Make sure a runtime room exists and is in sync
    const room = getOrCreateRoom({
      id: meetingId,
      title: meta.title,
      createdBy: meta.createdBy,
      requiresApproval: !!meta.requiresApproval,
      password: !!meta.pwdHash,
      scheduledFor: meta.scheduledFor,
    });

    if (room.locked && !isHost) {
      cb({ ok: false, error: "Meeting is locked" });
      return socket.emit("join-reject", { reason: "Meeting is locked" });
    }

    // Host claim if none
    if (!room.hostId && isHost) room.hostId = socket.id;

    const joiningUser = {
      id: socket.id,
      name: name || "User",
      isMuted: false,
      handRaised: false,
      isSharing: false,
      role: socket.id === room.hostId ? "host" : "guest",
    };

    socket.join(meetingId);

    if (socket.id !== room.hostId && (room.requiresApproval || room.locked)) {
      room.waiting.set(socket.id, { id: socket.id, name: joiningUser.name });
      // notify host of lobby
      if (room.hostId) {
        io.to(room.hostId).emit("lobby-update", [...room.waiting.values()]);
      }
      cb({ ok: true, waiting: true, room: serializeRoom(room) });
      return;
    }

    // admit (host or unlocked)
    joinedMeetingId = meetingId;
    room.participants.set(socket.id, joiningUser);
    io.to(meetingId).emit("participants", [...room.participants.values()]);
    cb({ ok: true, role: joiningUser.role, room: serializeRoom(room) });
    socket.emit("approved");
  });

  // Host admits/denies from lobby
  socket.on("host-approve", ({ meetingId, socketId }) => {
    const room = rooms.get(meetingId);
    if (!room || socket.id !== room.hostId) return;
    const w = room.waiting.get(socketId);
    if (!w) return;
    room.waiting.delete(socketId);
    room.participants.set(socketId, {
      id: socketId,
      name: w.name,
      isMuted: false,
      handRaised: false,
      isSharing: false,
      role: "guest",
    });
    io.to(socketId).emit("approved");
    io.to(meetingId).emit("participants", [...room.participants.values()]);
    io.to(room.hostId).emit("lobby-update", [...room.waiting.values()]);
  });

  socket.on("host-deny", ({ meetingId, socketId }) => {
    const room = rooms.get(meetingId);
    if (!room || socket.id !== room.hostId) return;
    room.waiting.delete(socketId);
    io.to(socketId).emit("join-reject", { reason: "Denied by host" });
    io.sockets.sockets.get(socketId)?.leave(meetingId);
    io.to(room.hostId).emit("lobby-update", [...room.waiting.values()]);
  });

  // Host settings
  socket.on("host-settings", ({ meetingId, locked, allowShare, allowUnmute }) => {
    const room = rooms.get(meetingId);
    if (!room || socket.id !== room.hostId) return;
    if (typeof locked === "boolean") room.locked = locked;
    if (typeof allowShare === "boolean") room.allowShare = allowShare;
    if (typeof allowUnmute === "boolean") room.allowUnmute = allowUnmute;
    io.to(meetingId).emit("host-settings", {
      locked: room.locked,
      allowShare: room.allowShare,
      allowUnmute: room.allowUnmute,
    });
  });

  // Chat
  socket.on("chat:msg", ({ meetingId, name, text }) => {
    if (!text?.trim()) return;
    io.to(meetingId).emit("chat:msg", { name: name || "User", text: text.trim(), ts: Date.now() });
  });

  // Cleanup on leave / disconnect
  const cleanup = () => {
    if (!joinedMeetingId) return;
    const room = rooms.get(joinedMeetingId);
    if (!room) return;
    room.waiting.delete(socket.id);
    room.participants.delete(socket.id);
    io.to(joinedMeetingId).emit("participants", [...room.participants.values()]);

    // if host leaves, unlock, clear lobby, notify & keep room ephemeral
    if (socket.id === room.hostId) {
      room.hostId = null;
      room.locked = false;
      for (const sid of room.waiting.keys()) {
        io.to(sid).emit("join-reject", { reason: "Host left" });
        io.sockets.sockets.get(sid)?.leave(joinedMeetingId);
      }
      room.waiting.clear();
    }
  };

  socket.on("leave", cleanup);
  socket.on("disconnect", cleanup);
});

// ========== Start ==========
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
