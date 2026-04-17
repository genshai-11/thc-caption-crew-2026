import { loadAdminRuntimeConfig } from '@/services/adminConfigRepository';
import { getDeepgramAccessToken } from '@/services/transcriptionService';
import { TranscriptResult } from '@/types';

type RoundRole = 'captain' | 'crew';
type RoundLanguage = 'vi' | 'en';

interface DeepgramStreamingSessionOptions {
  role: RoundRole;
  language: RoundLanguage;
  onPartialTranscript?: (transcript: string) => void;
  onStatusChange?: (status: string) => void;
  onError?: (error: Error) => void;
}

function joinTranscript(parts: string[]) {
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function getSelectedModel(role: RoundRole) {
  const config = loadAdminRuntimeConfig();
  return role === 'captain' ? config.captainDeepgramModel || 'nova-3' : config.crewDeepgramModel || 'nova-3';
}

export class DeepgramStreamingSession {
  private readonly role: RoundRole;

  private readonly language: RoundLanguage;

  private readonly model: string;

  private readonly onPartialTranscript?: (transcript: string) => void;

  private readonly onStatusChange?: (status: string) => void;

  private readonly onError?: (error: Error) => void;

  private ws: WebSocket | null = null;

  private readonly queue: Blob[] = [];

  private readonly committedSegments: string[] = [];

  private latestPartial = '';

  private finalized = false;

  private closed = false;

  private connectError: Error | null = null;

  private finalizePromise: Promise<TranscriptResult> | null = null;

  private finalizeResolve: ((result: TranscriptResult) => void) | null = null;

  private finalizeReject: ((error: Error) => void) | null = null;

  private settleTimer: number | null = null;

  private hardStopTimer: number | null = null;

  private confidence = 0;

  private duration = 0;

  private requestId = '';

  private readonly readyPromise: Promise<void>;

  constructor(options: DeepgramStreamingSessionOptions) {
    this.role = options.role;
    this.language = options.language;
    this.model = getSelectedModel(options.role);
    this.onPartialTranscript = options.onPartialTranscript;
    this.onStatusChange = options.onStatusChange;
    this.onError = options.onError;
    this.emitStatus('connecting live transcript…');
    this.readyPromise = this.connect();
  }

  private emitStatus(status: string) {
    this.onStatusChange?.(status);
  }

  private emitPartial() {
    const transcript = joinTranscript([...this.committedSegments, this.latestPartial].filter(Boolean));
    this.onPartialTranscript?.(transcript);
  }

  private handleFailure(error: Error) {
    this.connectError = error;
    this.emitStatus('live transcript unavailable — batch fallback will verify after stop');
    this.onError?.(error);
    if (this.finalizeReject && !this.finalized) {
      this.finalizeReject(error);
      this.finalizeReject = null;
      this.finalizeResolve = null;
    }
  }

  private async connect() {
    try {
      const config = loadAdminRuntimeConfig();
      if (config.transcriptProvider === 'google') {
        throw new Error('Live streaming is currently available only with Deepgram provider. Falling back to batch transcript.');
      }
      const token = await getDeepgramAccessToken();
      const url = new URL('wss://api.deepgram.com/v1/listen');
      url.searchParams.set('model', this.model);
      url.searchParams.set('language', this.language);
      url.searchParams.set('smart_format', 'true');
      url.searchParams.set('punctuate', 'true');
      url.searchParams.set('utterances', 'true');
      url.searchParams.set('interim_results', 'true');
      url.searchParams.set('vad_events', 'true');
      url.searchParams.set('endpointing', '300');

      this.ws = new WebSocket(url.toString(), ['bearer', token.accessToken]);
      this.ws.binaryType = 'blob';

      await new Promise<void>((resolve, reject) => {
        if (!this.ws) {
          reject(new Error('Deepgram streaming socket was not created'));
          return;
        }

        this.ws.onopen = () => {
          this.emitStatus('live transcript listening…');
          while (this.queue.length > 0) {
            const chunk = this.queue.shift();
            if (chunk) this.ws?.send(chunk);
          }
          resolve();
        };

        this.ws.onerror = () => {
          reject(new Error('Deepgram streaming connection failed'));
        };

        this.ws.onclose = () => {
          this.closed = true;
          if (this.finalized && this.finalizeResolve) {
            this.completeFinalize();
          }
        };

        this.ws.onmessage = (event) => {
          if (typeof event.data !== 'string') return;
          let payload: any;
          try {
            payload = JSON.parse(event.data);
          } catch {
            return;
          }

          const type = String(payload?.type || '');
          if (type === 'Metadata') {
            this.requestId = String(payload?.request_id || payload?.metadata?.request_id || this.requestId || '');
            return;
          }

          if (type === 'Results') {
            const alternative = payload?.channel?.alternatives?.[0] || payload?.results?.channels?.[0]?.alternatives?.[0] || {};
            const transcript = String(alternative?.transcript || '').trim();
            this.confidence = Number(alternative?.confidence || this.confidence || 0);
            this.duration = Number(payload?.duration || payload?.metadata?.duration || this.duration || 0);

            if (payload?.is_final) {
              if (transcript) this.committedSegments.push(transcript);
              this.latestPartial = '';
              this.emitPartial();
              this.emitStatus('live transcript finalized');
            } else {
              this.latestPartial = transcript;
              this.emitPartial();
              if (transcript) this.emitStatus('hearing speech…');
            }

            if (this.finalized) {
              this.scheduleSettle(250);
            }
            return;
          }

          if (type === 'UtteranceEnd' && this.finalized) {
            this.scheduleSettle(150);
            return;
          }

          if (type === 'Error') {
            this.handleFailure(new Error(String(payload?.description || payload?.message || 'Deepgram streaming error')));
          }
        };
      });
    } catch (error: any) {
      this.handleFailure(error instanceof Error ? error : new Error(error?.message || 'Deepgram streaming setup failed'));
      throw error;
    }
  }

  sendAudioChunk(chunk: Blob) {
    if (this.closed) return;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(chunk);
      return;
    }
    this.queue.push(chunk);
  }

  private scheduleSettle(delayMs: number) {
    if (this.settleTimer) window.clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => {
      this.completeFinalize();
    }, delayMs);
  }

  private completeFinalize() {
    if (!this.finalizeResolve) return;

    if (this.settleTimer) {
      window.clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }

    if (this.hardStopTimer) {
      window.clearTimeout(this.hardStopTimer);
      this.hardStopTimer = null;
    }

    const transcript = joinTranscript([...this.committedSegments, this.latestPartial].filter(Boolean));
    const result: TranscriptResult = {
      transcript,
      confidence: this.confidence,
      duration: this.duration,
      source: 'streaming',
      modelRequested: this.model,
      modelUsed: this.model,
      fallbackUsed: false,
      requestId: this.requestId,
      emptyTranscript: !transcript.trim(),
      roleReceived: this.role,
      languageReceived: this.language,
      contentTypeReceived: 'audio/webm;codecs=opus',
    };

    this.emitStatus(result.emptyTranscript ? 'live transcript empty — batch verification pending' : 'live transcript ready');

    try {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'CloseStream' }));
        this.ws.close();
      }
    } catch {
      // ignore socket close errors
    }

    const resolve = this.finalizeResolve;
    this.finalizeResolve = null;
    this.finalizeReject = null;
    resolve(result);
  }

  async finalize() {
    if (this.finalizePromise) return this.finalizePromise;

    this.finalized = true;
    this.emitStatus('finalizing live transcript…');

    this.finalizePromise = new Promise<TranscriptResult>((resolve, reject) => {
      this.finalizeResolve = resolve;
      this.finalizeReject = reject;

      const beginFinalize = () => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          reject(this.connectError || new Error('Deepgram streaming socket is not connected'));
          return;
        }

        try {
          this.ws.send(JSON.stringify({ type: 'Finalize' }));
          this.scheduleSettle(500);
          this.hardStopTimer = window.setTimeout(() => {
            this.completeFinalize();
          }, 2500);
        } catch (error: any) {
          reject(error instanceof Error ? error : new Error(error?.message || 'Could not finalize Deepgram streaming transcript'));
        }
      };

      if (this.ws?.readyState === WebSocket.OPEN) {
        beginFinalize();
        return;
      }

      this.readyPromise
        .then(beginFinalize)
        .catch((error) => {
          reject(error instanceof Error ? error : new Error('Deepgram streaming failed before finalize'));
        });
    });

    return this.finalizePromise;
  }

  close() {
    if (this.settleTimer) window.clearTimeout(this.settleTimer);
    if (this.hardStopTimer) window.clearTimeout(this.hardStopTimer);
    this.queue.length = 0;
    this.latestPartial = '';
    try {
      this.ws?.close();
    } catch {
      // ignore close failures
    }
    this.closed = true;
  }
}

export function createDeepgramStreamingSession(options: DeepgramStreamingSessionOptions) {
  return new DeepgramStreamingSession(options);
}
