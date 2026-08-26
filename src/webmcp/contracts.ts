import {
  selectCurrentViewToolPayload,
} from '../domain/selectors';
import type {
  CommitProposalRequest,
  DomainResult,
  IsoDate,
  OperationId,
  PlanRevision,
  ProposalOperation,
  ProposalRevision,
  RedlineAction,
  RedlineState,
  StructuredRefusal,
  TaskId,
  TaskOwner,
} from '../domain/types';

export const FROZEN_TOOL_NAMES = [
  'get_current_view',
  'propose_changes',
  'commit_proposal',
] as const;

export type FrozenToolName = (typeof FROZEN_TOOL_NAMES)[number];

export type WebMcpToolRuntime = {
  readonly getState: () => RedlineState;
  readonly transition: (action: RedlineAction) => DomainResult<unknown>;
};

const asPlanRevision = (value: number) => value as PlanRevision;
const asProposalRevision = (value: number) => value as ProposalRevision;
const asTaskId = (value: string) => value as TaskId;
const asOperationId = (value: string) => value as OperationId;
const asTaskOwner = (value: string) => value as TaskOwner;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value);

  return actual.length === keys.length && actual.every((key) => keys.includes(key));
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

const textResult = (payload: unknown): WebMcpToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(payload) }],
});

const refusalResult = (refusal: StructuredRefusal): WebMcpToolResult =>
  textResult({ ok: false, refusal });

const invalidInput = (message: string): WebMcpToolResult =>
  refusalResult({ code: 'INVALID_OPERATION', message });

const toProposalOperation = (value: unknown): ProposalOperation | null => {
  if (!isRecord(value) || !isNonEmptyString(value.operation_id) || !isNonEmptyString(value.rationale)) {
    return null;
  }

  const common = {
    operationId: asOperationId(value.operation_id),
    rationale: value.rationale,
  };

  switch (value.type) {
    case 'retime_task':
      return exactKeys(value, ['type', 'operation_id', 'rationale', 'task_id', 'new_start_date']) &&
        isNonEmptyString(value.task_id) &&
        isNonEmptyString(value.new_start_date)
        ? {
            ...common,
            type: 'retime_task',
            taskId: asTaskId(value.task_id),
            newStartDate: value.new_start_date as IsoDate,
          }
        : null;
    case 'reassign_task':
      return exactKeys(value, ['type', 'operation_id', 'rationale', 'task_id', 'new_owner']) &&
        isNonEmptyString(value.task_id) &&
        isNonEmptyString(value.new_owner)
        ? {
            ...common,
            type: 'reassign_task',
            taskId: asTaskId(value.task_id),
            newOwner: asTaskOwner(value.new_owner),
          }
        : null;
    case 'change_duration':
      return exactKeys(value, [
        'type',
        'operation_id',
        'rationale',
        'task_id',
        'new_duration_days',
      ]) &&
        isNonEmptyString(value.task_id) &&
        isNonNegativeInteger(value.new_duration_days)
        ? {
            ...common,
            type: 'change_duration',
            taskId: asTaskId(value.task_id),
            newDurationDays: value.new_duration_days,
          }
        : null;
    case 'split_task': {
      if (
        !exactKeys(value, ['type', 'operation_id', 'rationale', 'task_id', 'segments']) ||
        !isNonEmptyString(value.task_id) ||
        !Array.isArray(value.segments) ||
        value.segments.length !== 2
      ) {
        return null;
      }

      const segments = value.segments.map((segment) => {
        if (
          !isRecord(segment) ||
          !exactKeys(segment, ['title', 'duration_days']) ||
          !isNonEmptyString(segment.title) ||
          !isNonNegativeInteger(segment.duration_days)
        ) {
          return null;
        }

        return { title: segment.title, durationDays: segment.duration_days };
      });

      return segments[0] && segments[1]
        ? {
            ...common,
            type: 'split_task',
            taskId: asTaskId(value.task_id),
            segments: [segments[0], segments[1]],
          }
        : null;
    }
    case 'add_dependency':
      return exactKeys(value, [
        'type',
        'operation_id',
        'rationale',
        'task_id',
        'depends_on_task_id',
      ]) &&
        isNonEmptyString(value.task_id) &&
        isNonEmptyString(value.depends_on_task_id)
        ? {
            ...common,
            type: 'add_dependency',
            taskId: asTaskId(value.task_id),
            dependsOnTaskId: asTaskId(value.depends_on_task_id),
          }
        : null;
    default:
      return null;
  }
};

const parseProposalInput = (
  input: unknown,
): { readonly expectedPlanRevision: PlanRevision; readonly operations: readonly ProposalOperation[] } | null => {
  if (
    !isRecord(input) ||
    !exactKeys(input, ['expected_plan_revision', 'operations']) ||
    !isNonNegativeInteger(input.expected_plan_revision) ||
    !Array.isArray(input.operations)
  ) {
    return null;
  }

  const operations = input.operations.map(toProposalOperation);

  return operations.every((operation): operation is ProposalOperation => operation !== null)
    ? { expectedPlanRevision: asPlanRevision(input.expected_plan_revision), operations }
    : null;
};

const parseCommitInput = (input: unknown): CommitProposalRequest | null => {
  if (
    !isRecord(input) ||
    !exactKeys(input, ['proposal_id', 'expected_proposal_revision']) ||
    !isNonEmptyString(input.proposal_id) ||
    !isNonNegativeInteger(input.expected_proposal_revision)
  ) {
    return null;
  }

  return {
    proposalId: input.proposal_id as CommitProposalRequest['proposalId'],
    expectedProposalRevision: asProposalRevision(input.expected_proposal_revision),
  };
};

const operationSchemas: readonly WebMcpJsonSchema[] = [
  {
    type: 'object',
    properties: {
      type: { const: 'retime_task' },
      operation_id: { type: 'string', minLength: 1 },
      rationale: { type: 'string', minLength: 1 },
      task_id: { type: 'string', minLength: 1 },
      new_start_date: { type: 'string', minLength: 1 },
    },
    required: ['type', 'operation_id', 'rationale', 'task_id', 'new_start_date'],
    additionalProperties: false,
  },
  {
    type: 'object',
    properties: {
      type: { const: 'reassign_task' },
      operation_id: { type: 'string', minLength: 1 },
      rationale: { type: 'string', minLength: 1 },
      task_id: { type: 'string', minLength: 1 },
      new_owner: { type: 'string', enum: ['Alex', 'Casey', 'Maya', 'Priya', 'Sam'] },
    },
    required: ['type', 'operation_id', 'rationale', 'task_id', 'new_owner'],
    additionalProperties: false,
  },
  {
    type: 'object',
    properties: {
      type: { const: 'change_duration' },
      operation_id: { type: 'string', minLength: 1 },
      rationale: { type: 'string', minLength: 1 },
      task_id: { type: 'string', minLength: 1 },
      new_duration_days: { type: 'number', minimum: 1 },
    },
    required: ['type', 'operation_id', 'rationale', 'task_id', 'new_duration_days'],
    additionalProperties: false,
  },
  {
    type: 'object',
    properties: {
      type: { const: 'split_task' },
      operation_id: { type: 'string', minLength: 1 },
      rationale: { type: 'string', minLength: 1 },
      task_id: { type: 'string', minLength: 1 },
      segments: {
        type: 'array',
        minItems: 2,
        maxItems: 2,
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', minLength: 1 },
            duration_days: { type: 'number', minimum: 1 },
          },
          required: ['title', 'duration_days'],
          additionalProperties: false,
        },
      },
    },
    required: ['type', 'operation_id', 'rationale', 'task_id', 'segments'],
    additionalProperties: false,
  },
  {
    type: 'object',
    properties: {
      type: { const: 'add_dependency' },
      operation_id: { type: 'string', minLength: 1 },
      rationale: { type: 'string', minLength: 1 },
      task_id: { type: 'string', minLength: 1 },
      depends_on_task_id: { type: 'string', minLength: 1 },
    },
    required: ['type', 'operation_id', 'rationale', 'task_id', 'depends_on_task_id'],
    additionalProperties: false,
  },
];

export const getCurrentViewSchema: WebMcpJsonSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};

export const proposeChangesSchema: WebMcpJsonSchema = {
  type: 'object',
  properties: {
    expected_plan_revision: { type: 'number', minimum: 0 },
    operations: {
      type: 'array',
      minItems: 1,
      maxItems: 6,
      items: { oneOf: operationSchemas },
    },
  },
  required: ['expected_plan_revision', 'operations'],
  additionalProperties: false,
};

// Deliberately omits operation IDs and acceptance values: Alex's page-held
// review map is the only authority that determines the committed subset.
export const commitProposalSchema: WebMcpJsonSchema = {
  type: 'object',
  properties: {
    proposal_id: { type: 'string', minLength: 1 },
    expected_proposal_revision: { type: 'number', minimum: 1 },
  },
  required: ['proposal_id', 'expected_proposal_revision'],
  additionalProperties: false,
};

export const createWebMcpTools = (runtime: WebMcpToolRuntime): readonly WebMcpTool[] => [
  {
    name: 'get_current_view',
    description:
      'Read the tasks and planning context currently visible in this browser tab before proposing changes. Never mutates the plan.',
    inputSchema: getCurrentViewSchema,
    annotations: { readOnlyHint: true },
    execute: async (input) => {
      if (!isRecord(input) || !exactKeys(input, [])) {
        return invalidInput('get_current_view does not accept input properties.');
      }

      const state = runtime.getState();

      if (!state.currentView) {
        return refusalResult({
          code: 'VIEW_NOT_READY',
          message: 'The current tab view is not ready yet.',
        });
      }

      const view = selectCurrentViewToolPayload(state);

      return textResult({
        ok: true,
        data: {
          viewer: view.viewer,
          active_filter: view.activeFilter,
          selected_task_ids: view.selectedTaskIds,
          visible_date_range: view.visibleDateRange,
          visible_tasks: view.visibleTasks.map((task) => ({
            task_id: task.taskId,
            title: task.title,
            owner: task.owner,
            date_label: task.dateLabel,
          })),
          plan_revision: view.planRevision,
          proposal_status: view.proposalStatus,
        },
      });
    },
  },
  {
    name: 'propose_changes',
    description:
      'Stage 1–6 reviewable operations without committing. Use the exact operation types retime_task, reassign_task, change_duration, split_task, or add_dependency.',
    inputSchema: proposeChangesSchema,
    execute: async (input) => {
      const request = parseProposalInput(input);

      if (!request) {
        return invalidInput(
          'Use expected_plan_revision and 1–6 operations with exact types: retime_task, reassign_task, change_duration, split_task, or add_dependency.',
        );
      }

      const result = runtime.transition({
        type: 'STAGE_PROPOSAL_REQUESTED',
        request,
      });

      if (!result.ok) {
        return refusalResult(result.refusal);
      }

      const data = result.data as {
        readonly proposalId: string;
        readonly proposalRevision: number;
        readonly stagedOperationIds: readonly string[];
        readonly committedStateUnchanged: true;
        readonly impact: {
          readonly projectedFinishDate: string;
          readonly finishDeltaDays: number;
          readonly signals: readonly { readonly code: string; readonly message: string }[];
        };
      };

      return textResult({
        ok: true,
        data: {
          proposal_id: data.proposalId,
          proposal_revision: data.proposalRevision,
          staged_operation_ids: data.stagedOperationIds,
          committed_state_unchanged: data.committedStateUnchanged,
          projected_finish_date: data.impact.projectedFinishDate,
          finish_delta_days: data.impact.finishDeltaDays,
          signals: data.impact.signals,
        },
      });
    },
  },
  {
    name: 'commit_proposal',
    description:
      'Finalize the staged proposal after human review. Commits only the subset accepted in the page UI and refuses while review is incomplete or stale.',
    inputSchema: commitProposalSchema,
    execute: async (input) => {
      const request = parseCommitInput(input);

      if (!request) {
        return invalidInput('commit_proposal needs a proposal ID and its current proposal revision.');
      }

      const result = runtime.transition({
        type: 'COMMIT_PROPOSAL_REQUESTED',
        request,
      });

      if (!result.ok) {
        return refusalResult(result.refusal);
      }

      const data = result.data as {
        readonly receipt: {
          readonly committedOperationIds: readonly string[];
          readonly rejectedOperationIds: readonly string[];
          readonly newPlanRevision: number;
          readonly finalFinishDate: string;
          readonly attribution: {
            readonly proposedBy: 'visiting-agent';
            readonly acceptedBy: 'Alex';
            readonly acceptedAt: string;
          };
        };
        readonly alreadyApplied: boolean;
      };

      return textResult({
        ok: true,
        data: {
          committed_operation_ids: data.receipt.committedOperationIds,
          rejected_operation_ids: data.receipt.rejectedOperationIds,
          new_plan_revision: data.receipt.newPlanRevision,
          final_finish_date: data.receipt.finalFinishDate,
          attribution: data.receipt.attribution,
          already_applied: data.alreadyApplied,
        },
      });
    },
  },
];
