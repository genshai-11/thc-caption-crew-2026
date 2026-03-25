import { useEffect, useState } from 'react';
import { loadRecentRounds } from '@/services/roundRepository';
import { RoundRecord } from '@/types';

export default function HistoryPage() {
  const [rounds, setRounds] = useState<RoundRecord[]>([]);

  useEffect(() => {
    loadRecentRounds().then(setRounds).catch(() => undefined);
  }, []);

  return (
    <main className="screen-shell settings-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">History</p>
          <h1>Recent rounds</h1>
        </div>
      </header>

      <div className="history-list">
        {rounds.length === 0 && <p>No rounds yet.</p>}
        {rounds.map((round) => (
          <article key={round.id} className="history-card">
            <div className="result-header">
              <strong>{new Date(round.createdAt).toLocaleString()}</strong>
              <span className={`decision-pill decision-${round.evaluation?.decision || 'mismatch'}`}>
                {round.evaluation?.decision || round.state}
              </span>
            </div>
            <p><strong>Captain:</strong> {round.captainTranscript?.transcript || '—'}</p>
            <p><strong>Crew:</strong> {round.crewTranscript?.transcript || '—'}</p>
            <p><strong>Meaning:</strong> {round.evaluation?.matchScore ?? 0}</p>
          </article>
        ))}
      </div>
    </main>
  );
}