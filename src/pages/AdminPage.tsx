import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdminAuth } from '@/auth/AdminAuthContext';
import {
  AdminRuntimeConfig,
  defaultAdminRuntimeConfig,
  loadAdminRuntimeConfig,
  loadSharedAdminRuntimeConfig,
  saveAdminRuntimeConfig,
  saveSharedAdminRuntimeConfig,
} from '@/services/adminConfigRepository';
import { fetchRouterModels, testRouterCompletion, type RouterModelInfo } from '@/services/adminValidationService';
import { transcribeRoundAudio } from '@/services/transcriptionService';
import { useRoundRecorder } from '@/hooks/useRoundRecorder';
import { analyzeTranscript, OhmAnalysisResult } from '@/services/aiService';

interface TestState {
  status: 'idle' | 'loading' | 'success' | 'error';
  message: string;
  transcript?: string;
}

const idleTestState: TestState = {
  status: 'idle',
  message: 'Not tested yet.',
};

function StatusBadge({ label, status }: { label: string; status: TestState['status'] | 'ready' | 'not-ready' | 'loading' }) {
  return <span className={`status-dot status-${status}`}>{label}</span>;
}

export default function AdminPage() {
  const navigate = useNavigate();
  const { user, signOutAdmin } = useAdminAuth();
  const [config, setConfig] = useState<AdminRuntimeConfig>(defaultAdminRuntimeConfig);
  const [saved, setSaved] = useState(false);
  const [cloudStatus, setCloudStatus] = useState<'idle' | 'loading' | 'loaded' | 'saved' | 'error'>('idle');
  const [cloudMessage, setCloudMessage] = useState('');
  const [routerModels, setRouterModels] = useState<RouterModelInfo[]>([]);
  const [modelsState, setModelsState] = useState<TestState>(idleTestState);
  const [routerTestState, setRouterTestState] = useState<TestState>(idleTestState);
  const [captainTestState, setCaptainTestState] = useState<TestState>(idleTestState);
  const [crewTestState, setCrewTestState] = useState<TestState>(idleTestState);
  const [googleCaptainTestState, setGoogleCaptainTestState] = useState<TestState>(idleTestState);
  const [googleCrewTestState, setGoogleCrewTestState] = useState<TestState>(idleTestState);
  const [analysisTranscript, setAnalysisTranscript] = useState('');
  const [analysisResult, setAnalysisResult] = useState<OhmAnalysisResult | null>(null);
  const [analysisState, setAnalysisState] = useState<TestState>(idleTestState);

  const captainRecorder = useRoundRecorder();
  const crewRecorder = useRoundRecorder();

  useEffect(() => {
    setConfig(loadAdminRuntimeConfig());
  }, []);

  useEffect(() => {
    if (!user?.email) return;
    let cancelled = false;
    setCloudStatus('loading');
    setCloudMessage('Loading shared config…');
    loadSharedAdminRuntimeConfig()
      .then((remote) => {
        if (cancelled) return;
        setConfig(remote);
        setCloudStatus('loaded');
        setCloudMessage('Shared config loaded from cloud.');
      })
      .catch((error: any) => {
        if (cancelled) return;
        setCloudStatus('error');
        setCloudMessage(error?.message || 'Could not load shared config. Using local cache.');
      });
    return () => {
      cancelled = true;
    };
  }, [user?.email]);

  const patchConfig = <K extends keyof AdminRuntimeConfig>(key: K, value: AdminRuntimeConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const updateOhmAnalysisPreview = async (transcript: string) => {
    const normalizedTranscript = transcript.trim();
    setAnalysisTranscript(normalizedTranscript);
    if (!normalizedTranscript) {
      setAnalysisResult(null);
      setAnalysisState({ status: 'idle', message: 'No transcript to analyze.' });
      return;
    }

    setAnalysisState({ status: 'loading', message: 'Analyzing transcript with AI…' });
    try {
      const result = await analyzeTranscript(normalizedTranscript, {
        googleApiKey: config.googleApiKey,
        googleModel: config.googleTranscriptModel,
      });
      setAnalysisResult(result);
      setAnalysisState({ status: 'success', message: `Analysis complete • model ${result.modelUsed || config.googleTranscriptModel || 'gemini-1.5-flash'}` });
    } catch (error: any) {
      setAnalysisResult(null);
      setAnalysisState({ status: 'error', message: error?.message || 'Transcript analysis failed.' });
    }
  };

  const handleSave = async () => {
    try {
      setCloudStatus('loading');
      setCloudMessage('Saving shared config…');
      saveAdminRuntimeConfig(config);
      const savedConfig = await saveSharedAdminRuntimeConfig(config);
      setConfig(savedConfig);
      setSaved(true);
      setCloudStatus('saved');
      setCloudMessage('Shared config and public theme saved.');
      window.setTimeout(() => setSaved(false), 1500);
    } catch (error: any) {
      saveAdminRuntimeConfig(config);
      setCloudStatus('error');
      setCloudMessage(error?.message || 'Saved locally, but cloud sync failed.');
    }
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
      const diagnostics = result.fallbackUsed ? ` • fallback ${result.modelUsed}` : ` • ${result.modelUsed || 'primary model'}`;
      setCaptainTestState({
        status: 'success',
        message: `Vietnamese STT OK • confidence ${(result.confidence || 0).toFixed(2)}${diagnostics}` ,
        transcript: result.transcript,
      });
      void updateOhmAnalysisPreview(result.transcript);
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
      if (result.emptyTranscript) {
        const fallbackText = result.fallbackUsed ? ` Fallback tried: ${result.modelUsed}.` : '';
        const echoText = ` Backend received role=${result.roleReceived || 'n/a'}, language=${result.languageReceived || 'n/a'}, contentType=${result.contentTypeReceived || 'n/a'}.`;
        throw new Error(`Audio was recorded but no English speech was recognized.${fallbackText}${echoText} Request: ${result.requestId || 'n/a'}`);
      }
      const diagnostics = result.fallbackUsed ? ` • fallback ${result.modelUsed}` : ` • ${result.modelUsed || 'primary model'}`;
      setCrewTestState({
        status: 'success',
        message: `English STT OK • confidence ${(result.confidence || 0).toFixed(2)}${diagnostics}` ,
        transcript: result.transcript,
      });
      void updateOhmAnalysisPreview(result.transcript);
    } catch (error: any) {
      setCrewTestState({ status: 'error', message: error.message || 'English STT failed.' });
    }
  };

  const handleGoogleCaptainTranscriptionTest = async () => {
    setGoogleCaptainTestState({ status: 'loading', message: 'Testing forced Google STT (Vietnamese)...' });
    try {
      const blob = captainRecorder.audioBlob || await captainRecorder.stop();
      if (!blob) throw new Error('No Captain sample audio found. Record Vietnamese first.');
      const result = await transcribeRoundAudio(blob, {
        role: 'captain',
        language: 'vi',
        providerOverride: 'google',
        googleApiKeyOverride: config.googleApiKey,
        googleModelOverride: config.googleTranscriptModel,
      });

      if (result.emptyTranscript) {
        throw new Error('Google STT returned empty transcript.');
      }

      setGoogleCaptainTestState({
        status: 'success',
        message: `Google STT Vietnamese OK • model ${result.modelUsed || config.googleTranscriptModel || 'gemini-1.5-flash'}`,
        transcript: result.transcript,
      });
      void updateOhmAnalysisPreview(result.transcript);
    } catch (error: any) {
      setGoogleCaptainTestState({ status: 'error', message: error.message || 'Google Vietnamese STT failed.' });
    }
  };

  const handleGoogleCrewTranscriptionTest = async () => {
    setGoogleCrewTestState({ status: 'loading', message: 'Testing forced Google STT (English)...' });
    try {
      const blob = crewRecorder.audioBlob || await crewRecorder.stop();
      if (!blob) throw new Error('No Crew sample audio found. Record English first.');
      const result = await transcribeRoundAudio(blob, {
        role: 'crew',
        language: 'en',
        providerOverride: 'google',
        googleApiKeyOverride: config.googleApiKey,
        googleModelOverride: config.googleTranscriptModel,
      });

      if (result.emptyTranscript) {
        throw new Error('Google STT returned empty transcript.');
      }

      setGoogleCrewTestState({
        status: 'success',
        message: `Google STT English OK • model ${result.modelUsed || config.googleTranscriptModel || 'gemini-1.5-flash'}`,
        transcript: result.transcript,
      });
      void updateOhmAnalysisPreview(result.transcript);
    } catch (error: any) {
      setGoogleCrewTestState({ status: 'error', message: error.message || 'Google English STT failed.' });
    }
  };

  const transcriptReady = config.transcriptProvider === 'google'
    ? !!config.googleApiKey && captainTestState.status === 'success' && crewTestState.status === 'success'
    : !!config.deepgramApiKey && captainTestState.status === 'success' && crewTestState.status === 'success';
  const routerReady = !!config.router9ApiKey && !!config.router9Model && routerTestState.status === 'success';
  const systemReady = transcriptReady && routerReady;

  const modelOptions = useMemo(() => routerModels.map((model) => model.id), [routerModels]);

  return (
    <main className="screen-shell admin-shell">
      <header className="page-header">
        <div>
          <p className="page-kicker">Admin</p>
          <h1 className="page-title">STT + meaning setup</h1>
          {user?.email && <p className="muted-copy">Signed in as {user.email}</p>}
        </div>
        <div className="action-row">
          <StatusBadge label={systemReady ? 'ready' : 'not ready'} status={systemReady ? 'ready' : 'not-ready'} />
          <button className="ghost-pill-button" onClick={async () => { await signOutAdmin(); navigate('/admin-login', { replace: true }); }}>
            Sign out
          </button>
        </div>
      </header>

      <section className="soft-card admin-section-minimal">
        <div className="action-row">
          <span className="soft-label">Cloud sync</span>
          <StatusBadge label={cloudStatus} status={cloudStatus === 'loaded' || cloudStatus === 'saved' ? 'success' : cloudStatus === 'error' ? 'error' : cloudStatus === 'loading' ? 'loading' : 'idle'} />
        </div>
        <p className="admin-message">{cloudMessage || 'Shared config will load after admin sign-in.'}</p>
      </section>

      <section className="admin-grid two-up">
        <article className="soft-card compact">
          <span className="soft-label">Transcript ({config.transcriptProvider === 'google' ? 'Google' : 'Deepgram'})</span>
          <div className="action-row">
            <StatusBadge label={transcriptReady ? 'ready' : 'not ready'} status={transcriptReady ? 'ready' : 'not-ready'} />
            <StatusBadge
              label={config.transcriptProvider === 'deepgram' ? 'streaming available' : 'batch only'}
              status={config.transcriptProvider === 'deepgram' ? 'success' : 'idle'}
            />
          </div>
        </article>
        <article className="soft-card compact">
          <span className="soft-label">Router9</span>
          <StatusBadge label={routerReady ? 'ready' : 'not ready'} status={routerReady ? 'ready' : 'not-ready'} />
        </article>
      </section>

      <section className="soft-card admin-section-minimal">
        <div className="section-title-row">
          <h2 className="section-title">Visual style</h2>
        </div>
        <div className="admin-grid two-up">
          <label className="field-stack">
            <span>Shared app theme</span>
            <select value={config.visualTheme} onChange={(e) => patchConfig('visualTheme', e.target.value as AdminRuntimeConfig['visualTheme'])}>
              <option value="minimal">Minimal</option>
              <option value="bold">Bold</option>
            </select>
          </label>
          <div className="field-stack">
            <span>Theme note</span>
            <p className="admin-message">This is saved as a public visual setting so all devices see the same gameplay style.</p>
          </div>
        </div>
      </section>

      <section className="soft-card admin-section-minimal">
        <div className="section-title-row">
          <h2 className="section-title">Speech to text</h2>
        </div>

        <label className="field-stack">
          <span>Transcript provider</span>
          <select value={config.transcriptProvider} onChange={(e) => patchConfig('transcriptProvider', e.target.value as AdminRuntimeConfig['transcriptProvider'])}>
            <option value="deepgram">Deepgram (streaming + batch)</option>
            <option value="google">Google Gemini (batch transcript)</option>
          </select>
        </label>

        {config.transcriptProvider === 'google' ? (
          <>
            <label className="field-stack">
              <span>Google API key</span>
              <input type="password" value={config.googleApiKey} onChange={(e) => patchConfig('googleApiKey', e.target.value)} />
            </label>
            <label className="field-stack">
              <span>Gemini transcript model</span>
              <input value={config.googleTranscriptModel} onChange={(e) => patchConfig('googleTranscriptModel', e.target.value)} />
            </label>
            <p className="admin-message">Live partial transcript uses Deepgram only. With Google provider, app will transcribe after recording stops.</p>
          </>
        ) : (
          <>
            <label className="field-stack">
              <span>Deepgram API key</span>
              <input type="password" value={config.deepgramApiKey} onChange={(e) => patchConfig('deepgramApiKey', e.target.value)} />
            </label>

            <div className="admin-grid two-up">
              <label className="field-stack">
                <span>Captain model</span>
                <input value={config.captainDeepgramModel} onChange={(e) => patchConfig('captainDeepgramModel', e.target.value)} />
              </label>
              <label className="field-stack">
                <span>Crew model</span>
                <input value={config.crewDeepgramModel} onChange={(e) => patchConfig('crewDeepgramModel', e.target.value)} />
              </label>
            </div>
          </>
        )}
      </section>

      <section className="soft-card admin-section-minimal">
        <div className="section-title-row">
          <h2 className="section-title">Validation</h2>
        </div>
        {config.transcriptProvider === 'google' && (
          <p className="admin-message">Google provider uses batch transcription only. Live streaming is available with Deepgram provider.</p>
        )}

        <div className="admin-test-row">
          <div>
            <p className="soft-label">Captain Vietnamese</p>
            <p className="muted-copy">Record, stop, then test STT.</p>
          </div>
          <StatusBadge label={captainTestState.status === 'success' ? 'pass' : captainTestState.status === 'error' ? 'fail' : 'pending'} status={captainTestState.status === 'success' ? 'success' : captainTestState.status === 'error' ? 'error' : 'idle'} />
        </div>
        <div className="action-row">
          {!captainRecorder.isRecording ? (
            <button className="ghost-pill-button" onClick={() => void captainRecorder.start()}>Record Vietnamese</button>
          ) : (
            <button className="ghost-pill-button" onClick={() => void captainRecorder.stop()}>Stop</button>
          )}
          <button className="primary-pill-button" onClick={() => void handleCaptainTranscriptionTest()} disabled={captainTestState.status === 'loading'}>
            {captainTestState.status === 'loading' ? 'Testing…' : 'Test Vietnamese STT'}
          </button>
        </div>
        <p className="admin-message">{captainTestState.message}</p>
        {captainTestState.transcript && <p className="admin-transcript-preview">{captainTestState.transcript}</p>}

        <div className="admin-divider" />

        <div className="admin-test-row">
          <div>
            <p className="soft-label">Crew English</p>
            <p className="muted-copy">Record, stop, then test STT.</p>
          </div>
          <StatusBadge label={crewTestState.status === 'success' ? 'pass' : crewTestState.status === 'error' ? 'fail' : 'pending'} status={crewTestState.status === 'success' ? 'success' : crewTestState.status === 'error' ? 'error' : 'idle'} />
        </div>
        <div className="action-row">
          {!crewRecorder.isRecording ? (
            <button className="ghost-pill-button" onClick={() => void crewRecorder.start()}>Record English</button>
          ) : (
            <button className="ghost-pill-button" onClick={() => void crewRecorder.stop()}>Stop</button>
          )}
          <button className="primary-pill-button" onClick={() => void handleCrewTranscriptionTest()} disabled={crewTestState.status === 'loading'}>
            {crewTestState.status === 'loading' ? 'Testing…' : 'Test English STT'}
          </button>
        </div>
        <p className="admin-message">{crewTestState.message}</p>
        {crewTestState.transcript && <p className="admin-transcript-preview">{crewTestState.transcript}</p>}

        <div className="admin-divider" />

        <div className="admin-test-row">
          <div>
            <p className="soft-label">Forced Google STT test</p>
            <p className="muted-copy">Always calls Google provider, regardless of selected provider above.</p>
          </div>
          <StatusBadge
            label={googleCaptainTestState.status === 'success' && googleCrewTestState.status === 'success' ? 'pass' : 'pending'}
            status={googleCaptainTestState.status === 'success' && googleCrewTestState.status === 'success' ? 'success' : 'idle'}
          />
        </div>
        <div className="action-row">
          <button className="ghost-pill-button" onClick={() => void handleGoogleCaptainTranscriptionTest()} disabled={googleCaptainTestState.status === 'loading'}>
            {googleCaptainTestState.status === 'loading' ? 'Testing…' : 'Test Google STT (VI)'}
          </button>
          <button className="ghost-pill-button" onClick={() => void handleGoogleCrewTranscriptionTest()} disabled={googleCrewTestState.status === 'loading'}>
            {googleCrewTestState.status === 'loading' ? 'Testing…' : 'Test Google STT (EN)'}
          </button>
        </div>
        <p className="admin-message">{googleCaptainTestState.message}</p>
        {googleCaptainTestState.transcript && <p className="admin-transcript-preview">{googleCaptainTestState.transcript}</p>}
        <p className="admin-message">{googleCrewTestState.message}</p>
        {googleCrewTestState.transcript && <p className="admin-transcript-preview">{googleCrewTestState.transcript}</p>}
      </section>

      <section className="soft-card admin-section-minimal">
        <div className="section-title-row">
          <h2 className="section-title">Transcript → Ohm analysis preview</h2>
        </div>
        <p className="admin-message">Admin flow: transcribe → analyzeTranscript(AI JSON) → render full chunks/reason/confidence/formula/total.</p>
        <p className="admin-message">{analysisState.message}</p>
        {analysisTranscript ? (
          <>
            <p className="admin-transcript-preview">{analysisTranscript}</p>
            {analysisResult ? (
              <>
                <div className="admin-grid two-up">
                  <div className="field-stack">
                    <span>Total Ohm</span>
                    <strong>{analysisResult.totalOhm}</strong>
                  </div>
                  <div className="field-stack">
                    <span>Formula</span>
                    <strong>{analysisResult.formula}</strong>
                  </div>
                  <div className="field-stack">
                    <span>Normalized transcript</span>
                    <strong>{analysisResult.transcriptNormalized || 'n/a'}</strong>
                  </div>
                  <div className="field-stack">
                    <span>Chunks</span>
                    <strong>{analysisResult.chunks.length}</strong>
                  </div>
                </div>
                <div className="field-stack">
                  <span>Detected chunks (AI)</span>
                  {analysisResult.chunks.length > 0 ? (
                    <ul>
                      {analysisResult.chunks.map((chunk, idx) => (
                        <li key={`${chunk.text}-${idx}`} className="admin-message">
                          [{chunk.label}] {chunk.text} • {chunk.ohm}Ω • conf {(Number(chunk.confidence || 0)).toFixed(2)} • {chunk.reason}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="admin-message">No semantic chunks detected.</p>
                  )}
                </div>
              </>
            ) : (
              <p className="admin-message">No AI analysis result yet.</p>
            )}
          </>
        ) : (
          <p className="admin-message">Run any STT test above to preview transcript and AI Ohm analysis.</p>
        )}
      </section>

      <section className="soft-card admin-section-minimal">
        <div className="section-title-row">
          <h2 className="section-title">Router9</h2>
        </div>

        <label className="field-stack">
          <span>API key</span>
          <input type="password" value={config.router9ApiKey} onChange={(e) => patchConfig('router9ApiKey', e.target.value)} />
        </label>
        <label className="field-stack">
          <span>Base URL</span>
          <input value={config.router9BaseUrl} onChange={(e) => patchConfig('router9BaseUrl', e.target.value)} />
        </label>
        <div className="action-row">
          <button className="ghost-pill-button" onClick={() => void handleFetchModels()} disabled={modelsState.status === 'loading'}>
            {modelsState.status === 'loading' ? 'Fetching…' : 'Fetch models'}
          </button>
          <StatusBadge label={modelsState.status === 'success' ? 'loaded' : modelsState.status === 'error' ? 'failed' : 'pending'} status={modelsState.status === 'success' ? 'success' : modelsState.status === 'error' ? 'error' : 'idle'} />
        </div>
        <p className="admin-message">{modelsState.message}</p>

        <div className="admin-grid two-up">
          <label className="field-stack">
            <span>Primary model</span>
            {modelOptions.length > 0 ? (
              <select value={config.router9Model} onChange={(e) => patchConfig('router9Model', e.target.value)}>
                <option value="">Select a model</option>
                {modelOptions.map((modelId) => <option key={modelId} value={modelId}>{modelId}</option>)}
              </select>
            ) : (
              <input value={config.router9Model} onChange={(e) => patchConfig('router9Model', e.target.value)} />
            )}
          </label>
          <label className="field-stack">
            <span>Fallback model</span>
            {modelOptions.length > 0 ? (
              <select value={config.router9FallbackModel} onChange={(e) => patchConfig('router9FallbackModel', e.target.value)}>
                <option value="">Select a fallback model</option>
                {modelOptions.map((modelId) => <option key={modelId} value={modelId}>{modelId}</option>)}
              </select>
            ) : (
              <input value={config.router9FallbackModel} onChange={(e) => patchConfig('router9FallbackModel', e.target.value)} />
            )}
          </label>
        </div>

        <div className="action-row">
          <button className="primary-pill-button" onClick={() => void handleTestRouter()} disabled={routerTestState.status === 'loading'}>
            {routerTestState.status === 'loading' ? 'Testing…' : 'Test Router9'}
          </button>
          <StatusBadge label={routerTestState.status === 'success' ? 'pass' : routerTestState.status === 'error' ? 'fail' : 'pending'} status={routerTestState.status === 'success' ? 'success' : routerTestState.status === 'error' ? 'error' : 'idle'} />
        </div>
        <p className="admin-message">{routerTestState.message}</p>
      </section>

      <section className="soft-card admin-section-minimal">
        <div className="section-title-row">
          <h2 className="section-title">Meaning match</h2>
        </div>

        <div className="admin-grid two-up">
          <label className="field-stack">
            <span>Strictness</span>
            <select value={config.meaningStrictness} onChange={(e) => patchConfig('meaningStrictness', e.target.value as AdminRuntimeConfig['meaningStrictness'])}>
              <option value="loose">Loose</option>
              <option value="medium">Medium</option>
              <option value="strict">Strict</option>
            </select>
          </label>
          <label className="field-stack">
            <span>Meaning weight</span>
            <input type="number" min={0} max={100} value={config.meaningWeight} onChange={(e) => patchConfig('meaningWeight', Number(e.target.value) || 0)} />
          </label>
        </div>

        <div className="admin-grid two-up">
          <label className="field-stack">
            <span>Feedback mode</span>
            <select value={config.feedbackMode} onChange={(e) => patchConfig('feedbackMode', e.target.value as AdminRuntimeConfig['feedbackMode'])}>
              <option value="gentle">Gentle</option>
              <option value="balanced">Balanced</option>
              <option value="detailed">Detailed</option>
            </select>
          </label>
          <label className="field-stack">
            <span>Tone</span>
            <select value={config.feedbackTone} onChange={(e) => patchConfig('feedbackTone', e.target.value as AdminRuntimeConfig['feedbackTone'])}>
              <option value="encouraging">Encouraging</option>
              <option value="neutral">Neutral</option>
              <option value="strict">Strict</option>
            </select>
          </label>
        </div>

        <label className="toggle-row"><input type="checkbox" checked={config.feedbackEnabled} onChange={(e) => patchConfig('feedbackEnabled', e.target.checked)} />Enable feedback</label>
        <label className="toggle-row"><input type="checkbox" checked={config.showGrammarReminder} onChange={(e) => patchConfig('showGrammarReminder', e.target.checked)} />Show grammar reminder</label>
        <label className="toggle-row"><input type="checkbox" checked={config.showImprovedSentence} onChange={(e) => patchConfig('showImprovedSentence', e.target.checked)} />Show improved sentence</label>
        <label className="toggle-row"><input type="checkbox" checked={config.showWhenMeaningCorrect} onChange={(e) => patchConfig('showWhenMeaningCorrect', e.target.checked)} />Show feedback even when meaning is correct</label>
        <label className="toggle-row"><input type="checkbox" checked={config.onlyIfAffectsClarity} onChange={(e) => patchConfig('onlyIfAffectsClarity', e.target.checked)} />Only show feedback if clarity is affected</label>
      </section>

      <div className="action-row sticky-save-row">
        <button className="primary-pill-button" onClick={() => void handleSave()}>Save admin config</button>
        {saved && <span className="save-pill">Saved</span>}
      </div>
    </main>
  );
}
