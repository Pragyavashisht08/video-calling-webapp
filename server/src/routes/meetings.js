import { Router } from "express";
import crypto from "crypto";
import Meeting from "../models/Meeting.js";
import { withAuth } from "../middlewares/auth.js";

const r = Router();
const newId = () => crypto.randomBytes(6).toString("base64url");

// create (instant or scheduled)
r.post("/create", withAuth, async (req, res) => {
  try {
    const { title, scheduledFor = null, requiresApproval = false, password = "" } = req.body || {};
    const meetingId = newId();

    const doc = await Meeting.create({
      meetingId,
      title: (title || `${req.user.name}'s Meeting`).trim(),
      createdBy: req.user.id,
      createdByName: req.user.name,
      scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
      requiresApproval: !!requiresApproval,
      password: password || "",
    });

    res.json({ ok: true, meetingId: doc.meetingId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Failed to create meeting" });
  }
});

// list your meetings (optionally upcoming first)
r.get("/upcoming", withAuth, async (req, res) => {
  try {
    const meetings = await Meeting.find({ createdBy: req.user.id }).sort({ scheduledFor: 1, createdAt: -1 });
    res.json({ ok: true, meetings });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Failed to fetch meetings" });
  }
});

// delete your meeting
r.delete("/:id", withAuth, async (req, res) => {
  try {
    const m = await Meeting.findOne({ meetingId: req.params.id, createdBy: req.user.id });
    if (!m) return res.status(404).json({ ok: false, error: "Not found" });
    await m.deleteOne();
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Failed to delete meeting" });
  }
});

export default r;
