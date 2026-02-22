# RoadSense Backend

Node.js + Express + WebSocket server for road quality data and routing proxy.

## Setup

1. Copy `.env.example` to `.env` and set `SUPABASE_URL`, `SUPABASE_KEY`.
2. `npm install`
3. `npm start` (or `node server.js`)

## Automated tests

With the server running (e.g. on port 8080):

```bash
npm test
```

Or against a remote server:

```bash
BASE_URL=https://your-backend.onrender.com node health-check.js
```

Tests: `GET /health`, `GET /data`, `POST /data` (validation and valid payload).
