import jwt from "jsonwebtoken";

export function withAuth(req, res, next) {
  try {
    const token = req.cookies?.token;
    if (!token) return res.status(401).json({ ok: false, error: "Unauthorized" });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, name, email }
    next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
}
