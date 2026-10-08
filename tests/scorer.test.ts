import test from "node:test";
import assert from "node:assert/strict";
import { score } from "../src/scorer.ts";
import type { ScoreInput } from "../src/types.ts";

function s(input: ScoreInput) {
  return score(input);
}

function cat(result: ReturnType<typeof score>, name: string) {
  return result.evidence.filter((e) => e.category === name);
}

test("经典牌例 H5 D5 C5 SJ + S5 总计 29 分", () => {
  const r = s({ hand: ["H5", "D5", "C5", "SJ"], start: "S5", mode: "hand" });
  assert.equal(r.total, 29);
  assert.equal(cat(r, "fifteens").length, 8);
  assert.equal(cat(r, "fifteens").reduce((x, e) => x + e.points, 0), 16);
  assert.equal(cat(r, "pairs").length, 6);
  assert.equal(cat(r, "pairs").reduce((x, e) => x + e.points, 0), 12);
  assert.equal(cat(r, "nobs").length, 1);
  assert.equal(cat(r, "runs").length, 0);
  assert.equal(cat(r, "flush").length, 0);
  // 证据中必须保留角色
  const nobs = cat(r, "nobs")[0];
  assert.deepEqual(nobs.cards, ["SJ", "S5"]);
  assert.deepEqual(nobs.roles, ["hand", "start"]);
});

test("HA DA C2 S3 + H4：两组四张顺子 8 分加一对 A 共 10 分", () => {
  const r = s({ hand: ["HA", "DA", "C2", "S3"], start: "H4", mode: "hand" });
  assert.equal(r.total, 10);
  const runs = cat(r, "runs");
  assert.equal(runs.length, 2);
  assert.ok(runs.every((e) => e.points === 4));
  assert.deepEqual(runs[0].ranks, [1, 2, 3, 4]);
  assert.equal(cat(r, "pairs").length, 1);
  assert.equal(cat(r, "fifteens").length, 0);
});

test("五张连续等级形成单个五张顺子（不再拆分短顺）", () => {
  const r = s({ hand: ["H5", "D6", "C7", "S8"], start: "H9", mode: "hand" });
  const runs = cat(r, "runs");
  assert.equal(runs.length, 1);
  assert.equal(runs[0].points, 5);
  assert.equal(r.total, 5);
});

test("三顺：三张同等级配合连续三张，得到三个等长顺子", () => {
  // 2H 2D 2C 3S + 4H：实体三张 2 各配 3、4 → 三组三张顺
  const r = s({ hand: ["H2", "D2", "C2", "S3"], start: "H4", mode: "hand" });
  const runs = cat(r, "runs");
  assert.equal(runs.length, 3);
  assert.ok(runs.every((e) => e.points === 3));
});

test("有更长顺子时不计内部短顺子", () => {
  // 4,5,6,7 起始 8：唯一 4-5-6-7-8 五张顺
  const r = s({ hand: ["S4", "H5", "D6", "C7"], start: "S8", mode: "hand" });
  assert.equal(cat(r, "runs").length, 1);
  assert.equal(cat(r, "runs")[0].points, 5);
});

test("全无得分返回 0", () => {
  const r = s({ hand: ["HA", "H3", "D7", "CK"], start: "S9", mode: "hand" });
  assert.equal(r.total, 0);
  assert.ok(r.evidence.length === 0);
});

test("hand 模式四张手牌同花 4 分，起始牌同花升 5 分", () => {
  const four = s({ hand: ["HA", "H2", "H3", "H6"], start: "D7", mode: "hand" });
  assert.equal(cat(four, "flush").length, 1);
  assert.equal(cat(four, "flush")[0].points, 4);

  const five = s({ hand: ["HA", "H2", "H3", "H6"], start: "H7", mode: "hand" });
  assert.equal(cat(five, "flush")[0].points, 5);
});

test("三张手牌+起始牌同花不计同花", () => {
  const r = s({ hand: ["HA", "H2", "H3", "D6"], start: "H7", mode: "hand" });
  assert.equal(cat(r, "flush").length, 0);
});

test("crib 必须五张全同花，四张为 0", () => {
  const four = s({ hand: ["HA", "H2", "H3", "H6"], start: "D7", mode: "crib" });
  assert.equal(cat(four, "flush").length, 0);
  const five = s({ hand: ["HA", "H2", "H3", "H6"], start: "H7", mode: "crib" });
  assert.equal(cat(five, "flush")[0].points, 5);
});

test("起始牌本身是 J 不产生 nobs", () => {
  const r = s({ hand: ["H2", "D4", "C6", "S8"], start: "SJ", mode: "hand" });
  assert.equal(cat(r, "nobs").length, 0);
});

test("nobs 只认手牌中与起始牌同花的 J", () => {
  const yes = s({ hand: ["H2", "D4", "C6", "SJ"], start: "S5", mode: "hand" });
  assert.equal(cat(yes, "nobs").length, 1);
  const no = s({ hand: ["H2", "D4", "C6", "HJ"], start: "S5", mode: "hand" });
  assert.equal(cat(no, "nobs").length, 0);
});

test("对子：三条=6 分，四条=12 分", () => {
  const trips = s({ hand: ["H9", "D9", "C9", "S2"], start: "S3", mode: "hand" });
  assert.equal(cat(trips, "pairs").reduce((x, e) => x + e.points, 0), 6);
  const quads = s({ hand: ["H9", "D9", "C9", "S9"], start: "SA", mode: "hand" });
  assert.equal(cat(quads, "pairs").reduce((x, e) => x + e.points, 0), 12);
});

test("A 不环绕：QKA 不算顺子", () => {
  const r = s({ hand: ["HQ", "DK", "CA", "S2"], start: "S9", mode: "hand" });
  assert.equal(cat(r, "runs").length, 0);
});

test("非法：重复实体牌被拒绝", () => {
  assert.throws(
    () => s({ hand: ["H5", "D5", "C5", "SJ"], start: "H5", mode: "hand" }),
    /DUPLICATE_CARD/,
  );
});

test("非法：牌面格式/花色/等级错误码", () => {
  assert.throws(() => s({ hand: ["X5", "D5", "C5", "SJ"], start: "S5", mode: "hand" }), /INVALID_SUIT/);
  assert.throws(() => s({ hand: ["H5", "D5", "C5", "SJ"], start: "S5", mode: "hand" }), () => false);
  assert.throws(() => s({ hand: ["HZ", "D5", "C5", "SJ"], start: "S5", mode: "hand" }), /INVALID_RANK/);
});

test("非法：手牌数量与模式", () => {
  assert.throws(() => s({ hand: ["H5", "D5", "C5"], start: "S5", mode: "hand" }), /INVALID_HAND_SIZE/);
  assert.throws(
    () => s({ hand: ["H5", "D5", "C5", "SJ"], start: "S5", mode: "x" as "hand" }),
    /INVALID_MODE/,
  );
});
