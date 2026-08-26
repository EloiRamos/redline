import type { ToolStatusPresentation } from '../domain/selectors';

type ToolStatusStripProps = {
  readonly status: ToolStatusPresentation;
};

export const ToolStatusStrip = ({ status }: ToolStatusStripProps) => (
  <ol className="tool-status-strip" aria-label="Proposal lifecycle">
    {status.steps.map((step) => (
      <li className={`tool-status-strip__step tool-status-strip__step--${step.state}`} key={step.label}>
        <span aria-hidden="true" />
        {step.label}
      </li>
    ))}
  </ol>
);
