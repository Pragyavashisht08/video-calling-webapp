// server/src/rooms.js
export class Room {
  constructor({
    id,
    title = "Meeting",
    createdBy = "Unknown",
    requiresApproval = false,
    password = null,
    scheduledFor = null,
  }) {
    this.id = id;
    this.title = title;
    this.createdBy = createdBy;

    this.hostId = null;
    this.participants = new Map();
    this.waiting = new Map();

    this.locked = false;
    this.requiresApproval = !!requiresApproval;
    this.password = !!password;
    this.scheduledFor = scheduledFor ? new Date(scheduledFor) : null;

    this.allowShare = true;
    this.allowUnmute = true;
    this.permissions = { screenShare: new Set() };
  }
}

export const rooms = new Map();

export function getOrCreateRoom(init) {
  const id = init.id;
  let r = rooms.get(id);
  if (!r) {
    r = new Room(init);
    rooms.set(id, r);
    return r;
  }
  if (init.title) r.title = init.title;
  if (init.createdBy) r.createdBy = init.createdBy;
  if (typeof init.requiresApproval === "boolean") r.requiresApproval = init.requiresApproval;
  if (typeof init.password !== "undefined") r.password = !!init.password;
  if (typeof init.scheduledFor !== "undefined")
    r.scheduledFor = init.scheduledFor ? new Date(init.scheduledFor) : null;
  if (typeof init.allowShare === "boolean") r.allowShare = init.allowShare;
  if (typeof init.allowUnmute === "boolean") r.allowUnmute = init.allowUnmute;
  if (typeof init.locked === "boolean") r.locked = init.locked;
  return r;
}

export function serializeRoom(room) {
  return {
    id: room.id,
    title: room.title,
    createdBy: room.createdBy,
    hostId: room.hostId,
    locked: room.locked,
    requiresApproval: room.requiresApproval,
    password: !!room.password,
    scheduledFor: room.scheduledFor,
    allowShare: !!room.allowShare,
    allowUnmute: !!room.allowUnmute,
    participants: [...room.participants.values()].map((p) => ({
      id: p.id,
      name: p.name,
      isMuted: !!p.isMuted,
      handRaised: !!p.handRaised,
      isSharing: !!p.isSharing,
      role: p.role,
    })),
    waiting: [...room.waiting.values()],
    permissions: { screenShare: [...room.permissions.screenShare] },
  };
}
