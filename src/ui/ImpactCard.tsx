import type { ImpactPresentation } from '../domain/selectors';

type ImpactCardProps = {
  readonly impact: ImpactPresentation | null;
};

export const ImpactCard = ({ impact }: ImpactCardProps) => (
  <section className="impact-card" aria-label="Proposal impact">
    <span className="impact-card__eyebrow">PROJECTED IMPACT</span>
    {impact ? (
      <>
        <strong>{impact.headline}</strong>
        <span className={impact.hasQaCompression ? 'impact-card__risk' : undefined}>
          {impact.detail}
        </span>
      </>
    ) : (
      <span>Stage a proposal to compare outcomes.</span>
    )}
  </section>
);
