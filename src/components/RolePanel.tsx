import { Loader2, Mic, Square } from 'lucide-react';

interface RolePanelProps {
  role: 'captain' | 'crew';
  title: string;
  color: 'blue' | 'red';
  transcript?: string;
  recording: boolean;
  disabled: boolean;
  processing?: boolean;
  countdownLabel?: string;
  actionLabel?: string;
  onStart: () => void;
  onStop: () => void;
}

export function RolePanel({
  role,
  title,
  color,
  transcript,
  recording,
  disabled,
  processing,
  countdownLabel,
  actionLabel,
  onStart,
  onStop,
}: RolePanelProps) {
  const classes = color === 'blue' ? 'role-panel role-panel-blue' : 'role-panel role-panel-red';

  return (
    <section className={classes}>
      <div className="role-header">
        <div>
          <p className="role-eyebrow">{role.toUpperCase()}</p>
          <h2>{title}</h2>
        </div>
        {countdownLabel && <span className="role-badge">{countdownLabel}</span>}
      </div>

      <div className="role-actions">
        {!recording ? (
          <button className="big-action-button" disabled={disabled || processing} onClick={onStart}>
            {processing ? <Loader2 size={20} className="spin" /> : <Mic size={20} />}
            {actionLabel || 'Start'}
          </button>
        ) : (
          <button className="big-action-button stop" onClick={onStop}>
            <Square size={20} />
            Stop
          </button>
        )}
      </div>

      <div className="role-transcript">
        <p className="panel-label">Transcript</p>
        <p>{transcript || 'Waiting...'}</p>
      </div>
    </section>
  );
}