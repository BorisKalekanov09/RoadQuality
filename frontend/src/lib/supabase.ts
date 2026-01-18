import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const isPlaceholder = (str: string | undefined) =>
    !str || str === 'your_supabase_url' || str === 'your_supabase_anon_key' || str.includes('...');

if (isPlaceholder(supabaseUrl) || isPlaceholder(supabaseKey)) {
    throw new Error('Please set valid VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your frontend/.env file.');
}

// Basic URL validation
try {
    new URL(supabaseUrl as string);
} catch (e) {
    throw new Error('Invalid VITE_SUPABASE_URL format in .env file. It should look like https://xyz.supabase.co');
}

export const supabase = createClient(supabaseUrl as string, supabaseKey as string);
