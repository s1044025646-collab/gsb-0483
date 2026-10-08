import type { Card, Mode, ScoreInput, Suit } from "./types.js";

export const RULE_VERSION = "cribbage-showdown-v1";

const SUITS: Suit[] = ["S", "H", "D", "C"];
const SUIT_NAME: Record<Suit, string> = {
  S: "黑桃",
  H: "红桃",
  D: "方块",
  C: "梅花",
};
const RANK_CHARS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K"];

export class CardValidationError extends Error {
  code: string;
  row?: number;
  constructor(code: string, message: string, row?: number) {
    super(message);
    this.name = "CardValidationError";
    this.code = code;
    this.row = row;
  }
}

/** 稳定实体牌序：先等级（A..K），同级按花色 S,H,D,C */
export function cardOrder(c: Card): number {
  return c.rank * 10 + SUITS.indexOf(c.suit);
}

export function rankChar(rank: number): string {
  return RANK_CHARS[rank - 1];
}

export function suitName(suit: Suit): string {
  return SUIT_NAME[suit];
}

export function parseCard(raw: string): Card {
  const code = String(raw ?? "").trim().toUpperCase();
  if (code.length !== 2 && code.length !== 3) {
    throw new CardValidationError("INVALID_CARD_FORMAT", `非法牌面格式：${raw}（应为花色+等级，如 H5、SJ、DA、HT）`);
  }
  const suit = code[0] as Suit;
  const rankPart = code.slice(1);
  if (!SUITS.includes(suit)) {
    throw new CardValidationError("INVALID_SUIT", `非法花色：${code[0]}（允许 S/H/D/C）`);
  }
  const idx = RANK_CHARS.indexOf(rankPart);
  if (idx < 0) {
    throw new CardValidationError("INVALID_RANK", `非法等级：${rankPart}（允许 A,2-10(T),J,Q,K；10 写作 T）`);
  }
  const rank = idx + 1;
  const pip = Math.min(rank, 10);
  return { code: `${suit}${rankChar(rank)}`, suit, rank, pip };
}

export interface ParsedHand {
  handCards: Card[];
  startCard: Card;
  mode: Mode;
}

export function validateInput(input: ScoreInput, row?: number): ParsedHand {
  const mode = input.mode;
  if (mode !== "hand" && mode !== "crib") {
    throw new CardValidationError("INVALID_MODE", `非法模式：${String(mode)}（仅允许 hand 或 crib）`, row);
  }
  if (!Array.isArray(input.hand) || input.hand.length !== 4) {
    throw new CardValidationError("INVALID_HAND_SIZE", "手牌必须恰好为 4 张", row);
  }
  if (typeof input.start !== "string") {
    throw new CardValidationError("INVALID_START", "起始牌必须为单张牌", row);
  }
  const handCards = input.hand.map((c) => parseCardWithRow(c, row));
  const startCard = parseCardWithRow(input.start, row);

  const all = [...handCards, startCard];
  const seen = new Set<string>();
  for (const c of all) {
    if (seen.has(c.code)) {
      throw new CardValidationError("DUPLICATE_CARD", `实体牌重复：${c.code}（五张牌必须互不相同）`, row);
    }
    seen.add(c.code);
  }
  return { handCards, startCard, mode };
}

function parseCardWithRow(raw: string, row?: number): Card {
  try {
    return parseCard(raw);
  } catch (e) {
    if (e instanceof CardValidationError && row !== undefined) {
      throw new CardValidationError(e.code, e.message, row);
    }
    throw e;
  }
}

/** 枚举数组所有非空子集（保持元素的稳定顺序） */
export function nonEmptySubsets<T>(items: T[]): T[][] {
  const out: T[][] = [];
  const n = items.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const subset: T[] = [];
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) subset.push(items[i]);
    }
    out.push(subset);
  }
  return out;
}
