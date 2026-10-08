import { Card, cardIds, pipValue, rankValue, sortCards } from './cards.js';

export type Mode = 'hand' | 'crib';
export type Category = 'fifteens' | 'pairs' | 'runs' | 'flush' | 'nobs';

export const RULE_VERSION = 'cribbage-show-v1';

export interface Evidence {
  category: Category;
  points: number;
  /** 组合来源的实体牌 id，稳定排序 */
  cards: string[];
  /** 人类可读说明，顺子含有序等级 */
  detail: string;
}

export interface ScoreResult {
  total: number;
  mode: Mode;
  ruleVersion: string;
  hand: string[];
  starter: string;
  breakdown: Record<Category, number>;
  evidence: Evidence[];
}

/** 所有非空子集（按下标枚举，保证不同实体组合不合并） */
function* subsets<T>(items: T[]): Generator<T[]> {
  const n = items.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const out: T[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) out.push(items[i]);
    yield out;
  }
}

function scoreFifteens(all: Card[]): Evidence[] {
  const out: Evidence[] = [];
  for (const sub of subsets(all)) {
    const sum = sub.reduce((s, c) => s + pipValue(c.rank), 0);
    if (sum === 15) {
      out.push({
        category: 'fifteens',
        points: 2,
        cards: cardIds(sub),
        detail: `点值和=15: ${cardIds(sub).join(' ')}`,
      });
    }
  }
  return out;
}

function scorePairs(all: Card[]): Evidence[] {
  const out: Evidence[] = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (all[i].rank === all[j].rank) {
        out.push({
          category: 'pairs',
          points: 2,
          cards: cardIds([all[i], all[j]]),
          detail: `一对 ${all[i].rank}: ${all[i].id} ${all[j].id}`,
        });
      }
    }
  }
  return out;
}

/** 等级互异且连续的子集判定 */
function isRun(sub: Card[]): boolean {
  const vals = sub.map((c) => rankValue(c.rank)).sort((a, b) => a - b);
  for (let i = 1; i < vals.length; i++) {
    if (vals[i] !== vals[i - 1] + 1) return false;
  }
  return true;
}

function scoreRuns(all: Card[]): Evidence[] {
  // 先求全局最长顺子长度 L，再枚举所有长度 L 的实体子集
  let maxLen = 0;
  const byLen = new Map<number, Card[][]>();
  for (const sub of subsets(all)) {
    if (sub.length < 3) continue;
    if (!isRun(sub)) continue;
    if (sub.length > maxLen) maxLen = sub.length;
    if (!byLen.has(sub.length)) byLen.set(sub.length, []);
    byLen.get(sub.length)!.push(sub);
  }
  if (maxLen < 3) return [];
  return byLen.get(maxLen)!.map((sub) => {
    const ordered = sortCards(sub);
    const ranks = ordered.map((c) => c.rank).join('-');
    return {
      category: 'runs' as const,
      points: maxLen,
      cards: cardIds(sub),
      detail: `${maxLen} 张顺子 (${ranks}): ${cardIds(sub).join(' ')}`,
    };
  });
}

function scoreFlush(hand: Card[], starter: Card, mode: Mode): Evidence[] {
  const handFlush = hand.every((c) => c.suit === hand[0].suit);
  if (mode === 'crib') {
    if (handFlush && starter.suit === hand[0].suit) {
      return [{
        category: 'flush',
        points: 5,
        cards: cardIds([...hand, starter]),
        detail: `crib 五张同花 (${hand[0].suit})`,
      }];
    }
    return [];
  }
  if (!handFlush) return [];
  const out: Evidence[] = [{
    category: 'flush',
    points: 4,
    cards: cardIds(hand),
    detail: `手牌四张同花 (${hand[0].suit})`,
  }];
  if (starter.suit === hand[0].suit) {
    out.push({
      category: 'flush',
      points: 1,
      cards: [starter.id],
      detail: `起始牌同为 ${starter.suit}，同花追加 1 分`,
    });
  }
  return out;
}

function scoreNobs(hand: Card[], starter: Card): Evidence[] {
  const jack = hand.find((c) => c.rank === 'J' && c.suit === starter.suit);
  if (!jack) return [];
  return [{
    category: 'nobs',
    points: 1,
    cards: [jack.id, starter.id],
    detail: `nobs: 手牌 ${jack.id} 与起始牌 ${starter.id} 同花`,
  }];
}

export function scoreHand(hand: Card[], starter: Card, mode: Mode): ScoreResult {
  const all = [...hand, starter];
  const evidence: Evidence[] = [
    ...scoreFifteens(all),
    ...scorePairs(all),
    ...scoreRuns(all),
    ...scoreFlush(hand, starter, mode),
    ...scoreNobs(hand, starter),
  ];
  const breakdown: Record<Category, number> = { fifteens: 0, pairs: 0, runs: 0, flush: 0, nobs: 0 };
  for (const e of evidence) breakdown[e.category] += e.points;
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return {
    total,
    mode,
    ruleVersion: RULE_VERSION,
    hand: cardIds(hand),
    starter: starter.id,
    breakdown,
    evidence,
  };
}
