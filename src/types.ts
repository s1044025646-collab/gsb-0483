export type Suit = "S" | "H" | "D" | "C";

export type Mode = "hand" | "crib";

export interface Card {
  /** 两字符牌，如 H5、SJ、DA */
  code: string;
  suit: Suit;
  /** A=1 ... K=13 */
  rank: number;
  /** 计分点值：A=1，2-10 按面值，J/Q/K=10 */
  pip: number;
}

export type Category =
  | "fifteens"
  | "pairs"
  | "runs"
  | "flush"
  | "nobs";

export interface ScoreEvidence {
  category: Category;
  /** 该份证据得分 */
  points: number;
  /** 有序等级（顺子时使用，如 [1,2,3,4]；其他类别可省略） */
  ranks?: number[];
  /** 组成该证据的实体牌 code，按稳定实体牌序排序 */
  cards: string[];
  /** 每张牌的角色，与 cards 一一对应：hand/start */
  roles: Array<"hand" | "start">;
  /** 人类可读说明 */
  detail: string;
}

export interface CategoryTotal {
  category: Category;
  label: string;
  count: number;
  points: number;
}

export interface ScoreResult {
  hand: string[];
  start: string;
  mode: Mode;
  ruleVersion: string;
  total: number;
  categoryTotals: CategoryTotal[];
  evidence: ScoreEvidence[];
}

export interface ScoreInput {
  hand: string[];
  start: string;
  mode: Mode;
}

export interface ValidationError {
  code: string;
  message: string;
  /** 出错的原始行号（批量导入时），单例可省略 */
  row?: number;
}
