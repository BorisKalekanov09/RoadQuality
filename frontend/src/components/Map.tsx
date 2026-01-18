import { MapContainer, TileLayer, Marker, Popup, Polyline, useMapEvents } from 'react-leaflet';
import type { Road } from '../types.ts';
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
    liveData?: any;
    onMapClick?: (lat: number, lng: number) => void;
    selectedRoad?: Road | null;
    onRoadClick?: (road: Road) => void;
    waypoints?: { lat: number, lng: number }[];
}

// Sub-component to handle routing for a single road and return coordinates
function RoutingLine({ road, onRoadClick, isSelected }: { road: Road, onRoadClick?: (road: Road) => void, isSelected: boolean }) {
    const [positions, setPositions] = useState<[number, number][]>([]);

    useEffect(() => {
        const processPoints = (pts: any[] | undefined) => (pts || []).map(p => ({
            lat: Number(p.lat),
            lng: Number(p.lng)
        }));

        const hasWaypoints = road.waypoints && road.waypoints.length > 0;
        const points = hasWaypoints
            ? processPoints(road.waypoints)
            : (road.start_lat && road.start_lng && road.end_lat && road.end_lng
                ? processPoints([{ lat: road.start_lat, lng: road.start_lng }, { lat: road.end_lat, lng: road.end_lng }])
                : []);

        if (points.length < 2) return;

        const fetchRoute = async () => {
            try {
                // Call our backend proxy to avoid CORS and handle OSRM logic
                const response = await fetch('http://localhost:8080/route', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ points })
                });

                if (response.ok) {
                    const data = await response.json();
                    if (data.success && data.coordinates) {
                        const coords = data.coordinates;
                        // OSRM GeoJSON is [lng, lat], Leaflet needs [lat, lng]
                        setPositions(coords.map((c: [number, number]) => [c[1], c[0]]));
                    } else {
                        throw new Error("Backend routing did not return coordinates");
                    }
                } else {
                    throw new Error(`Proxy error: ${response.status}`);
                }
            } catch (error) {
                console.error("Routing error for road:", road.name, error);
                setPositions(points.map(p => [p.lat, p.lng]));
            }
        };

        fetchRoute();
    }, [road]);

    // Fallback/Loading positions if not yet calculated but we have start/end
    const fallbackPositions: [number, number][] = (road.waypoints && road.waypoints.length > 0)
        ? road.waypoints.map(v => [Number(v.lat), Number(v.lng)])
        : (road.start_lat && road.start_lng && road.end_lat && road.end_lng)
            ? [[Number(road.start_lat), Number(road.start_lng)], [Number(road.end_lat), Number(road.end_lng)]]
            : [];

    const displayPositions = positions.length > 0 ? positions : fallbackPositions;

    if (displayPositions.length === 0) return null;

    return (
        <>
            {/* Invisibly thick line to make clicking much easier */}
            <Polyline
                key={`${road.id}-click-${isSelected}`}
                positions={displayPositions}
                color="transparent"
                weight={30}
                eventHandlers={{
                    click: () => {
                        if (onRoadClick) onRoadClick(road);
                    }
                }}
            />
            {/* The visible road line */}
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
                            <div className="mt-2 text-xs text-gray-400">Click to view detailed analytics</div>
                        </div>
                    </div>
                </Popup>
            </Polyline>

            {/* Start Marker for the road */}
            <Marker
                position={displayPositions[0]}
                zIndexOffset={isSelected ? 1000 : 0}
                eventHandlers={{
                    add: (e) => { e.target._icon.style.filter = 'hue-rotate(240deg) brightness(1.2) saturate(1.5)'; }
                }}
            >
                <Popup>
                    <div className="p-1">
                        <div className="font-bold text-green-600 text-xs uppercase tracking-wider">Start of Road</div>
                        <div className="font-bold">{road.name}</div>
                    </div>
                </Popup>
            </Marker>

            {/* End Marker for the road */}
            <Marker
                position={displayPositions[displayPositions.length - 1]}
                zIndexOffset={isSelected ? 1000 : 0}
                eventHandlers={{
                    add: (e) => { e.target._icon.style.filter = 'hue-rotate(160deg) brightness(1.1) saturate(1.5)'; }
                }}
            >
                <Popup>
                    <div className="p-1">
                        <div className="font-bold text-red-600 text-xs uppercase tracking-wider">End of Road</div>
                        <div className="font-bold">{road.name}</div>
                    </div>
                </Popup>
            </Marker>
        </>
    );
}

function MapEvents({ onClick }: { onClick?: (lat: number, lng: number) => void }) {
    useMapEvents({
        click: (e) => {
            if (onClick) onClick(e.latlng.lat, e.latlng.lng);
        },
    });
    return null;
}

export default function Map({ className, roads = [], currentLocation, liveData, onMapClick, onRoadClick, waypoints, selectedRoad }: MapProps) {
    const position: [number, number] = [41.9981, 21.4254];

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
                            <div className="space-y-1">
                                <p>Quality: <span className="font-mono">{liveData?.roadQuality?.toFixed(2) || '0.00'}</span></p>
                                <p>Holes: <span className="font-mono">{liveData?.holesCount || '0'}</span></p>
                                <p>Condition: <span className="font-bold">{liveData?.condition || 'UNKNOWN'}</span></p>
                            </div>
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

            {waypoints && waypoints.map((p, i) => {
                const isFirst = i === 0;
                const isLast = i === waypoints.length - 1 && waypoints.length > 1;

                // Use CSS filters to change marker color without extra assets
                // Green for start, Red for end, Default (blue) for middle
                const filter = isFirst
                    ? 'hue-rotate(240deg) brightness(1.2) saturate(1.5)'
                    : isLast
                        ? 'hue-rotate(160deg) brightness(1.1) saturate(1.5)'
                        : 'none';

                return (
                    <Marker
                        key={`waypoint-${i}`}
                        position={[p.lat, p.lng]}
                        eventHandlers={{
                            add: (e) => {
                                e.target._icon.style.filter = filter;
                            }
                        }}
                    >
                        <Popup>
                            <div className="font-bold">
                                {isFirst ? '🚀 START POINT' : isLast ? '🏁 END POINT' : `Waypoint ${i + 1}`}
                            </div>
                            <div className="text-xs text-gray-500 font-mono">
                                {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
                            </div>
                        </Popup>
                    </Marker>
                );
            })}
        </MapContainer>
    );
}
