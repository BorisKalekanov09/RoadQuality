require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 8080;
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, host: '0.0.0.0' });

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(express.json());
app.use(cors());
app.use(express.static('public'));

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
      console.log("[Parsed JSON]", data);

      if (data.type === 'control') {
        // Handle start/stop recording from Worker
        if (data.command === 'start' && data.roadId) {
          currentRoadId = data.roadId;
          measurementBuffer = []; // Clear buffer for new session
          // Update road status in DB
          await supabase.from('roads').update({ status: 'recording' }).eq('id', currentRoadId);
          console.log(`Started recording for road: ${currentRoadId}`);
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
        // Assume sensor data
        if (data.roadQuality !== undefined) latestSensorData.roadQuality = data.roadQuality;
        if (data.condition !== undefined) latestSensorData.condition = data.condition;
        if (data.holesCount !== undefined) latestSensorData.holesCount = data.holesCount;

        if (data.latitude) latestSensorData.latitude = data.latitude;
        if (data.longitude) latestSensorData.longitude = data.longitude;

        broadcast({ type: "sensor_data", data: latestSensorData });

        // Buffer data if recording
        if (currentRoadId) {
          measurementBuffer.push({
            quality: latestSensorData.roadQuality,
            condition: latestSensorData.condition,
            holes_count: latestSensorData.holesCount,
            latitude: latestSensorData.latitude,
            longitude: latestSensorData.longitude
          });
          console.log(`Buffered measurement. Buffer size: ${measurementBuffer.length}`);
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

// HTTP Endpoint for ESP32 (if using HTTP instead of WS)
app.post('/data', async (req, res) => {
  console.log("[HTTP] Received POST data:", req.body);

  if (req.body.roadQuality !== undefined) latestSensorData.roadQuality = req.body.roadQuality;
  if (req.body.condition !== undefined) latestSensorData.condition = req.body.condition;
  if (req.body.holesCount !== undefined) latestSensorData.holesCount = req.body.holesCount;
  if (req.body.latitude) latestSensorData.latitude = req.body.latitude;
  if (req.body.longitude) latestSensorData.longitude = req.body.longitude;

  broadcast({ type: "sensor_data", data: latestSensorData });

  if (currentRoadId) {
    measurementBuffer.push({
      quality: latestSensorData.roadQuality,
      condition: latestSensorData.condition,
      holes_count: latestSensorData.holesCount,
      latitude: latestSensorData.latitude || 0,
      longitude: latestSensorData.longitude || 0
    });
  }

  res.json({ status: 'success', received: latestSensorData });
});

// Proxy endpoint for OSRM Routing to avoid CORS and handle fallbacks
app.post('/route', async (req, res) => {
  const { points } = req.body;
  if (!points || points.length < 2) {
    return res.status(400).json({ error: 'At least 2 points required' });
  }

  // Format points for OSRM: lng,lat;lng,lat
  const pointsStr = points.map(p => `${p.lng},${p.lat}`).join(';');
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

app.get('/data', (req, res) => {
  res.json(latestSensorData);
});

server.listen(PORT, () => {
  console.log(` Server running at: http://localhost:${PORT}`);
  console.log(" WebSocket listening on the same port");
});
