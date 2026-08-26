import { CANONICAL_TASK_IDS } from './fixture';
import type {
  CommittedPlan,
  ImpactSignal,
  IsoDate,
  ProposalOperation,
  StagedImpact,
  Task,
  TaskId,
} from './types';

const asIsoDate = (value: string) => value as IsoDate;

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const parseDate = (value: IsoDate): Date => {
  const [year, month, day] = value.split('-').map(Number);

  return new Date(Date.UTC(year, month - 1, day));
};

const toIsoDate = (date: Date): IsoDate =>
  asIsoDate(date.toISOString().slice(0, 10));

const isWeekend = (date: Date): boolean => {
  const day = date.getUTCDay();

  return day === 0 || day === 6;
};

export const addWorkingDays = (startDate: IsoDate, daysToAdd: number): IsoDate => {
  const date = parseDate(startDate);
  let remainingDays = daysToAdd;

  while (remainingDays > 0) {
    date.setUTCDate(date.getUTCDate() + 1);

    if (!isWeekend(date)) {
      remainingDays -= 1;
    }
  }

  return toIsoDate(date);
};

export const isIsoDate = (value: string): value is IsoDate => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

const cloneTask = (task: Task): Task => ({
  ...task,
  dependencyIds: [...task.dependencyIds],
});

const clonePlan = (plan: CommittedPlan): CommittedPlan => ({
  ...plan,
  tasks: Object.fromEntries(
    plan.taskOrder.map((taskId) => [taskId, cloneTask(plan.tasks[taskId])]),
  ) as Readonly<Record<TaskId, Task>>,
  taskOrder: [...plan.taskOrder],
});

const replaceDependency = (
  dependencyIds: readonly TaskId[],
  sourceTaskId: TaskId,
  replacementTaskId: TaskId,
): readonly TaskId[] =>
  dependencyIds.map((dependencyId) =>
    dependencyId === sourceTaskId ? replacementTaskId : dependencyId,
  );

const splitTask = (
  plan: CommittedPlan,
  operation: Extract<ProposalOperation, { type: 'split_task' }>,
): CommittedPlan => {
  const sourceTask = plan.tasks[operation.taskId];

  if (!sourceTask) {
    return plan;
  }

  const [firstSegment, secondSegment] = operation.segments;
  const firstTaskId = `${sourceTask.id}--${operation.operationId}--1` as TaskId;
  const secondTaskId = `${sourceTask.id}--${operation.operationId}--2` as TaskId;
  const firstTask: Task = {
    ...sourceTask,
    id: firstTaskId,
    title: firstSegment.title,
    durationDays: firstSegment.durationDays,
    dependencyIds: [...sourceTask.dependencyIds],
  };
  const secondTask: Task = {
    ...sourceTask,
    id: secondTaskId,
    title: secondSegment.title,
    startDate: addWorkingDays(sourceTask.startDate, firstSegment.durationDays),
    durationDays: secondSegment.durationDays,
    dependencyIds: [firstTaskId],
  };
  const tasks = Object.fromEntries(
    Object.entries(plan.tasks)
      .filter(([taskId]) => taskId !== sourceTask.id)
      .map(([taskId, task]) => [
        taskId,
        {
          ...task,
          dependencyIds: replaceDependency(
            task.dependencyIds,
            sourceTask.id,
            secondTaskId,
          ),
        },
      ])
      .concat([
        [firstTaskId, firstTask],
        [secondTaskId, secondTask],
      ]),
  ) as Readonly<Record<TaskId, Task>>;
  const taskOrder = plan.taskOrder.flatMap((taskId) =>
    taskId === sourceTask.id ? [firstTaskId, secondTaskId] : [taskId],
  );

  return { ...plan, tasks, taskOrder };
};

const applyOperation = (
  plan: CommittedPlan,
  operation: ProposalOperation,
): CommittedPlan => {
  if (operation.type === 'split_task') {
    return splitTask(plan, operation);
  }

  const task = plan.tasks[operation.taskId];

  if (!task) {
    return plan;
  }

  const updatedTask: Task = (() => {
    switch (operation.type) {
      case 'retime_task':
        return { ...task, startDate: operation.newStartDate };
      case 'reassign_task':
        return { ...task, owner: operation.newOwner };
      case 'change_duration':
        return { ...task, durationDays: operation.newDurationDays };
      case 'add_dependency':
        return {
          ...task,
          dependencyIds: [...task.dependencyIds, operation.dependsOnTaskId],
        };
    }
  })();

  return {
    ...plan,
    tasks: {
      ...plan.tasks,
      [task.id]: updatedTask,
    },
  };
};

/**
 * Applies a validated operation batch to a copied plan. It deliberately owns
 * the only operation-to-plan projection used by both impact and selectors.
 */
export const applyProposalOperations = (
  committedPlan: CommittedPlan,
  operations: readonly ProposalOperation[],
): CommittedPlan =>
  operations.reduce(
    (projectedPlan, operation) => applyOperation(projectedPlan, operation),
    clonePlan(committedPlan),
  );

const latestDate = (left: IsoDate, right: IsoDate): IsoDate =>
  left > right ? left : right;

const isQaCompletionGate = (
  task: Task,
  dependency: Task,
): boolean =>
  task.id === CANONICAL_TASK_IDS.finalApproval &&
  dependency.id === CANONICAL_TASK_IDS.browserQa;

const calculateFinishDate = (plan: CommittedPlan): IsoDate => {
  const finishDates = new Map<TaskId, IsoDate>();
  const visitingTaskIds = new Set<TaskId>();

  const finishFor = (taskId: TaskId): IsoDate => {
    const cached = finishDates.get(taskId);

    if (cached) {
      return cached;
    }

    const task = plan.tasks[taskId];

    if (!task || visitingTaskIds.has(taskId)) {
      return plan.targetDate;
    }

    visitingTaskIds.add(taskId);
    let startDate = task.startDate;

    for (const dependencyId of task.dependencyIds) {
      const dependency = plan.tasks[dependencyId];
      const dependencyFinish = finishFor(dependencyId);
      const requiredStart =
        dependency && isQaCompletionGate(task, dependency)
          ? addWorkingDays(dependencyFinish, 1)
          : dependencyFinish;

      startDate = latestDate(startDate, requiredStart);
    }

    visitingTaskIds.delete(taskId);
    const finishDate = addWorkingDays(startDate, task.durationDays - 1);

    finishDates.set(taskId, finishDate);
    return finishDate;
  };

  return plan.taskOrder.reduce(
    (latestFinishDate, taskId) => latestDate(latestFinishDate, finishFor(taskId)),
    plan.targetDate,
  );
};

const calendarDayDifference = (from: IsoDate, to: IsoDate): number =>
  Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / DAY_IN_MS);

export const calculateImpact = (
  committedPlan: CommittedPlan,
  operations: readonly ProposalOperation[],
): StagedImpact => {
  const projectedPlan = applyProposalOperations(committedPlan, operations);
  const projectedFinishDate = calculateFinishDate(projectedPlan);
  const baseQa = committedPlan.tasks[CANONICAL_TASK_IDS.browserQa];
  const projectedQa = projectedPlan.tasks[CANONICAL_TASK_IDS.browserQa];
  const signals: ImpactSignal[] = [];

  if (baseQa && projectedQa && projectedQa.durationDays < baseQa.durationDays) {
    signals.push({
      code: 'BROWSER_QA_COMPRESSED',
      message: `Browser QA compressed from ${baseQa.durationDays} days to ${projectedQa.durationDays} day.`,
    });
  }

  return {
    projectedFinishDate,
    finishDeltaDays: calendarDayDifference(
      committedPlan.targetDate,
      projectedFinishDate,
    ),
    signals,
  };
};
