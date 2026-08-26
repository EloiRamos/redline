import { CANONICAL_TASK_IDS } from './fixture';
import { calculateImpact } from './impact';
import type {
  AcceptanceDecision,
  CurrentView,
  IsoDate,
  OperationId,
  ProposalOperation,
  RedlineState,
  Task,
  TaskId,
} from './types';

export type LiveViewContract = {
  readonly viewerName: 'Alex' | 'Sam';
  readonly viewerRole: 'reviewer' | 'observer';
  readonly activeFilter: string;
  readonly selectedTaskCount: number;
  readonly selectedTaskIds: readonly TaskId[];
  readonly visibleDateRange: {
    readonly label: string;
    readonly start: IsoDate;
    readonly end: IsoDate;
  };
  readonly planRevision: number;
  readonly proposalStatus: 'none' | 'staged' | 'in_review' | 'ready_to_commit';
};

export type CurrentViewToolPayload = {
  readonly viewer: {
    readonly identity: 'Alex' | 'Sam';
    readonly role: 'reviewer' | 'observer';
  };
  readonly activeFilter: string;
  readonly selectedTaskIds: readonly TaskId[];
  readonly visibleDateRange: LiveViewContract['visibleDateRange'];
  readonly visibleTasks: readonly {
    readonly taskId: TaskId;
    readonly title: string;
    readonly owner: string;
    readonly dateLabel: string;
  }[];
  readonly planRevision: number;
  readonly proposalStatus: LiveViewContract['proposalStatus'];
};

export type CommittedRowViewModel = {
  readonly taskId: TaskId;
  readonly title: string;
  readonly owner: string;
  readonly dateLabel: string;
  readonly startPercent: number;
  readonly widthPercent: number;
};

type ProposalGhostViewModelBase = {
  readonly operationId: OperationId;
  readonly taskId: TaskId;
  readonly label: string;
  readonly rationale: string;
  readonly decision: AcceptanceDecision;
  readonly stateLabel: 'PROPOSED · NOT COMMITTED';
};

export type ProposalTimelineGhostViewModel = ProposalGhostViewModelBase & {
  readonly presentationKind: 'timeline';
  readonly presentationLabel: 'DATE' | 'DURATION' | 'SPLIT';
  readonly startPercent: number;
  readonly widthPercent: number;
  readonly ownerLabel: null;
};

export type ProposalBoundedIndicatorViewModel = ProposalGhostViewModelBase & {
  readonly presentationKind: 'owner' | 'relation';
  readonly presentationLabel: 'OWNER' | 'DEPENDENCY';
  readonly startPercent: null;
  readonly widthPercent: null;
  readonly ownerLabel: string | null;
};

export type ProposalGhostViewModel =
  | ProposalTimelineGhostViewModel
  | ProposalBoundedIndicatorViewModel;

export type PlanSurfaceRowViewModel = CommittedRowViewModel & {
  readonly ghosts: readonly ProposalGhostViewModel[];
};

export type ReviewOperationViewModel = {
  readonly operationId: OperationId;
  readonly label: string;
  readonly rationale: string;
  readonly decision: AcceptanceDecision;
  readonly stateLabel: string;
};

export type ReviewProjection = {
  readonly proposalId: string;
  readonly proposalRevision: number;
  readonly proposedBy: 'visiting-agent';
  readonly operationCount: number;
  readonly operations: readonly ReviewOperationViewModel[];
};

export type CommitReadiness = {
  readonly ready: boolean;
  readonly acceptedCount: number;
  readonly decidedCount: number;
  readonly operationCount: number;
  readonly message: string;
};

export type ImpactPresentation = {
  readonly headline: string;
  readonly detail: string;
  readonly projectedFinishDate: IsoDate;
  readonly hasQaCompression: boolean;
};

export type ToolStatusPresentation = {
  readonly steps: readonly {
    readonly label: string;
    readonly state: 'complete' | 'active' | 'pending';
  }[];
};

export type AttributionPresentation = {
  readonly proposalLabel: string;
  readonly acceptanceLabel: string;
  readonly summary: string;
};

export type ParticipantSurfaceViewModel = {
  readonly identity: LiveViewContract;
  readonly committedRows: readonly CommittedRowViewModel[];
  readonly planRows: readonly PlanSurfaceRowViewModel[];
  readonly ghosts: readonly ProposalGhostViewModel[];
  readonly review: ReviewProjection | null;
  readonly impact: ImpactPresentation | null;
  readonly attribution: AttributionPresentation | null;
};

export type DualViewPresentation = {
  readonly alex: ParticipantSurfaceViewModel;
  readonly sam: ParticipantSurfaceViewModel;
  readonly toolStatus: ToolStatusPresentation;
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const dateAtUtcMidnight = (date: IsoDate): number =>
  Date.parse(`${date}T00:00:00.000Z`);

const dayOffset = (start: IsoDate, date: IsoDate): number =>
  Math.round((dateAtUtcMidnight(date) - dateAtUtcMidnight(start)) / DAY_IN_MS);

const daySpan = (start: IsoDate, end: IsoDate): number =>
  dayOffset(start, end) + 1;

const timelinePercent = (value: number, rangeDays: number): number =>
  Math.round((value / rangeDays) * 100);

const formatDate = (date: IsoDate): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
};

const operationLabel = (
  operation: ProposalOperation,
  task: Task | undefined,
): string => {
  const taskTitle = task?.title ?? 'Unknown task';

  switch (operation.type) {
    case 'retime_task':
      return `Retime ${taskTitle}`;
    case 'reassign_task':
      return `Reassign ${taskTitle}`;
    case 'change_duration':
      return `Change ${taskTitle} duration`;
    case 'split_task':
      return `Split ${taskTitle}`;
    case 'add_dependency':
      return `Add ${taskTitle} dependency`;
  }
};

const reviewSubset = (state: RedlineState): readonly ProposalOperation[] =>
  state.proposal?.operations.filter(
    (operation) => state.acceptanceMap[operation.operationId] !== 'rejected',
  ) ?? [];

const createViewContract = (
  state: RedlineState,
  currentView: CurrentView,
): LiveViewContract => ({
  viewerName: currentView.viewerName,
  viewerRole: currentView.viewerRole,
  activeFilter: currentView.activeFilter,
  selectedTaskCount: currentView.selectedTaskIds.length,
  selectedTaskIds: currentView.selectedTaskIds,
  visibleDateRange: {
    ...currentView.visibleDateRange,
    label: `${formatDate(currentView.visibleDateRange.start)}–${formatDate(
      currentView.visibleDateRange.end,
    )}`,
  },
  planRevision: state.committedPlan.revision,
  proposalStatus: state.proposal?.lifecycleStatus ?? 'none',
});

export const selectCurrentViewContract = (state: RedlineState): LiveViewContract =>
  createViewContract(state, state.currentView);

/**
 * The tool payload intentionally composes the same current-view and committed
 * row selectors that render this tab. It is not a parallel agent-only model.
 */
export const selectCurrentViewToolPayload = (
  state: RedlineState,
): CurrentViewToolPayload => {
  const view = selectCurrentViewContract(state);

  return {
    viewer: {
      identity: view.viewerName,
      role: view.viewerRole,
    },
    activeFilter: view.activeFilter,
    selectedTaskIds: view.selectedTaskIds,
    visibleDateRange: view.visibleDateRange,
    visibleTasks: selectCommittedRows(state).map((row) => ({
      taskId: row.taskId,
      title: row.title,
      owner: row.owner,
      dateLabel: row.dateLabel,
    })),
    planRevision: view.planRevision,
    proposalStatus: view.proposalStatus,
  };
};

export const selectCommittedRows = (
  state: RedlineState,
): readonly CommittedRowViewModel[] => {
  const range = state.currentView.visibleDateRange;
  const rangeDays = daySpan(range.start, range.end);

  return state.committedPlan.taskOrder
    .filter((taskId) => state.currentView.selectedTaskIds.includes(taskId))
    .map((taskId) => {
      const task = state.committedPlan.tasks[taskId];

      return {
        taskId,
        title: task.title,
        owner: task.owner,
        dateLabel: `${formatDate(task.startDate)} · ${task.durationDays} day${
          task.durationDays === 1 ? '' : 's'
        }`,
        startPercent: timelinePercent(dayOffset(range.start, task.startDate), rangeDays),
        widthPercent: timelinePercent(task.durationDays, rangeDays),
      };
    });
};

export const selectProposalGhosts = (
  state: RedlineState,
): readonly ProposalGhostViewModel[] => {
  if (!state.proposal) {
    return [];
  }

  const range = state.currentView.visibleDateRange;
  const rangeDays = daySpan(range.start, range.end);
  return state.proposal.operations.map((operation) => {
    const originalTask = state.committedPlan.tasks[operation.taskId];
    const common = {
      operationId: operation.operationId,
      taskId: operation.taskId,
      label: operationLabel(operation, originalTask),
      rationale: operation.rationale,
      decision: state.acceptanceMap[operation.operationId] ?? 'pending',
      stateLabel: 'PROPOSED · NOT COMMITTED' as const,
    };

    switch (operation.type) {
      case 'reassign_task':
        return {
          ...common,
          presentationKind: 'owner' as const,
          presentationLabel: 'OWNER' as const,
          startPercent: null,
          widthPercent: null,
          ownerLabel: operation.newOwner,
        };
      case 'add_dependency':
        return {
          ...common,
          presentationKind: 'relation' as const,
          presentationLabel: 'DEPENDENCY' as const,
          startPercent: null,
          widthPercent: null,
          ownerLabel: null,
        };
      case 'retime_task':
        return {
          ...common,
          presentationKind: 'timeline' as const,
          presentationLabel: 'DATE' as const,
          startPercent: originalTask
            ? timelinePercent(dayOffset(range.start, operation.newStartDate), rangeDays)
            : 0,
          widthPercent: originalTask
            ? timelinePercent(originalTask.durationDays, rangeDays)
            : 0,
          ownerLabel: null,
        };
      case 'change_duration':
        return {
          ...common,
          presentationKind: 'timeline' as const,
          presentationLabel: 'DURATION' as const,
          startPercent: originalTask
            ? timelinePercent(dayOffset(range.start, originalTask.startDate), rangeDays)
            : 0,
          widthPercent: timelinePercent(operation.newDurationDays, rangeDays),
          ownerLabel: null,
        };
      case 'split_task':
        return {
          ...common,
          presentationKind: 'timeline' as const,
          presentationLabel: 'SPLIT' as const,
          startPercent: originalTask
            ? timelinePercent(dayOffset(range.start, originalTask.startDate), rangeDays)
            : 0,
          widthPercent: timelinePercent(
            operation.segments.reduce((total, segment) => total + segment.durationDays, 0),
            rangeDays,
          ),
          ownerLabel: null,
        };
    }
  });
};

export const selectPlanSurfaceRows = (
  state: RedlineState,
): readonly PlanSurfaceRowViewModel[] => {
  const ghosts = selectProposalGhosts(state);

  return selectCommittedRows(state).map((row) => ({
    ...row,
    ghosts: ghosts.filter((ghost) => ghost.taskId === row.taskId),
  }));
};

export const selectReviewProjection = (
  state: RedlineState,
): ReviewProjection | null => {
  if (!state.proposal) {
    return null;
  }

  return {
    proposalId: state.proposal.id,
    proposalRevision: state.proposal.revision,
    proposedBy: state.proposal.proposedBy,
    operationCount: state.proposal.operations.length,
    operations: state.proposal.operations.map((operation) => ({
      operationId: operation.operationId,
      label: operationLabel(operation, state.committedPlan.tasks[operation.taskId]),
      rationale: operation.rationale,
      decision: state.acceptanceMap[operation.operationId] ?? 'pending',
      stateLabel:
        state.acceptanceMap[operation.operationId] === 'accepted'
          ? 'Accepted by Alex'
          : state.acceptanceMap[operation.operationId] === 'rejected'
            ? 'Rejected by Alex'
            : 'Awaiting Alex',
    })),
  };
};

export const selectReviewCompleteness = (state: RedlineState): boolean =>
  Boolean(
    state.proposal &&
      state.proposal.operations.every(
        (operation) => state.acceptanceMap[operation.operationId] !== 'pending',
      ),
  );

export const selectCommitReadiness = (state: RedlineState): CommitReadiness => {
  const operationCount = state.proposal?.operations.length ?? 0;
  const decidedCount = state.proposal
    ? state.proposal.operations.filter(
        (operation) => state.acceptanceMap[operation.operationId] !== 'pending',
      ).length
    : 0;
  const acceptedCount = state.proposal
    ? state.proposal.operations.filter(
        (operation) => state.acceptanceMap[operation.operationId] === 'accepted',
      ).length
    : 0;
  const ready =
    Boolean(state.proposal) &&
    selectReviewCompleteness(state) &&
    acceptedCount > 0;

  return {
    ready,
    acceptedCount,
    decidedCount,
    operationCount,
    message: !state.proposal
      ? 'No proposal staged'
      : !selectReviewCompleteness(state)
        ? `${decidedCount} of ${operationCount} decisions recorded`
        : acceptedCount === 0
          ? 'Accept at least one operation'
          : `${acceptedCount} accepted operations ready`,
  };
};

export const selectImpactPresentation = (
  state: RedlineState,
): ImpactPresentation | null => {
  if (!state.proposal) {
    return null;
  }

  const impact = calculateImpact(state.committedPlan, reviewSubset(state));
  const hasQaCompression = impact.signals.some(
    (signal) => signal.code === 'BROWSER_QA_COMPRESSED',
  );
  const qaTask = state.committedPlan.tasks[CANONICAL_TASK_IDS.browserQa];

  return {
    headline:
      impact.projectedFinishDate === state.committedPlan.targetDate
        ? 'Friday preserved'
        : 'Monday launch',
    detail: hasQaCompression
      ? impact.signals[0].message
      : `Full Browser QA retained · ${qaTask.durationDays} days.`,
    projectedFinishDate: impact.projectedFinishDate,
    hasQaCompression,
  };
};

export const selectToolStatusPresentation = (
  state: RedlineState,
): ToolStatusPresentation => {
  const readiness = selectCommitReadiness(state);
  const operationCount = state.proposal?.operations.length ?? 5;

  return {
    steps: [
      { label: 'Read live view', state: 'complete' },
      {
        label: `Stage ${operationCount} changes`,
        state: state.proposal ? 'complete' : 'active',
      },
      {
        label: `Commit ${readiness.acceptedCount || 4} accepted`,
        state: readiness.ready ? 'active' : 'pending',
      },
    ],
  };
};

export const selectAttributionPresentation = (
  state: RedlineState,
): AttributionPresentation | null => {
  if (!state.lastCommitReceipt) {
    return null;
  }

  return {
    proposalLabel: 'Proposed by visiting agent',
    acceptanceLabel: 'Accepted by Alex',
    summary: `${state.lastCommitReceipt.committedOperationIds.length} committed · ${state.lastCommitReceipt.rejectedOperationIds.length} rejected`,
  };
};

const selectParticipantSurface = (
  state: RedlineState,
  currentView: CurrentView,
): ParticipantSurfaceViewModel => ({
  identity: createViewContract(state, currentView),
  committedRows: selectCommittedRows(state),
  planRows: selectPlanSurfaceRows(state),
  ghosts: selectProposalGhosts(state),
  review: selectReviewProjection(state),
  impact: selectImpactPresentation(state),
  attribution: selectAttributionPresentation(state),
});

/**
 * Phase 2's static two-human shell derives both panes from the one local
 * projection. It does not synchronize, persist, or create a second state.
 */
export const selectDualViewPresentation = (
  state: RedlineState,
): DualViewPresentation => {
  const alexView: CurrentView = {
    ...state.currentView,
    viewerId: 'alex',
    viewerName: 'Alex',
    viewerRole: 'reviewer',
  };
  const samView: CurrentView = {
    ...state.currentView,
    viewerId: 'sam',
    viewerName: 'Sam',
    viewerRole: 'observer',
  };

  return {
    alex: selectParticipantSurface(state, alexView),
    sam: selectParticipantSurface(state, samView),
    toolStatus: selectToolStatusPresentation(state),
  };
};
