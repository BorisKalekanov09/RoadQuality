export interface Road {
    id: string;
    name: string;
    status: 'idle' | 'recording';
    description?: string;
    start_lat?: number;
    start_lng?: number;
    end_lat?: number;
    end_lng?: number;
    waypoints?: { lat: number, lng: number }[];
    created_at: string;
}

export interface SensorData {
    roadQuality: number;
    condition: string;
    holesCount: number;
    latitude?: number;
    longitude?: number;
}
