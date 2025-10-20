// client/src/lib/socket.js
import { io } from "socket.io-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";

// ✅ updated: explicitly enable credentials and use secure transport
export const socket = io(SERVER_URL, {
  autoConnect: true,
  withCredentials: true,
  transports: ["websocket", "polling"],
});
