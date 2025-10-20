// server/src/socket.js
// ✅ CHANGED: remove Server creation here; accept io from index.js
import { rooms, getOrCreateRoom, serializeRoom } from "./rooms.js";

/**
 * Register Socket.IO handlers on the provided io instance.
 * @param {import('socket.io').Server} io
 */
export function registerSocketHandlers(io) {
  io.on("connection", (socket) => {
    // ========= helpers =========
    function emitRoomState(roomId) {
      const room = rooms.get(roomId);
      if (!room) return;
      io.to(roomId).emit("room:state", serializeRoom(room));
    }

    function ensureHost(room, socketId) {
      return !!room.hostId && room.hostId === socketId;
    }

    function ensurePermissions(room) {
      if (!room.permissions) room.permissions = { screenShare: new Set() };
      if (!room.permissions.screenShare) room.permissions.screenShare = new Set();
    }

    // ========= basic signaling (keep your existing webrtc signaling as needed) =========
    socket.on("webrtc:signal", ({ to, data }) => {
      if (!to) return;
      io.to(to).emit("webrtc:signal", { from: socket.id, data });
    });

    // ========= join flow =========
    socket.on(
      "room:join",
      ({ roomId, name, admin = false, password = "" }, cb = () => {}) => {
        if (!roomId || !name?.trim()) {
          return cb({ ok: false, error: "Room ID and name are required" });
        }

        let room = rooms.get(roomId);
        if (!room) {
          // If admin flagged, allow creator to implicitly create a room shell
          room = getOrCreateRoom({
            id: roomId,
            title: `${name}'s Meeting`,
            createdBy: name,
          });
        }

        // Password check if present (note: plaintext comparison – if you later hash, change this)
        if (room.password && room.password !== password) {
          return cb({ ok: false, error: "Wrong password" });
        }

        ensurePermissions(room);

        const joiningUser = {
          id: socket.id,
          name: name.trim(),
          isMuted: false,
          handRaised: false,
          isSharing: false,
          role: "guest",
        };

        if (!room.hostId && admin) {
          // First admin becomes host
          room.hostId = socket.id;
          joiningUser.role = "host";
          room.participants.set(socket.id, joiningUser);
          socket.join(roomId);
          emitRoomState(roomId);
          return cb({ ok: true, role: "host", room: serializeRoom(room) });
        }

        if (room.locked || room.requiresApproval) {
          room.waiting.set(socket.id, { id: socket.id, name: joiningUser.name });
          socket.join(roomId); // join room but marked as waiting
          emitRoomState(roomId);
          return cb({ ok: true, waiting: true, room: serializeRoom(room) });
        }

        room.participants.set(socket.id, joiningUser);
        socket.join(roomId);
        emitRoomState(roomId);
        cb({ ok: true, role: joiningUser.role, room: serializeRoom(room) });
      }
    );

    // ========= host: admit/deny =========
    socket.on("host:admit", ({ roomId, userId }) => {
      const room = rooms.get(roomId);
      if (!room || !ensureHost(room, socket.id)) return;
      const w = room.waiting.get(userId);
      if (!w) return;
      room.waiting.delete(userId);
      room.participants.set(userId, {
        id: w.id,
        name: w.name,
        isMuted: false,
        handRaised: false,
        isSharing: false,
        role: "guest",
      });
      emitRoomState(roomId);
      io.to(userId).emit("room:admitted");
    });

    socket.on("host:deny", ({ roomId, userId }) => {
      const room = rooms.get(roomId);
      if (!room || !ensureHost(room, socket.id)) return;
      room.waiting.delete(userId);
      io.to(userId).emit("room:denied");
      emitRoomState(roomId);
      io.sockets.sockets.get(userId)?.leave(roomId);
    });

    // ========= host controls =========
    socket.on("host:lock", ({ roomId, locked }) => {
      const room = rooms.get(roomId);
      if (!room || !ensureHost(room, socket.id)) return;
      room.locked = !!locked;
      emitRoomState(roomId);
    });

    socket.on("host:mute-all", ({ roomId }) => {
      const room = rooms.get(roomId);
      if (!room || !ensureHost(room, socket.id)) return;
      for (const p of room.participants.values()) p.isMuted = true;
      io.to(roomId).emit("room:force-mute"); // clients should stop sending audio
      emitRoomState(roomId);
    });

    socket.on("host:mute-one", ({ roomId, userId }) => {
      const room = rooms.get(roomId);
      if (!room || !ensureHost(room, socket.id)) return;
      const p = room.participants.get(userId);
      if (!p) return;
      p.isMuted = true;
      io.to(userId).emit("room:force-mute");
      emitRoomState(roomId);
    });

    socket.on("host:grant-screenshare", ({ roomId, userId, allowed }) => {
      const room = rooms.get(roomId);
      if (!room || !ensureHost(room, socket.id)) return;
      ensurePermissions(room);
      if (allowed) room.permissions.screenShare.add(userId);
      else room.permissions.screenShare.delete(userId);
      emitRoomState(roomId);
      io.to(userId).emit("room:screen-permission", { allowed: !!allowed });
    });

    socket.on("host:remove", ({ roomId, userId }) => {
      const room = rooms.get(roomId);
      if (!room || !ensureHost(room, socket.id)) return;
      room.participants.delete(userId);
      io.to(userId).emit("room:removed");
      io.sockets.sockets.get(userId)?.leave(roomId);
      emitRoomState(roomId);
    });

    socket.on("host:end-meeting", ({ roomId }) => {
      const room = rooms.get(roomId);
      if (!room || !ensureHost(room, socket.id)) return;
      io.to(roomId).emit("room:ended");

      // capture sockets currently in room before deleting
      const socketIds = io.sockets.adapter.rooms.get(roomId);
      rooms.delete(roomId);

      if (socketIds) {
        for (const sid of socketIds) {
          io.sockets.sockets.get(sid)?.leave(roomId);
        }
      }
    });

    // ========= participant actions =========
    socket.on("user:hand", ({ roomId, raised }) => {
      const room = rooms.get(roomId);
      if (!room) return;
      const p = room.participants.get(socket.id);
      if (!p) return;
      p.handRaised = !!raised;
      emitRoomState(roomId);
    });

    socket.on("user:toggle-mic", ({ roomId, muted }) => {
      const room = rooms.get(roomId);
      if (!room) return;
      const p = room.participants.get(socket.id);
      if (!p) return;
      p.isMuted = !!muted;
      emitRoomState(roomId);
    });

    socket.on("user:share-start", ({ roomId }) => {
      const room = rooms.get(roomId);
      if (!room) return;
      ensurePermissions(room);
      const allowed =
        room.permissions.screenShare.has(socket.id) || socket.id === room.hostId;
      if (!allowed) return socket.emit("room:screen-permission", { allowed: false });
      const p = room.participants.get(socket.id);
      if (p) p.isSharing = true;
      emitRoomState(roomId);
    });

    socket.on("user:share-stop", ({ roomId }) => {
      const room = rooms.get(roomId);
      if (!room) return;
      const p = room.participants.get(socket.id);
      if (p) p.isSharing = false;
      emitRoomState(roomId);
    });

    // ========= chat =========
    socket.on("chat:send", ({ roomId, message, name }) => {
      if (!message?.trim()) return;
      io.to(roomId).emit("chat:message", {
        id: Date.now().toString(),
        from: name || "User",
        text: message.trim(),
        at: new Date().toISOString(),
      });
    });

    // ========= disconnect =========
    socket.on("disconnecting", () => {
      // iterate the rooms this socket is in
      for (const roomId of socket.rooms) {
        // socket.rooms includes the socket's own ID as a room; skip it
        if (roomId === socket.id) continue;

        const room = rooms.get(roomId);
        if (!room) continue;

        room.waiting.delete(socket.id);
        room.participants.delete(socket.id);

        if (room.hostId === socket.id) {
          // host left: promote first participant if available
          const first = [...room.participants.values()][0];
          room.hostId = first?.id || null;
          if (room.hostId && first) first.role = "host";
        }

        // delete room if empty; otherwise update state
        if (room.participants.size === 0 && room.waiting.size === 0) {
          rooms.delete(roomId);
        } else {
          emitRoomState(roomId);
        }
      }
    });
  });
}
