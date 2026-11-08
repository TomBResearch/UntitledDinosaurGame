import { fixedStepSeconds } from '@udg/config';
import type { EntityId } from '@udg/protocol/domain';

export function step(id, axis) {
  return axis * fixedStepSeconds * (id.length > 0 ? 1 : 0);
}
