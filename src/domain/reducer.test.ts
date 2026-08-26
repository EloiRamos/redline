import { describe, expect, it } from 'vitest';
import {
  CANONICAL_OPERATION_IDS,
  CANONICAL_OPERATIONS,
  CANONICAL_TASK_IDS,
  createCanonicalRedlineState,
} from './fixture';
import {
  commitProposal,
  resetRedline,
  stageProposal,
  transitionRedlineState,
  updateHumanReview,
} from './reducer';
import type {
  CommitProposalRequest,
  OperationId,
  PlanRevision,
  RedlineState,
  TaskId,
} from './types';

const stageCanonicalProposal = (state = createCanonicalRedlineState()): RedlineState => {
  const transition = stageProposal(state, {
    expectedPlanRevision: state.committedPlan.revision,
    operations: CANONICAL_OPERATIONS,
  });

  expect(transition.result.ok).toBe(true);
  return transition.state;
};

const reviewEveryOperation = (
  stagedState: RedlineState,
  acceptedOperationIds: readonly OperationId[],
): RedlineState => {
  let state = stagedState;

  for (const operation of stagedState.proposal?.operations ?? []) {
    state = updateHumanReview(
      state,
      operation.operationId,
      acceptedOperationIds.includes(operation.operationId) ? 'accepted' : 'rejected',
    ).state;
  }

  return state;
};

const proposalRequestFor = (state: RedlineState): CommitProposalRequest => ({
  proposalId: state.proposal!.id,
  expectedProposalRevision: state.proposal!.revision,
});

const asSam = (state: RedlineState): RedlineState => ({
  ...state,
  currentView: {
    ...state.currentView,
    viewerId: 'sam',
    viewerName: 'Sam',
    viewerRole: 'observer',
  },
});

describe('reducer authority invariants', () => {
  it('staging a proposal never mutates committed state', () => {
    const initial = createCanonicalRedlineState();
    const committedBefore = structuredClone(initial.committedPlan);
    const transition = stageProposal(initial, {
      expectedPlanRevision: initial.committedPlan.revision,
      operations: CANONICAL_OPERATIONS,
    });

    expect(transition.result).toMatchObject({
      ok: true,
      data: { committedStateUnchanged: true },
    });
    expect(transition.state.committedPlan).toBe(initial.committedPlan);
    expect(transition.state.committedPlan).toEqual(committedBefore);
    expect(transition.state.committedPlan.revision).toBe(1);
  });

  it('rejects an invalid batch atomically', () => {
    const initial = createCanonicalRedlineState();
    const invalidOperation = {
      ...CANONICAL_OPERATIONS[0],
      operationId: 'invalid-operation' as OperationId,
      taskId: 'unknown-task' as TaskId,
    };
    const transition = stageProposal(initial, {
      expectedPlanRevision: initial.committedPlan.revision,
      operations: [CANONICAL_OPERATIONS[0], invalidOperation],
    });

    expect(transition.result).toMatchObject({
      ok: false,
      refusal: { code: 'UNKNOWN_TASK' },
    });
    expect(transition.state).toBe(initial);
    expect(transition.state.proposal).toBeNull();
    expect(transition.state.committedPlan.revision).toBe(1);
  });

  it('rejects a stale plan revision atomically', () => {
    const initial = createCanonicalRedlineState();
    const transition = stageProposal(initial, {
      expectedPlanRevision: 2 as PlanRevision,
      operations: CANONICAL_OPERATIONS,
    });

    expect(transition.result).toMatchObject({
      ok: false,
      refusal: { code: 'STALE_PLAN_REVISION' },
    });
    expect(transition.state).toBe(initial);
  });

  it('creates proposal identity in the page from fixture generation and plan revision', () => {
    const staged = stageCanonicalProposal();

    expect(staged.proposal?.id).toBe('proposal-friday-campaign-launch-v1-g0-r1');
    expect(staged.proposal?.id).not.toContain(CANONICAL_OPERATION_IDS.retimeCampaignCopy);
  });

  it('starts every acceptance pending and changes it only through Alex review actions', () => {
    const staged = stageCanonicalProposal();
    const operationId = CANONICAL_OPERATION_IDS.retimeCampaignCopy;
    const reviewed = updateHumanReview(staged, operationId, 'accepted').state;

    expect(staged.acceptanceMap).toEqual({
      [CANONICAL_OPERATION_IDS.retimeCampaignCopy]: 'pending',
      [CANONICAL_OPERATION_IDS.reassignVisuals]: 'pending',
      [CANONICAL_OPERATION_IDS.retimeVisuals]: 'pending',
      [CANONICAL_OPERATION_IDS.retimeBrowserQa]: 'pending',
      [CANONICAL_OPERATION_IDS.compressBrowserQa]: 'pending',
    });
    expect(reviewed.acceptanceMap[operationId]).toBe('accepted');
    expect(staged.acceptanceMap[operationId]).toBe('pending');
  });

  it('commits only human-accepted operations and retains rejected IDs in the receipt', () => {
    const staged = stageCanonicalProposal();
    const accepted = CANONICAL_OPERATIONS.slice(0, 4).map(
      (operation) => operation.operationId,
    );
    const reviewed = reviewEveryOperation(staged, accepted);
    const transition = commitProposal(reviewed, proposalRequestFor(reviewed));

    expect(transition.result).toMatchObject({
      ok: true,
      data: {
        alreadyApplied: false,
        receipt: {
          committedOperationIds: accepted,
          rejectedOperationIds: [CANONICAL_OPERATION_IDS.compressBrowserQa],
          newPlanRevision: 2,
          finalFinishDate: '2026-08-31',
        },
      },
    });
    expect(transition.state.committedPlan.tasks[CANONICAL_TASK_IDS.browserQa].durationDays).toBe(2);
  });

  it('commit input cannot widen the accepted subset', () => {
    const staged = stageCanonicalProposal();
    const accepted = [CANONICAL_OPERATION_IDS.retimeCampaignCopy];
    const reviewed = reviewEveryOperation(staged, accepted);
    const widenedInput = {
      ...proposalRequestFor(reviewed),
      operation_ids: [CANONICAL_OPERATION_IDS.compressBrowserQa],
      acceptance_values: { [CANONICAL_OPERATION_IDS.compressBrowserQa]: 'accepted' },
    } as unknown as CommitProposalRequest;
    const transition = commitProposal(reviewed, widenedInput);

    expect(transition.result).toMatchObject({
      ok: true,
      data: {
        receipt: {
          committedOperationIds: accepted,
          rejectedOperationIds: CANONICAL_OPERATIONS.slice(1).map(
            (operation) => operation.operationId,
          ),
        },
      },
    });
    expect(transition.state.committedPlan.tasks[CANONICAL_TASK_IDS.browserQa].durationDays).toBe(2);
  });

  it('refuses incomplete review without changing proposal or committed state', () => {
    const staged = stageCanonicalProposal();
    const transition = commitProposal(staged, proposalRequestFor(staged));

    expect(transition.result).toMatchObject({
      ok: false,
      refusal: { code: 'REVIEW_INCOMPLETE' },
    });
    expect(transition.state).toBe(staged);
  });

  it('refuses stale proposal and stale plan revisions without mutation', () => {
    const staged = stageCanonicalProposal();
    const onceReviewed = updateHumanReview(
      staged,
      CANONICAL_OPERATION_IDS.retimeCampaignCopy,
      'accepted',
    ).state;
    const staleProposal = commitProposal(onceReviewed, proposalRequestFor(staged));
    const fullyReviewed = reviewEveryOperation(
      staged,
      CANONICAL_OPERATIONS.slice(0, 4).map((operation) => operation.operationId),
    );
    const stalePlanState: RedlineState = {
      ...fullyReviewed,
      committedPlan: {
        ...fullyReviewed.committedPlan,
        revision: 2 as PlanRevision,
      },
    };
    const stalePlan = commitProposal(stalePlanState, proposalRequestFor(fullyReviewed));

    expect(staleProposal.result).toMatchObject({
      ok: false,
      refusal: { code: 'STALE_PROPOSAL' },
    });
    expect(staleProposal.state).toBe(onceReviewed);
    expect(stalePlan.result).toMatchObject({
      ok: false,
      refusal: { code: 'STALE_PLAN_REVISION' },
    });
    expect(stalePlan.state).toBe(stalePlanState);
  });

  it('successful commit increments the plan revision exactly once', () => {
    const staged = stageCanonicalProposal();
    const reviewed = reviewEveryOperation(
      staged,
      CANONICAL_OPERATIONS.slice(0, 4).map((operation) => operation.operationId),
    );
    const committed = commitProposal(reviewed, proposalRequestFor(reviewed));

    expect(committed.state.committedPlan.revision).toBe(2);
    expect(committed.state.lastCommitReceipt?.newPlanRevision).toBe(2);
  });

  it('repeated commit returns the same receipt without mutation', () => {
    const staged = stageCanonicalProposal();
    const reviewed = reviewEveryOperation(
      staged,
      CANONICAL_OPERATIONS.slice(0, 4).map((operation) => operation.operationId),
    );
    const first = commitProposal(reviewed, proposalRequestFor(reviewed));
    const retry = commitProposal(first.state, proposalRequestFor(reviewed));

    expect(first.result).toMatchObject({ ok: true, data: { alreadyApplied: false } });
    expect(retry.result).toMatchObject({ ok: true, data: { alreadyApplied: true } });
    expect(retry.state).toBe(first.state);
    expect(retry.result).toMatchObject({
      ok: true,
      data: { receipt: first.state.lastCommitReceipt },
    });
    expect(retry.state.committedPlan.revision).toBe(2);
  });

  it('reset returns the deterministic Friday campaign fixture', () => {
    const staged = stageCanonicalProposal();
    const reviewed = reviewEveryOperation(
      staged,
      CANONICAL_OPERATIONS.slice(0, 4).map((operation) => operation.operationId),
    );
    const committed = commitProposal(reviewed, proposalRequestFor(reviewed)).state;
    const reset = resetRedline(committed);

    expect(reset.result).toMatchObject({ ok: true, data: { fixtureGeneration: 1 } });
    expect(reset.state).toEqual(createCanonicalRedlineState(1));
    expect(reset.state.committedPlan.revision).toBe(1);
    expect(reset.state.proposal).toBeNull();
    expect(reset.state.lastCommitReceipt).toBeNull();
  });

  it('Sam cannot stage, review, commit, or reset shared state', () => {
    const sam = asSam(createCanonicalRedlineState());
    const stage = stageProposal(sam, {
      expectedPlanRevision: sam.committedPlan.revision,
      operations: CANONICAL_OPERATIONS,
    });
    const review = updateHumanReview(
      sam,
      CANONICAL_OPERATION_IDS.retimeCampaignCopy,
      'accepted',
    );
    const commit = commitProposal(sam, {
      proposalId: 'proposal-friday-campaign-launch-v1-g0-r1' as CommitProposalRequest['proposalId'],
      expectedProposalRevision: 1 as CommitProposalRequest['expectedProposalRevision'],
    });
    const reset = transitionRedlineState(sam, { type: 'RESET_REQUESTED' });

    expect(stage.result).toMatchObject({ ok: false, refusal: { code: 'OBSERVER_READ_ONLY' } });
    expect(stage.state).toBe(sam);
    expect(review.state).toBe(sam);
    expect(commit.result).toMatchObject({ ok: false, refusal: { code: 'OBSERVER_READ_ONLY' } });
    expect(commit.state).toBe(sam);
    expect(reset.state).toBe(sam);
  });
});
