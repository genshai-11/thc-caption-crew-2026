import { RolePanel } from '@/components/RolePanel';
import { ResultCard } from '@/components/ResultCard';
import { useCaptionCrewRound } from '@/hooks/useCaptionCrewRound';

function formatCountdown(ms: number | null) {
  if (ms == null) return '';
  return `Crew starts in ${(ms / 1000).toFixed(1)}s`;
}

export default function GamePage() {
  const round = useCaptionCrewRound();

  return (
    <main className="screen-shell mobile-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">THC</p>
          <h1>Caption & Crew</h1>
        </div>
        <div className="status-chip">{round.state}</div>
      </header>

      {round.feedbackError && <div className="inline-error">{round.feedbackError}</div>}

      <section className="timer-strip">
        <div>
          <p className="panel-label">Rule</p>
          <p>Crew must start within {(round.settings.maxCrewStartDelayMs / 1000).toFixed(1)}s after Captain stops.</p>
        </div>
        <div>
          <p className="panel-label">Countdown</p>
          <p>{round.settings.showCountdown && round.countdownMs != null ? `${(round.countdownMs / 1000).toFixed(1)}s` : '—'}</p>
        </div>
      </section>

      <div className="role-stack">
        <RolePanel
          role="captain"
          title="Captain"
          color="green"
          transcript={round.captainTranscript?.transcript}
          recording={round.captainRecorder.isRecording}
          disabled={!round.canStartCaptain}
          processing={round.state === 'captain-processing'}
          actionLabel="Start green"
          onStart={() => void round.startCaptain()}
          onStop={() => void round.stopCaptain()}
        />

        <RolePanel
          role="crew"
          title="Crew"
          color="red"
          transcript={round.crewTranscript?.transcript}
          recording={round.crewRecorder.isRecording}
          disabled={!round.canStartCrew}
          processing={round.state === 'crew-processing' || round.state === 'evaluating'}
          countdownLabel={round.state === 'crew-waiting' ? formatCountdown(round.countdownMs) : undefined}
          actionLabel="Start red"
          onStart={() => void round.startCrew()}
          onStop={() => void round.stopCrew()}
        />
      </div>

      <ResultCard
        captainTranscript={round.captainTranscript}
        crewTranscript={round.crewTranscript}
        evaluation={round.evaluation}
        reactionDelayMs={round.reactionDelayMs}
      />

      <div className="footer-actions">
        <button className="secondary-button" onClick={round.resetRound}>Reset round</button>
      </div>
    </main>
  );
}