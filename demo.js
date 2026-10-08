// 演示：经典 29 分牌例 + 双顺牌例 + 批量 + 幂等
import { execFileSync } from 'node:child_process';

const run = (args) => console.log(execFileSync('node', ['dist/src/cli.js', ...args], { encoding: 'utf8' }));

console.log('=== 1. 经典 29 分牌例 ===');
console.log(run(['score', '--hand=H5,D5,C5,SJ', '--starter=S5']));

console.log('=== 2. 双顺牌例（两组四张顺子） ===');
console.log(run(['score', '--hand=HA,DA,C2,S3', '--starter=H4']));

console.log('=== 3. 同一手牌比较不同起始牌 ===');
console.log(run(['compare', '--hand=HA,DA,C2,S3', '--starters=H4,D4,S4']));

console.log('=== 4. 批量导入（含一行非法数据） ===');
console.log(run(['batch', '--file=examples.json']));

console.log('=== 5. 报告列表（重启后仍可读，SQLite 冻结保存） ===');
console.log(run(['list']));
