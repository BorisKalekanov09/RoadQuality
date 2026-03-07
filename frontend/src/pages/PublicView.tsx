import { useEffect, useState, useCallback } from 'react';
import Map from '../components/Map';
import type { Road, RoadWithAnalytics } from '../types';
import { supabase } from '../lib/supabase';
import { Radio, BarChart3, X, AlertCircle } from 'lucide-react';

export default function PublicView() {
    const [roads, setRoads] = useState<Road[]>([]);
    const [selectedRoadInfo, setSelectedRoadInfo] = useState<RoadWithAnalytics | null>(null);
    const [roadsLoading, setRoadsLoading] = useState(true);
    const [roadsError, setRoadsError] = useState<string | null>(null);

    const fetchRoads = useCallback(async () => {
        setRoadsError(null);
        const { data, error } = await supabase.from('roads').select('*').order('created_at', { ascending: false });
        if (error) {
            setRoadsError(error.message);
            setRoads([]);
            return;
        }
        setRoads((data ?? []) as Road[]);
    }, []);

    useEffect(() => {
        setRoadsLoading(true);
        fetchRoads().finally(() => setRoadsLoading(false));
    }, [fetchRoads]);

    useEffect(() => {
        const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8080';
        const wsUrl = backendUrl.replace(/^http/, 'ws');
        let ws: WebSocket;
        let reconnectTimer: ReturnType<typeof setTimeout>;

        const connect = () => {
            ws = new WebSocket(wsUrl);
            ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data as string);
                    if (message?.type === 'status_update') fetchRoads();
                } catch {
                    // ignore non-JSON or invalid messages
                }
            };
            ws.onclose = () => {
                reconnectTimer = setTimeout(connect, 3000);
            };
            ws.onerror = () => {
                ws.close();
            };
        };
        connect();
        return () => {
            clearTimeout(reconnectTimer);
            ws?.close();
        };
    }, [fetchRoads]);

    const handleRoadClick = async (road: Road) => {
        const { data, error } = await supabase
            .from('measurements')
            .select('quality, holes_count, condition')
            .eq('road_id', road.id)
            .order('timestamp', { ascending: false })
            .limit(100);

        if (error) {
            setSelectedRoadInfo({
                ...road,
                avgQuality: 0,
                totalHoles: 0,
                dataPoints: 0,
                latestCondition: 'ERROR'
            });
            return;
        }
        const list = data ?? [];
        if (list.length > 0) {
            const avgQuality = list.reduce((acc, curr) => acc + (curr.quality ?? 0), 0) / list.length;
            const totalHoles = list.reduce((acc, curr) => acc + (curr.holes_count ?? 0), 0);
            setSelectedRoadInfo({
                ...road,
                avgQuality,
                totalHoles,
                dataPoints: list.length,
                latestCondition: list[0].condition ?? 'UNKNOWN'
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


    return (
        <div className="flex h-[calc(100vh-64px)] bg-slate-50">
            {/* Sidebar */}
            <div className="w-80 bg-white border-r border-slate-200 flex flex-col shadow-sm overflow-hidden text-slate-800">

                {/* 1. Sticky Analytics Header (if road selected) */}
                {selectedRoadInfo && (
                    <div className="p-6 border-b border-slate-100 bg-white shrink-0 shadow-sm z-20 relative animate-in fade-in slide-in-from-top-4 duration-300">
                        <button
                            onClick={() => setSelectedRoadInfo(null)}
                            className="absolute top-4 right-4 bg-white shadow-sm rounded-full p-1.5 hover:bg-slate-50 transition border border-slate-200 z-10"
                        >
                            <X size={14} className="text-slate-400" />
                        </button>

                        <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 flex items-center">
                            <BarChart3 className="mr-2 h-3.5 w-3.5 text-blue-500" />
                            Road Analytics
                        </h2>

                        <div className="bg-blue-50/50 border border-blue-100 rounded-2xl p-5 space-y-4">
                            <div>
                                <h3 className="font-bold text-slate-800 text-lg leading-tight mb-1">{selectedRoadInfo.name}</h3>
                                <p className="text-slate-500 text-[11px] leading-relaxed line-clamp-2 italic">{selectedRoadInfo.description || 'No description available'}</p>
                            </div>

                            <div className="space-y-3 pt-3 border-t border-blue-200/40">
                                <div className="space-y-1.5">
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="text-slate-500 font-medium">Avg. Quality</span>
                                        <span className="font-black text-blue-700">{Math.round(selectedRoadInfo.avgQuality <= 1 ? selectedRoadInfo.avgQuality * 100 : selectedRoadInfo.avgQuality)}%</span>
                                    </div>
                                    <div className="w-full bg-blue-200/30 h-1.5 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full transition-all duration-1000 ${(selectedRoadInfo.avgQuality <= 1 ? selectedRoadInfo.avgQuality * 100 : selectedRoadInfo.avgQuality) >= 80 ? 'bg-green-500' : (selectedRoadInfo.avgQuality <= 1 ? selectedRoadInfo.avgQuality * 100 : selectedRoadInfo.avgQuality) >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                            style={{ width: `${selectedRoadInfo.avgQuality <= 1 ? selectedRoadInfo.avgQuality * 100 : selectedRoadInfo.avgQuality}%` }}
                                        />
                                    </div>
                                </div>
                                <div className="flex justify-between items-center text-xs">
                                    <span className="text-slate-500 font-medium">Total Holes</span>
                                    <span className="font-bold text-slate-800">{selectedRoadInfo.totalHoles}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-slate-500 text-xs font-medium">Status</span>
                                    <span className="text-[9px] font-black bg-blue-200 text-blue-800 px-2.5 py-1 rounded-full uppercase tracking-tighter">{selectedRoadInfo.latestCondition}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* 2. Scrollable Road List */}
                <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">

                    {!selectedRoadInfo && (
                        <div className="p-8 text-center border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
                            <p className="text-slate-400 text-sm italic">Click on a road on the map to view data</p>
                        </div>
                    )}

                    {roadsError && (
                        <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
                            <AlertCircle className="h-4 w-4 shrink-0" />
                            <span>{roadsError}</span>
                        </div>
                    )}

                    <div>
                        <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 flex items-center">
                            <Radio className="mr-2 h-3.5 w-3.5" />
                            Registered Roads
                        </h2>

                        {roadsLoading ? (
                            <div className="space-y-3">
                                {[1, 2, 3].map(i => (
                                    <div key={i} className="h-16 w-full bg-slate-100 rounded-xl animate-pulse" />
                                ))}
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {roads.map(road => (
                                    <button
                                        key={road.id}
                                        onClick={() => handleRoadClick(road)}
                                        className={`w-full text-left p-4 rounded-xl border transition-all duration-200 group ${selectedRoadInfo?.id === road.id ? 'bg-blue-600 border-blue-700 text-white shadow-lg translate-x-1' : 'bg-white border-slate-100 hover:border-blue-200 hover:bg-slate-50 text-slate-700 shadow-sm'}`}
                                    >
                                        <div className="font-bold text-sm mb-1 line-clamp-1">{road.name}</div>
                                        <div className={`text-[9px] font-black uppercase tracking-widest flex items-center ${selectedRoadInfo?.id === road.id ? 'text-blue-100' : 'text-slate-400'}`}>
                                            <div className={`h-1.5 w-1.5 rounded-full mr-2 ${road.status === 'recording' ? 'bg-green-400 animate-pulse' : 'bg-slate-300'}`} />
                                            {road.status === 'recording' ? 'Live Recording' : 'Standby'}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Map Area */}
            <div className="flex-1 relative">
                <Map
                    roads={roads}
                    onRoadClick={handleRoadClick}
                    selectedRoad={selectedRoadInfo}
                    className="h-full w-full"
                />
            </div>
        </div>
    );
}
