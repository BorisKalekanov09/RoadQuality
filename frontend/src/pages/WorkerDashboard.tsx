import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Road, SensorData } from '../types.ts';
import { Play, Square, Plus, MapPin } from 'lucide-react';
import type { Session, AuthChangeEvent } from '@supabase/supabase-js';
import Map from '../components/Map';

export default function WorkerDashboard() {
    const [roads, setRoads] = useState<Road[]>([]);
    const [newRoadName, setNewRoadName] = useState('');
    const [isRecording, setIsRecording] = useState(false);
    const [ws, setWs] = useState<WebSocket | null>(null);
    const [liveData, setLiveData] = useState<SensorData | null>(null);
    const [activeRoadId, setActiveRoadId] = useState<string | null>(null);
    const [selectedRoad, setSelectedRoad] = useState<Road | null>(null);

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [fullName, setFullName] = useState('');
    const [isSignUp, setIsSignUp] = useState(false);
    const [authLoading, setAuthLoading] = useState(false);
    const [session, setSession] = useState<Session | null>(null);

    // Map selection states
    const [selectionMode, setSelectionMode] = useState<'idle' | 'active'>('idle');
    const [waypoints, setWaypoints] = useState<{ lat: number, lng: number }[]>([]);

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
        });

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
            setSession(session);
        });

        return () => subscription.unsubscribe();
    }, []);

    useEffect(() => {
        if (!session) return; // Don't fetch if not logged in

        fetchRoads();

        const socket = new WebSocket('ws://localhost:8080');
        socket.onopen = () => console.log('Worker WS Connected');
        socket.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'sensor_data') {
                setLiveData(msg.data);
            } else if (msg.type === 'status_update') {
                setIsRecording(msg.recording);
                setActiveRoadId(msg.currentRoadId);
                fetchRoads();
            }
        };
        setWs(socket);

        return () => socket.close();
    }, [session]);

    const fetchRoads = async () => {
        const { data } = await supabase.from('roads').select('*').order('created_at', { ascending: false });
        if (data) setRoads(data as Road[]);
    };

    const handleCreateRoad = async () => {
        if (!newRoadName.trim() || waypoints.length < 2) {
            alert('Please provide road name and select at least 2 points on the map.');
            return;
        }

        const { error } = await supabase.from('roads').insert({
            name: newRoadName,
            status: 'idle',
            start_lat: waypoints[0].lat,
            start_lng: waypoints[0].lng,
            end_lat: waypoints[waypoints.length - 1].lat,
            end_lng: waypoints[waypoints.length - 1].lng,
            waypoints: waypoints
        });

        if (!error) {
            setNewRoadName('');
            setWaypoints([]);
            setSelectionMode('idle');
            fetchRoads();
        } else {
            alert('Error creating road: ' + error.message);
        }
    };

    const handleMapClick = (lat: number, lng: number) => {
        if (selectionMode === 'active') {
            setWaypoints([...waypoints, { lat, lng }]);
        } else {
            // Clear selection if clicking the map background in idle mode
            setSelectedRoad(null);
        }
    };

    const handleRoadClick = (road: Road) => {
        setSelectedRoad(road);
    };

    const startRecording = (roadId: string) => {
        if (!ws) return;
        ws.send(JSON.stringify({ type: 'control', command: 'start', roadId }));
    };

    const stopRecording = () => {
        if (!ws) return;
        ws.send(JSON.stringify({ type: 'control', command: 'stop' }));
    };

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setAuthLoading(true);

        if (isSignUp) {
            const { error } = await supabase.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        full_name: fullName
                    }
                }
            });
            if (error) alert(error.message);
            else alert('Signup successful! Check your email for confirmation (if enabled).');
        } else {
            const { error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) alert(error.message);
        }
        setAuthLoading(false);
    };

    if (!session) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-50 p-4">
                <form onSubmit={handleAuth} className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border border-gray-100">
                    <div className="text-center mb-8">
                        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Worker Access</h1>
                        <p className="text-gray-500 text-sm">
                            {isSignUp ? 'Create a new worker account' : 'Sign in to your worker dashboard'}
                        </p>
                    </div>

                    {isSignUp && (
                        <div className="mb-4">
                            <label className="block text-gray-700 text-sm font-semibold mb-2">Full Name</label>
                            <input
                                type="text"
                                value={fullName}
                                onChange={(e) => setFullName(e.target.value)}
                                className="w-full border border-gray-300 p-3 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
                                placeholder="John Doe"
                                required
                            />
                        </div>
                    )}

                    <div className="mb-4">
                        <label className="block text-gray-700 text-sm font-semibold mb-2">Email</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full border border-gray-300 p-3 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
                            placeholder="worker@example.com"
                            required
                        />
                    </div>
                    <div className="mb-6">
                        <label className="block text-gray-700 text-sm font-semibold mb-2">Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full border border-gray-300 p-3 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
                            placeholder="••••••••"
                            required
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={authLoading}
                        className="w-full bg-blue-600 text-white p-4 rounded-lg hover:bg-blue-700 font-bold shadow-lg shadow-blue-200 transition active:scale-[0.98] disabled:opacity-50">
                        {authLoading ? 'Processing...' : (isSignUp ? 'Create Account' : 'Sign In')}
                    </button>

                    <div className="mt-8 text-center pt-6 border-t border-gray-100">
                        <button
                            type="button"
                            onClick={() => setIsSignUp(!isSignUp)}
                            className="text-blue-600 hover:text-blue-800 font-medium text-sm">
                            {isSignUp ? 'Already have an account? Sign In' : 'Need an account? Create one'}
                        </button>
                    </div>
                </form>
            </div>
        );
    }

    return (
        <div className="p-8 max-w-6xl mx-auto flex flex-col gap-8">
            <header className="flex justify-between items-center">
                <h1 className="text-3xl font-bold text-slate-800">Worker Dashboard</h1>
                <button onClick={() => supabase.auth.signOut()} className="text-slate-500 hover:text-red-600 transition text-sm font-medium">
                    Sign Out
                </button>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Left: Controls and List */}
                <div className="lg:col-span-1 space-y-8">
                    {/* Live Control Panel */}
                    <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-xl">
                        <h2 className="text-lg font-semibold mb-4 flex items-center">
                            <ActivityIcon className="mr-2 h-5 w-5 text-blue-400" />
                            Live Robot Status
                        </h2>

                        <div className="space-y-6">
                            <div className="flex justify-between items-end">
                                <div>
                                    <div className="text-slate-400 text-xs uppercase tracking-widest mb-1">Current Task</div>
                                    <div className={`text-xl font-bold ${isRecording ? 'text-green-400' : 'text-slate-400'}`}>
                                        {isRecording ? 'RECORDING' : 'IDLE'}
                                    </div>
                                    {isRecording && activeRoadId && (
                                        <div className="text-blue-300 text-sm mt-1">
                                            Road: {roads.find(r => r.id === activeRoadId)?.name || '...'}
                                        </div>
                                    )}
                                </div>
                                {isRecording && (
                                    <button
                                        onClick={stopRecording}
                                        className="bg-red-600 hover:bg-red-700 text-white p-3 rounded-xl transition shadow-lg shadow-red-900/50">
                                        <Square className="h-6 w-6 fill-current" />
                                    </button>
                                )}
                            </div>

                            <div className="grid grid-cols-3 gap-2 pt-4 border-t border-slate-800">
                                <div className="text-center">
                                    <div className="text-xl font-mono text-blue-400">{liveData?.roadQuality.toFixed(1) || '0.0'}</div>
                                    <div className="text-[10px] text-slate-500 uppercase">Quality</div>
                                </div>
                                <div className="text-center">
                                    <div className="text-xl font-mono text-red-400">{liveData?.holesCount || '0'}</div>
                                    <div className="text-[10px] text-slate-500 uppercase">Holes</div>
                                </div>
                                <div className="text-center">
                                    <div className="text-sm font-bold text-slate-200 truncate mt-1">{liveData?.condition || '-'}</div>
                                    <div className="text-[10px] text-slate-500 uppercase">State</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* New Road Form */}
                    <div className="bg-white p-6 rounded-2xl shadow-lg border border-slate-100">
                        <h2 className="text-lg font-bold text-slate-800 mb-4">Add New Road</h2>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Road Name</label>
                                <input
                                    type="text"
                                    value={newRoadName}
                                    onChange={(e) => setNewRoadName(e.target.value)}
                                    placeholder="e.g. Main Street North"
                                    className="w-full border border-slate-200 p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 transition"
                                />
                            </div>

                            <div className="grid grid-cols-1 gap-3">
                                <button
                                    onClick={() => setSelectionMode(selectionMode === 'active' ? 'idle' : 'active')}
                                    className={`flex items-center justify-between p-3 rounded-xl border-2 transition ${selectionMode === 'active' ? 'border-blue-500 bg-blue-50' : 'border-slate-100 hover:border-slate-200'}`}>
                                    <div className="flex items-center">
                                        <MapPin className={`h-5 w-5 mr-3 ${waypoints.length > 0 ? 'text-blue-600' : 'text-slate-300'}`} />
                                        <div className="text-left">
                                            <div className="text-[10px] font-bold uppercase text-slate-400">Add Waypoints</div>
                                            <div className="text-sm font-bold text-slate-700">{waypoints.length} points set</div>
                                        </div>
                                    </div>
                                    {selectionMode === 'active' ? (
                                        <span className="text-[10px] bg-blue-600 text-white px-2 py-1 rounded font-black animate-pulse">STOP ADDING</span>
                                    ) : (
                                        <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-1 rounded font-black">START ADDING</span>
                                    )}
                                </button>
                                {waypoints.length > 0 && (
                                    <button
                                        onClick={() => setWaypoints([])}
                                        className="text-[10px] font-bold text-red-500 uppercase hover:text-red-700 transition self-end px-2"
                                    >
                                        Clear All Points
                                    </button>
                                )}
                            </div>

                            <button
                                onClick={handleCreateRoad}
                                className="w-full bg-slate-800 text-white p-4 rounded-xl hover:bg-slate-900 flex items-center justify-center font-bold transition shadow-lg">
                                <Plus className="h-5 w-5 mr-2" /> Save Road
                            </button>
                        </div>
                    </div>
                </div>

                {/* Right: Map and Road List */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="h-[400px] rounded-3xl overflow-hidden shadow-2xl border-4 border-white relative">
                        {selectionMode !== 'idle' && (
                            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] bg-blue-600 text-white px-6 py-2 rounded-full shadow-xl font-bold animate-bounce text-sm">
                                Click on the map to set the {selectionMode.toUpperCase()} POINT
                            </div>
                        )}
                        <Map
                            roads={roads}
                            liveData={liveData}
                            onMapClick={handleMapClick}
                            onRoadClick={handleRoadClick}
                            waypoints={waypoints}
                            selectedRoad={selectedRoad}
                            className="h-full w-full"
                        />
                    </div>

                    <div className="bg-white p-6 rounded-2xl shadow-lg border border-slate-100">
                        <h2 className="text-xl font-bold text-slate-800 mb-6">Manage Existing Roads</h2>
                        <div className="divide-y divide-slate-100">
                            {roads.map(road => (
                                <div key={road.id} className="py-4 flex justify-between items-center hover:bg-slate-50 px-2 rounded-xl transition group">
                                    <div
                                        className="flex items-center cursor-pointer flex-1"
                                        onClick={() => handleRoadClick(road)}
                                    >
                                        <div className={`h-10 w-10 ${selectedRoad?.id === road.id ? 'bg-orange-100' : 'bg-slate-100'} rounded-full flex items-center justify-center mr-4 group-hover:bg-blue-100 transition`}>
                                            <MapPin className={`h-5 w-5 ${selectedRoad?.id === road.id ? 'text-orange-500' : 'text-slate-400'} group-hover:text-blue-500`} />
                                        </div>
                                        <div>
                                            <div className={`font-bold ${selectedRoad?.id === road.id ? 'text-orange-600' : 'text-slate-700'}`}>{road.name}</div>
                                            <div className="text-[10px] text-slate-400 font-mono">{road.id.substring(0, 8)}...</div>
                                        </div>
                                    </div>
                                    <div>
                                        {!isRecording && (
                                            <button
                                                onClick={() => startRecording(road.id)}
                                                className="bg-green-100 text-green-700 px-5 py-2 rounded-xl hover:bg-green-200 flex items-center font-bold transition">
                                                <Play className="h-4 w-4 mr-1 fill-current" /> Start
                                            </button>
                                        )}
                                        {isRecording && activeRoadId === road.id && (
                                            <span className="flex items-center text-red-600 font-black text-xs uppercase italic animate-pulse">
                                                <div className="h-2 w-2 bg-red-600 rounded-full mr-2" /> Recording...
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function ActivityIcon({ className }: { className?: string }) {
    return (
        <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
    );
}
