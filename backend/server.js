require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

// ─── Constants (single source of truth, easy to tune) ─────────────────────
const PORT = process.env.PORT || 8080;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const MAX_MEASUREMENT_BUFFER_SIZE = 50000;
const VALID_CONDITIONS = new Set(['GOOD', 'MEDIUM', 'BAD', 'POOR', 'UNKNOWN']);
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, host: '0.0.0.0' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_KEY in environment.');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(express.json({ limit: '100kb' }));
app.use(cors({
  origin: CORS_ORIGIN,
  methods: ['GET', 'POST'],
  credentials: true
}));
app.use(express.static('public'));

/** Normalize and validate sensor payload from body or WebSocket. Returns null if invalid. */
function normalizeSensorPayload(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const quality = Number(raw.roadQuality);
  const condition = String(raw.condition || 'UNKNOWN').toUpperCase();
  const holesCount = Math.max(0, Math.floor(Number(raw.holesCount) || 0));
  const lat = raw.latitude != null ? Number(raw.latitude) : null;
  const lng = raw.longitude != null ? Number(raw.longitude) : null;
  const clampedQuality = Number.isFinite(quality) ? Math.max(0, Math.min(1, quality)) : 0;
  if (!VALID_CONDITIONS.has(condition)) return null;
  return {
    roadQuality: clampedQuality,
    condition,
    holesCount,
    latitude: Number.isFinite(lat) ? lat : 0,
    longitude: Number.isFinite(lng) ? lng : 0
  };
}

// ── Road Geometry Cache (Overpass proxy) ──────────────────────────────────────
// Caches OSM road geometry in memory. One batch Overpass call covers ALL roads.
let geometryCache = null; // { timestamp, data: { roadName: [[lat,lng], ...] } }
const GEOMETRY_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

function chainWays(ways) {
  if (!ways || ways.length === 0) return [];
  const chain = [...ways[0]];
  const used = new Set([0]);
  for (let i = 1; i < ways.length; i++) {
    let found = false;
    for (let j = 0; j < ways.length; j++) {
      if (used.has(j)) continue;
      const w = ways[j];
      if (w[0] === chain[chain.length - 1]) {
        used.add(j); chain.push(...w.slice(1)); found = true; break;
      }
      if (w[w.length - 1] === chain[chain.length - 1]) {
        used.add(j); chain.push(...[...w].reverse().slice(1)); found = true; break;
      }
    }
    if (!found) break;
  }
  return chain;
}

async function fetchGeometriesFromOverpass(names) {
  const bbox = '42.55,23.10,42.80,23.55';
  const nameFilters = names.map(n => `way["name"="${n}"](${bbox});`).join('\n');
  const query = `[out:json][timeout:30];\n(\n${nameFilters}\n);\n(._;>);\nout body;`;

  const servers = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];

  for (const server of servers) {
    try {
      const res = await fetch(server, {
        method: 'POST',
        body: query,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout(35000),
      });
      if (!res.ok) { console.warn(`[Geometry] ${server} returned ${res.status}`); continue; }
      const data = await res.json();
      if (!data.elements) continue;

      const nodeMap = {};
      for (const el of data.elements) {
        if (el.type === 'node') nodeMap[el.id] = [el.lat, el.lon];
      }

      const waysByName = {};
      for (const el of data.elements) {
        if (el.type === 'way' && el.tags?.name && el.nodes) {
          if (!waysByName[el.tags.name]) waysByName[el.tags.name] = [];
          waysByName[el.tags.name].push(el.nodes);
        }
      }

      const result = {};
      for (const [name, ways] of Object.entries(waysByName)) {
        const chain = chainWays(ways);
        const coords = chain.map(id => nodeMap[id]).filter(Boolean);
        if (coords.length >= 2) result[name] = coords;
      }

      console.log(`[Geometry] Fetched ${Object.keys(result).length} road geometries from ${server}`);
      return result;
    } catch (e) {
      console.warn(`[Geometry] Failed to reach ${server}: ${e.message}`);
    }
  }
  return null;
}

// GET /road-geometry?names=road1,road2,...
app.get('/road-geometry', async (req, res) => {
  const now = Date.now();

  // Serve from cache if fresh
  if (geometryCache && (now - geometryCache.timestamp) < GEOMETRY_CACHE_TTL) {
    return res.json({ success: true, data: geometryCache.data, cached: true });
  }

  // Parse requested names or fetch all known from Supabase
  let names = req.query.names ? req.query.names.split(',').map(n => n.trim()) : null;

  if (!names || names.length === 0) {
    try {
      const { data: roads } = await supabase.from('roads').select('name');
      names = (roads || []).map(r => r.name);
    } catch (e) {
      return res.status(500).json({ success: false, error: 'Could not load road names' });
    }
  }

  const data = await fetchGeometriesFromOverpass(names);
  if (!data) {
    return res.status(502).json({ success: false, error: 'Overpass unavailable' });
  }

  geometryCache = { timestamp: now, data };
  res.json({ success: true, data, cached: false });
});


let latestSensorData = {
  roadQuality: 0,
  condition: "UNKNOWN",
  holesCount: 0,
  latitude: 0,
  longitude: 0 // Assume robot sends location or we mock it
};

let currentRoadId = null; // Track which road is being recorded
let measurementBuffer = []; // Buffer to store measurements during a session

// WebSocket connection
wss.on('connection', (ws, req) => {
  const clientIP = req.socket.remoteAddress;
  console.log(`[WebSocket] Client connected: ${clientIP}`);

  // Send current state immediately
  ws.send(JSON.stringify({
    type: "sensor_data",
    data: latestSensorData,
    recording: !!currentRoadId
  }));

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'control') {
        if (data.command === 'start' && data.roadId) {
          if (!UUID_REGEX.test(String(data.roadId))) {
            console.warn('[WebSocket] Invalid roadId format, ignoring start.');
            return;
          }
          currentRoadId = data.roadId;
          measurementBuffer = [];
          const { error } = await supabase.from('roads').update({ status: 'recording' }).eq('id', currentRoadId);
          if (error) console.error('[WebSocket] Failed to set road status:', error.message);
          else console.log(`[WebSocket] Started recording for road: ${currentRoadId}`);
        } else if (data.command === 'stop') {
          if (currentRoadId) {
            // Calculate average data from buffer before stopping
            if (measurementBuffer.length > 0) {
              const count = measurementBuffer.length;
              const avgQuality = measurementBuffer.reduce((sum, m) => sum + m.quality, 0) / count;
              const totalHoles = measurementBuffer.reduce((sum, m) => sum + m.holes_count, 0);

              // Most frequent condition
              const conditionCounts = {};
              measurementBuffer.forEach(m => {
                conditionCounts[m.condition] = (conditionCounts[m.condition] || 0) + 1;
              });
              const avgCondition = Object.keys(conditionCounts).reduce((a, b) => conditionCounts[a] > conditionCounts[b] ? a : b);

              // Average location
              const avgLat = measurementBuffer.reduce((sum, m) => sum + m.latitude, 0) / count;
              const avgLng = measurementBuffer.reduce((sum, m) => sum + m.longitude, 0) / count;

              console.log(`[Summary] Road: ${currentRoadId}, Samples: ${count}, Avg Quality: ${avgQuality.toFixed(2)}, Total Holes: ${totalHoles}`);

              // Save aggregated measurement to DB
              const { error } = await supabase.from('measurements').insert({
                road_id: currentRoadId,
                quality: avgQuality,
                condition: avgCondition,
                holes_count: totalHoles,
                latitude: avgLat,
                longitude: avgLng
              });

              if (error) console.error("Error saving aggregated measurement:", error);
            }

            await supabase.from('roads').update({ status: 'idle' }).eq('id', currentRoadId);
            console.log(`Stopped recording for road: ${currentRoadId}`);
            currentRoadId = null;
            measurementBuffer = []; // Clear buffer
          }
        }

        // Broadcast recording status change
        broadcast({ type: "status_update", recording: !!currentRoadId, currentRoadId });

      } else {
        const payload = normalizeSensorPayload(data);
        if (!payload) {
          console.warn('[WebSocket] Invalid sensor payload, ignoring.');
          return;
        }
        latestSensorData = { ...latestSensorData, ...payload };
        broadcast({ type: 'sensor_data', data: latestSensorData });

        if (currentRoadId) {
          if (measurementBuffer.length < MAX_MEASUREMENT_BUFFER_SIZE) {
            measurementBuffer.push({
              quality: latestSensorData.roadQuality,
              condition: latestSensorData.condition,
              holes_count: latestSensorData.holesCount,
              latitude: latestSensorData.latitude,
              longitude: latestSensorData.longitude
            });
          }
        }
      }

    } catch (err) {
      console.error("[Error] Failed to parse incoming message:", err);
    }
  });

  ws.on('close', () => console.log(`[WebSocket] Client disconnected: ${clientIP}`));
});

function broadcast(msg) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(msg));
    }
  });
}

// HTTP endpoint for sensors (e.g. ESP32) when WebSocket is not used
app.post('/data', (req, res) => {
  const payload = normalizeSensorPayload(req.body);
  if (!payload) {
    return res.status(400).json({ error: 'Invalid payload: require roadQuality (0-1), condition (GOOD|MEDIUM|BAD|POOR|UNKNOWN), holesCount (number)' });
  }
  latestSensorData = { ...latestSensorData, ...payload };
  broadcast({ type: 'sensor_data', data: latestSensorData });

  if (currentRoadId && measurementBuffer.length < MAX_MEASUREMENT_BUFFER_SIZE) {
    measurementBuffer.push({
      quality: latestSensorData.roadQuality,
      condition: latestSensorData.condition,
      holes_count: latestSensorData.holesCount,
      latitude: latestSensorData.latitude,
      longitude: latestSensorData.longitude
    });
  }
  res.json({ status: 'ok', received: latestSensorData });
});

// Proxy endpoint for OSRM routing (avoids CORS, fallback servers)
app.post('/route', async (req, res) => {
  const { points } = req.body;
  if (!Array.isArray(points) || points.length < 2 || points.length > 50) {
    return res.status(400).json({ error: 'points must be an array of 2–50 { lat, lng } objects' });
  }
  const valid = points.every(p => typeof p === 'object' && p != null && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)));
  if (!valid) {
    return res.status(400).json({ error: 'Each point must have numeric lat and lng' });
  }
  const pointsStr = points.map(p => `${Number(p.lng)},${Number(p.lat)}`).join(';');
  const mode = 'route';

  const servers = [
    'https://routing.openstreetmap.de/routed-car',
    'https://router.project-osrm.org',
    'https://routing.openstreetmap.de/routed-bike'
  ];

  console.log(`[Routing] Requesting ${mode} for ${points.length} points... (${points[0].lat},${points[0].lng})`);

  for (const server of servers) {
    try {
      // annotations=false removes extra data we don't need
      // steps=false removes turn-by-turn instructions
      const url = `${server}/${mode}/v1/driving/${pointsStr}?overview=full&geometries=geojson&steps=false&annotations=false`;

      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        const routes = data.routes;
        if (routes && routes.length > 0) {
          console.log(`[Routing] Success from ${server}`);
          return res.json({
            success: true,
            coordinates: routes[0].geometry.coordinates
          });
        }
      } else {
        console.warn(`[Routing] Server ${server} returned ${response.status}`);
      }
    } catch (e) {
      console.warn(`[Routing] Failed to reach ${server}: ${e.message}`);
    }
  }

  // If all failed
  console.error("[Routing] All servers failed");
  res.status(502).json({ error: 'Routing services unavailable' });
});

app.get('/data', (_req, res) => {
  res.json(latestSensorData);
});

// Health check for monitoring and automated tests
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'road-quality-backend', timestamp: new Date().toISOString() });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log('WebSocket on same port; GET /health for health check.');
});
