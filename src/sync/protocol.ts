import { CANONICAL_FIXTURE_ID } from '../domain/fixture';
import type {
  CommitReceipt,
  CommittedPlan,
  FixtureGeneration,
  MessageId,
  ObserverSnapshot,
  PlanRevision,
  Proposal,
  ProposalOperation,
  ProposalRevision,
  RedlineState,
  StateRequestMessage,
  SyncMessage,
  TabId,
  Task,
} from '../domain/types';

export const SYNC_PROTOCOL_VERSION = 1 as const;
export const SYNC_CHANNEL_VERSION = 'v1' as const;
export const MAX_SEEN_MESSAGE_IDS = 128;

type SnapshotMessage = Exclude<SyncMessage, StateRequestMessage>;
export type SharedStateMessageKind = SnapshotMessage['kind'];

const taskOwners = new Set(['Alex', 'Casey', 'Maya', 'Priya', 'Sam']);
const lifecycleValues = new Set([
  'idle',
  'proposal_staged',
  'review_in_progress',
  'ready_to_commit',
  'commit_applied',
]);
const proposalLifecycleValues = new Set([
  'staged',
  'in_review',
  'ready_to_commit',
]);
const decisionValues = new Set(['pending', 'accepted', 'rejected']);

let localMessageSequence = 0;

const asMessageId = (value: string) => value as MessageId;
const asTabId = (value: string) => value as TabId;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean => {
  const actualKeys = Object.keys(value);

  return (
    actualKeys.length === keys.length &&
    actualKeys.every((key) => keys.includes(key))
  );
};

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const isIsoDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

const isTask = (value: unknown, taskId: string): value is Task => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    hasExactKeys(value, [
      'id',
      'title',
      'owner',
      'startDate',
      'durationDays',
      'dependencyIds',
    ]) &&
    value.id === taskId &&
    isNonEmptyString(value.title) &&
    typeof value.owner === 'string' &&
    taskOwners.has(value.owner) &&
    isIsoDate(value.startDate) &&
    isNonNegativeInteger(value.durationDays) &&
    value.durationDays > 0 &&
    Array.isArray(value.dependencyIds) &&
    value.dependencyIds.every(isNonEmptyString)
  );
};

const isCommittedPlan = (value: unknown): value is CommittedPlan => {
  if (!isRecord(value)) {
    return false;
  }

  const tasks = value.tasks;

  if (
    !hasExactKeys(value, ['fixtureId', 'revision', 'targetDate', 'tasks', 'taskOrder']) ||
    value.fixtureId !== CANONICAL_FIXTURE_ID ||
    !isNonNegativeInteger(value.revision) ||
    !isIsoDate(value.targetDate) ||
    !isRecord(tasks) ||
    !Array.isArray(value.taskOrder) ||
    !value.taskOrder.every(isNonEmptyString)
  ) {
    return false;
  }

  const taskIds = Object.keys(tasks);

  return (
    taskIds.length === value.taskOrder.length &&
    value.taskOrder.every((taskId) => taskIds.includes(taskId)) &&
    taskIds.every((taskId) => isTask(tasks[taskId], taskId))
  );
};

const isOperation = (value: unknown): value is ProposalOperation => {
  if (!isRecord(value) || !isNonEmptyString(value.operationId) || !isNonEmptyString(value.rationale)) {
    return false;
  }

  switch (value.type) {
    case 'retime_task':
      return (
        hasExactKeys(value, ['type', 'operationId', 'rationale', 'taskId', 'newStartDate']) &&
        isNonEmptyString(value.taskId) &&
        isIsoDate(value.newStartDate)
      );
    case 'reassign_task':
      return (
        hasExactKeys(value, ['type', 'operationId', 'rationale', 'taskId', 'newOwner']) &&
        isNonEmptyString(value.taskId) &&
        typeof value.newOwner === 'string' &&
        taskOwners.has(value.newOwner)
      );
    case 'change_duration':
      return (
        hasExactKeys(value, [
          'type',
          'operationId',
          'rationale',
          'taskId',
          'newDurationDays',
        ]) &&
        isNonEmptyString(value.taskId) &&
        isNonNegativeInteger(value.newDurationDays) &&
        value.newDurationDays > 0
      );
    case 'split_task':
      return (
        hasExactKeys(value, ['type', 'operationId', 'rationale', 'taskId', 'segments']) &&
        isNonEmptyString(value.taskId) &&
        Array.isArray(value.segments) &&
        value.segments.length === 2 &&
        value.segments.every(
          (segment) =>
            isRecord(segment) &&
            hasExactKeys(segment, ['title', 'durationDays']) &&
            isNonEmptyString(segment.title) &&
            isNonNegativeInteger(segment.durationDays) &&
            segment.durationDays > 0,
        )
      );
    case 'add_dependency':
      return (
        hasExactKeys(value, [
          'type',
          'operationId',
          'rationale',
          'taskId',
          'dependsOnTaskId',
        ]) &&
        isNonEmptyString(value.taskId) &&
        isNonEmptyString(value.dependsOnTaskId)
      );
    default:
      return false;
  }
};

const isImpact = (value: unknown): boolean => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    hasExactKeys(value, ['projectedFinishDate', 'finishDeltaDays', 'signals']) &&
    isIsoDate(value.projectedFinishDate) &&
    typeof value.finishDeltaDays === 'number' &&
    Array.isArray(value.signals) &&
    value.signals.every(
      (signal) =>
        isRecord(signal) &&
        hasExactKeys(signal, ['code', 'message']) &&
        isNonEmptyString(signal.code) &&
        isNonEmptyString(signal.message),
    )
  );
};

const isProposal = (value: unknown): value is Proposal | null => {
  if (value === null) {
    return true;
  }

  if (!isRecord(value)) {
    return false;
  }

  return (
    hasExactKeys(value, [
      'id',
      'revision',
      'basePlanRevision',
      'operations',
      'stagedImpact',
      'proposedBy',
      'lifecycleStatus',
    ]) &&
    isNonEmptyString(value.id) &&
    isNonNegativeInteger(value.revision) &&
    value.revision > 0 &&
    isNonNegativeInteger(value.basePlanRevision) &&
    Array.isArray(value.operations) &&
    value.operations.length >= 1 &&
    value.operations.length <= 6 &&
    value.operations.every(isOperation) &&
    new Set(value.operations.map((operation) => operation.operationId)).size ===
      value.operations.length &&
    isImpact(value.stagedImpact) &&
    value.proposedBy === 'visiting-agent' &&
    typeof value.lifecycleStatus === 'string' &&
    proposalLifecycleValues.has(value.lifecycleStatus)
  );
};

const isAcceptanceMap = (
  value: unknown,
  proposal: Proposal | null,
): boolean => {
  if (!isRecord(value)) {
    return false;
  }

  const operationIds = proposal?.operations.map((operation) => operation.operationId) ?? [];
  const mapIds = Object.keys(value);

  return (
    operationIds.length === mapIds.length &&
    operationIds.every(
      (operationId) =>
        mapIds.includes(operationId) &&
        typeof value[operationId] === 'string' &&
        decisionValues.has(value[operationId] as string),
    )
  );
};

const isCommitReceipt = (value: unknown): value is CommitReceipt | null => {
  if (value === null) {
    return true;
  }

  if (!isRecord(value)) {
    return false;
  }

  const attribution = value.attribution;

  return (
    hasExactKeys(value, [
      'receiptId',
      'receiptState',
      'proposalId',
      'proposalRevision',
      'committedOperationIds',
      'rejectedOperationIds',
      'newPlanRevision',
      'finalFinishDate',
      'attribution',
    ]) &&
    isNonEmptyString(value.receiptId) &&
    value.receiptState === 'applied' &&
    isNonEmptyString(value.proposalId) &&
    isNonNegativeInteger(value.proposalRevision) &&
    value.proposalRevision > 0 &&
    Array.isArray(value.committedOperationIds) &&
    value.committedOperationIds.every(isNonEmptyString) &&
    Array.isArray(value.rejectedOperationIds) &&
    value.rejectedOperationIds.every(isNonEmptyString) &&
    isNonNegativeInteger(value.newPlanRevision) &&
    isIsoDate(value.finalFinishDate) &&
    isRecord(attribution) &&
    hasExactKeys(attribution, [
      'proposalId',
      'proposalRevision',
      'proposedBy',
      'acceptedBy',
      'acceptedAt',
    ]) &&
    attribution.proposalId === value.proposalId &&
    attribution.proposalRevision === value.proposalRevision &&
    attribution.proposedBy === 'visiting-agent' &&
    attribution.acceptedBy === 'Alex' &&
    typeof attribution.acceptedAt === 'string'
  );
};

export const isObserverSnapshot = (value: unknown): value is ObserverSnapshot => {
  if (!isRecord(value) || !hasExactKeys(value, [
    'committedPlan',
    'proposal',
    'acceptanceMap',
    'lastCommitReceipt',
    'fixtureGeneration',
    'lifecycle',
  ])) {
    return false;
  }

  return (
    isCommittedPlan(value.committedPlan) &&
    isProposal(value.proposal) &&
    isAcceptanceMap(value.acceptanceMap, value.proposal) &&
    isCommitReceipt(value.lastCommitReceipt) &&
    isNonNegativeInteger(value.fixtureGeneration) &&
    typeof value.lifecycle === 'string' &&
    lifecycleValues.has(value.lifecycle)
  );
};

const cloneOperation = (operation: ProposalOperation): ProposalOperation => {
  switch (operation.type) {
    case 'split_task':
      return {
        ...operation,
        segments: operation.segments.map((segment) => ({ ...segment })) as unknown as typeof operation.segments,
      };
    case 'retime_task':
    case 'reassign_task':
    case 'change_duration':
    case 'add_dependency':
      return { ...operation };
  }
};

const clonePlan = (plan: CommittedPlan): CommittedPlan => ({
  fixtureId: plan.fixtureId,
  revision: plan.revision,
  targetDate: plan.targetDate,
  taskOrder: [...plan.taskOrder],
  tasks: Object.fromEntries(
    plan.taskOrder.map((taskId) => {
      const task = plan.tasks[taskId];

      return [taskId, { ...task, dependencyIds: [...task.dependencyIds] }];
    }),
  ) as CommittedPlan['tasks'],
});

const cloneProposal = (proposal: Proposal | null): Proposal | null =>
  proposal
    ? {
        ...proposal,
        operations: proposal.operations.map(cloneOperation),
        stagedImpact: {
          ...proposal.stagedImpact,
          signals: proposal.stagedImpact.signals.map((signal) => ({ ...signal })),
        },
      }
    : null;

const cloneReceipt = (receipt: CommitReceipt | null): CommitReceipt | null =>
  receipt
    ? {
        ...receipt,
        committedOperationIds: [...receipt.committedOperationIds],
        rejectedOperationIds: [...receipt.rejectedOperationIds],
        attribution: { ...receipt.attribution },
      }
    : null;

/** Only page state required to render the shared interaction crosses tabs. */
export const createObserverSnapshot = (state: RedlineState): ObserverSnapshot => ({
  committedPlan: clonePlan(state.committedPlan),
  proposal: cloneProposal(state.proposal),
  acceptanceMap: { ...state.acceptanceMap },
  lastCommitReceipt: cloneReceipt(state.lastCommitReceipt),
  fixtureGeneration: state.fixtureGeneration,
  lifecycle: state.lifecycle,
});

export const createTabId = (): TabId => {
  const entropy = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);

  return asTabId(`tab-${entropy}`);
};

const createMessageId = (senderTabId: TabId): MessageId => {
  localMessageSequence += 1;
  return asMessageId(`${senderTabId}-${localMessageSequence}`);
};

const createBaseMessage = (state: RedlineState, senderTabId: TabId) => ({
  protocolVersion: SYNC_PROTOCOL_VERSION,
  messageId: createMessageId(senderTabId),
  fixtureId: state.committedPlan.fixtureId,
  fixtureGeneration: state.fixtureGeneration,
  senderTabId,
});

export const createStateRequest = (
  state: RedlineState,
  senderTabId: TabId,
): StateRequestMessage => ({
  ...createBaseMessage(state, senderTabId),
  kind: 'STATE_REQUEST',
  senderRole: 'observer',
  payload: {
    knownPlanRevision: state.committedPlan.revision,
    knownProposalRevision: state.proposal?.revision ?? null,
  },
});

export const createStateMessage = (
  kind: SharedStateMessageKind,
  state: RedlineState,
  senderTabId: TabId,
): SnapshotMessage => ({
  ...createBaseMessage(state, senderTabId),
  kind,
  senderRole: 'reviewer',
  payload: createObserverSnapshot(state),
}) as SnapshotMessage;

export const channelNameFor = (fixtureId: string): string =>
  `redline:${fixtureId}:${SYNC_CHANNEL_VERSION}`;

export const validateSyncMessage = (value: unknown): SyncMessage | null => {
  if (!isRecord(value) || !hasExactKeys(value, [
    'protocolVersion',
    'messageId',
    'fixtureId',
    'fixtureGeneration',
    'senderTabId',
    'senderRole',
    'kind',
    'payload',
  ])) {
    return null;
  }

  if (
    value.protocolVersion !== SYNC_PROTOCOL_VERSION ||
    value.fixtureId !== CANONICAL_FIXTURE_ID ||
    !isNonEmptyString(value.messageId) ||
    !isNonNegativeInteger(value.fixtureGeneration) ||
    !isNonEmptyString(value.senderTabId)
  ) {
    return null;
  }

  if (value.kind === 'STATE_REQUEST') {
    if (
      value.senderRole !== 'observer' ||
      !isRecord(value.payload) ||
      !hasExactKeys(value.payload, ['knownPlanRevision', 'knownProposalRevision']) ||
      !isNonNegativeInteger(value.payload.knownPlanRevision) ||
      !(
        value.payload.knownProposalRevision === null ||
        isNonNegativeInteger(value.payload.knownProposalRevision)
      )
    ) {
      return null;
    }

    return value as StateRequestMessage;
  }

  if (
    !['STATE_SNAPSHOT', 'PROPOSAL_STAGED', 'REVIEW_UPDATED', 'COMMIT_APPLIED', 'RESET_APPLIED'].includes(
      value.kind as string,
    ) ||
    value.senderRole !== 'reviewer' ||
    !isObserverSnapshot(value.payload) ||
    value.payload.committedPlan.fixtureId !== value.fixtureId ||
    value.payload.fixtureGeneration !== value.fixtureGeneration
  ) {
    return null;
  }

  return value as SnapshotMessage;
};

export const isSnapshotFresh = (
  localState: RedlineState,
  message: SnapshotMessage,
): boolean => {
  const snapshot = message.payload;
  const incomingGeneration = snapshot.fixtureGeneration as number;
  const localGeneration = localState.fixtureGeneration as number;

  if (incomingGeneration < localGeneration) {
    return false;
  }

  if (
    incomingGeneration > localGeneration &&
    message.kind !== 'RESET_APPLIED' &&
    message.kind !== 'STATE_SNAPSHOT'
  ) {
    return false;
  }

  if (incomingGeneration > localGeneration) {
    return true;
  }

  const incomingPlanRevision = snapshot.committedPlan.revision as number;
  const localPlanRevision = localState.committedPlan.revision as number;

  if (incomingPlanRevision < localPlanRevision) {
    return false;
  }

  if (incomingPlanRevision > localPlanRevision) {
    return true;
  }

  if (!localState.proposal) {
    return true;
  }

  if (!snapshot.proposal || snapshot.proposal.id !== localState.proposal.id) {
    return false;
  }

  return snapshot.proposal.revision >= localState.proposal.revision;
};

export const hasRevisionGap = (
  localState: RedlineState,
  message: SnapshotMessage,
): boolean => {
  const snapshot = message.payload;

  if (snapshot.fixtureGeneration > localState.fixtureGeneration) {
    return true;
  }

  if (snapshot.committedPlan.revision > localState.committedPlan.revision + 1) {
    return true;
  }

  return Boolean(
    snapshot.proposal &&
      localState.proposal &&
      snapshot.proposal.id === localState.proposal.id &&
      snapshot.proposal.revision > localState.proposal.revision + 1,
  );
};

export const isObserverState = (state: RedlineState): boolean =>
  state.currentView.viewerId === 'sam' && state.currentView.viewerRole === 'observer';

export const isReviewerState = (state: RedlineState): boolean =>
  state.currentView.viewerId === 'alex' && state.currentView.viewerRole === 'reviewer';

export const stateMessageForTransition = (
  previous: RedlineState,
  next: RedlineState,
): SharedStateMessageKind | null => {
  if (!isReviewerState(previous) || previous === next) {
    return null;
  }

  if (next.fixtureGeneration > previous.fixtureGeneration) {
    return 'RESET_APPLIED';
  }

  if (next.committedPlan.revision > previous.committedPlan.revision) {
    return 'COMMIT_APPLIED';
  }

  if (!previous.proposal && next.proposal) {
    return 'PROPOSAL_STAGED';
  }

  if (
    previous.proposal &&
    next.proposal &&
    previous.proposal.id === next.proposal.id &&
    next.proposal.revision > previous.proposal.revision
  ) {
    return 'REVIEW_UPDATED';
  }

  return null;
};

export const planRevisionFrom = (value: number): PlanRevision => value as PlanRevision;
export const proposalRevisionFrom = (value: number): ProposalRevision => value as ProposalRevision;
export const fixtureGenerationFrom = (value: number): FixtureGeneration => value as FixtureGeneration;
