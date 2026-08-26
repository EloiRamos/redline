import type {
  ChangeDurationOperation,
  FixtureGeneration,
  FixtureId,
  IsoDate,
  OperationId,
  PlanRevision,
  ReassignTaskOperation,
  RedlineState,
  RetimeTaskOperation,
  Task,
  TaskId,
} from './types';

const asTaskId = (value: string) => value as TaskId;
const asOperationId = (value: string) => value as OperationId;
const asFixtureId = (value: string) => value as FixtureId;
const asIsoDate = (value: string) => value as IsoDate;
const asPlanRevision = (value: number) => value as PlanRevision;
const asFixtureGeneration = (value: number) => value as FixtureGeneration;

export const CANONICAL_FIXTURE_ID = asFixtureId('friday-campaign-launch-v1');

export const CANONICAL_TASK_IDS = {
  lockCampaignCopy: asTaskId('task-lock-campaign-copy'),
  polishVisuals: asTaskId('task-polish-visuals'),
  browserQa: asTaskId('task-browser-qa'),
  finalApproval: asTaskId('task-final-approval'),
  publishCampaign: asTaskId('task-publish-campaign'),
} as const;

export const CANONICAL_OPERATION_IDS = {
  retimeCampaignCopy: asOperationId('op-retime-campaign-copy'),
  reassignVisuals: asOperationId('op-reassign-polish-visuals'),
  retimeVisuals: asOperationId('op-retime-polish-visuals'),
  retimeBrowserQa: asOperationId('op-retime-browser-qa'),
  compressBrowserQa: asOperationId('op-compress-browser-qa'),
} as const;

const TASK_ORDER = [
  CANONICAL_TASK_IDS.lockCampaignCopy,
  CANONICAL_TASK_IDS.polishVisuals,
  CANONICAL_TASK_IDS.browserQa,
  CANONICAL_TASK_IDS.finalApproval,
  CANONICAL_TASK_IDS.publishCampaign,
] as const;

const TASKS: Readonly<Record<TaskId, Task>> = {
  [CANONICAL_TASK_IDS.lockCampaignCopy]: {
    id: CANONICAL_TASK_IDS.lockCampaignCopy,
    title: 'Lock campaign copy',
    owner: 'Alex',
    startDate: asIsoDate('2026-08-24'),
    durationDays: 2,
    dependencyIds: [],
  },
  [CANONICAL_TASK_IDS.polishVisuals]: {
    id: CANONICAL_TASK_IDS.polishVisuals,
    title: 'Polish visuals',
    owner: 'Casey',
    startDate: asIsoDate('2026-08-26'),
    durationDays: 2,
    dependencyIds: [],
  },
  [CANONICAL_TASK_IDS.browserQa]: {
    id: CANONICAL_TASK_IDS.browserQa,
    title: 'Browser QA',
    owner: 'Priya',
    startDate: asIsoDate('2026-08-27'),
    durationDays: 2,
    dependencyIds: [CANONICAL_TASK_IDS.polishVisuals],
  },
  [CANONICAL_TASK_IDS.finalApproval]: {
    id: CANONICAL_TASK_IDS.finalApproval,
    title: 'Final approval',
    owner: 'Sam',
    startDate: asIsoDate('2026-08-28'),
    durationDays: 1,
    dependencyIds: [
      CANONICAL_TASK_IDS.lockCampaignCopy,
      CANONICAL_TASK_IDS.browserQa,
    ],
  },
  [CANONICAL_TASK_IDS.publishCampaign]: {
    id: CANONICAL_TASK_IDS.publishCampaign,
    title: 'Publish campaign',
    owner: 'Alex',
    startDate: asIsoDate('2026-08-28'),
    durationDays: 1,
    dependencyIds: [CANONICAL_TASK_IDS.finalApproval],
  },
};

export const CANONICAL_OPERATIONS = [
  {
    type: 'retime_task',
    operationId: CANONICAL_OPERATION_IDS.retimeCampaignCopy,
    taskId: CANONICAL_TASK_IDS.lockCampaignCopy,
    newStartDate: asIsoDate('2026-08-21'),
    rationale: 'Move copy lock one working day earlier to create recovery room.',
  } satisfies RetimeTaskOperation,
  {
    type: 'reassign_task',
    operationId: CANONICAL_OPERATION_IDS.reassignVisuals,
    taskId: CANONICAL_TASK_IDS.polishVisuals,
    newOwner: 'Maya',
    rationale: 'Move visual ownership away from Casey before Thursday.',
  } satisfies ReassignTaskOperation,
  {
    type: 'retime_task',
    operationId: CANONICAL_OPERATION_IDS.retimeVisuals,
    taskId: CANONICAL_TASK_IDS.polishVisuals,
    newStartDate: asIsoDate('2026-08-25'),
    rationale: 'Run visual polish Tuesday and Wednesday before the absence.',
  } satisfies RetimeTaskOperation,
  {
    type: 'retime_task',
    operationId: CANONICAL_OPERATION_IDS.retimeBrowserQa,
    taskId: CANONICAL_TASK_IDS.browserQa,
    newStartDate: asIsoDate('2026-08-27'),
    rationale: 'Anchor Browser QA to start Thursday morning after visual polish.',
  } satisfies RetimeTaskOperation,
  {
    type: 'change_duration',
    operationId: CANONICAL_OPERATION_IDS.compressBrowserQa,
    taskId: CANONICAL_TASK_IDS.browserQa,
    newDurationDays: 1,
    rationale: 'Compress Browser QA to one day to preserve the Friday launch.',
  } satisfies ChangeDurationOperation,
] as const;

export const CANONICAL_SCENARIO = {
  title: 'Friday campaign launch versus full Browser QA',
  constraint: {
    owner: 'Casey' as const,
    unavailableDate: asIsoDate('2026-08-27'),
  },
  targetDate: asIsoDate('2026-08-28'),
  qualityFirstFinishDate: asIsoDate('2026-08-31'),
  allOperationsFinishDate: asIsoDate('2026-08-28'),
  qualityRiskOperationId: CANONICAL_OPERATION_IDS.compressBrowserQa,
  operations: CANONICAL_OPERATIONS,
} as const;

const createTasks = (): Readonly<Record<TaskId, Task>> =>
  Object.fromEntries(
    TASK_ORDER.map((taskId) => {
      const task = TASKS[taskId];

      return [
        taskId,
        {
          ...task,
          dependencyIds: [...task.dependencyIds],
        },
      ];
    }),
  ) as Readonly<Record<TaskId, Task>>;

export const createCanonicalRedlineState = (
  fixtureGeneration = 0,
): RedlineState => ({
  committedPlan: {
    fixtureId: CANONICAL_FIXTURE_ID,
    revision: asPlanRevision(1),
    targetDate: CANONICAL_SCENARIO.targetDate,
    tasks: createTasks(),
    taskOrder: [...TASK_ORDER],
  },
  currentView: {
    viewerId: 'alex',
    viewerName: 'Alex',
    viewerRole: 'reviewer',
    activeFilter: 'Launch',
    selectedTaskIds: [...TASK_ORDER],
    visibleDateRange: {
      start: asIsoDate('2026-08-21'),
      end: asIsoDate('2026-08-31'),
    },
  },
  proposal: null,
  acceptanceMap: {},
  lastCommitReceipt: null,
  fixtureGeneration: asFixtureGeneration(fixtureGeneration),
  lifecycle: 'idle',
  compatibilityStatus: 'unknown',
});
