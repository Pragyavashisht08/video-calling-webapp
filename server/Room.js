// server/src/rooms.js
const rooms = new Map();
/*
room = {
  id, title, hostId, locked: false,
  requiresApproval: true/false,
  createdBy, createdAt, password,
  waiting: Map<socketId, user>,
  participants: Map<socketId, user>,
  permissions: { screenShare: Set<socketId> } // who can share
}
user = { id: socketId, name, role: 'host'|'guest' }
*/

function getOrCreateRoom({ id, title, hostId, createdBy, requiresApproval=false, password='' }) {
  if (rooms.has(id)) return rooms.get(id);
  const room = {
    id, title: title || 'Meeting', hostId, createdBy, createdAt: Date.now(),
    locked: false, requiresApproval: !!requiresApproval, password: password || '',
    waiting: new Map(), participants: new Map(),
    permissions: { screenShare: new Set([hostId]) } // host can share by default
  };
  rooms.set(id, room);
  return room;
}

function getRoom(id) { return rooms.get(id); }
function deleteRoom(id) { rooms.delete(id); }

function isHost(room, socketId) { return room.hostId === socketId; }
function findUser(room, socketId) {
  return room.participants.get(socketId) || room.waiting.get(socketId);
}

module.exports = {
  rooms, getRoom, getOrCreateRoom, deleteRoom, isHost, findUser
};
