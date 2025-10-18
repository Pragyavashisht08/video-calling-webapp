const API_BASE =
  import.meta.env.VITE_SERVER_URL ||
  `${window.location.protocol}//${window.location.hostname}:4000`;

async function req(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include", // send/receive cookie!
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  // auth
  register: (name, email, password) =>
    req("/api/auth/register", { method: "POST", body: { name, email, password } }),
  login: (email, password) =>
    req("/api/auth/login", { method: "POST", body: { email, password } }),
  me: () => req("/api/auth/me"),
  logout: () => req("/api/auth/logout", { method: "POST" }),

  // meetings
  createMeeting: (payload) => req("/api/meetings/create", { method: "POST", body: payload }),
  upcoming: () => req("/api/meetings/upcoming"),
  removeMeeting: (id) => req(`/api/meetings/${id}`, { method: "DELETE" }),
};
