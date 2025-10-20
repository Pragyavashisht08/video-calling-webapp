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

/* ------------------------- CORS: env-driven setup ------------------------- */
const rawOrigins = (
  process.env.CORS_ORIGINS ||
  process.env.CLIENT_ORIGIN || // fallback (Render env)
  "http://localhost:5173"
)
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const toRegExp = (token) => {
  if (token.startsWith("/") && token.endsWith("/")) {
    try { return new RegExp(token.slice(1, -1)); } catch { /* ignore bad regex */ }
  }
  if (token.startsWith("*.")) {
    const base = token.slice(2).replace(/\./g, "\\.");
    return new RegExp(`^https?:\/\/[^/]+\\.${base}$`);
  }
  return token; // exact string
};

const allowedOrigins = rawOrigins.map(toRegExp);

const originMatches = (origin) => {
  if (!origin) return true; // allow same-origin & server-to-server
  return allowedOrigins.some(rule =>
    rule instanceof RegExp ? rule.test(origin) : rule === origin
  );
};

const expressCors = cors({
  origin(origin, cb) {
    if (originMatches(origin)) return cb(null, true);
    return cb(new Error("CORS: origin not allowed"), false);
  },
  credentials: true,
});
/* ------------------------------------------------------------------------ */

const app = express();
const server = http.createServer(app);

// CORS must be first and handle preflights
app.use(expressCors);
app.options("*", expressCors);

app.use(helmet());
app.use(express.json());
app.use(cookieParser());

const limiter = rateLimit({ windowMs: 60_000, max: 180 });
app.use(limiter);

// Socket.IO using the same dynamic origin check
const io = new Server(server, {
  cors: {
    origin(origin, cb) {
      if (originMatches(origin)) return cb(null, true);
      return cb(new Error("CORS: origin not allowed"), false);
    },
    credentials: true,
    methods: ["GET", "POST"],
  },
  // path: "/socket.io"
});

// In-memory meeting registry
const meetings = new Map();
const newMeetingId = () => crypto.randomBytes(6).toString("base64url");

// Require a user name for modifying endpoints
function requireName(req, res, next) {
  const name = (req.headers["x-user-name"] || "").trim();
  if (!name) return res.status(401).json({ ok: false, error: "Unauthorized: x-user-name required" });
  req.userName = name;
  next();
}

/* =============================== REST API =============================== */

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

  // Pre-warm a runtime room shell (optional)
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

// Public list
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
app.delete("/api/meetings/:id", requireName, (req, res) => {
  const id = req.params.id;
  const m = meetings.get(id);
  if (!m) return res.status(404).json({ ok: false, error: "Not found" });
  if (m.createdBy !== req.userName) return res.status(403).json({ ok: false, error: "Forbidden" });

  meetings.delete(id);
  rooms.delete(id);
  res.json({ ok: true });
});

// Quick password check
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

/* ============================= Socket.IO ============================== */
io.on("connection", (socket) => {
  let joinedMeetingId = null;

  // WebRTC signaling passthrough
  socket.on("webrtc:signal", ({ to, data }) => {
    io.to(to).emit("webrtc:signal", { from: socket.id, data });
  });

  // Join request (host or guest)
  socket.on("request-join", async ({ meetingId, name, isHost, password }, cb = () => {}) => {
    let meta = meetings.get(meetingId);

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

    if (meta.pwdHash) {
      const ok = await bcrypt.compare(password || "", meta.pwdHash);
      if (!ok) {
        cb({ ok: false, error: "Wrong password" });
        return socket.emit("join-reject", { reason: "Wrong password" });
      }
    }

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
      if (room.hostId) io.to(room.hostId).emit("lobby-update", [...room.waiting.values()]);
      cb({ ok: true, waiting: true, room: serializeRoom(room) });
      return;
    }

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

/* ============================== Start =============================== */
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
