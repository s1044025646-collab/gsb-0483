import { readFileSync } from 'node:fs';
import { Store } from './db.js';
import { validateAndScore } from './validate.js';
import { ScoreResult } from './scoring.js';

function printResult(result: ScoreResult, id?: number, created?: boolean): void {
  const head = id != null ? `报告 #${id}${created === false ? '（已存在，幂等返回）' : ''} ` : '';
  console.log(`${head}模式=${result.mode} 手牌=${result.hand.join(' ')} 起始牌=${result.starter} 规则=${result.ruleVersion}`);
  const names: Record<string, string> = { fifteens: '十五', pairs: '对子', runs: '顺子', flush: '同花', nobs: 'nobs' };
  for (const cat of Object.keys(names)) {
    console.log(`  ${names[cat]}: ${result.breakdown[cat as keyof typeof result.breakdown]} 分`);
    for (const e of result.evidence.filter((x) => x.category === cat)) {
      console.log(`    +${e.points}  ${e.detail}`);
    }
  }
  console.log(`  总分: ${result.total}`);
}

function parseScoreArgs(args: string[]): { hand: string[]; starter: string; mode: string } {
  const get = (k: string) => {
    const a = args.find((x) => x.startsWith(`--${k}=`));
    return a ? a.split('=').slice(1).join('=') : undefined;
  };
  const hand = get('hand')?.split(/[,\s]+/).filter(Boolean);
  const starter = get('starter');
  const mode = get('mode') ?? 'hand';
  if (!hand || !starter) {
    console.error('用法: score --hand=H5,D5,C5,SJ --starter=S5 [--mode=hand|crib]');
    process.exit(2);
  }
  return { hand, starter, mode };
}

function main(): void {
  const [cmd, ...args] = process.argv.slice(2);
  const store = new Store();
  try {
    switch (cmd) {
      case 'score': {
        const req = parseScoreArgs(args);
        const result = validateAndScore(req);
        const { report, created } = store.save(result);
        printResult(result, report.id, created);
        break;
      }
      case 'compare': {
        const get = (k: string) => args.find((x) => x.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
        const hand = get('hand')?.split(/[,\s]+/).filter(Boolean);
        const starters = get('starters')?.split(/[,\s]+/).filter(Boolean);
        const mode = get('mode') ?? 'hand';
        if (!hand || !starters?.length) {
          console.error('用法: compare --hand=HA,DA,C2,S3 --starters=H4,D4,C4 [--mode=hand|crib]');
          process.exit(2);
        }
        for (const starter of starters) {
          const result = validateAndScore({ hand, starter, mode });
          const { report, created } = store.save(result);
          printResult(result, report.id, created);
          console.log('');
        }
        break;
      }
      case 'batch': {
        const file = args.find((x) => x.startsWith('--file='))?.split('=').slice(1).join('=');
        if (!file) {
          console.error('用法: batch --file=examples.json  （JSON 数组，每行 {hand,starter,mode}）');
          process.exit(2);
        }
        const rows = JSON.parse(readFileSync(file, 'utf8'));
        if (!Array.isArray(rows)) throw new Error('批量文件必须是 JSON 数组');
        rows.forEach((row, index) => {
          try {
            const result = validateAndScore(row);
            const { report, created } = store.save(result);
            console.log(`行 ${index}: 报告 #${report.id}${created ? '' : '（幂等）'} 总分=${result.total}`);
          } catch (e) {
            const err = e as Error & { code?: string };
            console.log(`行 ${index}: 失败 [${err.code ?? 'E_INTERNAL'}] ${err.message}`);
          }
        });
        break;
      }
      case 'report': {
        const id = Number(args[0]);
        const report = store.get(id);
        if (!report) {
          console.error(`报告 ${id} 不存在`);
          process.exit(1);
        }
        printResult(report.result, report.id);
        break;
      }
      case 'list': {
        for (const r of store.list()) {
          console.log(`#${r.id} [${r.createdAt}] ${r.mode} 手牌=${r.hand.join(' ')} 起始=${r.starter} 总分=${r.total}`);
        }
        break;
      }
      case 'export': {
        const id = Number(args[0]);
        const report = store.get(id);
        if (!report) {
          console.error(`报告 ${id} 不存在`);
          process.exit(1);
        }
        console.log(JSON.stringify({ ...report.result, id: report.id, createdAt: report.createdAt }, null, 2));
        break;
      }
      default:
        console.log(`Cribbage 摊牌计分 CLI
用法:
  node dist/cli.js score   --hand=H5,D5,C5,SJ --starter=S5 [--mode=hand|crib]
  node dist/cli.js compare --hand=HA,DA,C2,S3 --starters=H4,D4,C4 [--mode=...]
  node dist/cli.js batch   --file=examples.json
  node dist/cli.js report  <id>     查看冻结报告
  node dist/cli.js list           列出最近报告
  node dist/cli.js export  <id>     导出 JSON`);
    }
  } catch (e) {
    const err = e as Error & { code?: string };
    console.error(`错误 [${err.code ?? 'E_INTERNAL'}] ${err.message}`);
    process.exit(1);
  } finally {
    store.close();
  }
}

main();
