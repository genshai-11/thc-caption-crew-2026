import { MeaningEvaluation, TranscriptResult } from '@/types';

interface ResultCardProps {
  captainTranscript: TranscriptResult | null;
  crewTranscript: TranscriptResult | null;
  evaluation: MeaningEvaluation | null;
  reactionDelayMs: number | null;
}

export function ResultCard({ captainTranscript, crewTranscript, evaluation, reactionDelayMs }: ResultCardProps) {
  if (!evaluation && !captainTranscript && !crewTranscript) {
    return null;
  }

  return (
    <section className="result-card">
      <div className="result-header">
        <h3>Round result</h3>
        {evaluation && <span className={`decision-pill decision-${evaluation.decision}`}>{evaluation.decision}</span>}
      </div>

      <div className="result-grid">
        <div>
          <p className="panel-label">Captain source (Vietnamese)</p>
          <p>{captainTranscript?.transcript || '—'}</p>
        </div>
        <div>
          <p className="panel-label">Crew response (English)</p>
          <p>{crewTranscript?.transcript || '—'}</p>
        </div>
      </div>

      <div className="score-row">
        <div>
          <p className="panel-label">Meaning score</p>
          <p className="score-value">{evaluation?.matchScore ?? 0}</p>
        </div>
        <div>
          <p className="panel-label">Reaction delay</p>
          <p>{reactionDelayMs != null ? `${(reactionDelayMs / 1000).toFixed(2)}s` : '—'}</p>
        </div>
      </div>

      {evaluation?.reason && (
        <div>
          <p className="panel-label">Reason</p>
          <p>{evaluation.reason}</p>
        </div>
      )}
    </section>
  );
}