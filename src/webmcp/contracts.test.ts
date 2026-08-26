import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CANONICAL_OPERATIONS,
  createCanonicalRedlineState,
} from '../domain/fixture';
import { transitionRedlineState } from '../domain/reducer';
import type { RedlineAction, RedlineState } from '../domain/types';
import {
  FROZEN_TOOL_NAMES,
  commitProposalSchema,
  createWebMcpTools,
  getCurrentViewSchema,
  proposeChangesSchema,
  type WebMcpToolRuntime,
} from './contracts';
import { registerWebMcpTools } from './register';

const parseToolResult = async (tool: WebMcpTool, input: unknown): Promise<Record<string, unknown>> => {
  const result = await tool.execute(input);

  return JSON.parse(result.content[0].text) as Record<string, unknown>;
};

const toolNamed = (tools: readonly WebMcpTool[], name: string): WebMcpTool => {
  const tool = tools.find((candidate) => candidate.name === name);

  if (!tool) {
    throw new Error(`Missing ${name}.`);
  }

  return tool;
};

const createRuntime = (initialState = createCanonicalRedlineState()): {
  readonly runtime: WebMcpToolRuntime;
  readonly state: () => RedlineState;
} => {
  let state = initialState;

  return {
    runtime: {
      getState: () => state,
      transition: (action: RedlineAction) => {
        const transition = transitionRedlineState(state, action);

        state = transition.state;
        return transition.result;
      },
    },
    state: () => state,
  };
};

const asSam = (state: RedlineState): RedlineState => ({
  ...state,
  currentView: {
    ...state.currentView,
    viewerId: 'sam',
    viewerName: 'Sam',
    viewerRole: 'observer',
  },
});

const canonicalToolOperations = CANONICAL_OPERATIONS.map((operation) => {
  switch (operation.type) {
    case 'retime_task':
      return {
        type: operation.type,
        operation_id: operation.operationId,
        rationale: operation.rationale,
        task_id: operation.taskId,
        new_start_date: operation.newStartDate,
      };
    case 'reassign_task':
      return {
        type: operation.type,
        operation_id: operation.operationId,
        rationale: operation.rationale,
        task_id: operation.taskId,
        new_owner: operation.newOwner,
      };
    case 'change_duration':
      return {
        type: operation.type,
        operation_id: operation.operationId,
        rationale: operation.rationale,
        task_id: operation.taskId,
        new_duration_days: operation.newDurationDays,
      };
    default:
      throw new Error('The canonical fixture only uses frozen operation variants.');
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WebMCP frozen contract invariants', () => {
  it('registers exactly the frozen three tool names', () => {
    const registered: WebMcpTool[] = [];
    const { runtime } = createRuntime();
    vi.stubGlobal('document', {
      modelContext: {
        registerTool: (tool: WebMcpTool) => {
          registered.push(tool);
        },
      },
    });

    const registration = registerWebMcpTools(runtime);

    expect(registration.supported).toBe(true);
    expect(FROZEN_TOOL_NAMES).toEqual([
      'get_current_view',
      'propose_changes',
      'commit_proposal',
    ]);
    expect(registered.map((tool) => tool.name)).toEqual(FROZEN_TOOL_NAMES);
    expect(registered).toHaveLength(3);
    registration.unregister();
  });

  it('proposal schema is bounded and commit schema contains no operation IDs or acceptance values', () => {
    const proposalOperations = proposeChangesSchema.properties?.operations;
    const commitProperties = commitProposalSchema.properties ?? {};

    expect(proposeChangesSchema.additionalProperties).toBe(false);
    expect(proposalOperations).toMatchObject({
      type: 'array',
      minItems: 1,
      maxItems: 6,
    });
    expect(commitProposalSchema.additionalProperties).toBe(false);
    expect(Object.keys(commitProperties)).toEqual([
      'proposal_id',
      'expected_proposal_revision',
    ]);
    expect(Object.keys(commitProperties)).not.toContain('operation_ids');
    expect(Object.keys(commitProperties)).not.toContain('acceptance_values');
  });

  it('Sam mutation handlers return OBSERVER_READ_ONLY', async () => {
    const { runtime } = createRuntime(asSam(createCanonicalRedlineState()));
    const tools = createWebMcpTools(runtime);
    const proposal = await parseToolResult(toolNamed(tools, 'propose_changes'), {
      expected_plan_revision: 1,
      operations: canonicalToolOperations,
    });
    const commit = await parseToolResult(toolNamed(tools, 'commit_proposal'), {
      proposal_id: 'proposal-friday-campaign-launch-v1-g0-r1',
      expected_proposal_revision: 1,
    });

    expect(proposal).toMatchObject({
      ok: false,
      refusal: { code: 'OBSERVER_READ_ONLY' },
    });
    expect(commit).toMatchObject({
      ok: false,
      refusal: { code: 'OBSERVER_READ_ONLY' },
    });
  });

  it('structured refusals preserve state', async () => {
    const harness = createRuntime();
    const tools = createWebMcpTools(harness.runtime);
    const before = harness.state();
    const proposal = await parseToolResult(toolNamed(tools, 'propose_changes'), {
      expected_plan_revision: 99,
      operations: canonicalToolOperations,
    });
    const afterProposalRefusal = harness.state();
    const commit = await parseToolResult(toolNamed(tools, 'commit_proposal'), {
      proposal_id: 'proposal-friday-campaign-launch-v1-g0-r1',
      expected_proposal_revision: 1,
    });

    expect(proposal).toMatchObject({
      ok: false,
      refusal: { code: 'STALE_PLAN_REVISION' },
    });
    expect(afterProposalRefusal).toBe(before);
    expect(commit).toMatchObject({
      ok: false,
      refusal: { code: 'PROPOSAL_NOT_FOUND' },
    });
    expect(harness.state()).toBe(before);
  });

  it('get_current_view accepts only an empty object with no extra properties', async () => {
    const { runtime } = createRuntime();
    const tool = toolNamed(createWebMcpTools(runtime), 'get_current_view');
    const accepted = await parseToolResult(tool, {});
    const refused = await parseToolResult(tool, { viewer: 'alex' });

    expect(getCurrentViewSchema).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: false,
    });
    expect(accepted).toMatchObject({
      ok: true,
      data: {
        viewer: { identity: 'Alex', role: 'reviewer' },
        active_filter: 'Launch',
      },
    });
    expect(refused).toMatchObject({
      ok: false,
      refusal: { code: 'INVALID_OPERATION' },
    });
  });

  it('proposal accepts only frozen operation discriminators and one to six operations', async () => {
    const { runtime } = createRuntime();
    const tool = toolNamed(createWebMcpTools(runtime), 'propose_changes');
    const alias = await parseToolResult(tool, {
      expected_plan_revision: 1,
      operations: [
        {
          type: 'reschedule_task',
          operation_id: 'alias-op',
          rationale: 'This alias is forbidden.',
          task_id: 'task-lock-campaign-copy',
          new_start_date: '2026-08-21',
        },
      ],
    });
    const empty = await parseToolResult(tool, {
      expected_plan_revision: 1,
      operations: [],
    });
    const sevenOperations = await parseToolResult(tool, {
      expected_plan_revision: 1,
      operations: [...canonicalToolOperations, ...canonicalToolOperations.slice(0, 2)],
    });

    expect(alias).toMatchObject({ ok: false, refusal: { code: 'INVALID_OPERATION' } });
    expect(empty).toMatchObject({ ok: false, refusal: { code: 'BATCH_TOO_LARGE' } });
    expect(sevenOperations).toMatchObject({ ok: false, refusal: { code: 'BATCH_TOO_LARGE' } });
  });

  it('contains no fourth tool, dynamic gating, pending elicitation, decision token, or alias schema', () => {
    const tools = createWebMcpTools(createRuntime().runtime);
    const proposalSchema = proposeChangesSchema.properties?.operations;
    const variants = proposalSchema?.items?.oneOf?.map(
      (schema) => schema.properties?.type?.const,
    );

    expect(tools.map((tool) => tool.name)).toEqual(FROZEN_TOOL_NAMES);
    expect(variants).toEqual([
      'retime_task',
      'reassign_task',
      'change_duration',
      'split_task',
      'add_dependency',
    ]);
    expect(tools.every((tool) => tool.annotations?.readOnlyHint !== false)).toBe(true);
  });
});
