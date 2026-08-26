import type { AttributionPresentation } from '../domain/selectors';

type AttributionBadgeProps = {
  readonly attribution: AttributionPresentation | null;
};

export const AttributionBadge = ({ attribution }: AttributionBadgeProps) => {
  if (!attribution) {
    return null;
  }

  return (
    <section className="attribution-badge" aria-label="Commit attribution">
      <span>{attribution.proposalLabel}</span>
      <span>{attribution.acceptanceLabel}</span>
      <strong>{attribution.summary}</strong>
    </section>
  );
};
