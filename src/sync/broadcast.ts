import type { ObserverSnapshot, RedlineState, TabId } from '../domain/types';
import {
  MAX_SEEN_MESSAGE_IDS,
  channelNameFor,
  createStateMessage,
  createStateRequest,
  createTabId,
  hasRevisionGap,
  isObserverState,
  isReviewerState,
  isSnapshotFresh,
  stateMessageForTransition,
  type SharedStateMessageKind,
  validateSyncMessage,
} from './protocol';

export type SyncStatus = 'unavailable' | 'waiting' | 'synced';

export type BroadcastSyncOptions = {
  readonly getState: () => RedlineState;
  readonly receiveSnapshot: (snapshot: ObserverSnapshot) => void;
  readonly onStatus?: (status: SyncStatus) => void;
};

export type BroadcastSyncHandle = {
  readonly tabId: TabId;
  readonly supported: boolean;
  publishTransition: (previous: RedlineState, next: RedlineState) => void;
  requestCurrentState: () => void;
  close: () => void;
};

const rememberMessage = (seenMessageIds: Set<string>, messageId: string): boolean => {
  if (seenMessageIds.has(messageId)) {
    return false;
  }

  seenMessageIds.add(messageId);

  if (seenMessageIds.size > MAX_SEEN_MESSAGE_IDS) {
    const oldest = seenMessageIds.values().next().value;

    if (oldest) {
      seenMessageIds.delete(oldest);
    }
  }

  return true;
};

export const createBroadcastSync = (
  options: BroadcastSyncOptions,
): BroadcastSyncHandle => {
  const tabId = createTabId();
  const initialState = options.getState();

  if (typeof BroadcastChannel === 'undefined') {
    options.onStatus?.('unavailable');

    return {
      tabId,
      supported: false,
      publishTransition: () => undefined,
      requestCurrentState: () => undefined,
      close: () => undefined,
    };
  }

  const channel = new BroadcastChannel(channelNameFor(initialState.committedPlan.fixtureId));
  const seenMessageIds = new Set<string>();
  let closed = false;

  const requestCurrentState = (): void => {
    const state = options.getState();

    if (closed || !isObserverState(state)) {
      return;
    }

    channel.postMessage(createStateRequest(state, tabId));
    options.onStatus?.('waiting');
  };

  const publish = (kind: SharedStateMessageKind, state: RedlineState): void => {
    if (closed || !isReviewerState(state)) {
      return;
    }

    channel.postMessage(createStateMessage(kind, state, tabId));
  };

  channel.onmessage = (event: MessageEvent<unknown>) => {
    const message = validateSyncMessage(event.data);

    if (!message || message.senderTabId === tabId || !rememberMessage(seenMessageIds, message.messageId)) {
      return;
    }

    const localState = options.getState();

    if (message.kind === 'STATE_REQUEST') {
      if (isReviewerState(localState) && message.fixtureGeneration <= localState.fixtureGeneration) {
        publish('STATE_SNAPSHOT', localState);
      }

      return;
    }

    if (!isObserverState(localState) || !isSnapshotFresh(localState, message)) {
      return;
    }

    const revisionGap = hasRevisionGap(localState, message);
    options.receiveSnapshot(message.payload);
    options.onStatus?.('synced');

    if (revisionGap) {
      requestCurrentState();
    }
  };

  const requestWhenVisible = (): void => {
    if (document.visibilityState === 'visible') {
      requestCurrentState();
    }
  };

  document.addEventListener('visibilitychange', requestWhenVisible);
  window.addEventListener('pageshow', requestWhenVisible);

  if (isObserverState(initialState)) {
    queueMicrotask(requestCurrentState);
  }

  return {
    tabId,
    supported: true,
    publishTransition: (previous, next) => {
      const kind = stateMessageForTransition(previous, next);

      if (kind) {
        publish(kind, next);
      }
    },
    requestCurrentState,
    close: () => {
      if (closed) {
        return;
      }

      closed = true;
      document.removeEventListener('visibilitychange', requestWhenVisible);
      window.removeEventListener('pageshow', requestWhenVisible);
      channel.close();
    },
  };
};
