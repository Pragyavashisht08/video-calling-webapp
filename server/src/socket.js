// server/src/socket.js
import { rooms, getOrCreateRoom, serializeRoom } from "./room.js";

/**
 * Wire up all Socket.IO events on an existing io instance.
 * Called from index.js after creating `io`.
 */
export function registerSocketHandlers(io) {
  // small helper to broadcast toast-style notifications to a room
  function notify(roomId, payload) {
    io.to(roomId).emit("notify", payload); // { type, text }
  }

  io.on("connection", (socket) => {
    let joinedRoomId = null;

    // ---------- low-level WebRTC signaling ----------
    socket.on("webrtc:signal", ({ to, data }) => {
      if (!to) return;
      io.to(to).emit("webrtc:signal", { from: socket.id, data });
    });

    // ---------- join flow (host or guest) ----------
    socket.on(
      "request-join",
      ({ meetingId, name, isHost = false, password = "" }, cb = () => {}) => {
        const safeName = (name || "User").trim();
        if (!meetingId) return cb({ ok: false, error: "Missing meetingId" });

        const room =
          getOrCreateRoom({
            id: meetingId,
            title: `${safeName}'s Meeting`,
            createdBy: safeName,
          }) || rooms.get(meetingId);

        // password check (plain since in-memory)
        if (room.password && room.password !== password) {
          return cb({ ok: false, error: "Wrong password" });
        }

        // establish host if not yet set
        if (!room.hostId && isHost) room.hostId = socket.id;

        // lobby handling for guests while locked / approval on
        const joiningUser = {
          id: socket.id,
          name: safeName,
          isMuted: false,
          handRaised: false,
          isSharing: false,
          role: socket.id === room.hostId ? "host" : "guest",
        };

        socket.join(meetingId);

        const needsApproval = room.locked || room.requiresApproval;
        const isGuestNeedingApproval = joiningUser.role !== "host" && needsApproval;

        if (isGuestNeedingApproval) {
          room.waiting.set(socket.id, { id: socket.id, name: joiningUser.name });
          // live lobby list for host and a bell notification
          if (room.hostId) {
            io.to(room.hostId).emit("lobby-update", [...room.waiting.values()]);
            io.to(room.hostId).emit("notify", {
              type: "join",
              text: `${joiningUser.name} requested to join`,
            });
          }
          cb({ ok: true, waiting: true, room: serializeRoom(room) });
          return;
        }

        // admit immediately (host or unlocked)
        room.participants.set(socket.id, joiningUser);
        joinedRoomId = meetingId;

        io.to(meetingId).emit("participants", [...room.participants.values()]);
        // in-room toast + sound
        notify(meetingId, { type: "join", text: `${joiningUser.name} joined` });

        cb({ ok: true, role: joiningUser.role, room: serializeRoom(room) });
        socket.emit("approved");
      }
    );

    // ---------- host admits / denies from lobby ----------
    socket.on("host-approve", ({ meetingId, socketId }) => {
      const room = rooms.get(meetingId);
      if (!room || socket.id !== room.hostId) return;
      const w = room.waiting.get(socketId);
      if (!w) return;

      room.waiting.delete(socketId);
      const p = {
        id: socketId,
        name: w.name,
        isMuted: false,
        handRaised: false,
        isSharing: false,
        role: "guest",
      };
      room.participants.set(socketId, p);
      io.to(socketId).emit("approved");
      io.to(meetingId).emit("participants", [...room.participants.values()]);
      io.to(room.hostId).emit("lobby-update", [...room.waiting.values()]);
      notify(meetingId, { type: "join", text: `${w.name} admitted by host` });
    });

    socket.on("host-deny", ({ meetingId, socketId }) => {
      const room = rooms.get(meetingId);
      if (!room || socket.id !== room.hostId) return;
      const w = room.waiting.get(socketId);
      if (!w) return;

      room.waiting.delete(socketId);
      io.to(socketId).emit("join-reject", { reason: "Denied by host" });
      io.sockets.sockets.get(socketId)?.leave(meetingId);
      io.to(room.hostId).emit("lobby-update", [...room.waiting.values()]);
    });

    // ---------- host controls ----------
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

    // End meeting: everyone gets kicked and the room is deleted.
    socket.on("host:end-meeting", ({ meetingId }) => {
      const room = rooms.get(meetingId);
      if (!room || socket.id !== room.hostId) return;

      io.to(meetingId).emit("room:ended");
      notify(meetingId, { type: "end", text: "Host ended the meeting" });

      const socketIds = io.sockets.adapter.rooms.get(meetingId);
      rooms.delete(meetingId);

      if (socketIds) {
        for (const sid of socketIds) {
          io.sockets.sockets.get(sid)?.leave(meetingId);
          io.sockets.sockets.get(sid)?.emit("force-leave");
        }
      }
    });

    // ---------- chat ----------
    socket.on("chat:msg", ({ meetingId, name, text }) => {
      if (!text?.trim()) return;
      io.to(meetingId).emit("chat:msg", {
        name: name || "User",
        text: text.trim(),
        ts: Date.now(),
      });
    });

    // ---------- disconnect / leave ----------
    function cleanup() {
      // iterate all rooms this socket is part of
      for (const roomId of socket.rooms) {
        if (roomId === socket.id) continue; // skip its own room
        const room = rooms.get(roomId);
        if (!room) continue;

        const leftName =
          room.participants.get(socket.id)?.name ||
          room.waiting.get(socket.id)?.name ||
          "User";

        room.waiting.delete(socket.id);
        room.participants.delete(socket.id);

        // if host left, end the meeting for everyone (clear state)
        if (socket.id === room.hostId) {
          io.to(roomId).emit("room:ended");
          notify(roomId, { type: "end", text: "Host left — meeting ended" });
          const socketIds = io.sockets.adapter.rooms.get(roomId);
          rooms.delete(roomId);
          if (socketIds) {
            for (const sid of socketIds) {
              io.sockets.sockets.get(sid)?.leave(roomId);
              io.sockets.sockets.get(sid)?.emit("force-leave");
            }
          }
        } else {
          // normal participant left
          io.to(roomId).emit("participants", [...room.participants.values()]);
          notify(roomId, { type: "leave", text: `${leftName} left` });
          // delete empty rooms
          if (room.participants.size === 0 && room.waiting.size === 0) {
            rooms.delete(roomId);
          }
        }
      }
    }

    socket.on("leave", cleanup);
    socket.on("disconnect", cleanup);
  });
}
