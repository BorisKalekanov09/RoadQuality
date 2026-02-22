/**
 * seed-geometry.js
 *
 * Run this ONCE to fetch real OSM road geometry and store it in Supabase.
 * After running, roads on the map will follow actual streets forever —
 * no external routing API needed at runtime.
 *
 * Usage: node seed-geometry.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const SOFIA_BBOX = '42.55,23.10,42.80,23.55';

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

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

async function fetchGeometryBatch(names, attempt = 1) {
    const nameFilters = names.map(n => `way["name"="${n}"](${SOFIA_BBOX});`).join('\n');
    const query = `[out:json][timeout:60];\n(\n${nameFilters}\n);\n(._;>);\nout body;`;

    const servers = [
        'https://overpass-api.de/api/interpreter',
        'https://overpass.kumi.systems/api/interpreter',
        'https://overpass.openstreetmap.ru/api/interpreter',
    ];

    for (const server of servers) {
        try {
            console.log(`  → Trying ${server} (attempt ${attempt})...`);
            const res = await fetch(server, {
                method: 'POST',
                body: `data=${encodeURIComponent(query)}`,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'RoadQualityApp/1.0 (educational project)'
                },
            });

            if (res.status === 429) {
                console.log(`  ⚠ Rate limited by ${server}. Waiting 60s...`);
                await sleep(60000);
                continue;
            }

            if (!res.ok) {
                console.log(`  ✗ ${server} returned ${res.status}`);
                continue;
            }

            const data = await res.json();
            if (!data.elements) continue;

            // Build node lookup
            const nodeMap = {};
            for (const el of data.elements) {
                if (el.type === 'node') nodeMap[el.id] = { lat: el.lat, lng: el.lon };
            }

            // Group ways by name
            const waysByName = {};
            for (const el of data.elements) {
                if (el.type === 'way' && el.tags?.name && el.nodes) {
                    if (!waysByName[el.tags.name]) waysByName[el.tags.name] = [];
                    waysByName[el.tags.name].push(el.nodes);
                }
            }

            // Build geometry
            const result = {};
            for (const [name, ways] of Object.entries(waysByName)) {
                const chain = chainWays(ways);
                const coords = chain.map(id => nodeMap[id]).filter(Boolean);
                if (coords.length >= 2) result[name] = coords;
            }

            console.log(`  ✓ Got ${Object.keys(result).length}/${names.length} roads from ${server}`);
            return result;

        } catch (e) {
            console.log(`  ✗ ${server} error: ${e.message}`);
        }
    }

    if (attempt < 3) {
        console.log(`  All servers failed. Waiting 30s before retry ${attempt + 1}...`);
        await sleep(30000);
        return fetchGeometryBatch(names, attempt + 1);
    }

    return null;
}

async function main() {
    console.log('🗺  Road Geometry Seeder');
    console.log('=======================\n');

    // 1. Load all roads from Supabase
    console.log('Loading roads from Supabase...');
    const { data: roads, error } = await supabase.from('roads').select('id, name, waypoints');
    if (error) { console.error('Supabase error:', error); process.exit(1); }
    console.log(`Found ${roads.length} roads.\n`);

    // 2. Only process roads that don't already have waypoints
    const needsGeometry = roads.filter(r => !r.waypoints || r.waypoints.length === 0);
    console.log(`${needsGeometry.length} roads need geometry.\n`);

    if (needsGeometry.length === 0) {
        console.log('✅ All roads already have geometry! Nothing to do.');
        return;
    }

    // 3. Fetch in batches of 20 to avoid query size limits
    const BATCH_SIZE = 20;
    let successCount = 0;

    for (let i = 0; i < needsGeometry.length; i += BATCH_SIZE) {
        const batch = needsGeometry.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(needsGeometry.length / BATCH_SIZE);

        console.log(`\nBatch ${batchNum}/${totalBatches}: ${batch.map(r => r.name).join(', ')}`);

        // Wait between batches to be polite to Overpass
        if (i > 0) {
            console.log('  Waiting 5s between batches...');
            await sleep(5000);
        }

        const geometries = await fetchGeometryBatch(batch.map(r => r.name));
        if (!geometries) {
            console.log('  ✗ Skipping batch — all servers unavailable');
            continue;
        }

        // 4. Update each road in Supabase
        for (const road of batch) {
            const coords = geometries[road.name];
            if (!coords) {
                console.log(`  ⚠ No geometry found for "${road.name}" in OSM`);
                continue;
            }

            const { error: updateError } = await supabase
                .from('roads')
                .update({ waypoints: coords })
                .eq('id', road.id);

            if (updateError) {
                console.log(`  ✗ Failed to update "${road.name}": ${updateError.message}`);
            } else {
                console.log(`  ✓ Updated "${road.name}" with ${coords.length} waypoints`);
                successCount++;
            }
        }
    }

    console.log(`\n✅ Done! Updated ${successCount}/${needsGeometry.length} roads with real geometry.`);
    console.log('Refresh the map — roads will now follow actual streets.');
}

main().catch(console.error);
