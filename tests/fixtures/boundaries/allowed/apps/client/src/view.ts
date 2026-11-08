import { fixedStepSeconds } from '@udg/config';

export function frameCount(frames) {
  return Math.round((window.performance.now() / 1000) * frames * fixedStepSeconds);
}
