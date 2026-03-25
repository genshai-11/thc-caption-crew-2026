const { onRequest } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');

exports.transcribeRoundAudio = onRequest({ cors: true }, async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return res.status(204).send('');

    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) throw new Error('DEEPGRAM_API_KEY not configured');

    const role = String(req.query.role || 'captain');
    const language = String(req.query.language || (role === 'captain' ? 'vi' : 'en'));
    const model = role === 'captain' ? 'nova-2' : 'nova-2';

    const deepgramUrl = `https://api.deepgram.com/v1/listen?model=${model}&smart_format=true&punctuate=true&detect_language=false&language=${language}`;
    const response = await fetch(deepgramUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': req.headers['content-type'] || 'audio/webm',
      },
      body: req.rawBody,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Deepgram error (${response.status}): ${text}`);
    }

    const result = await response.json();
    const alternative = result?.results?.channels?.[0]?.alternatives?.[0] || {};

    res.json({
      transcript: alternative.transcript || '',
      words: alternative.words || [],
      confidence: alternative.confidence || 0,
      duration: result?.metadata?.duration || 0,
    });
  } catch (error) {
    logger.error(error);
    res.status(500).json({ error: error.message || 'Transcription failed' });
  }
});

exports.evaluateCaptionCrewMeaning = onRequest({ cors: true }, async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return res.status(204).send('');

    const apiKey = process.env.ROUTER9_API_KEY;
    const baseUrl = process.env.ROUTER9_BASE_URL || 'https://rqlaeq5.9router.com/v1';
    const model = process.env.ROUTER9_MODEL || req.body.model;
    const fallbackModel = process.env.ROUTER9_FALLBACK_MODEL || req.body.fallbackModel;

    if (!apiKey) throw new Error('ROUTER9_API_KEY not configured');
    if (!model && !fallbackModel) throw new Error('No Router9 model configured');

    const captainTranscript = String(req.body.captainTranscript || '').trim();
    const crewTranscript = String(req.body.crewTranscript || '').trim();
    const strictness = String(req.body.strictness || 'medium');

    const prompt = `You are evaluating whether an English response preserves the meaning of an original Vietnamese sentence.\n\nReturn strict JSON only with keys: matchScore, decision, reason, missingConcepts, extraConcepts.\n- matchScore: integer 0-100\n- decision: match | partial | mismatch\n- reason: concise explanation\n- missingConcepts: string[]\n- extraConcepts: string[]\n\nStrictness: ${strictness}\nCaptain original Vietnamese: ${captainTranscript}\nCrew English response: ${crewTranscript}`;

    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || fallbackModel,
        temperature: 0.2,
        stream: false,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Return only valid JSON.' },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Router9 error (${response.status}): ${text}`);
    }

    const completion = await response.json();
    const raw = completion?.choices?.[0]?.message?.content;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;

    res.json({
      matchScore: Math.max(0, Math.min(100, Number(parsed?.matchScore) || 0)),
      decision: parsed?.decision || 'mismatch',
      reason: parsed?.reason || 'Meaning evaluation completed.',
      missingConcepts: Array.isArray(parsed?.missingConcepts) ? parsed.missingConcepts : [],
      extraConcepts: Array.isArray(parsed?.extraConcepts) ? parsed.extraConcepts : [],
    });
  } catch (error) {
    logger.error(error);
    res.status(500).json({ error: error.message || 'Meaning evaluation failed' });
  }
});