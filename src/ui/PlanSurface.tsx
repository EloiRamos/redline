import type { CSSProperties } from 'react';
import type {
  PlanSurfaceRowViewModel,
  ProposalGhostViewModel,
  ProposalTimelineGhostViewModel,
} from '../domain/selectors';

type PlanSurfaceProps = {
  readonly rows: readonly PlanSurfaceRowViewModel[];
  readonly proposalCount: number;
};

const barStyle = (startPercent: number, widthPercent: number): CSSProperties =>
  ({
    '--bar-start': `${startPercent}%`,
    '--bar-width': `${widthPercent}%`,
  }) as CSSProperties;

const decisionLabel = (decision: ProposalGhostViewModel['decision']): string => {
  switch (decision) {
    case 'accepted':
      return 'ACCEPTED';
    case 'rejected':
      return 'REJECTED';
    case 'pending':
      return 'PROPOSED';
  }
};

const isTimelineGhost = (
  ghost: ProposalGhostViewModel,
): ghost is ProposalTimelineGhostViewModel => ghost.presentationKind === 'timeline';

export const PlanSurface = ({ rows, proposalCount }: PlanSurfaceProps) => (
  <section className="plan-surface" aria-label="Plan surface">
    <div className="plan-surface__heading">
      <span>Committed plan</span>
      {proposalCount > 0 ? (
        <span className="plan-surface__proposal-label">
          AGENT PROPOSAL · {proposalCount} CHANGES · NOT COMMITTED
        </span>
      ) : (
        <span className="plan-surface__stable-label">Committed · unchanged</span>
      )}
    </div>

    <div className="plan-surface__axis" aria-hidden="true">
      <span>MON</span>
      <span>TUE</span>
      <span>WED</span>
      <span>THU</span>
      <span>FRI</span>
    </div>

    <div className="plan-surface__rows">
      {rows.map((row) => {
        const timelineGhosts = row.ghosts.filter(isTimelineGhost);
        const boundedIndicators = row.ghosts.filter(
          (ghost) => ghost.presentationKind !== 'timeline',
        );

        return (
          <article className="plan-row" key={row.taskId}>
            <div className="plan-row__meta">
              <span className="plan-row__title">{row.title}</span>
              <div className="plan-row__owner-region">
                <span className="plan-row__owner">{row.owner}</span>
                {boundedIndicators.map((indicator) => (
                  <span
                    className={`plan-row__bounded-indicator plan-row__bounded-indicator--${indicator.decision}`}
                    data-decision={indicator.decision}
                    key={indicator.operationId}
                    title={indicator.label}
                  >
                    {indicator.ownerLabel ? `→ ${indicator.ownerLabel}` : indicator.presentationLabel}
                    {' · '}
                    {decisionLabel(indicator.decision)}
                  </span>
                ))}
              </div>
            </div>
            <div className="plan-row__metadata-lane">
              <span className="plan-row__date">{row.dateLabel}</span>
              <div className="plan-row__proposal-keys">
                {timelineGhosts.map((ghost) => (
                  <span
                    className={`plan-row__proposal-key plan-row__proposal-key--${ghost.decision}`}
                    data-decision={ghost.decision}
                    key={ghost.operationId}
                    title={ghost.label}
                  >
                    {ghost.presentationLabel} · {decisionLabel(ghost.decision)}
                  </span>
                ))}
              </div>
            </div>
            <div
              className="plan-row__track"
              style={{ '--timeline-lanes': timelineGhosts.length } as CSSProperties}
            >
            <span
              className="plan-row__committed-bar"
              style={barStyle(row.startPercent, row.widthPercent)}
            />
            {timelineGhosts.map((ghost, index) => (
              <span
                className={`plan-row__ghost-bar plan-row__ghost-bar--${ghost.decision}`}
                data-decision={ghost.decision}
                key={ghost.operationId}
                style={{
                  ...barStyle(ghost.startPercent, ghost.widthPercent),
                  '--ghost-lane': index,
                } as CSSProperties}
              />
            ))}
          </div>
          </article>
        );
      })}
    </div>
  </section>
);
