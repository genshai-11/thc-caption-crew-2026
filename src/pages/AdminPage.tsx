import { useEffect, useState } from 'react';
import {
  AdminRuntimeConfig,
  defaultAdminRuntimeConfig,
  loadAdminRuntimeConfig,
  saveAdminRuntimeConfig,
} from '@/services/adminConfigRepository';

export default function AdminPage() {
  const [config, setConfig] = useState<AdminRuntimeConfig>(defaultAdminRuntimeConfig);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setConfig(loadAdminRuntimeConfig());
  }, []);

  const handleSave = () => {
    saveAdminRuntimeConfig(config);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  };

  return (
    <main className="screen-shell settings-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Admin settings</p>
          <h1>LLM & STT Config</h1>
        </div>
      </header>

      <section className="settings-card">
        <div className="admin-section">
          <p className="panel-label">Deepgram</p>
          <label>
            <span>Deepgram API key</span>
            <input
              type="password"
              value={config.deepgramApiKey}
              onChange={(e) => setConfig((prev) => ({ ...prev, deepgramApiKey: e.target.value }))}
            />
          </label>
          <label>
            <span>Captain model</span>
            <input
              value={config.captainDeepgramModel}
              onChange={(e) => setConfig((prev) => ({ ...prev, captainDeepgramModel: e.target.value }))}
            />
          </label>
          <label>
            <span>Crew model</span>
            <input
              value={config.crewDeepgramModel}
              onChange={(e) => setConfig((prev) => ({ ...prev, crewDeepgramModel: e.target.value }))}
            />
          </label>
        </div>

        <div className="admin-section">
          <p className="panel-label">Router9</p>
          <label>
            <span>Router9 API key</span>
            <input
              type="password"
              value={config.router9ApiKey}
              onChange={(e) => setConfig((prev) => ({ ...prev, router9ApiKey: e.target.value }))}
            />
          </label>
          <label>
            <span>Base URL</span>
            <input
              value={config.router9BaseUrl}
              onChange={(e) => setConfig((prev) => ({ ...prev, router9BaseUrl: e.target.value }))}
            />
          </label>
          <label>
            <span>Primary model</span>
            <input
              value={config.router9Model}
              onChange={(e) => setConfig((prev) => ({ ...prev, router9Model: e.target.value }))}
            />
          </label>
          <label>
            <span>Fallback model</span>
            <input
              value={config.router9FallbackModel}
              onChange={(e) => setConfig((prev) => ({ ...prev, router9FallbackModel: e.target.value }))}
            />
          </label>
        </div>

        <p className="panel-label">Current behavior</p>
        <p className="admin-note">
          These settings are stored locally on this device for the prototype admin flow. They are passed to the backend request at runtime so you can test the game without redeploying functions.
        </p>

        <button className="big-action-button" onClick={handleSave}>Save admin config</button>
        {saved && <p className="save-hint">Admin config saved.</p>}
      </section>
    </main>
  );
}