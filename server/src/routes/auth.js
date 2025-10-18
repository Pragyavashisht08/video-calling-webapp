import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

const r = Router();

const cookieOpts = {
  httpOnly: true,
  sameSite: "lax",
  secure: false,        // set true if serving over HTTPS
  path: "/",
  maxAge: 1000 * 60 * 60 * 8, // 8h
};

r.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name?.trim() || !email?.trim() || !password?.trim())
      return res.status(400).json({ ok: false, error: "Missing fields" });

    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists) return res.status(409).json({ ok: false, error: "Email already used" });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name: name.trim(), email: email.toLowerCase(), passwordHash });

    const token = jwt.sign({ id: user._id.toString(), name: user.name, email: user.email }, process.env.JWT_SECRET, { expiresIn: "8h" });
    res.cookie("token", token, cookieOpts).json({ ok: true, user: { id: user._id, name: user.name, email: user.email } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Failed to register" });
  }
});

r.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const user = await User.findOne({ email: (email || "").toLowerCase() });
    if (!user) return res.status(401).json({ ok: false, error: "Invalid credentials" });

    const ok = await bcrypt.compare(password || "", user.passwordHash);
    if (!ok) return res.status(401).json({ ok: false, error: "Invalid credentials" });

    const token = jwt.sign({ id: user._id.toString(), name: user.name, email: user.email }, process.env.JWT_SECRET, { expiresIn: "8h" });
    res.cookie("token", token, cookieOpts).json({ ok: true, user: { id: user._id, name: user.name, email: user.email } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Failed to login" });
  }
});

r.post("/logout", (req, res) => {
  res.clearCookie("token", { path: "/" }).json({ ok: true });
});

r.get("/me", (req, res) => {
  try {
    const token = req.cookies?.token;
    if (!token) return res.json({ ok: true, user: null });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    res.json({ ok: true, user: payload });
  } catch {
    res.json({ ok: true, user: null });
  }
});

export default r;
