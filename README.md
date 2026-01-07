# Video Calling Web Application (MERN + WebRTC)

A **multi‑party video calling web application** with real‑time audio/video, chat, screen sharing, meeting scheduling, and admin controls. Built with **React (Vite)** on the frontend and **Node.js + Express** on the backend, using **WebRTC** for media and **Socket.IO** for signaling.

---

## ✨ Features

### Meetings

* **Create / Join meetings** using unique IDs
* **Waiting room & admin approval** for participants
* **Permissions control**: grant mic/camera unmute and screen sharing
* **Optional meeting password** for added security

### Real‑time Media & Chat

* **WebRTC** peer‑to‑peer audio/video
* **Socket.IO** signaling and in‑meeting chat
* **A/V controls**: mute/unmute mic, camera on/off
* **Screen sharing** via `getDisplayMedia`

### Scheduling

* Schedule meetings with **title, date & time**
* View upcoming meetings in **My Meetings**
* **Optional email reminders** (SMTP) before start time

### UI & UX

* **Responsive, modern UI** built with React + Vite
* Clean layouts for video grids and controls

---

## 🧰 Tech Stack

* **Frontend:** React, Vite, HTML, CSS, JavaScript
* **Backend:** Node.js, Express
* **Database:** MongoDB
* **Real‑time:** WebRTC, Socket.IO
* **Optional:** SMTP (email reminders)

---

## 📁 Monorepo Layout

```
video-calling-webapp/
  README.md
  server/
  client/
```

---

## 🚀 Quick Start (Local)

### Prerequisites

* Node.js **18+**
* MongoDB (Atlas or local)
* SMTP account (optional, for email reminders)

### 1) Server

```bash
cd server
cp .env.example .env
# Edit .env with your values (MONGODB_URI, CLIENT_ORIGIN, SMTP creds optional)
npm install
npm run dev
```

Server runs at **[http://localhost:4000](http://localhost:4000)** by default.

### 2) Client

```bash
cd client
npm install
npm run dev
```

Open the URL printed by Vite (typically **[http://localhost:5173](http://localhost:5173)**).

---

## 🔐 Environment Variables

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

* If deploying the client separately (e.g., Vercel/Netlify), set `CLIENT_ORIGIN` to the deployed client origin for CORS/cookies.
* Set `ENABLE_REMINDERS=true` to enable scheduled email reminders (requires valid SMTP credentials).

---

## 🔎 Features Overview

### Meetings

* **Create:** generates a unique ID and join link
* **Join:** participants request access; admin approval supported
* **Permissions:** admin grants mic/camera unmute and screen sharing

### Real‑time Media & Chat

* **Mesh WebRTC topology** (separate peer connections per participant)
* **Socket.IO channels** per meeting for signaling and chat
* **Screen sharing** via `getDisplayMedia`

### Scheduling

* Create future meetings and view them in **My Meetings**
* **Optional email reminder** (e.g., 5 minutes before start)

### Security Options

* Optional meeting password
* Admin gate‑keeping on join

---

## 🌍 Deployment

### Server (Render example)

1. Create a **Render Web Service**
2. Environment: **Node**
3. Build Command: `npm ci` (or `npm ci && npm run build` if applicable)
4. Start Command: `npm run start`
5. Add environment variables from `.env.example`
6. Create a MongoDB Atlas cluster and set `MONGODB_URI`

### Client (Vercel example)

1. Import the `client/` directory
2. Build Command: `npm ci && npm run build`
3. Output Directory: `dist`
4. Set `VITE_SERVER_URL` to your deployed server URL

---

## 🖼️ Screenshots / Demo

After running locally:

1. Create a meeting from the Home page and copy the link
2. Open the link in another tab/window
3. Use chat, mute/unmute, camera toggle, and screen share
4. As admin, approve join requests and grant permissions

---

## 📜 Scripts

### Server

* `npm run dev` – development (nodemon)
* `npm start` – production

### Client

* `npm run dev` – Vite dev server
* `npm run build` – production build
* `npm run preview` – preview built app

---

## 📄 License

MIT
