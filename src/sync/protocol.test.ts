import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CANONICAL_OPERATIONS,
  CANONICAL_TASK_IDS,
  createCanonicalRedlineState,
} from '../domain/fixture';
import {
  commitProposal,
  stageProposal,
  transitionRedlineState,
  updateHumanReview,
} from '../domain/reducer';
import type { OperationId, RedlineState, TabId } from '../domain/types';
import { createBroadcastSync } from './broadcast';
import {
  createObserverSnapshot,
  createStateMessage,
  createStateRequest,
  isSnapshotFresh,
  validateSyncMessage,
} from './protocol';

const asTabId = (value: string) => value as TabId;

const asSam = (state: RedlineState): RedlineState => ({
  ...state,
  currentView: {
    ...state.currentView,
    viewerId: 'sam',
    viewerName: 'Sam',
    viewerRole: 'observer',
  },
});

const stageCanonicalProposal = (state = createCanonicalRedlineState()): RedlineState =>
  stageProposal(state, {
    expectedPlanRevision: state.committedPlan.revision,
    operations: CANONICAL_OPERATIONS,
  }).state;

const reviewEveryOperation = (state: RedlineState): RedlineState => {
  let reviewed = state;

  for (const operation of state.proposal?.operations ?? []) {
    reviewed = updateHumanReview(
      reviewed,
      operation.operationId,
      operation.operationId === CANONICAL_OPERATIONS[4].operationId
        ? 'rejected'
        : 'accepted',
    ).state;
  }

  return reviewed;
};

class FakeBroadcastChannel {
  static readonly instances: FakeBroadcastChannel[] = [];

  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly posted: unknown[] = [];
  closed = false;

  constructor(readonly name: string) {
    FakeBroadcastChannel.instances.push(this);
  }

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  close(): void {
    this.closed = true;
  }

  deliver(message: unknown): void {
    this.onmessage?.({ data: message } as MessageEvent<unknown>);
  }

  clear(): void {
    this.posted.splice(0);
  }
}

const installBrowserGlobals = (): void => {
  FakeBroadcastChannel.instances.splice(0);
  const documentTarget = new EventTarget() as EventTarget & { visibilityState: string };
  documentTarget.visibilityState = 'hidden';

  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
  vi.stubGlobal('document', documentTarget);
  vi.stubGlobal('window', new EventTarget());
};

afterEach(() => {
  vi.unstubAllGlobals();
  FakeBroadcastChannel.instances.splice(0);
});

describe('same-origin observer protocol invariants', () => {
  it('Sam receives proposal, review, and commit snapshots in revision order', () => {
    let sam = asSam(createCanonicalRedlineState());
    const alexStaged = stageCanonicalProposal();
    const proposalMessage = validateSyncMessage(
      createStateMessage('PROPOSAL_STAGED', alexStaged, asTabId('alex-tab')),
    );

    expect(proposalMessage?.kind).toBe('PROPOSAL_STAGED');
    if (!proposalMessage || proposalMessage.kind === 'STATE_REQUEST') {
      throw new Error('Expected a proposal snapshot.');
    }

    expect(isSnapshotFresh(sam, proposalMessage)).toBe(true);
    sam = transitionRedlineState(sam, {
      type: 'OBSERVER_SNAPSHOT_RECEIVED',
      snapshot: proposalMessage.payload,
    }).state;
    expect(sam.proposal?.revision).toBe(1);

    const alexReviewed = updateHumanReview(
      alexStaged,
      CANONICAL_OPERATIONS[0].operationId,
      'accepted',
    ).state;
    const reviewMessage = validateSyncMessage(
      createStateMessage('REVIEW_UPDATED', alexReviewed, asTabId('alex-tab')),
    );

    expect(reviewMessage?.kind).toBe('REVIEW_UPDATED');
    if (!reviewMessage || reviewMessage.kind === 'STATE_REQUEST') {
      throw new Error('Expected a review snapshot.');
    }

    expect(isSnapshotFresh(sam, reviewMessage)).toBe(true);
    sam = transitionRedlineState(sam, {
      type: 'OBSERVER_SNAPSHOT_RECEIVED',
      snapshot: reviewMessage.payload,
    }).state;
    expect(sam.proposal?.revision).toBe(2);
    expect(sam.acceptanceMap[CANONICAL_OPERATIONS[0].operationId]).toBe('accepted');

    const alexReady = reviewEveryOperation(alexReviewed);
    const alexCommitted = commitProposal(alexReady, {
      proposalId: alexReady.proposal!.id,
      expectedProposalRevision: alexReady.proposal!.revision,
    }).state;
    const commitMessage = validateSyncMessage(
      createStateMessage('COMMIT_APPLIED', alexCommitted, asTabId('alex-tab')),
    );

    expect(commitMessage?.kind).toBe('COMMIT_APPLIED');
    if (!commitMessage || commitMessage.kind === 'STATE_REQUEST') {
      throw new Error('Expected a commit snapshot.');
    }

    expect(isSnapshotFresh(sam, commitMessage)).toBe(true);
    sam = transitionRedlineState(sam, {
      type: 'OBSERVER_SNAPSHOT_RECEIVED',
      snapshot: commitMessage.payload,
    }).state;
    expect(sam.proposal).toBeNull();
    expect(sam.committedPlan.revision).toBe(2);
    expect(sam.committedPlan.tasks[CANONICAL_TASK_IDS.browserQa].durationDays).toBe(2);
  });

  it('Sam cannot originate proposal, review, commit, or reset mutations', async () => {
    installBrowserGlobals();
    const sam = asSam(createCanonicalRedlineState());
    const handle = createBroadcastSync({
      getState: () => sam,
      receiveSnapshot: () => undefined,
    });
    await Promise.resolve();
    const channel = FakeBroadcastChannel.instances[0];

    channel.clear();
    handle.publishTransition(sam, { ...sam, lifecycle: 'proposal_staged' });
    expect(channel.posted).toEqual([]);

    handle.requestCurrentState();
    expect(channel.posted).toHaveLength(1);
    expect((channel.posted[0] as { kind: string }).kind).toBe('STATE_REQUEST');
    handle.close();
  });

  it('stale, duplicate, and wrong-generation messages are ignored', () => {
    installBrowserGlobals();
    let sam = asSam(createCanonicalRedlineState());
    let received = 0;
    const handle = createBroadcastSync({
      getState: () => sam,
      receiveSnapshot: (snapshot) => {
        received += 1;
        sam = transitionRedlineState(sam, {
          type: 'OBSERVER_SNAPSHOT_RECEIVED',
          snapshot,
        }).state;
      },
    });
    const channel = FakeBroadcastChannel.instances[0];
    const alexStaged = stageCanonicalProposal();
    const proposalMessage = createStateMessage(
      'PROPOSAL_STAGED',
      alexStaged,
      asTabId('alex-tab'),
    );

    channel.deliver(proposalMessage);
    channel.deliver(proposalMessage);
    expect(received).toBe(1);
    expect(sam.proposal?.revision).toBe(1);

    const staleMessage = createStateMessage(
      'STATE_SNAPSHOT',
      createCanonicalRedlineState(),
      asTabId('alex-tab'),
    );
    channel.deliver(staleMessage);
    expect(received).toBe(1);

    const wrongGeneration = {
      ...proposalMessage,
      messageId: 'alex-tab-wrong-generation',
      fixtureGeneration: 1,
      payload: {
        ...proposalMessage.payload,
        fixtureGeneration: 1,
      },
    };
    channel.deliver(wrongGeneration);
    expect(received).toBe(1);
    expect(sam.fixtureGeneration).toBe(0);
    handle.close();
  });

  it('a state request recovers the current Alex snapshot', () => {
    installBrowserGlobals();
    const alex = stageCanonicalProposal();
    const handle = createBroadcastSync({
      getState: () => alex,
      receiveSnapshot: () => undefined,
    });
    const channel = FakeBroadcastChannel.instances[0];
    const request = createStateRequest(
      asSam(createCanonicalRedlineState()),
      asTabId('sam-tab'),
    );

    channel.deliver(request);
    expect(channel.posted).toHaveLength(1);
    const response = channel.posted[0] as {
      readonly kind: string;
      readonly payload: Record<string, unknown>;
    };
    expect(response.kind).toBe('STATE_SNAPSHOT');
    expect(response.payload.committedPlan).toEqual(alex.committedPlan);
    expect(response.payload.proposal).toEqual(alex.proposal);
    handle.close();
  });

  it('sanitized snapshots exclude provider, account, and prompt data', () => {
    const extendedState = {
      ...stageCanonicalProposal(),
      provider: 'untrusted-provider',
      account: 'untrusted-account',
      prompt: 'untrusted-prompt',
    } as unknown as RedlineState;
    const snapshot = createObserverSnapshot(extendedState);
    const serialized = JSON.stringify(snapshot);

    expect(Object.keys(snapshot)).toEqual([
      'committedPlan',
      'proposal',
      'acceptanceMap',
      'lastCommitReceipt',
      'fixtureGeneration',
      'lifecycle',
    ]);
    expect(serialized).not.toContain('untrusted-provider');
    expect(serialized).not.toContain('untrusted-account');
    expect(serialized).not.toContain('untrusted-prompt');
  });
});
