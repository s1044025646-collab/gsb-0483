#!/usr/bin/env node
import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { score } from "./scorer.js";
import { CardValidationError, parseCard } from "./cards.js";
import { listCases, loadReport, openDb, saveResult, type StoredReport } from "./db.js";
import type { ScoreInput, ScoreResult } from "./types.js";

const DATA_DIR = process.env.CRIBBAGE_DATA_DIR ?? resolve(process.cwd(), "data");
const DB_PATH = resolve(DATA_DIR, "cribbage.sqlite");

interface ParsedArgs {
  command: string;
  flags: Record<string, string[]>;
  positionals: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const flags: Record<string, string[]> = {};
  const positionals: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const values: string[] = [];
      while (i + 1 < rest.length && !rest[i + 1].startsWith("--")) {
        values.push(rest[++i]);
      }
      flags[key] = values;
    } else {
      positionals.push(token);
    }
  }
  return { command: command ?? "help", flags, positionals };
}

function one(flags: Record<string, string[]>, key: string): string {
  const v = flags[key];
  if (!v || v.length !== 1) throw new CardValidationError("BAD_ARGS", `参数 --${key} 需要恰好一个值`);
  return v[0];
}

function buildInput(flags: Record<string, string[]>): ScoreInput {
  const hand = flags.hand ?? [];
  const start = one(flags, "start");
  const mode = (one(flags, "mode") ?? "hand") as "hand" | "crib";
  return { hand, start, mode };
}

function printResult(result: ScoreResult): void {
  console.log(`手牌: ${result.hand.join(" ")}   起始牌: ${result.start}   模式: ${result.mode}`);
  console.log(`规则版本: ${result.ruleVersion}`);
  console.log("─".repeat(60));
  for (const cat of result.categoryTotals) {
    console.log(`【${cat.label}】 ${cat.count} 组，小计 ${cat.points} 分`);
    for (const e of result.evidence.filter((x) => x.category === cat.category)) {
      console.log(`   - ${e.detail}`);
    }
  }
  console.log("─".repeat(60));
  console.log(`总分: ${result.total}`);
}

function printReport(report: StoredReport): void {
  console.log(`牌例 id: ${report.id}  版本: v${report.version}  冻结时间: ${report.createdAt}`);
  printResult(report);
}

function fail(e: unknown): never {
  if (e instanceof CardValidationError) {
    console.error(`[${e.code}] ${e.message}`);
  } else {
    console.error("[INTERNAL_ERROR]", (e as Error).message);
  }
  process.exit(1);
}

function runDemo(): void {
  const cases: Array<ScoreInput & { name: string }> = [
    { name: "经典 29 分", hand: ["H5", "D5", "C5", "SJ"], start: "S5", mode: "hand" },
    { name: "双四张顺", hand: ["HA", "DA", "C2", "S3"], start: "H4", mode: "hand" },
    { name: "crib 四张同花不计", hand: ["HA", "H2", "H3", "H6"], start: "D7", mode: "crib" },
    { name: "hand 四张同花计 4 分", hand: ["HA", "H2", "H3", "H6"], start: "D7", mode: "hand" },
  ];
  for (const { name, ...input } of cases) {
    console.log("\n" + "=".repeat(60));
    console.log(`演示：${name}`);
    printResult(score(input));
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "help" || args.command === "--help" || args.command === "-h") {
    console.log(`Cribbage 摊牌计分 CLI

  score   --hand <4 张> --start <1 张> --mode hand|crib
  save    --id <id> --hand <4 张> --start <1 张> --mode hand|crib
  get     <id> [--version N] [--category fifteens|pairs|runs|flush|nobs]
  list
  compare --hand <4 张> --starts <若干张> --mode hand|crib
  import  <file.json>          JSON 数组：[{id,hand:[...],start,mode}, ...]
  export  <file.json>          导出全部牌例当前冻结版本
  demo

牌面格式：花色 S/H/D/C + 等级 A,2..9,T(=10),J,Q,K，例如 H5、SJ、DA。`);
    return;
  }

  if (args.command === "demo") {
    runDemo();
    return;
  }

  try {
    switch (args.command) {
      case "score": {
        printResult(score(buildInput(args.flags)));
        break;
      }
      case "save": {
        openDb(DB_PATH);
        const id = one(args.flags, "id");
        const input = buildInput(args.flags);
        printReport(saveResult(id, input, score(input)));
        break;
      }
      case "get": {
        openDb(DB_PATH);
        const id = args.positionals[0];
        if (!id) throw new CardValidationError("BAD_ARGS", "需要提供牌例 id");
        const version = args.flags.version ? Number(one(args.flags, "version")) : undefined;
        const report = loadReport(id, version);
        if (!report) throw new CardValidationError("NOT_FOUND", `未找到牌例 ${id}`);
        const category = args.flags.category ? one(args.flags, "category") : undefined;
        if (category) {
          const filtered = report.evidence.filter((e) => e.category === category);
          console.log(JSON.stringify({ ...report, evidence: filtered }, null, 2));
        } else {
          printReport(report);
        }
        break;
      }
      case "list": {
        openDb(DB_PATH);
        for (const c of listCases()) {
          console.log(`${c.id}\tv${c.version}\t${c.mode}\t${c.total} 分`);
        }
        break;
      }
      case "compare": {
        const hand = args.flags.hand ?? [];
        const starts = args.flags.starts ?? [];
        const mode = (args.flags.mode ? one(args.flags, "mode") : "hand") as "hand" | "crib";
        hand.forEach((c) => parseCard(c));
        const table = starts.map((startCard) => {
          const r = score({ hand, start: startCard, mode });
          return { start: startCard, total: r.total, result: r };
        });
        table.sort((a, b) => b.total - a.total);
        for (const row of table) {
          console.log(`起始牌 ${row.start} → 总分 ${row.total}`);
        }
        break;
      }
      case "import": {
        openDb(DB_PATH);
        const file = args.positionals[0];
        if (!file) throw new CardValidationError("BAD_ARGS", "需要提供 JSON 文件路径");
        const items = JSON.parse(readFileSync(file, "utf8")) as Array<{ id?: string } & ScoreInput>;
        if (!Array.isArray(items)) throw new CardValidationError("INVALID_BATCH", "文件内容必须是 JSON 数组");
        let ok = 0;
        items.forEach((item, idx) => {
          const row = idx + 1;
          try {
            if (!item.id) throw new CardValidationError("INVALID_ID", "缺少 id", row);
            saveResult(item.id, item, score(item));
            ok++;
          } catch (e) {
            if (e instanceof CardValidationError) console.error(`第 ${row} 行失败 [${e.code}] ${e.message}`);
            else console.error(`第 ${row} 行失败 [INTERNAL_ERROR] ${(e as Error).message}`);
          }
        });
        console.log(`导入完成：${items.length} 行，成功 ${ok} 行，失败 ${items.length - ok} 行（失败行不影响后续行）`);
        break;
      }
      case "export": {
        openDb(DB_PATH);
        const file = args.positionals[0];
        if (!file) throw new CardValidationError("BAD_ARGS", "需要提供输出文件路径");
        const reports = listCases().map((c) => loadReport(c.id)!);
        writeFileSync(file, JSON.stringify({ exportedAt: new Date().toISOString(), reports }, null, 2), "utf8");
        console.log(`已导出 ${reports.length} 个牌例到 ${file}`);
        break;
      }
      default:
        throw new CardValidationError("UNKNOWN_COMMAND", `未知命令：${args.command}（运行 help 查看用法）`);
    }
  } catch (e) {
    fail(e);
  }
}

main();
