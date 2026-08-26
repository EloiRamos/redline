import { describe, expect, it } from 'vitest';
import {
  CANONICAL_OPERATIONS,
  createCanonicalRedlineState,
} from './fixture';
import { calculateImpact } from './impact';

describe('impact contract invariants', () => {
  it('all five operations preserve Friday and flag QA compression', () => {
    const state = createCanonicalRedlineState();
    const impact = calculateImpact(state.committedPlan, CANONICAL_OPERATIONS);

    expect(impact).toEqual({
      projectedFinishDate: '2026-08-28',
      finishDeltaDays: 0,
      signals: [
        {
          code: 'BROWSER_QA_COMPRESSED',
          message: 'Browser QA compressed from 2 days to 1 day.',
        },
      ],
    });
  });

  it('rejecting QA compression yields Monday with full QA retained', () => {
    const state = createCanonicalRedlineState();
    const impact = calculateImpact(state.committedPlan, CANONICAL_OPERATIONS.slice(0, 4));

    expect(impact).toEqual({
      projectedFinishDate: '2026-08-31',
      finishDeltaDays: 3,
      signals: [],
    });
  });

  it('impact calculation is deterministic and does not mutate its inputs', () => {
    const state = createCanonicalRedlineState();
    const planBefore = structuredClone(state.committedPlan);
    const operationsBefore = structuredClone(CANONICAL_OPERATIONS);
    const first = calculateImpact(state.committedPlan, CANONICAL_OPERATIONS);
    const second = calculateImpact(state.committedPlan, CANONICAL_OPERATIONS);

    expect(first).toEqual(second);
    expect(state.committedPlan).toEqual(planBefore);
    expect(CANONICAL_OPERATIONS).toEqual(operationsBefore);
  });
});
