// server/src/index.js
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: ["http://localhost:5173"], credentials: true }
});

app.use(helmet());
app.use(express.json());
app.use(cookieParser());
app.use(cors({ origin: "http://localhost:5173", credentials: true }));

const limiter = rateLimit({ windowMs: 60_000, max: 120 });
app.use(limiter);

const JWT_SECRET = process.env.JWT_SECRET || "devsecret";

// In-memory store (swap w/ Mongo)
const meetings = new Map(); // meetingId -> { hostId, title, locked, pwdHash, allowShare, allowUnmute, waiting: Map, peers: Map }

const newMeetingId = () => crypto.randomBytes(6).toString("base64url");

// -------- Auth (simple) ----------
app.post("/api/auth/login", (req, res) => {
  const { name } = req.body;
  if (!name || name.trim().length < 2) return res.status(400).json({ ok: false, error: "Name required" });
  const token = jwt.sign({ name }, JWT_SECRET, { expiresIn: "2h" });
  res.cookie("tok", token, { httpOnly: true, sameSite: "lax", secure: false }).json({ ok: true });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("tok").json({ ok: true });
});

const auth = (req, _res, next) => {
  try {
    const tok = req.cookies.tok;
    if (!tok) throw new Error("no token");
    req.user = jwt.verify(tok, JWT_SECRET);
    next();
  } catch {
    _res.status(401).json({ ok: false, error: "Unauthorized" });
  }
};

// -------- Meetings REST ----------
app.post("/api/meetings/create", auth, async (req, res) => {
  const { title, password } = req.body;
  const meetingId = newMeetingId();
  const pwdHash = password ? await bcrypt.hash(password, 10) : null;
  meetings.set(meetingId, {
    hostId: null,            // will be set on first socket join
    title: title || `${req.user.name}'s Meeting`,
    locked: false,
    pwdHash,
    allowShare: true,
    allowUnmute: true,
    waiting: new Map(),      // socketId -> { name, ts }
    peers: new Map(),        // socketId -> { name, isHost }
  });
  res.json({ ok: true, meetingId });
});

app.post("/api/meetings/check", auth, async (req, res) => {
  const { meetingId, password } = req.body;
  const m = meetings.get(meetingId);
  if (!m) return res.status(404).json({ ok: false, error: "Not found" });
  if (m.pwdHash && !(await bcrypt.compare(password || "", m.pwdHash)))
    return res.status(401).json({ ok: false, error: "Bad password" });
  res.json({ ok: true, locked: m.locked, title: m.title });
});

// -------- Socket.IO -------------
io.on("connection", (socket) => {
  let joinedMeetingId = null;

  socket.on("request-join", async ({ meetingId, name, isHost }) => {
    const m = meetings.get(meetingId);
    if (!m) return socket.emit("join-reject", { reason: "Meeting not found" });
    if (m.locked && !isHost) return socket.emit("join-reject", { reason: "Meeting is locked" });

    // set first socket as host if none
    if (!m.hostId && isHost) m.hostId = socket.id;

    // guests go to waiting room
    if (socket.id !== m.hostId) {
      m.waiting.set(socket.id, { name, ts: Date.now() });
      // notify host
      if (m.hostId) io.to(m.hostId).emit("lobby-update", Array.from(m.waiting.values()).map((w, i) => ({ id: Array.from(m.waiting.keys())[i], ...w })));
      socket.join(meetingId);
      return; // wait for approval
    }

    // host joins immediately
    joinedMeetingId = meetingId;
    m.peers.set(socket.id, { name, isHost: true });
    socket.join(meetingId);
    io.to(meetingId).emit("participants", Array.from(m.peers.values()));
    socket.emit("approved");
  });

  socket.on("host-approve", ({ meetingId, socketId }) => {
    const m = meetings.get(meetingId);
    if (!m || socket.id !== m.hostId) return;
    const guest = m.waiting.get(socketId);
    if (!guest) return;
    m.waiting.delete(socketId);
    m.peers.set(socketId, { name: guest.name, isHost: false });
    io.to(socketId).emit("approved");
    io.to(meetingId).emit("participants", Array.from(m.peers.values()));
    io.to(m.hostId).emit("lobby-update", Array.from(m.waiting.values()).map((w, i) => ({ id: Array.from(m.waiting.keys())[i], ...w })));
  });

  socket.on("host-deny", ({ meetingId, socketId }) => {
    const m = meetings.get(meetingId);
    if (!m || socket.id !== m.hostId) return;
    m.waiting.delete(socketId);
    io.to(socketId).emit("join-reject", { reason: "Denied by host" });
    io.sockets.sockets.get(socketId)?.leave(meetingId);
    io.to(m.hostId).emit("lobby-update", Array.from(m.waiting.values()).map((w, i) => ({ id: Array.from(m.waiting.keys())[i], ...w })));
  });

  socket.on("host-settings", ({ meetingId, locked, allowShare, allowUnmute }) => {
    const m = meetings.get(meetingId);
    if (!m || socket.id !== m.hostId) return;
    if (locked !== undefined) m.locked = locked;
    if (allowShare !== undefined) m.allowShare = allowShare;
    if (allowUnmute !== undefined) m.allowUnmute = allowUnmute;
    io.to(meetingId).emit("host-settings", { locked: m.locked, allowShare: m.allowShare, allowUnmute: m.allowUnmute });
  });

  // chat
  socket.on("chat:msg", ({ meetingId, name, text }) => {
    io.to(meetingId).emit("chat:msg", { name, text, ts: Date.now() });
  });

  // leave / disconnect
  const cleanup = () => {
    if (!joinedMeetingId) return;
    const m = meetings.get(joinedMeetingId);
    if (!m) return;
    m.waiting.delete(socket.id);
    m.peers.delete(socket.id);
    io.to(joinedMeetingId).emit("participants", Array.from(m.peers.values()));
    // if host left, unlock and clear waiting (simple policy)
    if (socket.id === m.hostId) {
      m.hostId = null;
      m.locked = false;
      m.waiting.forEach((_v, sid) => {
        io.to(sid).emit("join-reject", { reason: "Host left" });
        io.sockets.sockets.get(sid)?.leave(joinedMeetingId);
      });
      m.waiting.clear();
    }
  };

  socket.on("leave", () => { cleanup(); });
  socket.on("disconnect", () => { cleanup(); });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log("Server listening on", PORT));
