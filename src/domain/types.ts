declare const brand: unique symbol;

type Brand<Value, Name extends string> = Value & {
  readonly [brand]: Name;
};

export type TaskId = Brand<string, 'TaskId'>;
export type OperationId = Brand<string, 'OperationId'>;
export type ProposalId = Brand<string, 'ProposalId'>;
export type FixtureId = Brand<string, 'FixtureId'>;
export type MessageId = Brand<string, 'MessageId'>;
export type TabId = Brand<string, 'TabId'>;
export type CommitReceiptId = Brand<string, 'CommitReceiptId'>;
export type IsoDate = Brand<string, 'IsoDate'>;
export type IsoDateTime = Brand<string, 'IsoDateTime'>;
export type PlanRevision = Brand<number, 'PlanRevision'>;
export type ProposalRevision = Brand<number, 'ProposalRevision'>;
export type FixtureGeneration = Brand<number, 'FixtureGeneration'>;

export type ReviewerAuthority = {
  readonly viewerId: 'alex';
  readonly viewerName: 'Alex';
  readonly viewerRole: 'reviewer';
};

export type ObserverAuthority = {
  readonly viewerId: 'sam';
  readonly viewerName: 'Sam';
  readonly viewerRole: 'observer';
};

export type ViewerAuthority = ReviewerAuthority | ObserverAuthority;
export type ViewerId = ViewerAuthority['viewerId'];
export type ViewerRole = ViewerAuthority['viewerRole'];
export type TaskOwner = 'Alex' | 'Casey' | 'Maya' | 'Priya' | 'Sam';

export type DateRange = {
  readonly start: IsoDate;
  readonly end: IsoDate;
};

export type Task = {
  readonly id: TaskId;
  readonly title: string;
  readonly owner: TaskOwner;
  readonly startDate: IsoDate;
  readonly durationDays: number;
  readonly dependencyIds: readonly TaskId[];
};

export type CommittedPlan = {
  readonly fixtureId: FixtureId;
  readonly revision: PlanRevision;
  readonly targetDate: IsoDate;
  readonly tasks: Readonly<Record<TaskId, Task>>;
  readonly taskOrder: readonly TaskId[];
};

export type CurrentView = ViewerAuthority & {
  readonly activeFilter: string;
  readonly selectedTaskIds: readonly TaskId[];
  readonly visibleDateRange: DateRange;
};

type ProposalOperationBase = {
  readonly operationId: OperationId;
  readonly rationale: string;
};

export type RetimeTaskOperation = ProposalOperationBase & {
  readonly type: 'retime_task';
  readonly taskId: TaskId;
  readonly newStartDate: IsoDate;
};

export type ReassignTaskOperation = ProposalOperationBase & {
  readonly type: 'reassign_task';
  readonly taskId: TaskId;
  readonly newOwner: TaskOwner;
};

export type ChangeDurationOperation = ProposalOperationBase & {
  readonly type: 'change_duration';
  readonly taskId: TaskId;
  readonly newDurationDays: number;
};

export type SplitTaskSegment = {
  readonly title: string;
  readonly durationDays: number;
};

export type SplitTaskOperation = ProposalOperationBase & {
  readonly type: 'split_task';
  readonly taskId: TaskId;
  readonly segments: readonly [SplitTaskSegment, SplitTaskSegment];
};

export type AddDependencyOperation = ProposalOperationBase & {
  readonly type: 'add_dependency';
  readonly taskId: TaskId;
  readonly dependsOnTaskId: TaskId;
};

export type ProposalOperation =
  | RetimeTaskOperation
  | ReassignTaskOperation
  | ChangeDurationOperation
  | SplitTaskOperation
  | AddDependencyOperation;

export type ImpactSignal = {
  readonly code: string;
  readonly message: string;
};

export type StagedImpact = {
  readonly projectedFinishDate: IsoDate;
  readonly finishDeltaDays: number;
  readonly signals: readonly ImpactSignal[];
};

export type ProposalLifecycleStatus =
  | 'staged'
  | 'in_review'
  | 'ready_to_commit';

export type Proposal = {
  readonly id: ProposalId;
  readonly revision: ProposalRevision;
  readonly basePlanRevision: PlanRevision;
  readonly operations: readonly ProposalOperation[];
  readonly stagedImpact: StagedImpact;
  readonly proposedBy: 'visiting-agent';
  readonly lifecycleStatus: ProposalLifecycleStatus;
};

export type AcceptanceDecision = 'pending' | 'accepted' | 'rejected';

// This map is created and changed only by Alex's page-held review controls.
// It is never part of proposal or commit tool input.
export type HumanAcceptanceMap = Readonly<
  Record<OperationId, AcceptanceDecision>
>;

export type ProposalAttribution = {
  readonly proposalId: ProposalId;
  readonly proposalRevision: ProposalRevision;
  readonly proposedBy: 'visiting-agent';
};

export type HumanAcceptanceAttribution = {
  readonly acceptedBy: 'Alex';
  readonly acceptedAt: IsoDateTime;
};

export type CommitAttribution = ProposalAttribution &
  HumanAcceptanceAttribution;

export type CommitReceipt = {
  readonly receiptId: CommitReceiptId;
  readonly receiptState: 'applied';
  readonly proposalId: ProposalId;
  readonly proposalRevision: ProposalRevision;
  readonly committedOperationIds: readonly OperationId[];
  readonly rejectedOperationIds: readonly OperationId[];
  readonly newPlanRevision: PlanRevision;
  readonly finalFinishDate: IsoDate;
  readonly attribution: CommitAttribution;
};

export type RedlineLifecycle =
  | 'idle'
  | 'proposal_staged'
  | 'review_in_progress'
  | 'ready_to_commit'
  | 'commit_applied';

export type CompatibilityStatus = 'unknown' | 'supported' | 'unsupported';

export type RedlineState = {
  readonly committedPlan: CommittedPlan;
  readonly currentView: CurrentView;
  readonly proposal: Proposal | null;
  readonly acceptanceMap: HumanAcceptanceMap;
  readonly lastCommitReceipt: CommitReceipt | null;
  readonly fixtureGeneration: FixtureGeneration;
  readonly lifecycle: RedlineLifecycle;
  readonly compatibilityStatus: CompatibilityStatus;
};

// These are the complete mutation requests a visiting agent may eventually
// supply. Proposal identity, impact, review decisions, receipts, and revision
// advancement are intentionally absent.
export type StageProposalRequest = {
  readonly expectedPlanRevision: PlanRevision;
  readonly operations: readonly ProposalOperation[];
};

export type CommitProposalRequest = {
  readonly proposalId: ProposalId;
  readonly expectedProposalRevision: ProposalRevision;
};

export type AgentMutationRequest =
  | {
      readonly type: 'STAGE_PROPOSAL_REQUESTED';
      readonly request: StageProposalRequest;
    }
  | {
      readonly type: 'COMMIT_PROPOSAL_REQUESTED';
      readonly request: CommitProposalRequest;
    };

// Page actions are not tool inputs. The page derives the actor from its local
// reviewer authority and owns acceptance attribution and reset generation.
export type PageAuthorityAction =
  | {
      readonly type: 'HUMAN_REVIEW_UPDATED';
      readonly operationId: OperationId;
      readonly decision: Exclude<AcceptanceDecision, 'pending'>;
    }
  | {
      readonly type: 'RESET_REQUESTED';
    }
  | {
      readonly type: 'COMPATIBILITY_STATUS_UPDATED';
      readonly status: CompatibilityStatus;
    };

export type ObserverStateAction = {
  readonly type: 'OBSERVER_SNAPSHOT_RECEIVED';
  readonly snapshot: ObserverSnapshot;
};

export type RedlineAction =
  | AgentMutationRequest
  | PageAuthorityAction
  | ObserverStateAction;

export type RefusalCode =
  | 'VIEW_NOT_READY'
  | 'OBSERVER_READ_ONLY'
  | 'STALE_PLAN_REVISION'
  | 'STALE_PROPOSAL'
  | 'UNKNOWN_TASK'
  | 'INVALID_OPERATION'
  | 'DUPLICATE_OPERATION_ID'
  | 'BATCH_TOO_LARGE'
  | 'PROPOSAL_ALREADY_OPEN'
  | 'REVIEW_INCOMPLETE'
  | 'NO_ACCEPTED_OPERATIONS'
  | 'PROPOSAL_NOT_FOUND';

export type StructuredRefusal = {
  readonly code: RefusalCode;
  readonly message: string;
};

export type ProposalStagedResult = {
  readonly proposalId: ProposalId;
  readonly proposalRevision: ProposalRevision;
  readonly stagedOperationIds: readonly OperationId[];
  readonly committedStateUnchanged: true;
  readonly impact: StagedImpact;
};

export type CommitAppliedResult = {
  readonly receipt: CommitReceipt;
  readonly alreadyApplied: boolean;
};

export type DomainResult<Value> =
  | { readonly ok: true; readonly data: Value }
  | { readonly ok: false; readonly refusal: StructuredRefusal };

export type ObserverSnapshot = {
  readonly committedPlan: CommittedPlan;
  readonly proposal: Proposal | null;
  readonly acceptanceMap: HumanAcceptanceMap;
  readonly lastCommitReceipt: CommitReceipt | null;
  readonly fixtureGeneration: FixtureGeneration;
  readonly lifecycle: RedlineLifecycle;
};

type SyncEnvelope = {
  readonly protocolVersion: 1;
  readonly messageId: MessageId;
  readonly fixtureId: FixtureId;
  readonly fixtureGeneration: FixtureGeneration;
  readonly senderTabId: TabId;
};

export type StateRequestMessage = SyncEnvelope & {
  readonly kind: 'STATE_REQUEST';
  readonly senderRole: 'observer';
  readonly payload: {
    readonly knownPlanRevision: PlanRevision;
    readonly knownProposalRevision: ProposalRevision | null;
  };
};

export type StateSnapshotMessage = SyncEnvelope & {
  readonly kind: 'STATE_SNAPSHOT';
  readonly senderRole: 'reviewer';
  readonly payload: ObserverSnapshot;
};

export type ProposalStagedMessage = SyncEnvelope & {
  readonly kind: 'PROPOSAL_STAGED';
  readonly senderRole: 'reviewer';
  readonly payload: ObserverSnapshot;
};

export type ReviewUpdatedMessage = SyncEnvelope & {
  readonly kind: 'REVIEW_UPDATED';
  readonly senderRole: 'reviewer';
  readonly payload: ObserverSnapshot;
};

export type CommitAppliedMessage = SyncEnvelope & {
  readonly kind: 'COMMIT_APPLIED';
  readonly senderRole: 'reviewer';
  readonly payload: ObserverSnapshot;
};

export type ResetAppliedMessage = SyncEnvelope & {
  readonly kind: 'RESET_APPLIED';
  readonly senderRole: 'reviewer';
  readonly payload: ObserverSnapshot;
};

export type SyncMessage =
  | StateRequestMessage
  | StateSnapshotMessage
  | ProposalStagedMessage
  | ReviewUpdatedMessage
  | CommitAppliedMessage
  | ResetAppliedMessage;
