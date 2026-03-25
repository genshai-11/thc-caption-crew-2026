import { useCallback, useRef, useState } from 'react';

export function useRoundRecorder() {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef<number | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingTimeMs, setRecordingTimeMs] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    try {
      setError(null);
      setAudioBlob(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      startedAtRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.start();
      setIsRecording(true);
      setRecordingTimeMs(0);
      timerRef.current = window.setInterval(() => {
        if (startedAtRef.current) setRecordingTimeMs(Date.now() - startedAtRef.current);
      }, 100);
    } catch (err: any) {
      setError(err.message || 'Microphone access failed');
    }
  }, []);

  const stop = useCallback(async () => {
    if (!mediaRecorderRef.current) return null;
    return await new Promise<Blob | null>((resolve) => {
      const recorder = mediaRecorderRef.current!;
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        setAudioBlob(blob);
        setIsRecording(false);
        if (timerRef.current) window.clearInterval(timerRef.current);
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;
        resolve(blob);
      };
      recorder.stop();
    });
  }, []);

  const reset = useCallback(() => {
    setAudioBlob(null);
    setRecordingTimeMs(0);
    setError(null);
  }, []);

  return {
    isRecording,
    recordingTimeMs,
    audioBlob,
    error,
    start,
    stop,
    reset,
  };
}