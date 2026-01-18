import { useEffect, useState } from 'react';
import Map from '../components/Map';
import type { Road, SensorData } from '../types.ts';
import { supabase } from '../lib/supabase';
import { Radio, BarChart3, X } from 'lucide-react';

export default function PublicView() {
    const [roads, setRoads] = useState<Road[]>([]);
    const [liveData, setLiveData] = useState<SensorData>({
        roadQuality: 0,
        condition: 'UNKNOWN',
        holesCount: 0
    });
    const [isConnected, setIsConnected] = useState(false);
    const [selectedRoadInfo, setSelectedRoadInfo] = useState<any>(null);

    useEffect(() => {
        // Fetch initial roads
        supabase.from('roads').select('*').then(({ data }) => {
            if (data) setRoads(data as Road[]);
        });

        // Connect to WebSocket
        const ws = new WebSocket('ws://localhost:8080');

        ws.onopen = () => {
            console.log('Connected to WS');
            setIsConnected(true);
        };

        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                if (message.type === 'sensor_data') {
                    setLiveData(message.data);
                } else if (message.type === 'status_update') {
                    // Refresh roads to show new status
                    supabase.from('roads').select('*').then(({ data }) => {
                        if (data) setRoads(data as Road[]);
                    });
                }
            } catch (e) {
                console.error(e);
            }
        };

        ws.onclose = () => setIsConnected(false);

        return () => ws.close();
    }, []);

    const handleRoadClick = async (road: Road) => {
        const { data } = await supabase
            .from('measurements')
            .select('quality, holes_count, condition')
            .eq('road_id', road.id)
            .order('timestamp', { ascending: false })
            .limit(100);

        if (data && data.length > 0) {
            const avgQuality = data.reduce((acc, curr) => acc + curr.quality, 0) / data.length;
            const totalHoles = data.reduce((acc, curr) => acc + curr.holes_count, 0);
            setSelectedRoadInfo({
                ...road,
                avgQuality,
                totalHoles,
                dataPoints: data.length,
                latestCondition: data[0].condition
            });
        } else {
            setSelectedRoadInfo({
                ...road,
                avgQuality: 0,
                totalHoles: 0,
                dataPoints: 0,
                latestCondition: 'NO DATA'
            });
        }
    };

    const currentLocation = liveData.latitude && liveData.longitude
        ? { lat: liveData.latitude, lng: liveData.longitude }
        : undefined;

    return (
        <div className="flex h-[calc(100vh-64px)] bg-slate-50">
            {/* Sidebar */}
            <div className="w-80 bg-white border-r border-slate-200 overflow-y-auto flex flex-col shadow-sm">
                <div className="p-6 space-y-8">
                    {/* Live Status */}
                    <div>
                        <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center">
                            <div className={`h-2 w-2 rounded-full mr-2 ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                            Live System Status
                        </h2>
                        <div className="bg-slate-900 rounded-2xl p-5 text-white shadow-lg space-y-4">
                            <div className="flex justify-between items-center">
                                <span className="text-slate-400 text-sm">Quality Index</span>
                                <span className="text-2xl font-mono text-blue-400 font-bold">{liveData.roadQuality.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-slate-400 text-sm">Holes Detected</span>
                                <span className="text-2xl font-mono text-red-400 font-bold">{liveData.holesCount}</span>
                            </div>
                            <div className="pt-2 border-t border-slate-800 flex justify-between items-center">
                                <span className="text-slate-400 text-xs uppercase">Condition</span>
                                <span className="text-sm font-bold text-blue-300">{liveData.condition}</span>
                            </div>
                        </div>
                    </div>

                    {/* Selected Road Details */}
                    {selectedRoadInfo ? (
                        <div className="relative group">
                            <button
                                onClick={() => setSelectedRoadInfo(null)}
                                className="absolute -top-2 -right-2 bg-white shadow-md rounded-full p-1 hover:bg-slate-100 transition border border-slate-100 z-10"
                            >
                                <X size={16} className="text-slate-400" />
                            </button>
                            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center">
                                <BarChart3 className="mr-2 h-4 w-4" />
                                Road Analytics
                            </h2>
                            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-5 space-y-4">
                                <div>
                                    <h3 className="font-bold text-slate-800 text-lg leading-tight mb-1">{selectedRoadInfo.name}</h3>
                                    <p className="text-slate-500 text-xs italic">{selectedRoadInfo.description || 'No description available'}</p>
                                </div>
                                <div className="space-y-3 pt-3 border-t border-blue-200/50">
                                    <div className="flex justify-between">
                                        <span className="text-slate-600 text-sm">Avg. Quality</span>
                                        <span className="font-bold text-blue-700">{selectedRoadInfo.avgQuality.toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-slate-600 text-sm">Total Holes</span>
                                        <span className="font-bold text-slate-800">{selectedRoadInfo.totalHoles}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-slate-600 text-sm">Status</span>
                                        <span className="text-xs font-bold bg-blue-200 text-blue-800 px-2 py-0.5 rounded-full uppercase">{selectedRoadInfo.latestCondition}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="p-8 text-center border-2 border-dashed border-slate-200 rounded-2xl">
                            <p className="text-slate-400 text-sm italic">Click on a road on the map to view data</p>
                        </div>
                    )}

                    {/* All Roads List */}
                    <div>
                        <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center">
                            <Radio className="mr-2 h-4 w-4" />
                            Active Networks
                        </h2>
                        <div className="space-y-2">
                            {roads.map(road => (
                                <button
                                    key={road.id}
                                    onClick={() => handleRoadClick(road)}
                                    className={`w-full text-left p-4 rounded-xl border transition group ${selectedRoadInfo?.id === road.id ? 'bg-blue-600 border-blue-700 text-white shadow-md' : 'bg-white border-slate-100 hover:border-blue-200 text-slate-700'}`}
                                >
                                    <div className="font-bold text-sm mb-1">{road.name}</div>
                                    <div className={`text-[10px] font-bold uppercase tracking-widest ${selectedRoadInfo?.id === road.id ? 'text-blue-100' : 'text-slate-400'}`}>
                                        {road.status === 'recording' ? '● Recording Now' : '○ Standby'}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Map Area */}
            <div className="flex-1 relative">
                <Map
                    roads={roads}
                    currentLocation={currentLocation}
                    liveData={liveData}
                    onRoadClick={handleRoadClick}
                    selectedRoad={selectedRoadInfo}
                    className="h-full w-full"
                />
            </div>
        </div>
    );
}
