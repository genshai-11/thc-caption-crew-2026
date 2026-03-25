import { useEffect, useState } from 'react';
import { defaultGameSettings, loadSettings, saveSettings } from '@/services/roundRepository';
import { GameSettings } from '@/types';

export default function SettingsPage() {
  const [settings, setSettings] = useState<GameSettings>(defaultGameSettings);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadSettings().then(setSettings).catch(() => undefined);
  }, []);

  const handleSave = async () => {
    await saveSettings(settings);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  };

  return (
    <main className="screen-shell settings-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Game settings</p>
          <h1>Timing & Meaning</h1>
        </div>
      </header>

      <section className="settings-card">
        <label>
          <span>Max Crew start delay (ms)</span>
          <input
            type="number"
            value={settings.maxCrewStartDelayMs}
            onChange={(e) => setSettings((prev) => ({ ...prev, maxCrewStartDelayMs: Number(e.target.value || 0) }))}
          />
        </label>

        <label>
          <span>Meaning strictness</span>
          <select
            value={settings.strictness}
            onChange={(e) => setSettings((prev) => ({ ...prev, strictness: e.target.value as GameSettings['strictness'] }))}
          >
            <option value="loose">Loose</option>
            <option value="medium">Medium</option>
            <option value="strict">Strict</option>
          </select>
        </label>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.showCountdown}
            onChange={(e) => setSettings((prev) => ({ ...prev, showCountdown: e.target.checked }))}
          />
          <span>Show countdown during Crew waiting phase</span>
        </label>

        <button className="big-action-button" onClick={handleSave}>Save settings</button>
        {saved && <p className="save-hint">Settings saved.</p>}
      </section>
    </main>
  );
}