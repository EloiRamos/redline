# REDLINE evidence

These artifacts come from genuine browser execution of the REDLINE fixture. Together, they show a proposal moving from an unchanged committed plan, through page-held human review, to a committed result visible to both participants.

## Lifecycle

| Artifact | What it shows |
| --- | --- |
| [`before.png`](before.png) | Alex and Sam share the committed plan before a proposal exists. |
| [`staged.png`](staged.png) | Five proposed changes are visible but not committed; Sam remains read-only. |
| [`reviewed.png`](reviewed.png) | Alex has reviewed all five operations; the consequence is a Monday launch with full two-day Browser QA. |
| [`after.png`](after.png) | Four accepted operations are committed and the rejected QA compression remains unapplied. |
| [`attribution.png`](attribution.png) | The completed result records the visiting-agent proposal and Alex's accepted subset. |

The `*-lifecycle.png` images are presentation crops of the corresponding lifecycle states for the README sequence. The linked full-size images remain available for closer inspection.

## Contracts and verification

- [`raw/get-current-view.json`](raw/get-current-view.json) shows the page-held live view available to the visiting agent.
- [`raw/propose-changes.json`](raw/propose-changes.json) shows atomic staging of the canonical five-operation proposal.
- [`raw/commit-proposal.json`](raw/commit-proposal.json) shows the human-reviewed commit and its idempotent retry.
- [`raw/test-run.txt`](raw/test-run.txt) records the current 5-file, 31-test suite.
- [`architecture.svg`](architecture.svg) and [`architecture.png`](architecture.png) show the browser-local authority boundary, the three WebMCP tools, and same-origin synchronization.
