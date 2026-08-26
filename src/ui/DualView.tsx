import type { ReactNode } from 'react';

type DualViewProps = {
  readonly alex: ReactNode;
  readonly sam: ReactNode;
};

/** Fixed capture geometry for the two equal human perspectives. */
export const DualView = ({ alex, sam }: DualViewProps) => (
  <section className="dual-view" aria-label="Alex and Sam sharing one plan">
    <div className="dual-view__side dual-view__side--alex">{alex}</div>
    <div className="dual-view__side dual-view__side--sam">{sam}</div>
  </section>
);
