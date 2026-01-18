import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import 'leaflet/dist/leaflet.css'

const rootElement = document.getElementById('root')!;

async function init() {
  try {
    // Dynamic import allows try-catch to catch errors inside App.tsx or its imported modules (like supabase.ts)
    const { default: App } = await import('./App.tsx');

    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    )
  } catch (error: any) {
    console.error("Failed to render React app:", error);
    rootElement.innerHTML = `
      <div style="padding: 40px; font-family: system-ui, sans-serif; text-align: center; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #e11d48; font-size: 2rem; margin-bottom: 1rem;">Configuration Error</h1>
        <p style="color: #475569; font-size: 1.1rem; line-height: 1.6;">
          The application failed to start. This is usually caused by invalid or missing Supabase project details.
        </p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 20px; border-radius: 12px; display: inline-block; text-align: left; margin-top: 20px; width: 100%;">
          <p style="margin: 0 0 10px 0; font-weight: bold; color: #1e293b;">Error Details:</p>
          <code style="color: #be123c; background: #fff1f2; padding: 4px 8px; border-radius: 4px; word-break: break-all;">${error.message}</code>
        </div>
        <div style="margin-top: 30px; padding: 20px; background: #f0f9ff; border-radius: 12px; text-align: left; border: 1px solid #bae6fd;">
          <h3 style="margin: 0 0 10px 0; color: #0369a1;">How to fix:</h3>
          <ol style="margin: 0; padding-left: 20px; color: #0c4a6e; line-height: 1.6;">
            <li>Open the file <b>frontend/.env</b></li>
            <li>Replace <code>your_supabase_url</code> with your actual Supabase Project URL (starts with https://)</li>
            <li>Replace <code>your_supabase_anon_key</code> with your Project API Key</li>
            <li>Save the file and refresh this page.</li>
          </ol>
        </div>
      </div>
    `;
  }
}

init();
