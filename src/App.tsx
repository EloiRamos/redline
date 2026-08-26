import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createCanonicalRedlineState } from './domain/fixture';
import { redlineReducer, transitionRedlineState } from './domain/reducer';
import {
  type ParticipantSurfaceViewModel,
  selectCommitReadiness,
  selectDualViewPresentation,
} from './domain/selectors';
import type {
  DomainResult,
  OperationId,
  RedlineAction,
  RedlineState,
} from './domain/types';
import {
  createBroadcastSync,
  type BroadcastSyncHandle,
  type SyncStatus,
} from './sync/broadcast';
import { isReviewerState } from './sync/protocol';
import { AttributionBadge } from './ui/AttributionBadge';
import { DualView } from './ui/DualView';
import { ImpactCard } from './ui/ImpactCard';
import { LiveContextCard } from './ui/LiveContextCard';
import { PlanSurface } from './ui/PlanSurface';
import { ReviewRail } from './ui/ReviewRail';
import { ToolStatusStrip } from './ui/ToolStatusStrip';
import { registerWebMcpTools } from './webmcp/register';

const createInitialState = (): RedlineState => {
  const state = createCanonicalRedlineState();
  const viewer = new URLSearchParams(window.location.search).get('viewer');

  return viewer === 'sam'
    ? {
        ...state,
        currentView: {
          ...state.currentView,
          viewerId: 'sam',
          viewerName: 'Sam',
          viewerRole: 'observer',
        },
      }
    : state;
};

type ParticipantSurfaceProps = {
  readonly participant: ParticipantSurfaceViewModel;
  readonly canReview: boolean;
  readonly readiness: ReturnType<typeof selectCommitReadiness>;
  readonly onReview: (
    operationId: OperationId,
    decision: 'accepted' | 'rejected',
  ) => void;
};

const ParticipantSurface = ({
  participant,
  canReview,
  readiness,
  onReview,
}: ParticipantSurfaceProps) => (
  <section className={`participant-surface participant-surface--${participant.identity.viewerName.toLowerCase()}`}>
    <header className="participant-surface__header">
      <div>
        <span className="participant-surface__eyebrow">{participant.identity.viewerRole}</span>
        <h2>{participant.identity.viewerName}</h2>
      </div>
      <span className="participant-surface__role-label">
        {canReview ? 'Alex decides' : 'Sees proposal · read only'}
      </span>
    </header>
    <LiveContextCard view={participant.identity} />
    <PlanSurface rows={participant.planRows} proposalCount={participant.ghosts.length} />
    <ImpactCard impact={participant.impact} />
    <ReviewRail
      review={participant.review}
      readiness={readiness}
      canReview={canReview}
      onDecision={canReview ? onReview : undefined}
    />
    <AttributionBadge attribution={participant.attribution} />
  </section>
);

export const App = () => {
  const [state, dispatch] = useReducer(redlineReducer, undefined, createInitialState);
  const stateRef = useRef(state);
  const syncRef = useRef<BroadcastSyncHandle | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(
    state.currentView.viewerRole === 'observer' ? 'waiting' : 'synced',
  );

  stateRef.current = state;

  const getState = useCallback(() => stateRef.current, []);
  const transition = useCallback(
    (action: RedlineAction): DomainResult<unknown> => {
      const previous = stateRef.current;
      const nextTransition = transitionRedlineState(previous, action);

      stateRef.current = nextTransition.state;
      dispatch(action);
      syncRef.current?.publishTransition(previous, nextTransition.state);

      return nextTransition.result;
    },
    [],
  );

  useEffect(() => {
    const sync = createBroadcastSync({
      getState,
      receiveSnapshot: (snapshot) => {
        transition({ type: 'OBSERVER_SNAPSHOT_RECEIVED', snapshot });
      },
      onStatus: setSyncStatus,
    });

    syncRef.current = sync;

    return () => {
      if (syncRef.current === sync) {
        syncRef.current = null;
      }

      sync.close();
    };
  }, [getState, transition]);

  const webMcpRuntime = useMemo(
    () => ({ getState, transition }),
    [getState, transition],
  );

  useEffect(() => {
    const registration = registerWebMcpTools(webMcpRuntime);

    transition({
      type: 'COMPATIBILITY_STATUS_UPDATED',
      status: registration.supported ? 'supported' : 'unsupported',
    });

    return registration.unregister;
  }, [transition, webMcpRuntime]);

  const presentation = useMemo(() => selectDualViewPresentation(state), [state]);
  const readiness = useMemo(() => selectCommitReadiness(state), [state]);
  const canReview = isReviewerState(state);
  const compatibilityLabel =
    state.compatibilityStatus === 'supported'
      ? 'WebMCP ready'
      : 'WebMCP unavailable · manual review remains available';

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="app-header__identity">
          <span className="app-header__mark">REDLINE</span>
          <span>Two people · one shared plan</span>
        </div>
        <div className="app-header__scenario">
          <span>Casey unavailable Thursday</span>
          <span className="app-header__compatibility">{compatibilityLabel}</span>
          {canReview ? (
            <button
              className="app-header__reset"
              type="button"
              onClick={() => transition({ type: 'RESET_REQUESTED' })}
            >
              Reset demo
            </button>
          ) : (
            <span className="app-header__observer-status">
              Sam observer · {syncStatus === 'waiting' ? 'waiting for Alex' : 'synced'}
            </span>
          )}
        </div>
      </header>

      <ToolStatusStrip status={presentation.toolStatus} />

      <DualView
        alex={
          <ParticipantSurface
            participant={presentation.alex}
            canReview={canReview}
            readiness={readiness}
            onReview={(operationId, decision) =>
              transition({
                type: 'HUMAN_REVIEW_UPDATED',
                operationId,
                decision,
              })
            }
          />
        }
        sam={
          <ParticipantSurface
            participant={presentation.sam}
            canReview={false}
            readiness={readiness}
            onReview={() => undefined}
          />
        }
      />
    </main>
  );
};
