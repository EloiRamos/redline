import {
  applyProposalOperations,
  calculateImpact,
  isIsoDate,
} from './impact';
import { createCanonicalRedlineState } from './fixture';
import type {
  CommitAppliedResult,
  CommitReceipt,
  CommitReceiptId,
  CommitProposalRequest,
  CommittedPlan,
  DomainResult,
  HumanAcceptanceMap,
  IsoDateTime,
  OperationId,
  PlanRevision,
  Proposal,
  ProposalId,
  ProposalOperation,
  ProposalRevision,
  ProposalStagedResult,
  RedlineAction,
  RedlineState,
  RefusalCode,
  StageProposalRequest,
  StructuredRefusal,
  Task,
  TaskId,
  TaskOwner,
} from './types';

const asProposalId = (value: string) => value as ProposalId;
const asProposalRevision = (value: number) => value as ProposalRevision;
const asPlanRevision = (value: number) => value as PlanRevision;
const asIsoDateTime = (value: string) => value as IsoDateTime;

const DEFAULT_ACCEPTED_AT = asIsoDateTime('2026-08-26T12:00:00.000Z');

export type ReducerDependencies = {
  readonly acceptedAt: IsoDateTime;
};

export const deterministicReducerDependencies: ReducerDependencies = {
  acceptedAt: DEFAULT_ACCEPTED_AT,
};

export type DomainTransition<Value> = {
  readonly state: RedlineState;
  readonly result: DomainResult<Value>;
};

type ReviewResult = {
  readonly proposalId: ProposalId;
  readonly proposalRevision: ProposalRevision;
};

type ResetResult = {
  readonly fixtureGeneration: RedlineState['fixtureGeneration'];
};

const refusal = (code: RefusalCode, message: string): StructuredRefusal => ({
  code,
  message,
});

const failedTransition = <Value>(
  state: RedlineState,
  code: RefusalCode,
  message: string,
): DomainTransition<Value> => ({
  state,
  result: { ok: false, refusal: refusal(code, message) },
});

const successfulTransition = <Value>(
  state: RedlineState,
  data: Value,
): DomainTransition<Value> => ({ state, result: { ok: true, data } });

const isReviewer = (state: RedlineState): boolean =>
  state.currentView.viewerId === 'alex' &&
  state.currentView.viewerRole === 'reviewer';

const isKnownOwner = (owner: string): owner is TaskOwner =>
  ['Alex', 'Casey', 'Maya', 'Priya', 'Sam'].includes(owner);

const hasDependencyCycle = (plan: CommittedPlan): boolean => {
  const visited = new Set<TaskId>();
  const visiting = new Set<TaskId>();

  const visit = (taskId: TaskId): boolean => {
    if (visiting.has(taskId)) {
      return true;
    }

    if (visited.has(taskId)) {
      return false;
    }

    const task = plan.tasks[taskId];

    if (!task) {
      return true;
    }

    visiting.add(taskId);
    const hasCycle = task.dependencyIds.some(visit);

    visiting.delete(taskId);
    visited.add(taskId);
    return hasCycle;
  };

  return plan.taskOrder.some(visit);
};

const validateOperation = (
  plan: CommittedPlan,
  operation: ProposalOperation,
): StructuredRefusal | null => {
  if (
    !operation.operationId ||
    !operation.rationale ||
    operation.rationale.trim().length > 240
  ) {
    return refusal('INVALID_OPERATION', 'Each operation needs an ID and short rationale.');
  }

  const task = plan.tasks[operation.taskId];

  if (!task) {
    return refusal('UNKNOWN_TASK', 'The proposal references a task that is not in the plan.');
  }

  switch (operation.type) {
    case 'retime_task':
      return isIsoDate(operation.newStartDate)
        ? null
        : refusal('INVALID_OPERATION', 'A retimed task needs a valid ISO date.');
    case 'reassign_task':
      return isKnownOwner(operation.newOwner)
        ? null
        : refusal('INVALID_OPERATION', 'A reassignment needs a known fixture owner.');
    case 'change_duration':
      return Number.isInteger(operation.newDurationDays) && operation.newDurationDays > 0
        ? null
        : refusal('INVALID_OPERATION', 'A task duration must be a positive whole day.');
    case 'split_task': {
      const validSegments =
        operation.segments.length === 2 &&
        operation.segments.every(
          (segment) =>
            segment.title.trim().length > 0 &&
            Number.isInteger(segment.durationDays) &&
            segment.durationDays > 0,
        );
      const segmentDuration = operation.segments.reduce(
        (total, segment) => total + segment.durationDays,
        0,
      );

      return validSegments && segmentDuration === task.durationDays
        ? null
        : refusal(
            'INVALID_OPERATION',
            'A task split needs two positive segments that preserve its duration.',
          );
    }
    case 'add_dependency': {
      if (!plan.tasks[operation.dependsOnTaskId]) {
        return refusal('UNKNOWN_TASK', 'The dependency task is not in the plan.');
      }

      if (
        operation.taskId === operation.dependsOnTaskId ||
        task.dependencyIds.includes(operation.dependsOnTaskId)
      ) {
        return refusal('INVALID_OPERATION', 'The dependency must be new and cannot self-reference.');
      }

      return null;
    }
  }
};

const validateProposalBatch = (
  plan: CommittedPlan,
  operations: readonly ProposalOperation[],
  priorReceipt: RedlineState['lastCommitReceipt'],
): StructuredRefusal | null => {
  if (operations.length < 1 || operations.length > 6) {
    return refusal('BATCH_TOO_LARGE', 'A proposal must contain one to six operations.');
  }

  const operationIds = new Set<OperationId>();
  const previouslyUsedOperationIds = new Set<OperationId>([
    ...(priorReceipt?.committedOperationIds ?? []),
    ...(priorReceipt?.rejectedOperationIds ?? []),
  ]);
  let projectedPlan = plan;

  for (const operation of operations) {
    if (operationIds.has(operation.operationId) || previouslyUsedOperationIds.has(operation.operationId)) {
      return refusal('DUPLICATE_OPERATION_ID', 'Each proposal operation ID must be unique.');
    }

    operationIds.add(operation.operationId);
    const invalidOperation = validateOperation(projectedPlan, operation);

    if (invalidOperation) {
      return invalidOperation;
    }

    projectedPlan = applyProposalOperations(projectedPlan, [operation]);

    if (hasDependencyCycle(projectedPlan)) {
      return refusal('INVALID_OPERATION', 'The proposal cannot create a dependency cycle.');
    }
  }

  return null;
};

const proposalIdFor = (state: RedlineState): ProposalId =>
  asProposalId(
    `proposal-${state.committedPlan.fixtureId}-g${state.fixtureGeneration}-r${state.committedPlan.revision}`,
  );

const initialAcceptanceMap = (
  operations: readonly ProposalOperation[],
): HumanAcceptanceMap =>
  Object.fromEntries(
    operations.map((operation) => [operation.operationId, 'pending']),
  ) as HumanAcceptanceMap;

const cloneOperation = (operation: ProposalOperation): ProposalOperation => {
  switch (operation.type) {
    case 'split_task':
      return {
        ...operation,
        segments: [
          { ...operation.segments[0] },
          { ...operation.segments[1] },
        ],
      };
    case 'retime_task':
    case 'reassign_task':
    case 'change_duration':
    case 'add_dependency':
      return { ...operation };
  }
};

const allReviewDecisionsMade = (acceptanceMap: HumanAcceptanceMap): boolean =>
  Object.values(acceptanceMap).every((decision) => decision !== 'pending');

const acceptedOperations = (
  proposal: Proposal,
  acceptanceMap: HumanAcceptanceMap,
): readonly ProposalOperation[] =>
  proposal.operations.filter(
    (operation) => acceptanceMap[operation.operationId] === 'accepted',
  );

const rejectedOperationIds = (
  proposal: Proposal,
  acceptanceMap: HumanAcceptanceMap,
): readonly OperationId[] =>
  proposal.operations
    .filter((operation) => acceptanceMap[operation.operationId] === 'rejected')
    .map((operation) => operation.operationId);

export const stageProposal = (
  state: RedlineState,
  request: StageProposalRequest,
): DomainTransition<ProposalStagedResult> => {
  if (!isReviewer(state)) {
    return failedTransition(
      state,
      'OBSERVER_READ_ONLY',
      'Only Alex can stage a proposal in this view.',
    );
  }

  if (request.expectedPlanRevision !== state.committedPlan.revision) {
    return failedTransition(
      state,
      'STALE_PLAN_REVISION',
      'The plan changed before this proposal could be staged.',
    );
  }

  if (state.proposal) {
    return failedTransition(
      state,
      'PROPOSAL_ALREADY_OPEN',
      'Resolve the current proposal before staging another one.',
    );
  }

  const invalidBatch = validateProposalBatch(
    state.committedPlan,
    request.operations,
    state.lastCommitReceipt,
  );

  if (invalidBatch) {
    return { state, result: { ok: false, refusal: invalidBatch } };
  }

  const proposal: Proposal = {
    id: proposalIdFor(state),
    revision: asProposalRevision(1),
    basePlanRevision: state.committedPlan.revision,
    operations: request.operations.map(cloneOperation),
    stagedImpact: calculateImpact(state.committedPlan, request.operations),
    proposedBy: 'visiting-agent',
    lifecycleStatus: 'staged',
  };
  const acceptanceMap = initialAcceptanceMap(request.operations);
  const nextState: RedlineState = {
    ...state,
    proposal,
    acceptanceMap,
    lifecycle: 'proposal_staged',
  };

  return successfulTransition(nextState, {
    proposalId: proposal.id,
    proposalRevision: proposal.revision,
    stagedOperationIds: proposal.operations.map((operation) => operation.operationId),
    committedStateUnchanged: true,
    impact: proposal.stagedImpact,
  });
};

export const updateHumanReview = (
  state: RedlineState,
  operationId: OperationId,
  decision: 'accepted' | 'rejected',
): DomainTransition<ReviewResult> => {
  if (!isReviewer(state) || !state.proposal || !state.acceptanceMap[operationId]) {
    return successfulTransition(state, {
      proposalId: state.proposal?.id ?? asProposalId('no-active-proposal'),
      proposalRevision: state.proposal?.revision ?? asProposalRevision(0),
    });
  }

  if (state.acceptanceMap[operationId] === decision) {
    return successfulTransition(state, {
      proposalId: state.proposal.id,
      proposalRevision: state.proposal.revision,
    });
  }

  const acceptanceMap: HumanAcceptanceMap = {
    ...state.acceptanceMap,
    [operationId]: decision,
  };
  const complete = allReviewDecisionsMade(acceptanceMap);
  const proposal: Proposal = {
    ...state.proposal,
    revision: asProposalRevision(state.proposal.revision + 1),
    lifecycleStatus: complete ? 'ready_to_commit' : 'in_review',
  };
  const nextState: RedlineState = {
    ...state,
    proposal,
    acceptanceMap,
    lifecycle: complete ? 'ready_to_commit' : 'review_in_progress',
  };

  return successfulTransition(nextState, {
    proposalId: proposal.id,
    proposalRevision: proposal.revision,
  });
};

export const commitProposal = (
  state: RedlineState,
  request: CommitProposalRequest,
  dependencies: ReducerDependencies = deterministicReducerDependencies,
): DomainTransition<CommitAppliedResult> => {
  if (!isReviewer(state)) {
    return failedTransition(
      state,
      'OBSERVER_READ_ONLY',
      'Only Alex can commit reviewed proposal changes.',
    );
  }

  const priorReceipt = state.lastCommitReceipt;

  if (
    priorReceipt &&
    priorReceipt.proposalId === request.proposalId &&
    priorReceipt.proposalRevision === request.expectedProposalRevision
  ) {
    return successfulTransition(state, { receipt: priorReceipt, alreadyApplied: true });
  }

  if (!state.proposal) {
    return failedTransition(
      state,
      'PROPOSAL_NOT_FOUND',
      'There is no active proposal with that identity.',
    );
  }

  if (state.proposal.id !== request.proposalId) {
    return failedTransition(
      state,
      'PROPOSAL_NOT_FOUND',
      'The requested proposal is not the active proposal.',
    );
  }

  if (state.proposal.revision !== request.expectedProposalRevision) {
    return failedTransition(
      state,
      'STALE_PROPOSAL',
      'The proposal review changed before commit.',
    );
  }

  if (state.proposal.basePlanRevision !== state.committedPlan.revision) {
    return failedTransition(
      state,
      'STALE_PLAN_REVISION',
      'The committed plan changed before this proposal was committed.',
    );
  }

  if (!allReviewDecisionsMade(state.acceptanceMap)) {
    return failedTransition(
      state,
      'REVIEW_INCOMPLETE',
      'Every proposed operation needs a human decision before commit.',
    );
  }

  const accepted = acceptedOperations(state.proposal, state.acceptanceMap);

  if (accepted.length === 0) {
    return failedTransition(
      state,
      'NO_ACCEPTED_OPERATIONS',
      'At least one operation must be accepted before commit.',
    );
  }

  const finalImpact = calculateImpact(state.committedPlan, accepted);
  const appliedPlan = applyProposalOperations(state.committedPlan, accepted);
  const committedPlan: CommittedPlan = {
    ...appliedPlan,
    revision: asPlanRevision(state.committedPlan.revision + 1),
  };
  const receipt: CommitReceipt = {
    receiptId: `receipt-${state.proposal.id}-${state.proposal.revision}` as CommitReceiptId,
    receiptState: 'applied' as const,
    proposalId: state.proposal.id,
    proposalRevision: state.proposal.revision,
    committedOperationIds: accepted.map((operation) => operation.operationId),
    rejectedOperationIds: rejectedOperationIds(state.proposal, state.acceptanceMap),
    newPlanRevision: committedPlan.revision,
    finalFinishDate: finalImpact.projectedFinishDate,
    attribution: {
      proposalId: state.proposal.id,
      proposalRevision: state.proposal.revision,
      proposedBy: 'visiting-agent' as const,
      acceptedBy: 'Alex' as const,
      acceptedAt: dependencies.acceptedAt,
    },
  };
  const nextState: RedlineState = {
    ...state,
    committedPlan,
    proposal: null,
    acceptanceMap: {},
    lastCommitReceipt: receipt,
    lifecycle: 'commit_applied',
  };

  return successfulTransition(nextState, { receipt, alreadyApplied: false });
};

export const resetRedline = (
  state: RedlineState,
): DomainTransition<ResetResult> => {
  if (!isReviewer(state)) {
    return successfulTransition(state, { fixtureGeneration: state.fixtureGeneration });
  }

  const resetState = createCanonicalRedlineState(state.fixtureGeneration + 1);
  const nextState: RedlineState = {
    ...resetState,
    compatibilityStatus: state.compatibilityStatus,
  };

  return successfulTransition(nextState, {
    fixtureGeneration: nextState.fixtureGeneration,
  });
};

/**
 * The one domain dispatcher. React receives the state-only wrapper below;
 * future tool adapters can use this transition result without bypassing it.
 */
export const transitionRedlineState = (
  state: RedlineState,
  action: RedlineAction,
  dependencies: ReducerDependencies = deterministicReducerDependencies,
): DomainTransition<
  ProposalStagedResult | CommitAppliedResult | ReviewResult | ResetResult | null
> => {
  switch (action.type) {
    case 'STAGE_PROPOSAL_REQUESTED':
      return stageProposal(state, action.request);
    case 'COMMIT_PROPOSAL_REQUESTED':
      return commitProposal(state, action.request, dependencies);
    case 'HUMAN_REVIEW_UPDATED':
      return updateHumanReview(state, action.operationId, action.decision);
    case 'RESET_REQUESTED':
      return resetRedline(state);
    case 'COMPATIBILITY_STATUS_UPDATED':
      return successfulTransition(
        {
          ...state,
          compatibilityStatus: action.status,
        },
        null,
      );
    case 'OBSERVER_SNAPSHOT_RECEIVED':
      if (isReviewer(state)) {
        return successfulTransition(state, null);
      }

      return successfulTransition(
        {
          ...state,
          committedPlan: action.snapshot.committedPlan,
          proposal: action.snapshot.proposal,
          acceptanceMap: action.snapshot.acceptanceMap,
          lastCommitReceipt: action.snapshot.lastCommitReceipt,
          fixtureGeneration: action.snapshot.fixtureGeneration,
          lifecycle: action.snapshot.lifecycle,
        },
        null,
      );
  }
};

export const redlineReducer = (
  state: RedlineState,
  action: RedlineAction,
): RedlineState => transitionRedlineState(state, action).state;
