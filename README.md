# Cribbage 摊牌计分后端

仅实现 Cribbage **摊牌（the show）阶段**的组合计分与最长顺子重数核验。技术栈：TypeScript + Node.js + SQLite（`node:sqlite`，零原生依赖），Windows 本地运行，不需要 Docker / WSL / 外部服务。

## 与扑克、出牌阶段的区别

- **不是扑克牌型比较**：不存在"最佳五张牌型"概念。十五、对子、顺子按**实体牌子集**逐组枚举计分，同一组牌可以同时参与十五和对子，点值形状相同的不同实体组合分别计分、绝不合并。
- **顺子不是简单加倍**：先求五张牌能构成的全局最长顺子长度 L，再枚举所有长度为 L 的实体子集，每组得 L 分；有长顺子时不另算其包含的短顺子。重复等级产生多组等长顺子（如两张 A 配 2-3-4 是两组四张顺子），每份解释都给出有序等级和确切实体牌。
- **不做 pegging**：不实现交替出牌、发牌、弃牌选择、胜率、下注或整局比赛；也不计"翻出 J 给发牌者 2 分"的发牌阶段奖励。
- **起始牌保留身份**：同花与 nobs 规则依赖手牌/起始牌的角色区分，不能混为无角色的五张集合。

## 计分规则（规则版本 `cribbage-show-v1`）

| 类别 | 规则 |
| --- | --- |
| 十五 | 五张牌的任意非空子集，点值和（A=1，J/Q/K=10）恰为 15，每组 2 分 |
| 对子 | 每对同等级实体牌 2 分（三条=3 对=6 分，四条=6 对=12 分） |
| 顺子 | 等级互异且连续（A=1..K=13，A 仅低位，不允许 QKA 环绕）的最长长度 L 的所有实体子集，每组 L 分 |
| 同花 | hand：手牌四张同花 4 分，起始牌也同花共 5 分；crib：必须五张全同花才得 5 分 |
| nobs | 手牌中有 J 与起始牌同花 +1 分；起始牌本身是 J 不加分 |

## 牌例格式

花色 `H/D/C/S` + 等级 `A,2-10,J,Q,K`，如 `H5`、`S10`、`DA`。手牌 4 张 + 起始牌 1 张，五张实体必须互不相同。

## 快速开始

```powershell
npm install
npm run build     # 编译 TypeScript 到 dist/
npm test          # 构建并运行全部测试（node:test）
npm start         # 启动 API 服务（默认自动选择空闲端口）
npm start -- --port=8080   # 或环境变量 PORT=8080
node demo.js      # 演示：29 分牌例、双顺、比较、批量、报告列表
```

数据保存在项目内 `data/cribbage.db`，重启后报告仍可读取（冻结保存，含规则版本与每条得分证据）。

## CLI

```powershell
node dist/src/cli.js score   --hand=H5,D5,C5,SJ --starter=S5 [--mode=hand|crib]
node dist/src/cli.js compare --hand=HA,DA,C2,S3 --starters=H4,D4,C4
node dist/src/cli.js batch   --file=examples.json
node dist/src/cli.js report  <id>     # 查看冻结报告（按类别小计+来源）
node dist/src/cli.js list             # 最近报告
node dist/src/cli.js export  <id>     # 导出 JSON
```

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/score` | `{hand:[4张], starter, mode}` 计分并入库；相同请求幂等返回已有报告 |
| POST | `/api/compare` | `{hand, starters:[...], mode}` 同一手牌比较多个合法起始牌（只处理给定牌） |
| POST | `/api/batch` | 数组批量计分；每行结果带原行号 `row`，单行失败不影响后续行对应关系 |
| GET | `/api/reports` | 最近报告列表 |
| GET | `/api/reports/:id?category=runs` | 报告详情，可按类别过滤得分证据 |
| GET | `/api/export/:id` | 导出冻结报告 JSON |

错误响应统一为 `{ "error": { "code", "message" } }`，错误码包括：`E_BAD_JSON`、`E_BAD_BODY`、`E_BAD_HAND`、`E_BAD_STARTER`、`E_BAD_MODE`、`E_INVALID_CARD`、`E_DUPLICATE_CARD`、`E_NOT_FOUND`。非法牌例不会留下成功报告。

## 已知牌例验证

- `H5 D5 C5 SJ` + `S5`：8 组十五 16 分 + 6 对 12 分 + nobs 1 分 = **29 分**
- `HA DA C2 S3` + `H4`：两组四张顺子 8 分 + 一对 A 2 分 = **10 分**

测试另覆盖：五张连续、双顺/三顺、零分牌例、hand/crib 四张同花差异、起始牌为 J、非法重复实体牌、十五与顺子的独立子集枚举基准核对、输入重排与花色一致重命名不变量。

## 限制与假设

- 仅摊牌阶段；`compare` 只比较给定起始牌，不遍历牌库求最优丢牌。
- 使用 Node 内置实验性 `node:sqlite`（Node ≥ 22.5，本机 Node 25 验证通过），启动时有 ExperimentalWarning 提示，属正常。
- 规则版本变化时同一牌例会另存新报告（按 `request_hash + rule_version` 唯一）。
