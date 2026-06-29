import { clamp } from '../../shared/utils.js';
import type { CompileConfig, Experience } from '../../shared/types.js';

export function applyConfidenceDecay(experience: Experience, config: CompileConfig): void {
  if (!experience.updated_at) return;
  const ageMs = Date.now() - new Date(experience.updated_at).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const startDays = config.confidenceDecayStartDays;
  const ratePerMonth = config.confidenceDecayRatePerMonth;
  const maxDecay = config.confidenceDecayMax;
  if (ageDays <= startDays) return;
  const monthsPast = (ageDays - startDays) / 30;
  const decay = Math.min(monthsPast * ratePerMonth, maxDecay);
  experience.confidence = clamp(experience.confidence - decay, 0, 1);
}
