import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCard, parseCards, assertDistinct, pipValue, rankValue, Card, CardError } from '../src/cards.js';
import { scoreHand } from '../src/scoring.js';
import { validateAndScore } from '../src/validate.js';

const C = (s: string) => parseCard(s);
const score = (hand: string[], starter: string, mode: 'hand' | 'crib' = 'hand') =>
  scoreHand(parseCards(hand), C(starter), mode);

// ---------- 独立基准实现（与被测代码不共享逻辑） ----------
function* allSubsets<T>(items: T[]): Generator<T[]> {
  const n = items.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const out: T[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) out.push(items[i]);
    yield out;
  }
}
function baselineFifteens(all: Card[]): Set<string> {
  const set = new Set<string>();
  for (const sub of allSubsets(all)) {
    if (sub.reduce((s, c) => s + pipValue(c.rank), 0) === 15) {
      set.add(sub.map((c) => c.id).sort().join(','));
    }
  }
  return set;
}
function baselineRuns(all: Card[]): Set<string> {
  const runs: Card[][] = [];
  let max = 0;
  for (const sub of allSubsets(all)) {
    if (sub.length < 3) continue;
    const vals = sub.map((c) => rankValue(c.rank));
    if (new Set(vals).size !== vals.length) continue;
    const sorted = [...vals].sort((a, b) => a - b);
    if (sorted[sorted.length - 1] - sorted[0] === sorted.length - 1) {
      runs.push(sub);
      max = Math.max(max, sub.length);
    }
  }
  return new Set(runs.filter((r) => r.length === max).map((r) => r.map((c) => c.id).sort().join(',')));
}
const key = (cards: string[]) => [...cards].sort().join(',');

// ---------- 已知牌例 ----------
test('29 分经典牌例: H5 D5 C5 SJ + S5', () => {
  const r = score(['H5', 'D5', 'C5', 'SJ'], 'S5');
  assert.equal(r.breakdown.fifteens, 16);
  assert.equal(r.breakdown.pairs, 12);
  assert.equal(r.breakdown.nobs, 1);
  assert.equal(r.total, 29);
  assert.equal(r.evidence.filter((e) => e.category === 'fifteens').length, 8);
  assert.equal(r.evidence.filter((e) => e.category === 'pairs').length, 6);
});

test('双顺牌例: HA DA C2 S3 + H4 = 10 分', () => {
  const r = score(['HA', 'DA', 'C2', 'S3'], 'H4');
  assert.equal(r.breakdown.runs, 8);
  assert.equal(r.breakdown.pairs, 2);
  assert.equal(r.total, 10);
  const runs = r.evidence.filter((e) => e.category === 'runs');
  assert.equal(runs.length, 2);
  assert.deepEqual(runs.map((e) => key(e.cards)).sort(), ['C2,DA,H4,S3', 'C2,H4,HA,S3']);
});

// ---------- 顺子规则 ----------
test('五张连续等级: 单组五张顺子 5 分', () => {
  const r = score(['H3', 'D4', 'C5', 'S6'], 'H7');
  assert.equal(r.breakdown.runs, 5);
  assert.equal(r.evidence.filter((e) => e.category === 'runs').length, 1);
});

test('重复等级双顺: 2x(3) 共 6 分', () => {
  const r = score(['H3', 'D3', 'C4', 'S5'], 'H9');
  assert.equal(r.breakdown.runs, 6);
  assert.equal(r.evidence.filter((e) => e.category === 'runs').length, 2);
});

test('三顺: 3x(3) 共 9 分', () => {
  const r = score(['H3', 'D3', 'C3', 'S4'], 'H5');
  assert.equal(r.breakdown.runs, 9);
  assert.equal(r.evidence.filter((e) => e.category === 'runs').length, 3);
});

test('有长顺子时不另算短顺子', () => {
  const r = score(['H2', 'D3', 'C4', 'S5'], 'H5'); // 2-3-4-5 四顺 + 一对5
  assert.equal(r.breakdown.runs, 8); // 两组四张顺子
  assert.equal(r.breakdown.pairs, 2);
});

test('不允许 QKA 环绕', () => {
  const r = score(['HQ', 'DK', 'CA', 'S2'], 'H9');
  assert.equal(r.breakdown.runs, 0);
});

test('全无得分牌例为 0 分', () => {
  const r = score(['H2', 'D4', 'C8', 'SK'], 'HQ');
  assert.equal(r.total, 0);
});

// ---------- 同花与 nobs ----------
test('hand 模式: 四张同花 4 分，起始牌同花共 5 分', () => {
  const r4 = score(['H2', 'H4', 'H7', 'H9'], 'CK');
  assert.equal(r4.breakdown.flush, 4);
  const r5 = score(['H2', 'H4', 'H7', 'H9'], 'HK');
  assert.equal(r5.breakdown.flush, 5);
});

test('hand 模式: 手牌不全同花时，三张+起始牌同花不计', () => {
  const r = score(['H2', 'H4', 'H7', 'D9'], 'HK');
  assert.equal(r.breakdown.flush, 0);
});

test('crib 模式: 四张同花得 0，五张同花得 5', () => {
  const r4 = score(['H2', 'H4', 'H7', 'H9'], 'CK', 'crib');
  assert.equal(r4.breakdown.flush, 0);
  const r5 = score(['H2', 'H4', 'H7', 'H9'], 'HK', 'crib');
  assert.equal(r5.breakdown.flush, 5);
});

test('起始牌为 J 不触发 nobs；手牌 J 与起始牌同花才计', () => {
  const r = score(['H2', 'D4', 'C7', 'S9'], 'HJ');
  assert.equal(r.breakdown.nobs, 0);
  const r2 = score(['H2', 'D4', 'C7', 'SJ'], 'H9');
  assert.equal(r2.breakdown.nobs, 0); // SJ 与 HS 不同花
  const r3 = score(['H2', 'D4', 'C7', 'SJ'], 'SK');
  assert.equal(r3.breakdown.nobs, 1);
});

// ---------- 校验 ----------
test('非法重复实体牌报错且不产生结果', () => {
  assert.throws(() => validateAndScore({ hand: ['H5', 'D5', 'C5', 'SJ'], starter: 'H5' }), /重复/);
  assert.throws(() => validateAndScore({ hand: ['H5', 'H5', 'C5', 'SJ'], starter: 'D2' }), /重复/);
});

test('参数校验错误码', () => {
  assert.throws(() => validateAndScore({ hand: ['H5'], starter: 'D2' }), (e: any) => e.code === 'E_BAD_HAND');
  assert.throws(() => validateAndScore({ hand: ['H5', 'D5', 'C5', 'SJ'], starter: 'XX' }), (e: any) => e.code === 'E_INVALID_CARD');
  assert.throws(() => validateAndScore({ hand: ['H5', 'D5', 'C5', 'SJ'], starter: 'D2', mode: 'x' }), (e: any) => e.code === 'E_BAD_MODE');
});

// ---------- 基准核对 ----------
test('十五与顺子来源集合与独立基准一致（多组牌例）', () => {
  const cases: [string[], string][] = [
    [['H5', 'D5', 'C5', 'SJ'], 'S5'],
    [['HA', 'DA', 'C2', 'S3'], 'H4'],
    [['H3', 'D4', 'C5', 'S6'], 'H7'],
    [['H3', 'D3', 'C3', 'S4'], 'H5'],
    [['H2', 'D4', 'C7', 'S9'], 'HK'],
    [['H10', 'DJ', 'CQ', 'SK'], 'H5'],
    [['HA', 'H2', 'H3', 'D3'], 'C3'],
  ];
  for (const [hand, starter] of cases) {
    const cards = [...parseCards(hand), C(starter)];
    const r = score(hand, starter);
    const fif = new Set(r.evidence.filter((e) => e.category === 'fifteens').map((e) => key(e.cards)));
    assert.deepEqual(fif, baselineFifteens(cards), `fifteens mismatch for ${hand}+${starter}`);
    const runs = new Set(r.evidence.filter((e) => e.category === 'runs').map((e) => key(e.cards)));
    assert.deepEqual(runs, baselineRuns(cards), `runs mismatch for ${hand}+${starter}`);
  }
});

// ---------- 不变量 ----------
test('手牌输入重排不改分', () => {
  const a = score(['H5', 'D5', 'C5', 'SJ'], 'S5');
  const b = score(['SJ', 'C5', 'H5', 'D5'], 'S5');
  assert.equal(a.total, b.total);
  assert.deepEqual(
    a.evidence.map((e) => `${e.category}:${key(e.cards)}`).sort(),
    b.evidence.map((e) => `${e.category}:${key(e.cards)}`).sort(),
  );
});

test('全体花色一致重命名不改分', () => {
  const map: Record<string, string> = { H: 'S', S: 'H', C: 'D', D: 'C' };
  const rename = (id: string) => map[id[0]] + id.slice(1);
  const hand = ['H5', 'D5', 'C5', 'SJ'];
  const starter = 'S5';
  const a = score(hand, starter);
  const b = score(hand.map(rename), rename(starter));
  assert.equal(a.total, b.total);
  assert.equal(a.total, 29);
  assert.deepEqual(a.breakdown, b.breakdown);
});
