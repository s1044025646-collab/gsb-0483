import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { score } from "./scorer.js";
import { CardValidationError } from "./cards.js";
import { listCases, loadReport, openDb, saveResult } from "./db.js";
import type { ScoreInput } from "./types.js";

const DATA_DIR = process.env.CRIBBAGE_DATA_DIR ?? resolve(process.cwd(), "data");
const DB_PATH = resolve(DATA_DIR, "cribbage.sqlite");

export interface StartResult {
  server: Server;
  port: number;
}

export async function startServer(requestedPort?: number): Promise<StartResult> {
  openDb(DB_PATH);
  const server = createServer(handleRequest);
  const port = requestedPort ?? Number(process.env.PORT ?? 0);
  await new Promise<void>((res, rej) => {
    server.once("error", rej);
    server.listen(port, "127.0.0.1", () => res());
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  return { server, port: actualPort };
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(text);
}

function errorBody(code: string, message: string, extra?: Record<string, unknown>) {
  return { error: { code, message, ...extra } };
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const path = url.pathname;

  try {
    if (req.method === "GET" && path === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && path === "/api/score") {
      const body = (await readJson(req)) as ScoreInput;
      const result = score(body);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && path === "/api/hands") {
      const body = (await readJson(req)) as { id?: unknown } & ScoreInput;
      if (typeof body.id !== "string" || !/^[A-Za-z0-9_\-:]{1,64}$/.test(body.id)) {
        sendJson(res, 400, errorBody("INVALID_ID", "id 必须为 1-64 位字母/数字/_/-/: 字符串"));
        return;
      }
      const result = score(body);
      const report = saveResult(body.id, body, result);
      sendJson(res, 200, report);
      return;
    }

    if (req.method === "POST" && path === "/api/batch") {
      const body = (await readJson(req)) as { items?: Array<{ id?: string } & ScoreInput> };
      if (!body || !Array.isArray(body.items)) {
        sendJson(res, 400, errorBody("INVALID_BATCH", "请求体需包含 items 数组"));
        return;
      }
      const results: unknown[] = [];
      const failures: Array<{ row: number; code: string; message: string }> = [];
      body.items.forEach((item, idx) => {
        const row = idx + 1;
        try {
          if (!item || typeof item.id !== "string" || !/^[A-Za-z0-9_\-:]{1,64}$/.test(item.id)) {
            throw new CardValidationError("INVALID_ID", "id 必须为 1-64 位字母/数字/_/-/: 字符串", row);
          }
          const result = score(item);
          const report = saveResult(item.id, item, result);
          results.push({ row, id: item.id, report });
        } catch (e) {
          if (e instanceof CardValidationError) {
            failures.push({ row, code: e.code, message: e.message });
          } else {
            failures.push({ row, code: "INTERNAL_ERROR", message: (e as Error).message });
          }
        }
      });
      sendJson(res, 200, {
        total: body.items.length,
        succeeded: results.length,
        failed: failures.length,
        results,
        failures,
      });
      return;
    }

    const reportMatch = path.match(/^\/api\/hands\/([^/]+)(?:\/versions\/(\d+))?$/);
    if (req.method === "GET" && reportMatch) {
      const id = decodeURIComponent(reportMatch[1]);
      const version = reportMatch[2] ? Number(reportMatch[2]) : undefined;
      const report = loadReport(id, version);
      if (!report) {
        sendJson(res, 404, errorBody("NOT_FOUND", `未找到牌例 ${id}${version ? ` 版本 ${version}` : ""}`));
        return;
      }
      const category = url.searchParams.get("category");
      if (category) {
        const allowed = ["fifteens", "pairs", "runs", "flush", "nobs"];
        if (!allowed.includes(category)) {
          sendJson(res, 400, errorBody("INVALID_CATEGORY", `类别需为 ${allowed.join("/")}`));
          return;
        }
        sendJson(res, 200, {
          ...report,
          evidence: report.evidence.filter((e) => e.category === category),
        });
        return;
      }
      sendJson(res, 200, report);
      return;
    }

    if (req.method === "GET" && path === "/api/hands") {
      sendJson(res, 200, { cases: listCases() });
      return;
    }

    if (req.method === "POST" && path === "/api/compare") {
      const body = (await readJson(req)) as { hand?: string[]; mode?: "hand" | "crib"; starts?: string[] };
      if (!body || !Array.isArray(body.hand) || !Array.isArray(body.starts) || body.starts.length === 0) {
        sendJson(res, 400, errorBody("INVALID_COMPARE", "需提供 hand 数组与非空 starts 数组"));
        return;
      }
      const comparisons = body.starts.map((startCard) => ({
        start: startCard,
        result: score({ hand: body.hand!, start: startCard, mode: body.mode ?? "hand" }),
      }));
      sendJson(res, 200, { hand: body.hand, mode: body.mode ?? "hand", comparisons });
      return;
    }

    sendJson(res, 404, errorBody("NOT_FOUND", `无此路由：${req.method} ${path}`));
  } catch (e) {
    if (e instanceof CardValidationError) {
      sendJson(res, 400, errorBody(e.code, e.message, e.row !== undefined ? { row: e.row } : undefined));
    } else if (e instanceof SyntaxError) {
      sendJson(res, 400, errorBody("INVALID_JSON", "请求体不是合法 JSON"));
    } else {
      sendJson(res, 500, errorBody("INTERNAL_ERROR", (e as Error).message));
    }
  }
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`) {
  startServer()
    .then(({ port }) => {
      console.log(`Cribbage 计分服务已启动：http://127.0.0.1:${port}`);
      console.log(`数据目录：${DATA_DIR}`);
    })
    .catch((e) => {
      console.error("启动失败：", e);
      process.exit(1);
    });
}
