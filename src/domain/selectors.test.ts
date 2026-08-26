import { describe, expect, it } from 'vitest';
import { CANONICAL_OPERATIONS, createCanonicalRedlineState } from './fixture';
import { stageProposal } from './reducer';
import {
  selectDualViewPresentation,
  selectProposalGhosts,
} from './selectors';

const stagedCanonicalState = () => {
  const initial = createCanonicalRedlineState();

  return stageProposal(initial, {
    expectedPlanRevision: initial.committedPlan.revision,
    operations: CANONICAL_OPERATIONS,
  }).state;
};

describe('plan-surface presentation', () => {
  it('represents reassignment as a bounded owner indicator with no timeline geometry', () => {
    const reassignment = selectProposalGhosts(stagedCanonicalState()).find(
      (ghost) => ghost.operationId === 'op-reassign-polish-visuals',
    );

    expect(reassignment).toMatchObject({
      presentationKind: 'owner',
      presentationLabel: 'OWNER',
      ownerLabel: 'Maya',
      startPercent: null,
      widthPercent: null,
    });
  });

  it('maps each timeline operation independently to deterministic integer geometry', () => {
    const ghosts = selectProposalGhosts(stagedCanonicalState());
    const browserRetime = ghosts.find(
      (ghost) => ghost.operationId === 'op-retime-browser-qa',
    );
    const browserDuration = ghosts.find(
      (ghost) => ghost.operationId === 'op-compress-browser-qa',
    );

    expect(browserRetime).toMatchObject({
      presentationKind: 'timeline',
      presentationLabel: 'DATE',
      startPercent: 55,
      widthPercent: 18,
    });
    expect(browserDuration).toMatchObject({
      presentationKind: 'timeline',
      presentationLabel: 'DURATION',
      startPercent: 55,
      widthPercent: 9,
    });

    for (const ghost of ghosts) {
      if (ghost.presentationKind === 'timeline') {
        expect(Number.isInteger(ghost.startPercent)).toBe(true);
        expect(Number.isInteger(ghost.widthPercent)).toBe(true);
      }
    }
  });

  it('keeps Alex and Sam plan projections identical apart from authority identity', () => {
    const presentation = selectDualViewPresentation(stagedCanonicalState());

    expect(presentation.alex.planRows).toEqual(presentation.sam.planRows);
    expect(presentation.alex.ghosts).toEqual(presentation.sam.ghosts);
    expect(presentation.alex.review).toEqual(presentation.sam.review);
    expect(presentation.alex.impact).toEqual(presentation.sam.impact);
    expect(presentation.alex.identity).toMatchObject({
      viewerName: 'Alex',
      viewerRole: 'reviewer',
    });
    expect(presentation.sam.identity).toMatchObject({
      viewerName: 'Sam',
      viewerRole: 'observer',
    });
  });
});
