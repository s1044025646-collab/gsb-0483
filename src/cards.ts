export type Suit = 'H' | 'D' | 'C' | 'S';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export interface Card {
  suit: Suit;
  rank: Rank;
  /** 实体牌唯一标识，如 "H5"、"S10" */
  id: string;
}

export const SUITS: Suit[] = ['H', 'D', 'C', 'S'];
export const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/** 对子/顺子用的真实等级：A=1 ... K=13，A 只作低位 */
export function rankValue(rank: Rank): number {
  return RANKS.indexOf(rank) + 1;
}

/** 计十五用的点值：A=1，JQK=10 */
export function pipValue(rank: Rank): number {
  if (rank === 'A') return 1;
  if (rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  return parseInt(rank, 10);
}

export class CardError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
  }
}

export function parseCard(text: unknown): Card {
  if (typeof text !== 'string') {
    throw new CardError(`牌必须是字符串，收到: ${JSON.stringify(text)}`, 'E_INVALID_CARD_TYPE');
  }
  const m = /^([HDCS])(A|10|[2-9]|[JQK])$/i.exec(text.trim());
  if (!m) {
    throw new CardError(`无法识别的牌: "${text}"，格式应为花色(H/D/C/S)+等级(A,2-10,J,Q,K)`, 'E_INVALID_CARD');
  }
  const suit = m[1].toUpperCase() as Suit;
  const rank = m[2].toUpperCase() as Rank;
  return { suit, rank, id: `${suit}${rank}` };
}

export function parseCards(texts: unknown[]): Card[] {
  return texts.map((t) => parseCard(t));
}

/** 校验五张实体牌互不相同 */
export function assertDistinct(cards: Card[]): void {
  const seen = new Set<string>();
  for (const c of cards) {
    if (seen.has(c.id)) {
      throw new CardError(`重复的实体牌: ${c.id}`, 'E_DUPLICATE_CARD');
    }
    seen.add(c.id);
  }
}

/** 稳定实体牌序：先按等级再按花色，保证同一组合输出唯一 */
export function sortCards(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const d = rankValue(a.rank) - rankValue(b.rank);
    if (d !== 0) return d;
    return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
  });
}

export function cardIds(cards: Card[]): string[] {
  return sortCards(cards).map((c) => c.id);
}
