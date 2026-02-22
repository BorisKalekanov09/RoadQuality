/**
 * Simple health check and API validation script for automated testing.
 * Run: node health-check.js
 * Expects server running at BASE_URL (default http://localhost:8080).
 */
const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';

async function run() {
  let failed = 0;

  // 1. Health endpoint
  try {
    const res = await fetch(`${BASE_URL}/health`);
    const data = await res.json();
    if (res.status !== 200 || data?.status !== 'ok') {
      console.error('FAIL: GET /health expected status 200 and { status: "ok" }');
      failed++;
    } else {
      console.log('OK: GET /health');
    }
  } catch (e) {
    console.error('FAIL: GET /health', e.message);
    failed++;
  }

  // 2. GET /data returns current sensor state
  try {
    const res = await fetch(`${BASE_URL}/data`);
    const data = await res.json();
    if (res.status !== 200 || typeof data.roadQuality !== 'number') {
      console.error('FAIL: GET /data expected 200 and object with roadQuality');
      failed++;
    } else {
      console.log('OK: GET /data');
    }
  } catch (e) {
    console.error('FAIL: GET /data', e.message);
    failed++;
  }

  // 3. POST /data rejects invalid payload
  try {
    const res = await fetch(`${BASE_URL}/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    if (res.status !== 400) {
      console.error('FAIL: POST /data with empty body expected 400');
      failed++;
    } else {
      console.log('OK: POST /data validation (rejects invalid)');
    }
  } catch (e) {
    console.error('FAIL: POST /data', e.message);
    failed++;
  }

  // 4. POST /data accepts valid payload
  try {
    const res = await fetch(`${BASE_URL}/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roadQuality: 0.8,
        condition: 'GOOD',
        holesCount: 2,
        latitude: 42.7,
        longitude: 23.3
      })
    });
    const data = await res.json();
    if (res.status !== 200 || data?.status !== 'ok') {
      console.error('FAIL: POST /data valid payload expected 200 and status ok');
      failed++;
    } else {
      console.log('OK: POST /data valid payload');
    }
  } catch (e) {
    console.error('FAIL: POST /data valid', e.message);
    failed++;
  }

  if (failed > 0) {
    console.error(`\n${failed} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll checks passed.');
}

run();
