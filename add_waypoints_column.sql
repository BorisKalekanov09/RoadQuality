-- Add waypoints column to store multiple points for a road
ALTER TABLE roads ADD COLUMN IF NOT EXISTS waypoints JSONB DEFAULT '[]'::jsonb;
