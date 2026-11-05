import {hash} from './peuCommon.js';

// Bind native manual closure to both the displayed review and its current
// interrupted-operation evidence. This digest grants no execution permission.
export function reviewSnapshot(store, review) {
  return hash({review, operation: review.operation_id
    ? store.state.mail_operations[review.operation_id] ?? null : null});
}
