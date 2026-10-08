import { cardOrder, nonEmptySubsets, rankChar, RULE_VERSION, suitName, validateInput } from "./cards.js";
import type {
  Card,
  CategoryTotal,
  ScoreEvidence,
  ScoreInput,
  ScoreResult,
} from "./types.js";

interface Entry {
  card: Card;
  role: "hand" | "start";
}

const LABELS: Record<string, string> = {
  fifteens: "十五",
  pairs: "对子",
  runs: "顺子",
  flush: "同花",
  nobs: "nobs（与起始牌同花的 J）",
};

export function score(input: ScoreInput): ScoreResult {
  const { handCards, startCard, mode } = validateInput(input);

  const entries: Entry[] = [
    ...handCards.map((card) => ({ card, role: "hand" as const })),
    { card: startCard, role: "start" as const },
  ].sort((a, b) => cardOrder(a.card) - cardOrder(b.card));

  const evidence: ScoreEvidence[] = [];
  evidence.push(...scoreFifteens(entries));
  evidence.push(...scorePairs(entries));
  evidence.push(...scoreRuns(entries));
  evidence.push(...scoreFlush(handCards, startCard, mode));
  evidence.push(...scoreNobs(handCards, startCard));

  const total = evidence.reduce((sum, e) => sum + e.points, 0);
  evidence.sort((a, b) => categoryIndex(a.category) - categoryIndex(b.category));

  return {
    hand: handCards.map((c) => c.code),
    start: startCard.code,
    mode,
    ruleVersion: RULE_VERSION,
    total,
    categoryTotals: buildCategoryTotals(evidence),
    evidence,
  };
}

function categoryIndex(c: string): number {
  return ["fifteens", "pairs", "runs", "flush", "nobs"].indexOf(c);
}

function toEvidence(
  category: ScoreEvidence["category"],
  points: number,
  picked: Entry[],
  detail: string,
  ranks?: number[],
): ScoreEvidence {
  return {
    category,
    points,
    ranks,
    cards: picked.map((e) => e.card.code),
    roles: picked.map((e) => e.role),
    detail,
  };
}

/** 十五：枚举五张牌所有非空子集，点值和恰好 15，每组 2 分 */
function scoreFifteens(entries: Entry[]): ScoreEvidence[] {
  const out: ScoreEvidence[] = [];
  for (const subset of nonEmptySubsets(entries)) {
    const sum = subset.reduce((s, e) => s + e.card.pip, 0);
    if (sum === 15) {
      const ranksDesc = subset
        .map((e) => e.card.code)
        .join("+");
      out.push(toEvidence("fifteens", 2, subset, `点值合计 15：${ranksDesc}（2 分）`));
    }
  }
  return out;
}

/** 对子：枚举所有两张同等级子集，每对 2 分（三条=3 对、四条=6 对自然成立） */
function scorePairs(entries: Entry[]): ScoreEvidence[] {
  const out: ScoreEvidence[] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (entries[i].card.rank === entries[j].card.rank) {
        const picked = [entries[i], entries[j]];
        out.push(
          toEvidence(
            "pairs",
            2,
            picked,
            `${rankChar(entries[i].card.rank)} 对子：${picked.map((e) => e.card.code).join("+")}（2 分）`,
          ),
        );
      }
    }
  }
  return out;
}

/**
 * 顺子：至少三张、等级互异且连续。
 * 先枚举所有合格子集确定全局最大长度 L，再只计长度为 L 的实体子集，每组 L 分。
 */
function scoreRuns(entries: Entry[]): ScoreEvidence[] {
  const candidates: { subset: Entry[]; length: number }[] = [];
  for (const subset of nonEmptySubsets(entries)) {
    if (subset.length < 3) continue;
    const ranks = subset.map((e) => e.card.rank);
    if (new Set(ranks).size !== ranks.length) continue;
    const min = Math.min(...ranks);
    const max = Math.max(...ranks);
    if (max - min + 1 === ranks.length) {
      candidates.push({ subset, length: ranks.length });
    }
  }
  if (candidates.length === 0) return [];
  const maxLen = Math.max(...candidates.map((c) => c.length));
  return candidates
    .filter((c) => c.length === maxLen)
    .map((c) => {
      const ordered = [...c.subset].sort((a, b) => a.card.rank - b.card.rank);
      const ranks = ordered.map((e) => e.card.rank);
      return toEvidence(
        "runs",
        maxLen,
        c.subset,
        `${maxLen} 张顺子 ${ranks.map(rankChar).join("-")}：${ordered
          .map((e) => e.card.code)
          .join(" ")}（${maxLen} 分）`,
        ranks,
      );
    });
}

/** 同花：hand 模式四张手牌同花 4 分、起始牌也同花则 5 分；crib 必须五张全同花 5 分 */
function scoreFlush(
  handCards: Card[],
  startCard: Card,
  mode: "hand" | "crib",
): ScoreEvidence[] {
  const handSame = handCards.every((c) => c.suit === handCards[0].suit);
  const allSame = handSame && startCard.suit === handCards[0].suit;

  if (mode === "crib") {
    if (!allSame) return [];
    return [
      toEvidence(
        "flush",
        5,
        [...handCards, startCard].map((card) => ({ card, role: card === startCard ? ("start" as const) : ("hand" as const) })),
        `crib 五张全部${suitName(startCard.suit)}同花（5 分）`,
      ),
    ];
  }

  if (!handSame) return [];
  if (allSame) {
    return [
      toEvidence(
        "flush",
        5,
        [...handCards, startCard].map((card) => ({ card, role: card === startCard ? ("start" as const) : ("hand" as const) })),
        `四张手牌${suitName(handCards[0].suit)}同花且起始牌同花色（5 分）`,
      ),
    ];
  }
  return [
    toEvidence(
      "flush",
      4,
      handCards.map((card) => ({ card, role: "hand" as const })),
      `四张手牌全部${suitName(handCards[0].suit)}同花（4 分）`,
    ),
  ];
}

/** nobs：手牌中有一张 J 且与起始牌同花，加 1 分；起始牌自身是 J 不算 */
function scoreNobs(handCards: Card[], startCard: Card): ScoreEvidence[] {
  const jack = handCards.find((c) => c.rank === 11 && c.suit === startCard.suit);
  if (!jack) return [];
  return [
    toEvidence(
      "nobs",
      1,
      [
        { card: jack, role: "hand" as const },
        { card: startCard, role: "start" as const },
      ],
      `手牌 ${jack.code} 是与起始牌 ${startCard.code} 同花的 J（nobs，1 分）`,
    ),
  ];
}

function buildCategoryTotals(evidence: ScoreEvidence[]): CategoryTotal[] {
  const order = ["fifteens", "pairs", "runs", "flush", "nobs"];
  return order.map((category) => {
    const items = evidence.filter((e) => e.category === category);
    return {
      category: category as CategoryTotal["category"],
      label: LABELS[category],
      count: items.length,
      points: items.reduce((s, e) => s + e.points, 0),
    };
  });
}
