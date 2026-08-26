import type { LiveViewContract } from '../domain/selectors';

type LiveContextCardProps = {
  readonly view: LiveViewContract;
};

export const LiveContextCard = ({ view }: LiveContextCardProps) => (
  <section className="live-context-card" aria-label={`${view.viewerName}'s live view`}>
    <div className="live-context-card__heading">
      <span>LIVE BROWSER CONTEXT</span>
      <span>{view.viewerRole}</span>
    </div>
    <dl className="live-context-card__grid">
      <div>
        <dt>Filter</dt>
        <dd>{view.activeFilter}</dd>
      </div>
      <div>
        <dt>Selected</dt>
        <dd>{view.selectedTaskCount} tasks</dd>
      </div>
      <div>
        <dt>Range</dt>
        <dd>{view.visibleDateRange.label}</dd>
      </div>
      <div>
        <dt>Plan</dt>
        <dd>Revision {view.planRevision}</dd>
      </div>
    </dl>
  </section>
);
