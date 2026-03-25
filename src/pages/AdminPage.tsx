import { useEffect, useMemo, useState } from 'react';
import {
  AdminRuntimeConfig,
  defaultAdminRuntimeConfig,
  loadAdminRuntimeConfig,
  saveAdminRuntimeConfig,
} from '@/services/adminConfigRepository';
import { fetchRouterModels, testRouterCompletion, type RouterModelInfo } from '@/services/adminValidationService';
import { transcribeRoundAudio } from '@/services/transcriptionService';
import { useRoundRecorder } from '@/hooks/useRoundRecorder';

interface TestState {
  status: 'idle' | 'loading' | 'success' | 'error';
  message: string;
  transcript?: string;
}

const idleTestState: TestState = {
  status: 'idle',
  message: 'Not tested yet.',
};

function StatusBadge({ label, status }: { label: string; status: TestState['status'] | 'ready' | 'not-ready' }) {
  return <span className={`decision-pill admin-status admin-status-${status}`}>{label}</span>;
}

export default function AdminPage() {
  const [config, setConfig] = useState<AdminRuntimeConfig>(defaultAdminRuntimeConfig);
  const [saved, setSaved] = useState(false);
  const [routerModels, setRouterModels] = useState<RouterModelInfo[]>([]);
  const [modelsState, setModelsState] = useState<TestState>(idleTestState);
  const [routerTestState, setRouterTestState] = useState<TestState>(idleTestState);
  const [captainTestState, setCaptainTestState] = useState<TestState>(idleTestState);
  const [crewTestState, setCrewTestState] = useState<TestState>(idleTestState);

  const captainRecorder = useRoundRecorder();
  const crewRecorder = useRoundRecorder();

  useEffect(() => {
    setConfig(loadAdminRuntimeConfig());
  }, []);

  const handleSave = () => {
    saveAdminRuntimeConfig(config);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  };

  const handleFetchModels = async () => {
    setModelsState({ status: 'loading', message: 'Fetching models...' });
    try {
      saveAdminRuntimeConfig(config);
      const models = await fetchRouterModels();
      setRouterModels(models);
      setModelsState({ status: 'success', message: `${models.length} model(s) loaded.` });
      if (!config.router9Model && models[0]?.id) {
        setConfig((prev) => ({ ...prev, router9Model: models[0].id, router9FallbackModel: prev.router9FallbackModel || models[1]?.id || models[0].id }));
      }
    } catch (error: any) {
      setModelsState({ status: 'error', message: error.message || 'Failed to fetch models.' });
    }
  };

  const handleTestRouter = async () => {
    setRouterTestState({ status: 'loading', message: 'Testing Router9 completion...' });
    try {
      saveAdminRuntimeConfig(config);
      const result = await testRouterCompletion();
      setRouterTestState({ status: 'success', message: `Router9 OK: ${String(result.content || '').trim() || 'No content returned.'}` });
    } catch (error: any) {
      setRouterTestState({ status: 'error', message: error.message || 'Router9 test failed.' });
    }
  };

  const handleCaptainTranscriptionTest = async () => {
    setCaptainTestState({ status: 'loading', message: 'Transcribing Vietnamese sample...' });
    try {
      saveAdminRuntimeConfig(config);
      const blob = captainRecorder.audioBlob || await captainRecorder.stop();
      if (!blob) throw new Error('No Captain sample audio found. Record Vietnamese first.');
      const result = await transcribeRoundAudio(blob, { role: 'captain', language: 'vi' });
      setCaptainTestState({
        status: 'success',
        message: `Vietnamese STT OK • confidence ${(result.confidence || 0).toFixed(2)}`,
        transcript: result.transcript,
      });
    } catch (error: any) {
      setCaptainTestState({ status: 'error', message: error.message || 'Vietnamese STT failed.' });
    }
  };

  const handleCrewTranscriptionTest = async () => {
    setCrewTestState({ status: 'loading', message: 'Transcribing English sample...' });
    try {
      saveAdminRuntimeConfig(config);
      const blob = crewRecorder.audioBlob || await crewRecorder.stop();
      if (!blob) throw new Error('No Crew sample audio found. Record English first.');
      const result = await transcribeRoundAudio(blob, { role: 'crew', language: 'en' });
      setCrewTestState({
        status: 'success',
        message: `English STT OK • confidence ${(result.confidence || 0).toFixed(2)}`,
        transcript: result.transcript,
      });
    } catch (error: any) {
      setCrewTestState({ status: 'error', message: error.message || 'English STT failed.' });
    }
  };

  const deepgramReady = !!config.deepgramApiKey && captainTestState.status === 'success' && crewTestState.status === 'success';
  const routerReady = !!config.router9ApiKey && !!config.router9Model && routerTestState.status === 'success';
  const systemReady = deepgramReady && routerReady;

  const modelOptions = useMemo(() => routerModels.map((model) => model.id), [routerModels]);

  return (
    <main className="screen-shell settings-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Admin settings</p>
          <h1>LLM & STT Config</h1>
        </div>
        <StatusBadge label={systemReady ? 'System Ready' : 'Not Ready'} status={systemReady ? 'ready' : 'not-ready'} />
      </header>

      <section className="settings-card">
        <div className="admin-readiness-grid">
          <div className="admin-mini-card">
            <p className="panel-label">Deepgram</p>
            <StatusBadge label={deepgramReady ? 'Ready' : 'Not Ready'} status={deepgramReady ? 'ready' : 'not-ready'} />
          </div>
          <div className="admin-mini-card">
            <p className="panel-label">Router9</p>
            <StatusBadge label={routerReady ? 'Ready' : 'Not Ready'} status={routerReady ? 'ready' : 'not-ready'} />
          </div>
        </div>

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
            <span>Captain model (Vietnamese)</span>
            <input
              value={config.captainDeepgramModel}
              onChange={(e) => setConfig((prev) => ({ ...prev, captainDeepgramModel: e.target.value }))}
            />
          </label>
          <label>
            <span>Crew model (English)</span>
            <input
              value={config.crewDeepgramModel}
              onChange={(e) => setConfig((prev) => ({ ...prev, crewDeepgramModel: e.target.value }))}
            />
          </label>
        </div>

        <div className="admin-section">
          <p className="panel-label">Deepgram validation</p>

          <div className="admin-test-card">
            <div className="admin-test-header">
              <strong>Captain Vietnamese STT</strong>
              <StatusBadge
                label={captainTestState.status === 'success' ? 'Pass' : captainTestState.status === 'error' ? 'Fail' : 'Pending'}
                status={captainTestState.status === 'success' ? 'success' : captainTestState.status === 'error' ? 'error' : 'idle'}
              />
            </div>
            <p className="admin-note">Record a short Vietnamese sentence, stop, then test transcription.</p>
            <div className="admin-actions-row">
              {!captainRecorder.isRecording ? (
                <button className="secondary-button" onClick={() => void captainRecorder.start()}>Record Vietnamese</button>
              ) : (
                <button className="secondary-button" onClick={() => void captainRecorder.stop()}>Stop Recording</button>
              )}
              <button className="big-action-button" onClick={() => void handleCaptainTranscriptionTest()} disabled={captainTestState.status === 'loading'}>
                {captainTestState.status === 'loading' ? 'Testing...' : 'Test Vietnamese STT'}
              </button>
            </div>
            <p className="admin-test-message">{captainTestState.message}</p>
            {captainTestState.transcript && <p className="admin-transcript-preview">{captainTestState.transcript}</p>}
          </div>

          <div className="admin-test-card">
            <div className="admin-test-header">
              <strong>Crew English STT</strong>
              <StatusBadge
                label={crewTestState.status === 'success' ? 'Pass' : crewTestState.status === 'error' ? 'Fail' : 'Pending'}
                status={crewTestState.status === 'success' ? 'success' : crewTestState.status === 'error' ? 'error' : 'idle'}
              />
            </div>
            <p className="admin-note">Record a short English sentence, stop, then test transcription.</p>
            <div className="admin-actions-row">
              {!crewRecorder.isRecording ? (
                <button className="secondary-button" onClick={() => void crewRecorder.start()}>Record English</button>
              ) : (
                <button className="secondary-button" onClick={() => void crewRecorder.stop()}>Stop Recording</button>
              )}
              <button className="big-action-button" onClick={() => void handleCrewTranscriptionTest()} disabled={crewTestState.status === 'loading'}>
                {crewTestState.status === 'loading' ? 'Testing...' : 'Test English STT'}
              </button>
            </div>
            <p className="admin-test-message">{crewTestState.message}</p>
            {crewTestState.transcript && <p className="admin-transcript-preview">{crewTestState.transcript}</p>}
          </div>
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
          <div className="admin-actions-row">
            <button className="secondary-button" onClick={() => void handleFetchModels()} disabled={modelsState.status === 'loading'}>
              {modelsState.status === 'loading' ? 'Fetching...' : 'Fetch Models'}
            </button>
            <StatusBadge
              label={modelsState.status === 'success' ? 'Models Loaded' : modelsState.status === 'error' ? 'Models Failed' : 'Models Pending'}
              status={modelsState.status === 'success' ? 'success' : modelsState.status === 'error' ? 'error' : 'idle'}
            />
          </div>
          <p className="admin-test-message">{modelsState.message}</p>

          <label>
            <span>Primary model</span>
            {modelOptions.length > 0 ? (
              <select value={config.router9Model} onChange={(e) => setConfig((prev) => ({ ...prev, router9Model: e.target.value }))}>
                <option value="">Select a model</option>
                {modelOptions.map((modelId) => <option key={modelId} value={modelId}>{modelId}</option>)}
              </select>
            ) : (
              <input value={config.router9Model} onChange={(e) => setConfig((prev) => ({ ...prev, router9Model: e.target.value }))} />
            )}
          </label>
          <label>
            <span>Fallback model</span>
            {modelOptions.length > 0 ? (
              <select value={config.router9FallbackModel} onChange={(e) => setConfig((prev) => ({ ...prev, router9FallbackModel: e.target.value }))}>
                <option value="">Select a fallback model</option>
                {modelOptions.map((modelId) => <option key={modelId} value={modelId}>{modelId}</option>)}
              </select>
            ) : (
              <input value={config.router9FallbackModel} onChange={(e) => setConfig((prev) => ({ ...prev, router9FallbackModel: e.target.value }))} />
            )}
          </label>
          <div className="admin-actions-row">
            <button className="big-action-button" onClick={() => void handleTestRouter()} disabled={routerTestState.status === 'loading'}>
              {routerTestState.status === 'loading' ? 'Testing...' : 'Test Router9'}
            </button>
            <StatusBadge
              label={routerTestState.status === 'success' ? 'Pass' : routerTestState.status === 'error' ? 'Fail' : 'Pending'}
              status={routerTestState.status === 'success' ? 'success' : routerTestState.status === 'error' ? 'error' : 'idle'}
            />
          </div>
          <p className="admin-test-message">{routerTestState.message}</p>
        </div>

        <p className="panel-label">Current behavior</p>
        <p className="admin-note">
          Save first, then validate each dependency. The game is only truly ready when Vietnamese STT, English STT, and Router9 all pass.
        </p>

        <button className="big-action-button" onClick={handleSave}>Save admin config</button>
        {saved && <p className="save-hint">Admin config saved.</p>}
      </section>
    </main>
  );
}
