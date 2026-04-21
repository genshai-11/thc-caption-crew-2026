const { onRequest } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Deepgram-Api-Key, X-Deepgram-Model, x-deepgram-api-key, x-deepgram-model, x-transcript-provider, x-google-api-key, x-google-model, x-google-project-id, x-google-location, x-google-ohm-model, x-thirdparty-transcript-url, x-thirdparty-transcript-api-key, x-thirdparty-transcript-model, x-thirdparty-transcript-auth-scheme, x-ohm-analysis-provider, x-thirdparty-ohm-url, x-thirdparty-ohm-api-key, x-thirdparty-ohm-model, x-thirdparty-ohm-auth-scheme, x-thirdparty-ohm-webhook-url',
  'Access-Control-Max-Age': '3600',
};

function applyCors(res) {
  Object.entries(corsHeaders).forEach(([key, value]) => res.set(key, value));
}

function handleOptions(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return true;
  }
  return false;
}

const defaultSharedConfig = {
  transcriptProvider: 'deepgram',
  partialTranscriptEnabled: false,
  deepgramApiKey: '',
  captainDeepgramModel: 'nova-3',
  crewDeepgramModel: 'nova-3',
  googleApiKey: '',
  googleCloudProjectId: '',
  googleTranscriptModel: 'chirp_3',
  googleTranscriptLocation: 'global',
  googleOhmModel: 'gemini-1.5-flash',
  thirdPartyTranscriptUrl: 'https://ais-dev-msgfyvxutdkvwq3bz4qbhr-148630698694.asia-southeast1.run.app/api/transcribe',
  thirdPartyTranscriptApiKey: '',
  thirdPartyTranscriptModel: '',
  thirdPartyTranscriptAuthScheme: 'bearer',
  ohmAnalysisProvider: 'google',
  thirdPartyOhmUrl: 'https://ais-dev-msgfyvxutdkvwq3bz4qbhr-148630698694.asia-southeast1.run.app/api/analyze-ohm',
  thirdPartyOhmApiKey: '',
  thirdPartyOhmModel: '',
  thirdPartyOhmAuthScheme: 'bearer',
  thirdPartyOhmWebhookUrl: '',
  router9ApiKey: '',
  router9BaseUrl: 'https://rqlaeq5.9router.com/v1',
  router9Model: '',
  router9FallbackModel: '',
  meaningStrictness: 'medium',
  meaningWeight: 100,
  feedbackEnabled: true,
  feedbackMode: 'gentle',
  feedbackTone: 'encouraging',
  showGrammarReminder: false,
  showImprovedSentence: false,
  showWhenMeaningCorrect: false,
  onlyIfAffectsClarity: true,
};

async function getSharedAdminConfig() {
  try {
    const [buffer] = await admin.storage().bucket().file('admin-runtime/shared.json').download();
    const parsed = JSON.parse(buffer.toString('utf-8'));
    return { ...defaultSharedConfig, ...(parsed || {}) };
  } catch (error) {
    const code = String(error?.code || '');
    const message = String(error?.message || '');
    if (code === '404' || message.includes('No such object')) {
      return defaultSharedConfig;
    }
    logger.warn('Could not load shared admin config from Storage', error);
    return defaultSharedConfig;
  }
}

async function callDeepgramListen({ apiKey, model, language, contentType, audioBuffer, detectLanguage = false }) {
  const deepgramUrl = `https://api.deepgram.com/v1/listen?model=${encodeURIComponent(model)}&smart_format=true&punctuate=true&utterances=true&detect_language=${detectLanguage ? 'true' : 'false'}${language ? `&language=${encodeURIComponent(language)}` : ''}`;
  const response = await fetch(deepgramUrl, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': contentType,
    },
    body: audioBuffer,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Deepgram error (${response.status}): ${text}`);
  }

  return await response.json();
}

function parseDurationSeconds(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value || '');
  const matched = text.match(/^(\d+(?:\.\d+)?)s$/);
  if (!matched) return 0;
  return Number(matched[1] || 0);
}

async function callGoogleSpeechTranscribe({ apiKey, model, language, location, projectId, contentType, audioBuffer }) {
  const cleanModel = String(model || 'chirp_3').replace(/^models\//, '');
  const selectedLocation = String(location || 'global');
  const selectedProjectId = String(
    projectId
    || process.env.GCLOUD_PROJECT
    || process.env.GOOGLE_CLOUD_PROJECT
    || process.env.PROJECT_ID
    || ''
  );

  if (!selectedProjectId) {
    throw new Error('Google STT project ID is missing. Set googleCloudProjectId in Admin config or GOOGLE_CLOUD_PROJECT env.');
  }

  const languageCode = language === 'vi' ? 'vi-VN' : language === 'en' ? 'en-US' : 'en-US';
  const base64Audio = Buffer.from(audioBuffer).toString('base64');

  const response = await fetch(
    `https://speech.googleapis.com/v2/projects/${encodeURIComponent(selectedProjectId)}/locations/${encodeURIComponent(selectedLocation)}/recognizers/_:recognize?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        config: {
          autoDecodingConfig: {},
          languageCodes: [languageCode],
          model: cleanModel,
          features: {
            enableAutomaticPunctuation: true,
          },
        },
        content: base64Audio,
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google Speech transcript error (${response.status}): ${body}`);
  }

  const result = await response.json();
  const alternatives = result?.results?.flatMap((entry) => entry?.alternatives || []) || [];
  const transcript = String(alternatives.map((alt) => alt?.transcript || '').join(' ').replace(/\s+/g, ' ').trim());
  const confidenceValues = alternatives
    .map((alt) => Number(alt?.confidence || 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  const confidence = confidenceValues.length > 0
    ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
    : (transcript ? 1 : 0);

  return {
    transcript,
    confidence,
    duration: parseDurationSeconds(result?.metadata?.totalBilledDuration),
    metadata: {
      model: cleanModel,
      requestId: String(result?.metadata?.requestId || result?.metadata?.request_id || ''),
      projectId: selectedProjectId,
      location: selectedLocation,
      mimeType: contentType,
    },
  };
}

function createThirdPartyAuthHeaders(authScheme, apiKey) {
  if (!apiKey || authScheme === 'none') return {};
  if (String(authScheme || '').toLowerCase() === 'x-api-key') {
    return { 'x-api-key': String(apiKey) };
  }
  return { Authorization: 'Bearer ' + String(apiKey) };
}

async function callThirdPartyTranscript({ url, apiKey, authScheme, contentType, audioBuffer }) {
  if (!url) throw new Error('THIRD_PARTY_TRANSCRIPT_URL not configured');
  const payload = {
    audioData: Buffer.from(audioBuffer).toString('base64'),
    mimeType: contentType,
  };

  const response = await fetch(String(url), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...createThirdPartyAuthHeaders(authScheme, apiKey),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error('Third-party transcript error (' + response.status + '): ' + body);
  }

  const result = await response.json();
  return {
    transcript: String(result?.transcript || result?.text || '').trim(),
    confidence: Number(result?.confidence || 0),
    duration: Number(result?.duration || 0),
    modelUsed: String(result?.modelUsed || result?.model || ''),
    requestId: String(result?.requestId || result?.id || ''),
  };
}

async function callThirdPartyOhm({ url, apiKey, authScheme, model, transcript, webhookUrl }) {
  if (!url) throw new Error('THIRD_PARTY_OHM_URL not configured');

  const response = await fetch(String(url), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...createThirdPartyAuthHeaders(authScheme, apiKey),
    },
    body: JSON.stringify({
      transcript,
      settings: {
        ohmBaseValues: { Green: 5, Blue: 7, Red: 9, Pink: 3 },
      },
      webhookUrl: webhookUrl || undefined,
      model: model || undefined,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error('Third-party Ohm error (' + response.status + '): ' + body);
  }

  const result = await response.json();
  return {
    transcriptRaw: String(result?.transcriptRaw || transcript),
    transcriptNormalized: String(result?.transcriptNormalized || ''),
    chunks: Array.isArray(result?.chunks) ? result.chunks : [],
    formula: String(result?.formula || '0'),
    totalOhm: Number(result?.totalOhm || 0),
    modelUsed: String(result?.modelUsed || result?.model || model || ''),
  };
}

function normalizeDeepgramResult(result, meta = {}) {
  const alternative = result?.results?.channels?.[0]?.alternatives?.[0] || {};
  return {
    transcript: alternative.transcript || '',
    words: alternative.words || [],
    confidence: alternative.confidence || 0,
    duration: result?.metadata?.duration || 0,
    requestId: result?.metadata?.request_id || '',
    ...meta,
  };
}

exports.getDeepgramAccessToken = onRequest({ cors: false, invoker: 'public' }, async (req, res) => {
  try {
    if (handleOptions(req, res)) return;
    applyCors(res);

    const sharedConfig = await getSharedAdminConfig();
    const transcriptProvider = String(sharedConfig.transcriptProvider || 'deepgram').toLowerCase();
    const partialEnabled = sharedConfig.partialTranscriptEnabled === true;
    if (transcriptProvider !== 'deepgram' || !partialEnabled) {
      throw new Error('Deepgram live token is disabled because provider is not Deepgram or partial transcript setting is OFF.');
    }
    const apiKey = req.headers['x-deepgram-api-key'] || process.env.DEEPGRAM_API_KEY || sharedConfig.deepgramApiKey;
    if (!apiKey) throw new Error('DEEPGRAM_API_KEY not configured');

    const ttlSeconds = Math.max(30, Math.min(300, Number(req.body?.ttlSeconds || 90) || 90));
    const response = await fetch('https://api.deepgram.com/v1/auth/grant', {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl_seconds: ttlSeconds }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Deepgram token error (${response.status}): ${text}`);
    }

    const token = await response.json();
    res.json({
      accessToken: token?.access_token || '',
      expiresIn: Number(token?.expires_in || ttlSeconds),
    });
  } catch (error) {
    logger.error(error);
    applyCors(res);
    res.status(500).json({ error: error.message || 'Could not create Deepgram token' });
  }
});

exports.transcribeRoundAudio = onRequest({ cors: false, invoker: 'public' }, async (req, res) => {
  try {
    if (handleOptions(req, res)) return;
    applyCors(res);

    const sharedConfig = await getSharedAdminConfig();
    const role = String(req.query.role || 'captain');
    const language = String(req.query.language || (role === 'captain' ? 'vi' : 'en'));
    const transcriptProvider = String(req.headers['x-transcript-provider'] || sharedConfig.transcriptProvider || 'deepgram').toLowerCase();

    const contentType = String(req.headers['content-type'] || 'audio/webm');
    const audioBuffer = req.rawBody;
    const audioBytes = audioBuffer?.length || audioBuffer?.byteLength || 0;

    if (!audioBuffer || !audioBytes) {
      throw new Error('No audio payload received');
    }

    if (transcriptProvider === 'thirdparty') {
      const thirdPartyUrl = String(req.headers['x-thirdparty-transcript-url'] || process.env.THIRD_PARTY_TRANSCRIPT_URL || sharedConfig.thirdPartyTranscriptUrl || '');
      const thirdPartyApiKey = req.headers['x-thirdparty-transcript-api-key'] || process.env.THIRD_PARTY_TRANSCRIPT_API_KEY || sharedConfig.thirdPartyTranscriptApiKey;
      const thirdPartyModel = String(req.headers['x-thirdparty-transcript-model'] || process.env.THIRD_PARTY_TRANSCRIPT_MODEL || sharedConfig.thirdPartyTranscriptModel || '');
      const thirdPartyAuthScheme = String(req.headers['x-thirdparty-transcript-auth-scheme'] || process.env.THIRD_PARTY_TRANSCRIPT_AUTH_SCHEME || sharedConfig.thirdPartyTranscriptAuthScheme || 'bearer').toLowerCase();

      logger.info('STT request received (thirdparty)', { role, language, thirdPartyUrl, thirdPartyModel, contentType, audioBytes });

      const thirdPartyResult = await callThirdPartyTranscript({
        url: thirdPartyUrl,
        apiKey: thirdPartyApiKey,
        authScheme: thirdPartyAuthScheme,
        contentType,
        audioBuffer,
      });

      const transcript = String(thirdPartyResult?.transcript || '').trim();
      res.json({
        transcript,
        words: [],
        confidence: Number(thirdPartyResult?.confidence || (transcript ? 1 : 0)),
        duration: Number(thirdPartyResult?.duration || 0),
        modelRequested: thirdPartyModel,
        modelUsed: String(thirdPartyResult?.modelUsed || thirdPartyModel || ''),
        fallbackUsed: false,
        roleReceived: role,
        languageReceived: language,
        contentTypeReceived: contentType,
        requestId: String(thirdPartyResult?.requestId || ''),
        transcriptProviderUsed: 'thirdparty',
      });
      return;
    }

    if (transcriptProvider === 'google') {
      const googleModel = String(req.headers['x-google-model'] || sharedConfig.googleTranscriptModel || 'chirp_3');
      const googleApiKey = req.headers['x-google-api-key'] || process.env.GOOGLE_API_KEY || sharedConfig.googleApiKey;
      const googleProjectId = String(req.headers['x-google-project-id'] || sharedConfig.googleCloudProjectId || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '');
      const googleLocation = String(req.headers['x-google-location'] || sharedConfig.googleTranscriptLocation || 'global');
      if (!googleApiKey) throw new Error('GOOGLE_API_KEY not configured');

      logger.info('STT request received (google)', { role, language, googleModel, googleLocation, googleProjectId, contentType, audioBytes });

      const googleResult = await callGoogleSpeechTranscribe({
        apiKey: googleApiKey,
        model: googleModel,
        language,
        location: googleLocation,
        projectId: googleProjectId,
        contentType,
        audioBuffer,
      });

      const transcript = String(googleResult?.transcript || '').trim();
      res.json({
        transcript,
        words: [],
        confidence: Number(googleResult?.confidence || (transcript ? 1 : 0)),
        duration: Number(googleResult?.duration || 0),
        modelRequested: googleModel,
        modelUsed: String(googleResult?.metadata?.model || googleModel),
        fallbackUsed: false,
        roleReceived: role,
        languageReceived: language,
        contentTypeReceived: contentType,
        requestId: String(googleResult?.metadata?.requestId || ''),
        transcriptProviderUsed: 'google',
      });
      return;
    }

    const selectedModel = String(
      req.headers['x-deepgram-model'] ||
      (role === 'captain' ? sharedConfig.captainDeepgramModel : sharedConfig.crewDeepgramModel) ||
      'nova-3'
    );
    const apiKey = req.headers['x-deepgram-api-key'] || process.env.DEEPGRAM_API_KEY || sharedConfig.deepgramApiKey;
    if (!apiKey) throw new Error('DEEPGRAM_API_KEY not configured');

    logger.info('STT request received (deepgram)', { role, language, selectedModel, contentType, audioBytes });

    const primaryRaw = await callDeepgramListen({
      apiKey,
      model: selectedModel,
      language,
      contentType,
      audioBuffer,
      detectLanguage: false,
    });

    let normalized = normalizeDeepgramResult(primaryRaw, { modelUsed: selectedModel, fallbackUsed: false });
    logger.info('STT primary result', {
      role,
      language,
      selectedModel,
      transcriptLength: normalized.transcript.length,
      confidence: normalized.confidence,
      duration: normalized.duration,
      words: normalized.words.length,
      requestId: normalized.requestId,
    });

    const shouldFallback = !normalized.transcript.trim() && selectedModel !== 'nova-2';
    if (shouldFallback) {
      logger.warn('STT empty transcript, retrying fallback model', { role, language, selectedModel, contentType, audioBytes });
      const fallbackRaw = await callDeepgramListen({
        apiKey,
        model: 'nova-2',
        language,
        contentType,
        audioBuffer,
        detectLanguage: false,
      });
      const fallbackNormalized = normalizeDeepgramResult(fallbackRaw, { modelUsed: 'nova-2', fallbackUsed: true });
      logger.info('STT fallback result', {
        role,
        language,
        transcriptLength: fallbackNormalized.transcript.length,
        confidence: fallbackNormalized.confidence,
        duration: fallbackNormalized.duration,
        words: fallbackNormalized.words.length,
        requestId: fallbackNormalized.requestId,
      });

      if (fallbackNormalized.transcript.trim()) {
        normalized = fallbackNormalized;
      }
    }

    res.json({
      transcript: normalized.transcript,
      words: normalized.words,
      confidence: normalized.confidence,
      duration: normalized.duration,
      modelRequested: selectedModel,
      modelUsed: normalized.modelUsed,
      fallbackUsed: normalized.fallbackUsed,
      roleReceived: role,
      languageReceived: language,
      contentTypeReceived: contentType,
      requestId: normalized.requestId,
      transcriptProviderUsed: 'deepgram',
    });
  } catch (error) {
    logger.error(error);
    applyCors(res);
    res.status(500).json({ error: error.message || 'Transcription failed' });
  }
});

function extractFirstJsonObject(text) {
  const source = String(text || '').trim();
  if (!source) throw new Error('Empty AI response');
  const fenced = source.match(/```json\s*([\s\S]*?)\s*```/i);
  const raw = fenced?.[1] || source;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('AI response did not contain a JSON object');
  }
  return raw.slice(start, end + 1);
}

exports.analyzeTranscriptOhm = onRequest({ cors: false, invoker: 'public' }, async (req, res) => {
  try {
    if (handleOptions(req, res)) return;
    applyCors(res);

    const transcript = String(req.body?.transcript || '').trim();
    if (!transcript) throw new Error('Transcript is required');

    const sharedConfig = await getSharedAdminConfig();
    const provider = String(req.headers['x-ohm-analysis-provider'] || sharedConfig.ohmAnalysisProvider || 'google').toLowerCase();

    if (provider === 'thirdparty') {
      const thirdPartyOhmUrl = String(req.headers['x-thirdparty-ohm-url'] || process.env.THIRD_PARTY_OHM_URL || sharedConfig.thirdPartyOhmUrl || '');
      const thirdPartyOhmApiKey = req.headers['x-thirdparty-ohm-api-key'] || process.env.THIRD_PARTY_OHM_API_KEY || sharedConfig.thirdPartyOhmApiKey;
      const thirdPartyOhmModel = String(req.headers['x-thirdparty-ohm-model'] || process.env.THIRD_PARTY_OHM_MODEL || sharedConfig.thirdPartyOhmModel || '');
      const thirdPartyOhmAuthScheme = String(req.headers['x-thirdparty-ohm-auth-scheme'] || process.env.THIRD_PARTY_OHM_AUTH_SCHEME || sharedConfig.thirdPartyOhmAuthScheme || 'bearer').toLowerCase();
      const thirdPartyOhmWebhookUrl = String(req.headers['x-thirdparty-ohm-webhook-url'] || process.env.THIRD_PARTY_OHM_WEBHOOK_URL || sharedConfig.thirdPartyOhmWebhookUrl || '');

      const thirdPartyResult = await callThirdPartyOhm({
        url: thirdPartyOhmUrl,
        apiKey: thirdPartyOhmApiKey,
        authScheme: thirdPartyOhmAuthScheme,
        model: thirdPartyOhmModel,
        transcript,
        webhookUrl: thirdPartyOhmWebhookUrl,
      });

      res.json({
        transcriptRaw: thirdPartyResult.transcriptRaw,
        transcriptNormalized: thirdPartyResult.transcriptNormalized,
        chunks: thirdPartyResult.chunks,
        formula: thirdPartyResult.formula,
        totalOhm: thirdPartyResult.totalOhm,
        modelUsed: thirdPartyResult.modelUsed,
      });
      return;
    }

    const model = String(req.headers['x-google-ohm-model'] || req.headers['x-google-model'] || sharedConfig.googleOhmModel || sharedConfig.googleTranscriptModel || 'gemini-1.5-flash');
    const googleApiKey = req.headers['x-google-api-key'] || process.env.GOOGLE_API_KEY || sharedConfig.googleApiKey;
    if (!googleApiKey) throw new Error('GOOGLE_API_KEY not configured');

    const prompt = `You are an expert linguistic analyzer. Analyze the following transcript and extract semantic chunks based on these 4 categories:
- GREEN (5 Ohm): Gap fillers, discourse markers, transition phrases, openers.
- BLUE (7 Ohm): Sentence frames, reusable communication templates (incomplete starter patterns).
- RED (9 Ohm): Idiomatic expressions, figurative language, vivid colloquial sayings.
- PINK (3 Ohm): Key terms, specific concepts, lexical topic units.

CRITICAL RULES:
1) Do not classify everything. Ignore normal speech.
2) BLUE is not catch-all.
3) Common words are not PINK unless specific technical terms.
4) Do not force classification.
5) Extract exact substrings from transcript.
6) Add short reason and confidence (0..1).

Ohm rules:
- Same label: sum
- Different labels: multiply group sums

Transcript:
"${transcript.replace(/\"/g, '\\\"')}"

Return STRICT JSON object:
{
  "transcriptRaw": "original transcript",
  "transcriptNormalized": "lowercase, no punctuation",
  "chunks": [
    {
      "text": "extracted text",
      "label": "GREEN|BLUE|RED|PINK",
      "ohm": number,
      "confidence": number,
      "reason": "short reason"
    }
  ],
  "formula": "(5 + 5) x 9",
  "totalOhm": number
}`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(String(model).replace(/^models\//, ''))}:generateContent?key=${encodeURIComponent(String(googleApiKey))}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0 },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Gemini analyze error (${response.status}): ${body}`);
    }

    const payload = await response.json();
    const answerText = String(payload?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join(' ') || payload?.text || '');
    const parsed = JSON.parse(extractFirstJsonObject(answerText));

    res.json({
      transcriptRaw: String(parsed?.transcriptRaw || transcript),
      transcriptNormalized: String(parsed?.transcriptNormalized || ''),
      chunks: Array.isArray(parsed?.chunks) ? parsed.chunks : [],
      formula: String(parsed?.formula || '0'),
      totalOhm: Number(parsed?.totalOhm || 0),
      modelUsed: String(model),
    });
  } catch (error) {
    logger.error(error);
    applyCors(res);
    res.status(500).json({ error: error.message || 'Transcript analysis failed' });
  }
});

async function callRouterChat({ apiKey, baseUrl, model, fallbackModel, messages, temperature = 0.2, responseFormat }) {
  if (!apiKey) throw new Error('ROUTER9_API_KEY not configured');
  if (!model && !fallbackModel) throw new Error('No Router9 model configured');

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model || fallbackModel,
      temperature,
      stream: false,
      ...(responseFormat ? { response_format: responseFormat } : {}),
      messages,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Router9 error (${response.status}): ${text}`);
  }

  return await response.json();
}

exports.fetchRouterModels = onRequest({ cors: false, invoker: 'public' }, async (req, res) => {
  try {
    if (handleOptions(req, res)) return;
    applyCors(res);

    const sharedConfig = await getSharedAdminConfig();
    const apiKey = req.body.routerApiKey || process.env.ROUTER9_API_KEY || sharedConfig.router9ApiKey;
    const baseUrl = req.body.routerBaseUrl || process.env.ROUTER9_BASE_URL || sharedConfig.router9BaseUrl || 'https://rqlaeq5.9router.com/v1';
    if (!apiKey) throw new Error('ROUTER9_API_KEY not configured');

    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Router9 models error (${response.status}): ${text}`);
    }

    const result = await response.json();
    res.json({ models: Array.isArray(result?.data) ? result.data : [] });
  } catch (error) {
    logger.error(error);
    applyCors(res);
    res.status(500).json({ error: error.message || 'Failed to fetch models' });
  }
});

exports.testRouterCompletion = onRequest({ cors: false, invoker: 'public' }, async (req, res) => {
  try {
    if (handleOptions(req, res)) return;
    applyCors(res);

    const sharedConfig = await getSharedAdminConfig();
    const apiKey = req.body.routerApiKey || process.env.ROUTER9_API_KEY || sharedConfig.router9ApiKey;
    const baseUrl = req.body.routerBaseUrl || process.env.ROUTER9_BASE_URL || sharedConfig.router9BaseUrl || 'https://rqlaeq5.9router.com/v1';
    const model = req.body.model || process.env.ROUTER9_MODEL || sharedConfig.router9Model;
    const fallbackModel = req.body.fallbackModel || process.env.ROUTER9_FALLBACK_MODEL || sharedConfig.router9FallbackModel;

    const completion = await callRouterChat({
      apiKey,
      baseUrl,
      model,
      fallbackModel,
      temperature: 0,
      messages: [
        { role: 'system', content: 'Reply with a single short sentence.' },
        { role: 'user', content: 'Say: Router9 connection OK' },
      ],
    });

    const content = completion?.choices?.[0]?.message?.content || '';
    res.json({ ok: true, content, model: model || fallbackModel || '' });
  } catch (error) {
    logger.error(error);
    applyCors(res);
    res.status(500).json({ error: error.message || 'Router9 completion test failed' });
  }
});

exports.evaluateCaptionCrewMeaning = onRequest({ cors: false, invoker: 'public' }, async (req, res) => {
  try {
    if (handleOptions(req, res)) return;
    applyCors(res);

    const sharedConfig = await getSharedAdminConfig();
    const apiKey = req.body.routerApiKey || process.env.ROUTER9_API_KEY || sharedConfig.router9ApiKey;
    const baseUrl = req.body.routerBaseUrl || process.env.ROUTER9_BASE_URL || sharedConfig.router9BaseUrl || 'https://rqlaeq5.9router.com/v1';
    const model = req.body.model || process.env.ROUTER9_MODEL || sharedConfig.router9Model;
    const fallbackModel = req.body.fallbackModel || process.env.ROUTER9_FALLBACK_MODEL || sharedConfig.router9FallbackModel;

    if (!apiKey) throw new Error('ROUTER9_API_KEY not configured');
    if (!model && !fallbackModel) throw new Error('No Router9 model configured');

    const captainTranscript = String(req.body.captainTranscript || '').trim();
    const crewTranscript = String(req.body.crewTranscript || '').trim();
    const strictness = String(req.body.strictness || sharedConfig.meaningStrictness || 'medium');
    const meaningWeight = typeof req.body.meaningWeight === 'number' ? req.body.meaningWeight : sharedConfig.meaningWeight || 100;
    const feedbackConfig = req.body.feedbackConfig && typeof req.body.feedbackConfig === 'object'
      ? req.body.feedbackConfig
      : {
          enabled: sharedConfig.feedbackEnabled,
          feedbackMode: sharedConfig.feedbackMode,
          tone: sharedConfig.feedbackTone,
          showGrammarReminder: sharedConfig.showGrammarReminder,
          showImprovedSentence: sharedConfig.showImprovedSentence,
          showWhenMeaningCorrect: sharedConfig.showWhenMeaningCorrect,
          onlyIfAffectsClarity: sharedConfig.onlyIfAffectsClarity,
        };

    const feedbackEnabled = feedbackConfig.enabled !== false;
    const feedbackMode = String(feedbackConfig.feedbackMode || 'gentle');
    const feedbackTone = String(feedbackConfig.tone || 'encouraging');
    const showGrammarReminder = feedbackConfig.showGrammarReminder !== false;
    const showImprovedSentence = feedbackConfig.showImprovedSentence !== false;
    const showWhenMeaningCorrect = feedbackConfig.showWhenMeaningCorrect !== false;
    const onlyIfAffectsClarity = feedbackConfig.onlyIfAffectsClarity === true;

    const prompt = `You are evaluating whether an English response preserves the meaning of an original Vietnamese sentence.\n\nScore ONLY by meaning and intent, not by literal word overlap. Natural paraphrases that preserve the same meaning should receive 95-100. Minor grammar mistakes must NOT reduce score unless they change meaning or clarity significantly.\n\nReturn strict JSON only with keys: matchScore, decision, reason, missingConcepts, extraConcepts, grammarNote, improvedTranscript, grammarSeverity, feedbackType.\n- matchScore: integer 0-100 based only on meaning equivalence\n- decision: one of match, partial, mismatch\n- reason: concise explanation focused on meaning\n- missingConcepts: string[] for important missing meaning elements only\n- extraConcepts: string[] for important added meaning only\n- grammarNote: short gentle note, or empty string if no reminder should be shown\n- improvedTranscript: smoother or more natural version, or empty string if not needed\n- grammarSeverity: one of none, minor, medium, major\n- feedbackType: one of off, gentle, balanced, detailed\n\nFeedback policy:\n- Feedback enabled: ${feedbackEnabled}\n- Feedback mode: ${feedbackMode}\n- Tone: ${feedbackTone}\n- Show grammar reminder: ${showGrammarReminder}\n- Show improved sentence: ${showImprovedSentence}\n- Show feedback when meaning is correct: ${showWhenMeaningCorrect}\n- Only show feedback if clarity is affected: ${onlyIfAffectsClarity}\n\nIf feedback is disabled, return empty grammarNote and improvedTranscript, grammarSeverity=none, feedbackType=off.\nIf meaning is correct and feedback is allowed, keep the wording gentle and encouraging.\nIf onlyIfAffectsClarity is true, hide minor grammar reminders that do not affect understanding.\n\nStrictness: ${strictness}\nMeaning weight hint: ${meaningWeight}\nCaptain original Vietnamese: ${captainTranscript}\nCrew English response: ${crewTranscript}`;

    const completion = await callRouterChat({
      apiKey,
      baseUrl,
      model,
      fallbackModel,
      temperature: 0.2,
      responseFormat: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Be concise. Return only valid JSON with the requested keys.' },
        { role: 'user', content: prompt },
      ],
    });

    const raw = completion?.choices?.[0]?.message?.content;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const semanticScore = Math.max(0, Math.min(100, Number(parsed?.matchScore) || 0));

    res.json({
      matchScore: semanticScore,
      decision: parsed?.decision || (semanticScore >= 80 ? 'match' : semanticScore >= 50 ? 'partial' : 'mismatch'),
      reason: parsed?.reason || 'Meaning evaluation completed.',
      missingConcepts: Array.isArray(parsed?.missingConcepts) ? parsed.missingConcepts : [],
      extraConcepts: Array.isArray(parsed?.extraConcepts) ? parsed.extraConcepts : [],
      grammarNote: typeof parsed?.grammarNote === 'string' ? parsed.grammarNote : '',
      improvedTranscript: typeof parsed?.improvedTranscript === 'string' ? parsed.improvedTranscript : '',
      grammarSeverity: ['none', 'minor', 'medium', 'major'].includes(parsed?.grammarSeverity) ? parsed.grammarSeverity : 'none',
      feedbackType: ['off', 'gentle', 'balanced', 'detailed'].includes(parsed?.feedbackType) ? parsed?.feedbackType : (feedbackEnabled ? feedbackMode : 'off'),
    });
  } catch (error) {
    logger.error(error);
    applyCors(res);
    res.status(500).json({ error: error.message || 'Meaning evaluation failed' });
  }
});
