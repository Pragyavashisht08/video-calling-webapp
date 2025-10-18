# Video Calling Web Application (MERN + WebRTC)

This project implements a multi-party video calling web app that supports:
- Create/join meetings with unique IDs
- Real-time video/audio using **WebRTC**
- **Socket.IO** signaling and **chat**
- A/V toggles (mute/unmute mic, camera on/off)
- **Screen sharing**
- **Admin controls** (creator approval for join, grant permissions for unmute/video, grant screenshare)
- **Schedule meetings** (title, date/time, link) stored in MongoDB
- Optional: email reminders (via SMTP) and notification sounds
- Responsive, modern UI built with React + Vite

> Tech stack: MongoDB, Express, React, Node.js, Socket.IO, WebRTC, Vite

## Monorepo Layout

```
video-calling-webapp/
  README.md
  server/
  client/
```

---

## Quick Start (Local)

### Prerequisites
- Node.js 18+
- MongoDB (Atlas or local)
- An SMTP account (optional) for email reminders

### 1) Server
```bash
cd server
cp .env.example .env
# Edit .env with your values (MONGODB_URI, CLIENT_ORIGIN, SMTP creds optional)
npm install
npm run dev
```
Server runs at `http://localhost:4000` by default.

### 2) Client
```bash
cd client
npm install
npm run dev
```
Open the URL printed by Vite (typically `http://localhost:5173`).

---

## Environment Variables

**server/.env**
```
PORT=4000
MONGODB_URI=mongodb://127.0.0.1:27017/videocall
CLIENT_ORIGIN=http://localhost:5173

# Optional email reminders
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
FROM_EMAIL=Video Calls <no-reply@example.com>
ENABLE_REMINDERS=false
```

**Notes**
- If deploying the client separately (e.g., Vercel/Netlify), set `CLIENT_ORIGIN` to your deployed client origin so CORS and cookies work.
- Set `ENABLE_REMINDERS=true` to turn on scheduled email reminders (requires valid SMTP env).

---

## Features Overview

### Meetings
- **Create**: generates a unique ID and returns a join link
- **Join**: participants request to join; **admin approval** supported (waiting room)
- **Permissions**: admin can grant mic/cam unmute and screen share

### Real-time Media & Chat
- Mesh WebRTC topology using separate peer connections per participant
- Socket.IO channels per meeting for signaling and chat
- Screen sharing via `getDisplayMedia`

### Scheduling
- Create future meetings with title/date/time and see them in **My Meetings**
- Optional **email reminder** 5 minutes before start (when enabled)

### Security Options
- Optional meeting password (set at creation; required to join)
- Admin gate-keeping on join

---

## Deployment

You can deploy the **client** (Vite React) on **Vercel/Netlify** and the **server** on **Render/Railway/Heroku**.

### Server (Render example)
1. Create a Render Web Service
2. Set Environment: Node
3. Build Command: `npm ci && npm run build` (no-op build) or just `npm ci`
4. Start Command: `npm run start`
5. Add env vars from `.env.example`
6. Add a free MongoDB Atlas cluster and paste the connection string into `MONGODB_URI`

### Client (Vercel example)
1. `vercel` -> import the `client/` directory
2. Build Command: `npm ci && npm run build`
3. Output directory: `dist`
4. Set `VITE_SERVER_URL` to your deployed server URL

---

## Screenshots/Demo

After you run locally:
- Create a meeting from Home page, copy the link, open in another tab/window
- Use chat, mute/unmute, camera toggle, screen share
- As admin, approve join requests and grant permissions

---

## Scripts

**Server**
- `npm run dev` – nodemon development
- `npm start` – production

**Client**
- `npm run dev` – Vite dev server
- `npm run build` – production build
- `npm run preview` – preview built app

---

## License
MIT
