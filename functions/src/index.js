const { onRequest } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const nuanceLexicon = require('./nuanceLexicon.json');

if (!admin.apps.length) {
  admin.initializeApp();
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Deepgram-Api-Key, X-Deepgram-Model, x-deepgram-api-key, x-deepgram-model, x-transcript-provider, x-google-api-key, x-google-model, x-google-models, x-google-project-id, x-google-location, x-google-ohm-model, x-thirdparty-transcript-url, x-thirdparty-transcript-api-key, x-thirdparty-transcript-model, x-thirdparty-transcript-auth-scheme, x-ohm-analysis-provider, x-thirdparty-ohm-url, x-thirdparty-ohm-api-key, x-thirdparty-ohm-model, x-thirdparty-ohm-auth-scheme, x-thirdparty-ohm-webhook-url',
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

const GOOGLE_STT_MODELS = [
  {
    id: 'chirp_3',
    label: 'Chirp 3',
    category: 'multilingual',
    recommended: true,
    description: 'Latest multilingual model with best quality/speed balance for most use cases.',
  },
  {
    id: 'chirp_2',
    label: 'Chirp 2',
    category: 'multilingual',
    recommended: false,
    description: 'Previous generation multilingual model. Useful for compatibility checks.',
  },
  {
    id: 'telephony',
    label: 'Telephony',
    category: 'phone-call',
    recommended: false,
    description: 'Optimized for call-center style audio and narrowband telephony recordings.',
  },
];

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
  ohmModel: 'gpt',
  ohmFallbackModel: 'gpt',
  ohmWeights: { GREEN: 5, BLUE: 7, RED: 9, PINK: 3 },
  ohmLengthConstraints: {
    veryShort: { maxSentences: 1, maxWords: 25 },
    short: { maxSentences: 2, maxWords: 35 },
    medium: { maxSentences: 3, maxWords: 60 },
    long: { maxSentences: 5, maxWords: 110 },
  },
  ohmLengthCoefficients: {
    veryShort: 1,
    short: 1.5,
    medium: 2,
    long: 2.5,
    overLong: 2.5,
  },
  thirdPartyTranscriptUrl: 'https://ais-dev-msgfyvxutdkvwq3bz4qbhr-148630698694.asia-southeast1.run.app/api/transcribe',
  thirdPartyTranscriptApiKey: '',
  thirdPartyTranscriptModel: '',
  thirdPartyTranscriptAuthScheme: 'bearer',
  ohmAnalysisProvider: 'router9',
  thirdPartyOhmUrl: 'https://ais-dev-msgfyvxutdkvwq3bz4qbhr-148630698694.asia-southeast1.run.app/api/analyze-ohm',
  thirdPartyOhmApiKey: '',
  thirdPartyOhmModel: '',
  thirdPartyOhmAuthScheme: 'bearer',
  thirdPartyOhmWebhookUrl: '',
  router9ApiKey: '',
  router9BaseUrl: 'http://34.87.121.108:20128/v1',
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

function normalizeGoogleModelList(rawModels) {
  const explicit = String(rawModels || '')
    .split(',')
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  if (explicit.length > 0) return explicit;
  return GOOGLE_STT_MODELS.map((model) => model.id);
}

function sanitizeSpeechModel(model) {
  return String(model || 'chirp_3')
    .replace(/^models\//, '')
    .trim()
    .replace(/[\s.,;:!?]+$/g, '')
    .toLowerCase();
}

function resolveSpeechLocation(model, location) {
  const cleanModel = sanitizeSpeechModel(model);
  const selected = String(location || 'global').trim().toLowerCase();

  if ((cleanModel === 'chirp_3' || cleanModel === 'chirp_2' || cleanModel.startsWith('chirp_')) && selected === 'global') {
    return 'us';
  }

  return selected || 'us';
}

async function getGcpAccessToken() {
  const metadataUrl = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
  const response = await fetch(metadataUrl, {
    method: 'GET',
    headers: {
      'Metadata-Flavor': 'Google',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Could not obtain GCP access token (${response.status}): ${body}`);
  }

  const payload = await response.json();
  const accessToken = String(payload?.access_token || '');
  if (!accessToken) throw new Error('GCP access token was empty');
  return accessToken;
}

async function callGoogleSpeechTranscribe({ model, language, location, projectId, contentType, audioBuffer }) {
  const cleanModel = sanitizeSpeechModel(model);
  const selectedLocation = resolveSpeechLocation(cleanModel, location);
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

  const accessToken = await getGcpAccessToken();

  const speechHost = selectedLocation === 'global'
    ? 'speech.googleapis.com'
    : `${selectedLocation}-speech.googleapis.com`;

  const response = await fetch(
    `https://${speechHost}/v2/projects/${encodeURIComponent(selectedProjectId)}/locations/${encodeURIComponent(selectedLocation)}/recognizers/_:recognize`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
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
      const googleProjectId = String(req.headers['x-google-project-id'] || sharedConfig.googleCloudProjectId || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '');
      const googleLocation = String(req.headers['x-google-location'] || sharedConfig.googleTranscriptLocation || 'global');

      logger.info('STT request received (google)', { role, language, googleModel, googleLocation, googleProjectId, contentType, audioBytes });

      const googleResult = await callGoogleSpeechTranscribe({
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

function normalizeOhmSettings(sharedConfig = {}) {
  const defaultWeights = { GREEN: 5, BLUE: 7, RED: 9, PINK: 3 };
  const defaultConstraints = {
    veryShort: { maxSentences: 1, maxWords: 25 },
    short: { maxSentences: 2, maxWords: 35 },
    medium: { maxSentences: 3, maxWords: 60 },
    long: { maxSentences: 5, maxWords: 110 },
  };
  const defaultCoefficients = { veryShort: 1, short: 1.5, medium: 2, long: 2.5, overLong: 2.5 };

  return {
    weights: {
      GREEN: Number(sharedConfig?.ohmWeights?.GREEN || defaultWeights.GREEN),
      BLUE: Number(sharedConfig?.ohmWeights?.BLUE || defaultWeights.BLUE),
      RED: Number(sharedConfig?.ohmWeights?.RED || defaultWeights.RED),
      PINK: Number(sharedConfig?.ohmWeights?.PINK || defaultWeights.PINK),
    },
    constraints: {
      veryShort: {
        maxSentences: Number(sharedConfig?.ohmLengthConstraints?.veryShort?.maxSentences || defaultConstraints.veryShort.maxSentences),
        maxWords: Number(sharedConfig?.ohmLengthConstraints?.veryShort?.maxWords || defaultConstraints.veryShort.maxWords),
      },
      short: {
        maxSentences: Number(sharedConfig?.ohmLengthConstraints?.short?.maxSentences || defaultConstraints.short.maxSentences),
        maxWords: Number(sharedConfig?.ohmLengthConstraints?.short?.maxWords || defaultConstraints.short.maxWords),
      },
      medium: {
        maxSentences: Number(sharedConfig?.ohmLengthConstraints?.medium?.maxSentences || defaultConstraints.medium.maxSentences),
        maxWords: Number(sharedConfig?.ohmLengthConstraints?.medium?.maxWords || defaultConstraints.medium.maxWords),
      },
      long: {
        maxSentences: Number(sharedConfig?.ohmLengthConstraints?.long?.maxSentences || defaultConstraints.long.maxSentences),
        maxWords: Number(sharedConfig?.ohmLengthConstraints?.long?.maxWords || defaultConstraints.long.maxWords),
      },
    },
    coefficients: {
      veryShort: Number(sharedConfig?.ohmLengthCoefficients?.veryShort || defaultCoefficients.veryShort),
      short: Number(sharedConfig?.ohmLengthCoefficients?.short || defaultCoefficients.short),
      medium: Number(sharedConfig?.ohmLengthCoefficients?.medium || defaultCoefficients.medium),
      long: Number(sharedConfig?.ohmLengthCoefficients?.long || defaultCoefficients.long),
      overLong: Number(sharedConfig?.ohmLengthCoefficients?.overLong || defaultCoefficients.overLong),
    },
  };
}

function resolveLengthBucket(transcript, constraints = {}) {
  const sentenceCount = String(transcript || '').split(/[.!?\n\r]+/).map((segment) => segment.trim()).filter(Boolean).length || 1;
  const wordCount = String(transcript || '').trim().split(/\s+/).filter(Boolean).length;

  if (sentenceCount <= (constraints.veryShort?.maxSentences || 1) && wordCount <= (constraints.veryShort?.maxWords || 25)) {
    return { sentenceCount, wordCount, lengthBucket: 'veryShort' };
  }
  if (sentenceCount <= (constraints.short?.maxSentences || 2) && wordCount <= (constraints.short?.maxWords || 35)) {
    return { sentenceCount, wordCount, lengthBucket: 'short' };
  }
  if (sentenceCount <= (constraints.medium?.maxSentences || 3) && wordCount <= (constraints.medium?.maxWords || 60)) {
    return { sentenceCount, wordCount, lengthBucket: 'medium' };
  }
  if (sentenceCount <= (constraints.long?.maxSentences || 5) && wordCount <= (constraints.long?.maxWords || 110)) {
    return { sentenceCount, wordCount, lengthBucket: 'long' };
  }
  return { sentenceCount, wordCount, lengthBucket: 'overLong' };
}

function computeOhmFromChunks(chunks = [], weights = { GREEN: 5, BLUE: 7, RED: 9, PINK: 3 }) {
  const values = chunks
    .map((chunk) => {
      const label = String(chunk?.label || '').toUpperCase();
      return Number(weights[label] || 0);
    })
    .filter((value) => Number.isFinite(value) && value > 0);

  if (values.length === 0) {
    return { baseOhm: 0, formula: '0' };
  }

  const baseOhm = values.reduce((acc, value) => acc + value, 0);
  const formula = values.length > 1 ? `(${values.join(' + ')})` : `${values[0]}`;

  return { baseOhm, formula };
}

const OHM_NOISE_TERMS = new Set(['liệu', 'à', 'ạ', 'ơi', 'ơ', 'hả', 'nhé', 'nha', 'nhỉ', 'nhỉ?', 'ừ', 'ừm', 'ok', 'okay', 'đi', 'vớ']);
const OHM_LABEL_PRIORITY = { RED: 4, BLUE: 3, GREEN: 2, PINK: 1 };

function normalizeOhmText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[“”"'`]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLexiconEntryAcceptable(entry) {
  if (!entry || !entry.normalized) return false;
  if (!['GREEN', 'BLUE', 'RED', 'PINK'].includes(entry.label)) return false;
  if (entry.words < 2) return false;
  if (entry.normalized.length < 4) return false;
  if (OHM_NOISE_TERMS.has(entry.normalized)) return false;
  return true;
}

const nuanceLexiconIndex = (() => {
  if (!Array.isArray(nuanceLexicon)) return [];

  const dedup = new Map();
  for (const entry of nuanceLexicon) {
    const normalized = normalizeOhmText(entry?.normalized || entry?.text || '');
    const next = {
      label: String(entry?.label || '').toUpperCase(),
      text: String(entry?.text || '').trim(),
      normalized,
      words: normalized.split(/\s+/).filter(Boolean).length,
    };

    if (!isLexiconEntryAcceptable(next)) continue;

    const prev = dedup.get(next.normalized);
    if (!prev) {
      dedup.set(next.normalized, next);
      continue;
    }

    const prevPriority = OHM_LABEL_PRIORITY[prev.label] || 0;
    const nextPriority = OHM_LABEL_PRIORITY[next.label] || 0;
    if (nextPriority > prevPriority) {
      dedup.set(next.normalized, next);
    }
  }

  return Array.from(dedup.values()).sort((a, b) => b.normalized.length - a.normalized.length);
})();

function detectLexiconChunks(transcript = '', weights = { GREEN: 5, BLUE: 7, RED: 9, PINK: 3 }) {
  const source = normalizeOhmText(transcript);
  if (!source) return [];

  const occupied = [];
  const chunks = [];

  for (const entry of nuanceLexiconIndex) {
    let idx = source.indexOf(entry.normalized);
    while (idx >= 0) {
      const start = idx;
      const end = idx + entry.normalized.length;
      const overlaps = occupied.some((slot) => !(end <= slot.start || start >= slot.end));
      if (!overlaps) {
        if (isLabelChunkAcceptable(entry.label, entry.normalized, transcript, 'lexicon')) {
          occupied.push({ start, end });
          chunks.push({
            text: entry.text,
            label: entry.label,
            ohm: Number(weights[entry.label] || 0),
            confidence: 0.995,
            reason: 'nuance lexicon exact match',
          });
        }
      }
      idx = source.indexOf(entry.normalized, idx + entry.normalized.length);
    }
  }

  return chunks;
}

const PINK_COMMON_PHRASES = new Set(['ngày mai', 'hôm nay', 'bây giờ', 'đi với tôi', 'không tới', 'có đi', 'với tôi']);
const RED_IDIOM_MARKERS = [
  'gieo gió', 'gặt bão', 'đứng núi này trông núi nọ', 'vỏ quýt dày có móng tay nhọn', 'đâm sau lưng',
  'bút sa gà chết', 'xa mặt cách lòng', 'khách hàng là thượng đế', 'chuyện gì tới nó tới', 'đừng đùa với lửa',
  'bữa tiệc nào rồi cũng có lúc tàn', 'im lặng là đồng ý', 'có cái giá', 'đi guốc trong bụng',
  'gần mực thì đen gần đèn thì sáng', 'nói trước bước không qua', 'thời gian sẽ trả lời',
  'đứng núi này', 'trông núi nọ', 'bóp chết từ trong trứng nước', 'tiền nào của đó', 'yêu từ cái nhìn đầu tiên',
  'gừng càng già càng cay'
];
const RED_EXACT_SET = new Set([
  'gần mực thì đen gần đèn thì sáng',
  'gieo gió thì gặt bão',
  'đứng núi này trông núi nọ',
  'vỏ quýt dày có móng tay nhọn',
  'đâm sau lưng',
  'bút sa gà chết',
  'xa mặt cách lòng',
  'nói trước bước không qua',
  'thời gian sẽ trả lời',
  'bóp chết từ trong trứng nước',
  'tiền nào của đó',
  'khách hàng là thượng đế',
  'im lặng là đồng ý',
  'chuyện gì tới nó tới',
  'bữa tiệc nào rồi cũng có lúc tàn',
  'gừng càng già càng cay',
  'có công mài sắt có ngày nên kim'
]);
const RED_COMPOSITE_IDIOMS = [
  'gần mực thì đen gần đèn thì sáng',
  'gieo gió thì gặt bão',
  'đứng núi này trông núi nọ',
  'vỏ quýt dày có móng tay nhọn',
  'bữa tiệc nào rồi cũng có lúc tàn',
  'gừng càng già càng cay',
  'có công mài sắt có ngày nên kim'
];
const BLUE_FRAME_MARKERS = [
  'cậu có', 'bạn có', 'điều gì làm', 'nếu cậu', 'nếu bạn', 'tui nghĩ', 'tôi nghĩ', 'hãy', 'đừng', 'làm sao', 'sao cậu', 'ai mà', 'một mặt', 'mặt khác'
];

const BLUE_EXACT_SET = new Set(
  Array.isArray(nuanceLexicon)
    ? nuanceLexicon
        .filter((entry) => String(entry?.label || '').toUpperCase() === 'BLUE')
        .map((entry) => normalizeOhmText(entry?.normalized || entry?.text || ''))
        .filter(Boolean)
    : []
);

function isSentenceOpener(phraseNormalized = '', transcript = '') {
  if (!phraseNormalized) return false;
  const sentences = String(transcript || '')
    .split(/[.!?\n\r]+/)
    .map((segment) => normalizeOhmText(segment))
    .filter(Boolean);
  return sentences.some((sentence) => sentence.startsWith(phraseNormalized));
}

function isRedIdiomCandidate(normalized = '') {
  if (!normalized) return false;
  if (RED_EXACT_SET.has(normalized)) return true;
  if (RED_IDIOM_MARKERS.some((marker) => normalized.includes(marker))) return true;

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length >= 6 && normalized.includes(' thì ') && normalized.split(' thì ').length >= 3) return true;
  return false;
}

function coerceIdiomLabel(label = '', normalized = '') {
  const next = String(label || '').toUpperCase();
  if (isRedIdiomCandidate(normalized)) return 'RED';
  return next;
}

function isLabelChunkAcceptable(label = '', normalized = '', transcript = '', sourceType = 'model') {
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  if (OHM_NOISE_TERMS.has(normalized)) return false;

  if (label === 'GREEN') {
    return isSentenceOpener(normalized, transcript);
  }

  if (label === 'BLUE') {
    if (sourceType === 'lexicon') {
      return BLUE_EXACT_SET.has(normalized);
    }
    return words.length >= 3 && BLUE_FRAME_MARKERS.some((marker) => normalized.includes(marker));
  }

  if (label === 'RED') {
    return words.length >= 3 && isRedIdiomCandidate(normalized);
  }

  if (label === 'PINK') {
    return words.length >= 2 && !PINK_COMMON_PHRASES.has(normalized);
  }

  return false;
}

function sanitizeOhmChunks(chunks = [], transcript = '') {
  const source = normalizeOhmText(transcript);
  return chunks.filter((chunk) => {
    const text = String(chunk?.text || '').trim();
    if (!text) return false;

    const normalized = normalizeOhmText(text);
    const label = String(chunk?.label || '').toUpperCase();
    if (!source.includes(normalized)) return false;
    return isLabelChunkAcceptable(label, normalized, transcript, 'model');
  });
}

function detectCompositeIdiomChunks(transcript = '', weights = { GREEN: 5, BLUE: 7, RED: 9, PINK: 3 }) {
  const source = normalizeOhmText(transcript);
  const chunks = [];
  for (const idiom of RED_COMPOSITE_IDIOMS) {
    const normalized = normalizeOhmText(idiom);
    if (!normalized || !source.includes(normalized)) continue;
    chunks.push({
      text: idiom,
      label: 'RED',
      ohm: Number(weights.RED || 9),
      confidence: 0.999,
      reason: 'composite idiom exact match',
    });
  }
  return chunks;
}

function mergeLexiconAndModelChunks(compositeChunks = [], lexiconChunks = [], modelChunks = [], transcript = '') {
  const map = new Map();

  for (const chunk of compositeChunks) {
    const normalized = normalizeOhmText(chunk.text);
    const key = `${chunk.label}::${normalized}`;
    map.set(key, chunk);
  }

  for (const chunk of lexiconChunks) {
    const normalized = normalizeOhmText(chunk.text);
    const label = String(chunk.label || '').toUpperCase();
    if (!isLabelChunkAcceptable(label, normalized, transcript, 'lexicon')) continue;
    const key = `${label}::${normalized}`;
    if (!map.has(key)) map.set(key, chunk);
  }

  for (const chunk of modelChunks) {
    const confidence = Number(chunk?.confidence || 0);
    const label = String(chunk?.label || '').toUpperCase();
    const normalized = normalizeOhmText(chunk.text);

    if (confidence < 0.9) continue;
    if (!isLabelChunkAcceptable(label, normalized, transcript, 'model')) continue;

    const key = `${label}::${normalized}`;
    if (!map.has(key)) {
      map.set(key, chunk);
    }
  }

  const items = Array.from(map.values());
  const compositeNorms = compositeChunks.map((c) => normalizeOhmText(c.text));
  if (compositeNorms.length === 0) return items;

  return items.filter((chunk) => {
    const normalized = normalizeOhmText(chunk.text);
    const isComposite = compositeNorms.includes(normalized);
    if (isComposite) return true;
    if (String(chunk.label || '').toUpperCase() !== 'RED') return true;
    return !compositeNorms.some((comp) => comp.includes(normalized));
  });
}

function logOhmTrainingSample(payload) {
  try {
    if (!admin?.firestore) return;
    const enabled = payload?.datasetCaptureEnabled !== false;
    if (!enabled) return;
    const sampleRate = Math.max(0, Math.min(1, Number(payload?.datasetSampleRate ?? 1)));
    if (Math.random() > sampleRate) return;

    const db = admin.firestore();
    db.collection('ohm_training_samples').add({
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      transcript: payload.transcript,
      transcriptNormalized: payload.transcriptNormalized,
      rawModelChunks: payload.rawModelChunks,
      modelChunks: payload.modelChunks,
      lexiconChunks: payload.lexiconChunks,
      mergedChunks: payload.mergedChunks,
      score: {
        baseOhm: payload.baseOhm,
        totalOhm: payload.totalOhm,
        formula: payload.formula,
        lengthBucket: payload.lengthBucket,
        lengthCoefficient: payload.lengthCoefficient,
      },
      model: {
        requested: payload.modelRequested,
        used: payload.modelUsed,
      },
      diagnostics: {
        elapsedMs: payload.elapsedMs,
        sentenceCount: payload.sentenceCount,
        wordCount: payload.wordCount,
        filteredChunkCount: payload.filteredChunkCount,
      },
    }).catch((error) => logger.warn('Could not write ohm training sample', error));
  } catch (error) {
    logger.warn('Unexpected ohm dataset logging error', error);
  }
}

exports.analyzeTranscriptOhm = onRequest({ cors: false, invoker: 'public' }, async (req, res) => {
  try {
    if (handleOptions(req, res)) return;
    applyCors(res);

    const transcript = String(req.body?.transcript || '').trim();
    if (!transcript) throw new Error('Transcript is required');

    const sharedConfig = await getSharedAdminConfig();
    const apiKey = req.body.routerApiKey || process.env.ROUTER9_API_KEY || sharedConfig.router9ApiKey;
    const baseUrl = req.body.routerBaseUrl || process.env.ROUTER9_BASE_URL || sharedConfig.router9BaseUrl || 'http://34.87.121.108:20128/v1';
    const model = String(req.body.model || sharedConfig.ohmModel || sharedConfig.router9Model || process.env.ROUTER9_MODEL || 'gpt').trim();
    const fallbackModel = String(req.body.fallbackModel || sharedConfig.ohmFallbackModel || sharedConfig.router9FallbackModel || process.env.ROUTER9_FALLBACK_MODEL || model).trim();
    const ohmSettings = normalizeOhmSettings(sharedConfig);

    const prompt = `You are an expert linguistic analyzer. Analyze transcript and extract semantic chunks in labels GREEN, BLUE, RED, PINK only.\n\nLabel definitions:\n- GREEN: discourse opener / sentence opener / transition starter.\n- BLUE: reusable sentence frame/pattern with slots.\n- RED: idioms, proverbs, figurative sayings. Proverbs must be RED (never GREEN).\n- PINK: difficult/specific vocabulary terms or collocations (not basic everyday words).\n\nRules:\n1) Do not classify everything. Most words are NORMAL and must be ignored.\n2) Extract exact substrings from transcript only.\n3) Do NOT classify single filler words, particles, or isolated question words (examples: liệu, à, ạ, hả, nhé).\n4) GREEN/BLUE/RED should usually be phrase-level (>= 2 words).\n5) If a phrase is an idiom/proverb, label it RED even if it appears at sentence start.\n6) Return valid JSON object only.\n7) Keep confidence in 0..1.\n\nTranscript:\n${JSON.stringify(transcript)}\n\nReturn JSON with keys: transcriptRaw, transcriptNormalized, chunks.\nEach chunk item must include text, label, confidence, reason.`;

    const startedAt = Date.now();
    const completion = await callRouterChat({
      apiKey,
      baseUrl,
      model,
      fallbackModel,
      temperature: 0,
      timeoutMs: 20000,
      responseFormat: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Return strict JSON. Labels allowed: GREEN, BLUE, RED, PINK.' },
        { role: 'user', content: prompt },
      ],
    });

    const raw = completion?.choices?.[0]?.message?.content;
    const parsed = typeof raw === 'string' ? JSON.parse(extractFirstJsonObject(raw)) : (raw || {});

    const rawChunks = Array.isArray(parsed?.chunks)
      ? parsed.chunks
          .map((chunk) => {
            const text = String(chunk?.text || '');
            const normalized = normalizeOhmText(text);
            const label = coerceIdiomLabel(String(chunk?.label || '').toUpperCase(), normalized);
            return {
              text,
              label,
              ohm: Number(ohmSettings.weights[label] || 0),
              confidence: Number(chunk?.confidence || 0),
              reason: String(chunk?.reason || ''),
            };
          })
          .filter((chunk) => ['GREEN', 'BLUE', 'RED', 'PINK'].includes(chunk.label) && chunk.text)
      : [];

    const modelChunks = sanitizeOhmChunks(rawChunks, transcript);
    const lexiconChunks = detectLexiconChunks(transcript, ohmSettings.weights);
    const compositeChunks = detectCompositeIdiomChunks(transcript, ohmSettings.weights);
    const chunks = mergeLexiconAndModelChunks(compositeChunks, lexiconChunks, modelChunks, transcript);

    const { baseOhm, formula: baseFormula } = computeOhmFromChunks(chunks, ohmSettings.weights);
    const { sentenceCount, wordCount, lengthBucket } = resolveLengthBucket(transcript, ohmSettings.constraints);
    const lengthCoefficient = Number(ohmSettings.coefficients[lengthBucket] || ohmSettings.coefficients.overLong || 2.5);
    const totalOhm = Number((baseOhm * lengthCoefficient).toFixed(4));
    const formula = baseOhm > 0 ? `${baseFormula} x ${lengthCoefficient}` : '0';
    const elapsedMs = Date.now() - startedAt;
    const modelUsed = String(completion?.model || model || fallbackModel || '');
    const transcriptNormalized = String(parsed?.transcriptNormalized || '');

    const responsePayload = {
      transcriptRaw: String(parsed?.transcriptRaw || transcript),
      transcriptNormalized,
      chunks,
      formula,
      totalOhm,
      modelUsed,
      baseOhm,
      lengthBucket,
      lengthCoefficient,
      sentenceCount,
      wordCount,
      elapsedMs,
      filteredChunkCount: Math.max(0, rawChunks.length - modelChunks.length),
      lexiconChunkCount: lexiconChunks.length,
      compositeChunkCount: compositeChunks.length,
    };

    logOhmTrainingSample({
      transcript,
      transcriptNormalized,
      rawModelChunks: rawChunks,
      modelChunks,
      lexiconChunks,
      compositeChunks,
      mergedChunks: chunks,
      baseOhm,
      totalOhm,
      formula,
      lengthBucket,
      lengthCoefficient,
      sentenceCount,
      wordCount,
      elapsedMs,
      filteredChunkCount: responsePayload.filteredChunkCount,
      modelRequested: model,
      modelUsed,
      datasetCaptureEnabled: sharedConfig?.ohmDatasetCaptureEnabled,
      datasetSampleRate: sharedConfig?.ohmDatasetSampleRate,
    });

    res.json(responsePayload);
  } catch (error) {
    logger.error(error);
    applyCors(res);
    res.status(500).json({ error: error.message || 'Transcript analysis failed' });
  }
});


async function callRouterChat({ apiKey, baseUrl, model, fallbackModel, messages, temperature = 0.2, responseFormat, timeoutMs = 20000 }) {
  const cleanApiKey = String(apiKey || '').trim();
  const cleanBaseUrl = String(baseUrl || '').trim();
  if (!cleanApiKey) throw new Error('ROUTER9_API_KEY not configured');
  if (!model && !fallbackModel) throw new Error('No Router9 model configured');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(3000, Number(timeoutMs) || 12000));

  try {
    const response = await fetch(`${cleanBaseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cleanApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || fallbackModel,
        temperature,
        stream: false,
        ...(responseFormat ? { response_format: responseFormat } : {}),
        messages,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Router9 error (${response.status}): ${text}`);
    }

    return await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Router9 request timeout');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

exports.fetchGoogleSttModels = onRequest({ cors: false, invoker: 'public' }, async (req, res) => {
  try {
    if (handleOptions(req, res)) return;
    applyCors(res);

    const sharedConfig = await getSharedAdminConfig();
    const configuredModel = String(sharedConfig.googleTranscriptModel || 'chirp_3');

    res.json({
      models: GOOGLE_STT_MODELS,
      recommendedModel: 'chirp_3',
      configuredModel,
    });
  } catch (error) {
    logger.error(error);
    applyCors(res);
    res.status(500).json({ error: error.message || 'Failed to fetch Google STT models' });
  }
});

exports.testGoogleSttModels = onRequest({ cors: false, invoker: 'public' }, async (req, res) => {
  try {
    if (handleOptions(req, res)) return;
    applyCors(res);

    const sharedConfig = await getSharedAdminConfig();
    const role = String(req.query.role || 'captain');
    const language = String(req.query.language || (role === 'captain' ? 'vi' : 'en'));
    const contentType = String(req.headers['content-type'] || 'audio/webm');
    const audioBuffer = req.rawBody;
    const audioBytes = audioBuffer?.length || audioBuffer?.byteLength || 0;

    if (!audioBuffer || !audioBytes) throw new Error('No audio payload received');

    const googleProjectId = String(req.headers['x-google-project-id'] || sharedConfig.googleCloudProjectId || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '');
    const googleLocation = String(req.headers['x-google-location'] || sharedConfig.googleTranscriptLocation || 'global');
    const requestedModels = normalizeGoogleModelList(req.headers['x-google-models'] || req.body?.models);

    if (!googleProjectId) throw new Error('Google STT project ID is missing');

    logger.info('Testing Google STT models', { role, language, models: requestedModels, googleLocation, googleProjectId, contentType, audioBytes });

    const startedAt = Date.now();
    const results = await Promise.all(requestedModels.map(async (modelId) => {
      const modelStartedAt = Date.now();
      try {
        const result = await callGoogleSpeechTranscribe({
          model: modelId,
          language,
          location: googleLocation,
          projectId: googleProjectId,
          contentType,
          audioBuffer,
        });

        const transcript = String(result?.transcript || '').trim();
        return {
          model: modelId,
          ok: true,
          transcript,
          emptyTranscript: !transcript,
          confidence: Number(result?.confidence || 0),
          duration: Number(result?.duration || 0),
          elapsedMs: Date.now() - modelStartedAt,
          requestId: String(result?.metadata?.requestId || ''),
        };
      } catch (modelError) {
        return {
          model: modelId,
          ok: false,
          transcript: '',
          emptyTranscript: true,
          confidence: 0,
          duration: 0,
          elapsedMs: Date.now() - modelStartedAt,
          error: modelError?.message || String(modelError),
        };
      }
    }));

    const passedModels = results.filter((entry) => entry.ok && !entry.emptyTranscript).map((entry) => entry.model);

    res.json({
      role,
      language,
      location: googleLocation,
      projectId: googleProjectId,
      totalModels: requestedModels.length,
      passedModels,
      elapsedMs: Date.now() - startedAt,
      results,
    });
  } catch (error) {
    logger.error(error);
    applyCors(res);
    res.status(500).json({ error: error.message || 'Google STT model test failed' });
  }
});

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
