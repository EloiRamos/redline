import type {
  CommitReadiness,
  ReviewProjection,
} from '../domain/selectors';
import type { OperationId } from '../domain/types';

type ReviewRailProps = {
  readonly review: ReviewProjection | null;
  readonly readiness: CommitReadiness;
  readonly canReview: boolean;
  readonly onDecision?: (
    operationId: OperationId,
    decision: 'accepted' | 'rejected',
  ) => void;
};

export const ReviewRail = ({
  review,
  readiness,
  canReview,
  onDecision,
}: ReviewRailProps) => (
  <section className="review-rail" aria-label={canReview ? 'Alex review rail' : 'Review status'}>
    <div className="review-rail__heading">
      <span>{canReview ? 'ALEX REVIEWS CHANGES' : 'SAM SEES PROPOSAL'}</span>
      <span>{review ? `${readiness.decidedCount}/${readiness.operationCount}` : 'Waiting'}</span>
    </div>
    {!review ? (
      <p className="review-rail__empty">No proposal staged.</p>
    ) : (
      <ol className="review-rail__operations">
        {review.operations.map((operation) => (
          <li
            className={`review-rail__operation review-rail__operation--${operation.decision}`}
            key={operation.operationId}
          >
            <div className="review-rail__operation-copy">
              <strong>{operation.label}</strong>
              <span>{operation.stateLabel}</span>
            </div>
            {canReview ? (
              <div className="review-rail__actions" aria-label={`Review ${operation.label}`}>
                <button
                  className="review-button review-button--accept"
                  type="button"
                  aria-pressed={operation.decision === 'accepted'}
                  onClick={() => onDecision?.(operation.operationId, 'accepted')}
                >
                  Accept
                </button>
                <button
                  className="review-button review-button--reject"
                  type="button"
                  aria-pressed={operation.decision === 'rejected'}
                  onClick={() => onDecision?.(operation.operationId, 'rejected')}
                >
                  Reject
                </button>
              </div>
            ) : (
              <span className="review-rail__read-only">Read only</span>
            )}
          </li>
        ))}
      </ol>
    )}
    {review ? <p className="review-rail__readiness">{readiness.message}</p> : null}
  </section>
);
