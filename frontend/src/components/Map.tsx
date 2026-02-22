import { MapContainer, TileLayer, Marker, Popup, Polyline, useMapEvents } from 'react-leaflet';
import type { Road, SensorData } from '../types';
import { useEffect, useState } from 'react';
import L from 'leaflet';

// Fix for default leaflet markers
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

interface MapProps {
    className?: string;
    roads?: Road[];
    currentLocation?: { lat: number, lng: number };
    liveData?: SensorData | null;
    onMapClick?: (lat: number, lng: number) => void;
    selectedRoad?: Road | null;
    onRoadClick?: (road: Road) => void;
    waypoints?: { lat: number, lng: number }[];
}

// ─── Polite Routing Queue ──────────────────────────────────────────────────────────
// To prevent IP bans from mapping servers (Too Many Requests), we strictly rate-limit
// our API calls to exactly 1 request per 1000ms.
const routingQueue: (() => Promise<void>)[] = [];
let isQueueProcessing = false;

function enqueueRoutePolite(task: () => Promise<void>) {
    routingQueue.push(task);
    if (!isQueueProcessing) {
        processPoliteQueue();
    }
}

async function processPoliteQueue() {
    isQueueProcessing = true;
    while (routingQueue.length > 0) {
        const task = routingQueue.shift()!;
        try {
            await task();
        } catch (e) {
            console.error(e);
        }
        // Strict 1 second delay between requests to avoid bans
        await new Promise(r => setTimeout(r, 1000));
    }
    isQueueProcessing = false;
}

// ─── Sub-component to handle routing for a single road ───────────────────────────
function RoutingLine({ road, onRoadClick, isSelected }: { road: Road, onRoadClick?: (road: Road) => void, isSelected: boolean }) {
    const [positions, setPositions] = useState<[number, number][]>([]);

    useEffect(() => {
        const cacheKey = `osrm_cache_v3_${road.id}`;

        // 1. Try to load from local cache to make it instant!
        try {
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                setPositions(JSON.parse(cached));
                return;
            }
        } catch (e) { }

        // Fallback straight-line points setup
        const processPoints = (pts: any[] | undefined) => (pts || []).map(p => ({
            lat: Number(p.lat), lng: Number(p.lng)
        }));
        const hasWaypoints = road.waypoints && road.waypoints.length > 0;
        const points = hasWaypoints
            ? processPoints(road.waypoints)
            : (road.start_lat && road.start_lng && road.end_lat && road.end_lng
                ? processPoints([{ lat: road.start_lat, lng: road.start_lng }, { lat: road.end_lat, lng: road.end_lng }])
                : []);

        if (points.length < 2) return;

        // 2. Fetch from routing API politely
        const fetchOsrmRoute = async () => {
            const pointsStr = points.map(p => `${p.lng},${p.lat}`).join(';');
            const url = `https://routing.openstreetmap.de/routed-car/route/v1/driving/${pointsStr}?overview=full&geometries=geojson&steps=false&annotations=false`;

            try {
                const res = await fetch(url);
                if (res.ok) {
                    const data = await res.json();
                    if (data.routes && data.routes.length > 0) {
                        const coords = data.routes[0].geometry.coordinates;
                        const mappedCoords = coords.map((c: [number, number]) => [c[1], c[0]]);

                        setPositions(mappedCoords);
                        // Save so we never have to ask the server for this road again
                        try { localStorage.setItem(cacheKey, JSON.stringify(mappedCoords)); } catch (_) { }
                        return;
                    }
                }
            } catch (e) {
                console.warn(`Routing failed for ${road.name}`);
            }

            // Fallback to straight line if API fails
            setPositions(points.map(p => [p.lat, p.lng]));
        };

        // Enqueue the network request
        enqueueRoutePolite(fetchOsrmRoute);

    }, [road]);

    // Fallback while loading
    const fallbackPositions: [number, number][] = (road.waypoints && road.waypoints.length > 0)
        ? road.waypoints.map(v => [Number(v.lat), Number(v.lng)])
        : (road.start_lat && road.start_lng && road.end_lat && road.end_lng)
            ? [[Number(road.start_lat), Number(road.start_lng)], [Number(road.end_lat), Number(road.end_lng)]]
            : [];

    const displayPositions = positions.length > 0 ? positions : fallbackPositions;

    if (displayPositions.length === 0) return null;

    return (
        <>
            <Polyline
                key={`${road.id}-click-${isSelected}`}
                positions={displayPositions}
                color="transparent"
                weight={30}
                eventHandlers={{ click: () => { if (onRoadClick) onRoadClick(road); } }}
            />
            <Polyline
                key={`${road.id}-visible-${isSelected}`}
                positions={displayPositions}
                color={isSelected ? '#FF0000' : (road.status === 'recording' ? '#22c55e' : '#3b82f6')}
                weight={isSelected ? 16 : 10}
                opacity={isSelected ? 1.0 : 0.6}
                interactive={false}
            >
                <Popup>
                    <div className="p-2 min-w-[150px]">
                        <h3 className="font-bold text-lg">{road.name}</h3>
                        <p className="text-gray-600 text-sm mb-2">{road.description || 'No description'}</p>
                        <div className="bg-gray-50 p-2 rounded border text-sm">
                            <p>Status: <span className={`capitalize font-semibold ${road.status === 'recording' ? 'text-green-600' : 'text-blue-600'}`}>{road.status}</span></p>
                        </div>
                    </div>
                </Popup>
            </Polyline>

            <Marker
                position={displayPositions[0]}
                zIndexOffset={isSelected ? 1000 : 0}
                eventHandlers={{ add: (e) => { e.target._icon.style.filter = 'hue-rotate(240deg) brightness(1.2) saturate(1.5)'; } }}
            />

            <Marker
                position={displayPositions[displayPositions.length - 1]}
                zIndexOffset={isSelected ? 1000 : 0}
                eventHandlers={{ add: (e) => { e.target._icon.style.filter = 'hue-rotate(160deg) brightness(1.1) saturate(1.5)'; } }}
            />
        </>
    );
}

function MapEvents({ onClick }: { onClick?: (lat: number, lng: number) => void }) {
    useMapEvents({ click: (e) => { if (onClick) onClick(e.latlng.lat, e.latlng.lng); } });
    return null;
}

export default function Map({ className, roads = [], currentLocation, liveData: _liveData, onMapClick, onRoadClick, waypoints: _waypoints, selectedRoad }: MapProps) {
    const position: [number, number] = [42.6977, 23.3219];

    return (
        <MapContainer center={position} zoom={13} className={className} style={{ height: "100%", width: "100%" }}>
            <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            <MapEvents onClick={onMapClick} />

            {currentLocation && (
                <Marker position={[currentLocation.lat, currentLocation.lng]}>
                    <Popup>
                        <div className="p-2">
                            <h3 className="font-bold border-b mb-2">Live Robot Location</h3>
                        </div>
                    </Popup>
                </Marker>
            )}

            {[...roads].sort((a, b) => {
                if (a.id === selectedRoad?.id) return 1;
                if (b.id === selectedRoad?.id) return -1;
                return 0;
            }).map(road => (
                <RoutingLine
                    key={road.id}
                    road={road}
                    onRoadClick={onRoadClick}
                    isSelected={selectedRoad?.id === road.id}
                />
            ))}
        </MapContainer>
    );
}
