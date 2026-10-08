import http from 'node:http';
import { Store } from './db.js';
import { RequestError, validateAndScore } from './validate.js';

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(json);
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new RequestError('请求体不是合法 JSON', 'E_BAD_JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function createServer(store: Store): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    try {
      if (req.method === 'POST' && path === '/api/score') {
        const body = (await readBody(req)) as any;
        const result = validateAndScore(body);
        const { report, created } = store.save(result);
        send(res, 200, { id: report.id, created, ...result });
        return;
      }
      if (req.method === 'POST' && path === '/api/compare') {
        const body = (await readBody(req)) as any;
        if (!Array.isArray(body?.starters) || body.starters.length === 0) {
          throw new RequestError('starters 必须是非空数组', 'E_BAD_STARTERS');
        }
        const comparisons = body.starters.map((starter: unknown) => {
          const result = validateAndScore({ hand: body.hand, starter, mode: body.mode });
          const { report } = store.save(result);
          return { starter: result.starter, id: report.id, total: result.total, breakdown: result.breakdown };
        });
        send(res, 200, { hand: comparisons.length ? validateAndScore({ hand: body.hand, starter: body.starters[0], mode: body.mode }).hand : [], comparisons });
        return;
      }
      if (req.method === 'POST' && path === '/api/batch') {
        const body = (await readBody(req)) as any;
        const rows = Array.isArray(body) ? body : body?.rows;
        if (!Array.isArray(rows)) throw new RequestError('批量请求必须是数组或 { rows: [...] }', 'E_BAD_BATCH');
        const results = rows.map((row: any, index: number) => {
          try {
            const result = validateAndScore(row);
            const { report } = store.save(result);
            return { row: index, ok: true, id: report.id, total: result.total, breakdown: result.breakdown };
          } catch (e) {
            const err = e as RequestError;
            return { row: index, ok: false, code: err.code ?? 'E_INTERNAL', message: err.message };
          }
        });
        send(res, 200, { results });
        return;
      }
      const reportMatch = /^\/api\/reports\/(\d+)$/.exec(path);
      if (req.method === 'GET' && reportMatch) {
        const report = store.get(Number(reportMatch[1]));
        if (!report) throw new RequestError(`报告 ${reportMatch[1]} 不存在`, 'E_NOT_FOUND');
        const category = url.searchParams.get('category') ?? undefined;
        send(res, 200, { ...report, evidence: store.evidenceOf(report.id, category) });
        return;
      }
      if (req.method === 'GET' && path === '/api/reports') {
        send(res, 200, { reports: store.list() });
        return;
      }
      const exportMatch = /^\/api\/export\/(\d+)$/.exec(path);
      if (req.method === 'GET' && exportMatch) {
        const report = store.get(Number(exportMatch[1]));
        if (!report) throw new RequestError(`报告 ${exportMatch[1]} 不存在`, 'E_NOT_FOUND');
        send(res, 200, { ...report.result, id: report.id, createdAt: report.createdAt });
        return;
      }
      throw new RequestError(`未知路由: ${req.method} ${path}`, 'E_NOT_FOUND');
    } catch (e) {
      const err = e as RequestError;
      const status = err.code === 'E_NOT_FOUND' ? 404 : err instanceof RequestError ? 400 : 500;
      send(res, status, { error: { code: err.code ?? 'E_INTERNAL', message: err.message } });
    }
  });
}

export function startServer(port?: number): Promise<{ server: http.Server; port: number }> {
  const store = new Store();
  const server = createServer(store);
  const listenPort = port ?? Number(process.env.PORT ?? 0); // 默认 0 = 选择空闲端口
  return new Promise((resolve) => {
    server.listen(listenPort, () => {
      const addr = server.address() as any;
      resolve({ server, port: addr.port });
    });
  });
}

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  const portArg = process.argv.find((a) => a.startsWith('--port='));
  const port = portArg ? Number(portArg.split('=')[1]) : undefined;
  startServer(port).then(({ port }) => {
    console.log(`Cribbage 计分服务已启动: http://localhost:${port}`);
  });
}
