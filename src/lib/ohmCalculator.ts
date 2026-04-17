export enum OhmCategory {
  GREEN = 'GREEN',
  BLUE = 'BLUE',
  RED = 'RED',
  PINK = 'PINK',
}

export const OHM_VALUES: Record<OhmCategory, number> = {
  [OhmCategory.GREEN]: 5,
  [OhmCategory.BLUE]: 7,
  [OhmCategory.RED]: 9,
  [OhmCategory.PINK]: 3,
};

export interface SemanticChunk {
  text: string;
  label: OhmCategory;
  ohm?: number;
}

export interface SemanticRuleOverrides {
  GREEN?: string[];
  BLUE?: string[];
  RED?: string[];
  PINK?: string[];
}

export interface OhmCalculationResult {
  totalOhm: number;
  formula: string;
  voltage: number;
  current: number;
  score: number;
}

const DEFAULT_CATEGORY_PATTERNS: Record<OhmCategory, RegExp[]> = {
  [OhmCategory.GREEN]: [
    /thành thật|thú thật|nói cách khác|nói lại|honestly|to be honest|in other words|frankly/i,
    /đi thì cũng phải nói lại/i,
  ],
  [OhmCategory.BLUE]: [
    /cậu có biết|bạn có biết|cậu nên|bạn nên|hãy|you should|remember that|i think|we should|it means/i,
  ],
  [OhmCategory.RED]: [
    /chuyện nhỏ như con thỏ|piece of cake|break a leg|hit the hay|once in a blue moon|spill the beans/i,
  ],
  [OhmCategory.PINK]: [
    /hiệu ứng|khái niệm|thuật ngữ|key term|concept|term/i,
  ],
};

function compilePatterns(overrides?: SemanticRuleOverrides): Record<OhmCategory, RegExp[]> {
  return {
    [OhmCategory.GREEN]: (overrides?.GREEN?.length ? overrides.GREEN : []).map((item) => new RegExp(item, 'i')).concat(DEFAULT_CATEGORY_PATTERNS.GREEN),
    [OhmCategory.BLUE]: (overrides?.BLUE?.length ? overrides.BLUE : []).map((item) => new RegExp(item, 'i')).concat(DEFAULT_CATEGORY_PATTERNS.BLUE),
    [OhmCategory.RED]: (overrides?.RED?.length ? overrides.RED : []).map((item) => new RegExp(item, 'i')).concat(DEFAULT_CATEGORY_PATTERNS.RED),
    [OhmCategory.PINK]: (overrides?.PINK?.length ? overrides.PINK : []).map((item) => new RegExp(item, 'i')).concat(DEFAULT_CATEGORY_PATTERNS.PINK),
  };
}

function classifyChunk(text: string, patterns: Record<OhmCategory, RegExp[]>): OhmCategory | null {
  const normalized = text.trim();
  if (!normalized) return null;

  for (const category of [OhmCategory.GREEN, OhmCategory.BLUE, OhmCategory.RED, OhmCategory.PINK] as const) {
    if (patterns[category].some((pattern) => pattern.test(normalized))) {
      return category;
    }
  }

  return null;
}

export function detectSemanticChunksFromCaptain(
  captainTranscript?: string,
  overrides?: SemanticRuleOverrides,
): SemanticChunk[] {
  const transcript = (captainTranscript || '').trim();
  if (!transcript) return [];

  const patterns = compilePatterns(overrides);

  const segments = transcript
    .split(/[\n\r|,.;!?]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  const chunks: SemanticChunk[] = [];
  for (const segment of segments) {
    const label = classifyChunk(segment, patterns);
    if (!label) continue;

    chunks.push({
      text: segment,
      label,
      ohm: OHM_VALUES[label],
    });
  }

  return chunks;
}

function toScore(voltage: number) {
  if (voltage <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((voltage / 120) * 100)));
}

export function calculateSemanticOhm(
  chunks: SemanticChunk[],
  current: number = 1.0,
): OhmCalculationResult {
  if (!chunks || chunks.length === 0) {
    return {
      totalOhm: 0,
      formula: '0',
      voltage: 0,
      current,
      score: 0,
    };
  }

  const groups: Record<OhmCategory, number[]> = {
    [OhmCategory.GREEN]: [],
    [OhmCategory.BLUE]: [],
    [OhmCategory.RED]: [],
    [OhmCategory.PINK]: [],
  };

  chunks.forEach((chunk) => {
    const value = chunk.ohm ?? OHM_VALUES[chunk.label];
    if (Number.isFinite(value) && value > 0) {
      groups[chunk.label].push(value);
    }
  });

  const groupSums = (Object.keys(groups) as OhmCategory[])
    .map((label) => ({
      label,
      parts: groups[label],
      sum: groups[label].reduce((acc, val) => acc + val, 0),
    }))
    .filter((group) => group.parts.length > 0);

  if (groupSums.length === 0) {
    return {
      totalOhm: 0,
      formula: '0',
      voltage: 0,
      current,
      score: 0,
    };
  }

  const totalOhm = groupSums.reduce((acc, group) => acc * group.sum, 1);
  const formula = groupSums
    .map((group) => (group.parts.length > 1 ? `(${group.parts.join(' + ')})` : `${group.parts[0]}`))
    .join(' x ');

  const voltage = totalOhm * current;

  return {
    totalOhm,
    formula,
    current,
    voltage,
    score: toScore(voltage),
  };
}

export function getDifficultyLabel(voltage: number): string {
  if (voltage <= 20) return 'Beginner';
  if (voltage <= 50) return 'Intermediate';
  if (voltage <= 100) return 'Advanced';
  return 'Master';
}
