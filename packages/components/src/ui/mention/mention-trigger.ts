export type TriggerCandidate = {
  trigger: string;
  index: number;
};

export function findTriggerCandidates(
  value: string,
  triggers: string[],
  fromIndex: number,
): TriggerCandidate[] {
  const clampedFromIndex = Math.max(0, Math.min(fromIndex, value.length));
  const candidates: TriggerCandidate[] = [];

  for (const trigger of triggers) {
    if (!trigger) continue;
    const index = value.lastIndexOf(trigger, clampedFromIndex);
    if (index !== -1) candidates.push({ trigger, index });
  }

  candidates.sort((a, b) => b.index - a.index);
  return candidates;
}

