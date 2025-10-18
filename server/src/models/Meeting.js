import mongoose from "mongoose";

const MeetingSchema = new mongoose.Schema(
  {
    meetingId: { type: String, required: true, unique: true, index: true },
    title: { type: String, default: "Untitled Meeting" },
    createdBy: { type: String, required: true },

    // security & controls
    password: { type: String, default: null }, // bcrypt hash or null
    locked: { type: Boolean, default: false },
    allowShare: { type: Boolean, default: true },
    allowUnmute: { type: Boolean, default: true },
    requiresApproval: { type: Boolean, default: false },

    // scheduling
    scheduledFor: { type: Date, default: null },
  },
  { timestamps: true }
);

export const Meeting = mongoose.models.Meeting || mongoose.model("Meeting", MeetingSchema);
