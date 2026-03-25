import { useCallback, useEffect, useRef, useState } from 'react';
import { evaluateCaptionCrewMeaning } from '@/services/meaningService';
import { defaultGameSettings, loadSettings, saveRound } from '@/services/roundRepository';
import { transcribeRoundAudio } from '@/services/transcriptionService';
import { GameSettings, MeaningEvaluation, RoundRecord, RoundState, TranscriptResult } from '@/types';
import { useRoundRecorder } from './useRoundRecorder';

function createRoundId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useCaptionCrewRound() {
  const captainRecorder = useRoundRecorder();
  const crewRecorder = useRoundRecorder();

  const [state, setState] = useState<RoundState>('captain-ready');
  const [settings, setSettings] = useState<GameSettings>(defaultGameSettings);
  const [captainTranscript, setCaptainTranscript] = useState<TranscriptResult | null>(null);
  const [crewTranscript, setCrewTranscript] = useState<TranscriptResult | null>(null);
  const [evaluation, setEvaluation] = useState<MeaningEvaluation | null>(null);
  const [reactionDelayMs, setReactionDelayMs] = useState<number | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [countdownMs, setCountdownMs] = useState<number | null>(null);

  const captainStoppedAtRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const countdownIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    loadSettings().then(setSettings).catch(() => undefined);
  }, []);

  const clearCrewTimers = useCallback(() => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    if (countdownIntervalRef.current) window.clearInterval(countdownIntervalRef.current);
    timeoutRef.current = null;
    countdownIntervalRef.current = null;
    setCountdownMs(null);
  }, []);

  const resetRound = useCallback(() => {
    captainRecorder.reset();
    crewRecorder.reset();
    setState('captain-ready');
    setCaptainTranscript(null);
    setCrewTranscript(null);
    setEvaluation(null);
    setReactionDelayMs(null);
    setFeedbackError(null);
    captainStoppedAtRef.current = null;
    clearCrewTimers();
  }, [captainRecorder, clearCrewTimers, crewRecorder]);

  const startCaptain = useCallback(async () => {
    resetRound();
    setState('captain-recording');
    await captainRecorder.start();
  }, [captainRecorder, resetRound]);

  const stopCaptain = useCallback(async () => {
    setState('captain-processing');
    const blob = await captainRecorder.stop();
    if (!blob) {
      setFeedbackError('No Captain audio captured.');
      setState('captain-ready');
      return;
    }
    try {
      const result = await transcribeRoundAudio(blob, { role: 'captain', language: 'vi' });
      setCaptainTranscript(result);
      captainStoppedAtRef.current = Date.now();
      setState('crew-waiting');
      setCountdownMs(settings.maxCrewStartDelayMs);
      const waitingStartedAt = Date.now();
      timeoutRef.current = window.setTimeout(() => {
        setReactionDelayMs(Date.now() - (captainStoppedAtRef.current || Date.now()));
        setEvaluation({ matchScore: 0, decision: 'timeout', reason: 'Crew started too late.' });
        setState('crew-timeout');
      }, settings.maxCrewStartDelayMs);
      countdownIntervalRef.current = window.setInterval(() => {
        const elapsed = Date.now() - waitingStartedAt;
        setCountdownMs(Math.max(settings.maxCrewStartDelayMs - elapsed, 0));
      }, 100);
    } catch (error: any) {
      setFeedbackError(error.message || 'Captain transcription failed.');
      setState('captain-ready');
    }
  }, [captainRecorder, settings.maxCrewStartDelayMs]);

  const startCrew = useCallback(async () => {
    if (state !== 'crew-waiting') return;
    const delay = Date.now() - (captainStoppedAtRef.current || Date.now());
    setReactionDelayMs(delay);
    if (delay > settings.maxCrewStartDelayMs) {
      clearCrewTimers();
      setEvaluation({ matchScore: 0, decision: 'timeout', reason: 'Crew started too late.' });
      setState('crew-timeout');
      return;
    }
    clearCrewTimers();
    setState('crew-recording');
    await crewRecorder.start();
  }, [clearCrewTimers, crewRecorder, settings.maxCrewStartDelayMs, state]);

  const stopCrew = useCallback(async () => {
    setState('crew-processing');
    const blob = await crewRecorder.stop();
    if (!blob) {
      setFeedbackError('No Crew audio captured.');
      setState('crew-waiting');
      return;
    }
    try {
      const transcript = await transcribeRoundAudio(blob, { role: 'crew', language: 'en' });
      setCrewTranscript(transcript);
      setState('evaluating');
      const result = await evaluateCaptionCrewMeaning({
        captainTranscript: captainTranscript?.transcript || '',
        crewTranscript: transcript.transcript,
        strictness: settings.strictness,
      });
      setEvaluation(result);
      setState('results');
      const round: RoundRecord = {
        id: createRoundId(),
        createdAt: new Date().toISOString(),
        state: 'results',
        captainTranscript: captainTranscript || undefined,
        crewTranscript: transcript,
        evaluation: result,
        reactionDelayMs: reactionDelayMs || undefined,
        timeoutLost: false,
      };
      await saveRound(round);
    } catch (error: any) {
      setFeedbackError(error.message || 'Crew processing failed.');
      setState('results');
    }
  }, [captainTranscript, crewRecorder, reactionDelayMs, settings.strictness]);

  useEffect(() => {
    return () => clearCrewTimers();
  }, [clearCrewTimers]);

  return {
    state,
    settings,
    setSettings,
    captainRecorder,
    crewRecorder,
    captainTranscript,
    crewTranscript,
    evaluation,
    feedbackError,
    reactionDelayMs,
    countdownMs,
    canStartCaptain: state === 'captain-ready',
    canStartCrew: state === 'crew-waiting',
    startCaptain,
    stopCaptain,
    startCrew,
    stopCrew,
    resetRound,
  };
}