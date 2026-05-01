# Claude 中转站检测工具 (relay-detector)

一个用来识别 Claude API "中转站" 真伪与质量的检测工具。给定一个 `base_url + api_key`,自动跑一组 10 项检测,把结果跟「官方真品基线」做字段级对比,回答三个问题:

1. **真伪**:这家中转站给我的真的是它声称的 Claude 模型吗?
2. **能力**:PDF / Tool Use / Thinking 等高级能力有没有被剥离?
3. **合规**:响应字段、ID 前缀、streaming 协议是否符合 Anthropic 官方规范?

核心创新:**思维签名验证 (ThinkingSignatureDetector)** 利用 Claude 的 thinking 块返回的加密签名(`signature` 字段,~500-2000 字符),无法被中转站伪造。是 10 项里**唯一**可加密级验证的指标,占 25% 权重。

详细设计见 [DESIGN.md](DESIGN.md)。

---

## 🎯 项目部署位置

工具部署在远程服务器上:

| | |
|---|---|
| **服务器** | `root@156.227.236.49` |
| **路径** | `/opt/relay-detector` |
| **Python venv** | `/opt/relay-detector/venv/` |
| **CLI 入口** | `./venv/bin/relay-detector` |

本地代码只是开发副本,通过 `./deploy.sh` 同步到服务器。**实际测试和检测都在服务器上跑**。

---

## ⚡ 五分钟实战:测一家中转站(完整流程)

ssh 到服务器进入项目目录:

```bash
ssh root@156.227.236.49
cd /opt/relay-detector
```

### 步骤 1:配置中转站凭据

编辑 `.env` 文件填入待测中转站的 `base_url` 和 `api_key`:

```bash
nano .env
```

或者一行替换:

```bash
sed -i 's|^ANTHROPIC_BASE_URL=.*|ANTHROPIC_BASE_URL=https://api.apimart.ai|' .env
sed -i 's|^ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=sk-XXXXXX|' .env
```

确认配置:

```bash
grep -E '^ANTHROPIC_(BASE_URL|MODEL)' .env
# ANTHROPIC_BASE_URL=https://api.apimart.ai
# ANTHROPIC_MODEL=claude-haiku-4-5
```

### 步骤 2:跑一次完整检测

```bash
mkdir -p out

./venv/bin/relay-detector detect \
  --model claude-haiku-4-5 \
  --mode full \
  -o out/test_haiku.json
```

`--mode full` 跑全部 10 项 detector,约 1 分钟,成本 ~$0.012(以 Haiku 价格)。

### 步骤 3:跟官方基线对比

```bash
./venv/bin/relay-detector compare out/test_haiku.json
```

工具会:
- 自动从 `data/baselines/claude-haiku-4-5_full.json` 找基线
- 字段级逐项对比 baseline vs relay
- 输出严重度判定(✓ 一致 / ▲ 轻微 / ⚠ 重大 / ✗ 严重)

### 步骤 4:解读 compare 输出

输出长这样(以 router.8864k.com 中转站为例):

```
╭─── 基线对比报告 ───╮
│ baseline: 100.0    │
│ relay:    63.1     │
│ ✗ 严重: 总分 -36.9 │
│ 中转站极有可能不是 │
│ 声称的 Claude 模型 │
╰────────────────────╯
┏━━━━━━━━━━━━━━┳━━━━━━━━━━┳━━━━━━━┳━━━━━┳━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━┓
┃ 项           ┃ baseline ┃ relay ┃ Δ   ┃ 级别   ┃ 差异详情               ┃
┡━━━━━━━━━━━━━━╇━━━━━━━━━━╇━━━━━━━╇━━━━━╇━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━┩
│ 思维签名验证 │ 100      │ 0     │-100 │ ✗ 严重 │ thinking 块完全没返回  │
│ PDF 文档识别 │ 100      │ 50    │ -50 │ ✗ 严重 │ 'responded_but_missed' │
│ 消息标识规范 │ 100      │ 50    │ -50 │ ⚠ 重大 │ id 是 UUID + 'tool_1'  │
│ ...          │ ...      │ ...   │ ... │ ...    │ ...                    │
└──────────────┴──────────┴───────┴─────┴────────┴───────────────────────┘
```

**严重度判定标准:**

| 级别 | 含义 | 典型场景 |
|---|---|---|
| **✗ 严重 (critical)** | 几乎确定不是真品 | thinking 块缺失 / PDF 剥离 / tool_use 假 ID |
| **⚠ 重大 (major)** | 疑似伪装 / 能力降级 | response.model 不匹配 / 用 UUID 替代 msg_ |
| **▲ 轻微 (minor)** | 能用但有协议偏差 | 1-2 题失败 / CV 偏高 / 1-2 个 issues |
| **✓ 一致 (ok)** | 跟官方基线一致 | 关键字段全部匹配 |

任意一项 critical 或多项 major,基本可以判定中转站不是真原生 Claude API。

---

## 🔁 切换到另一家中转站

只需改 `.env`,其他命令不变:

```bash
sed -i 's|^ANTHROPIC_BASE_URL=.*|ANTHROPIC_BASE_URL=https://NEW-RELAY.com|' .env
sed -i 's|^ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=sk-NEW-KEY|' .env

# 跑同样的命令
./venv/bin/relay-detector detect --model claude-haiku-4-5 --mode full -o out/new_relay.json
./venv/bin/relay-detector compare out/new_relay.json
```

## 🔁 一次跑 3 个模型

```bash
mkdir -p out
for m in claude-opus-4-7 claude-sonnet-4-6 claude-haiku-4-5; do
  echo
  echo "════════════════════════════════════════"
  echo "  $m"
  echo "════════════════════════════════════════"
  ./venv/bin/relay-detector detect --model "$m" --mode full \
    -o "out/relay_${m}.json" || { echo "✗ detect 失败,跳过"; continue; }
  echo
  ./venv/bin/relay-detector compare "out/relay_${m}.json"
done
```

约 3 分钟跑完,总成本 ~$0.12(以官方价格估算)。

---

## 📊 实战:apimart vs router.8864k.com

工具能精确区分**真原生 Claude 透传** 和**包装/伪造层**。这是两家中转站的实测对比:

| 维度 | router.8864k.com (假) | apimart (真) |
|---|---|---|
| identity | "我是 Kiro IDE" / "Claude-compatible" 不稳定 | 跟官方文本几乎一字不差 |
| **thinking signature** | **完全消失** | **540 chars 真签名** |
| pdf | 剥离 multimodal,模型说"看不到附件" | 完美识别 magic 字符串 |
| tool_use id | `'tool_1'` 假 ID | `toolu_01NmVcX1xhXne4dCbviQYJoN` 真 ID |
| message_id | UUID `81b21a23-...` | 规范 `msg_xxx` |
| stream input_tokens | 30 vs ns 58 (差 28) | 27 vs ns 27 (完全一致) |
| 非官方 usage 字段 | `claude_cache_creation_5_m_tokens` | 无 |
| **总分** | **63.1 (marginal)** | **100.0 (优秀)** |
| **严重度** | **✗ 严重 (3 critical)** | **✓ 一致** |

apimart 在 **2 个模型** (Opus 4.6 + Sonnet 4.6) 上都通过了字段级 1:1 比对 — 100/100, 全 ✓ 一致。
router.8864k.com 即使是同一个 model name 跑两次都不稳定 — thinking signature 永远缺失,tool_use ID 还是硬编码的 `'tool_1'`。

---

## 检测维度详解

10 个 detector,按目标分三组(详细规则见 [DESIGN.md §3](DESIGN.md)):

| 类别 | 检测器 | 权重 | 核心检测点 |
|---|---|---|---|
| **真伪辨别** | 身份一致性 (identity) | 5% | 直接询问"你是谁",含 Claude/Anthropic 关键词 |
| | 行为签名验证 (behavioral_signature) | 15% | 3 道行为指纹题(markdown/列表/拒绝风格) |
| | **思维签名验证 ⭐** (thinking_signature) | **25%** | **加密级**: thinking 块的 signature 不可伪造 |
| | 模型一致性 (consistency) | 10% | model 字段匹配 + 多次响应稳定性 (CV) |
| | 知识准确度 (knowledge) | 10% | 5 道 Anthropic 公司知识题 |
| **能力完整** | PDF 文档识别 (pdf) | 8% | base64 PDF + magic string 提取 |
| | 结构化输出 (structured_output) | 12% | tool_use schema 校验 (5 项子检查) |
| **协议合规** | 协议规范性 (protocol) | 5% | 响应字段 + content block 类型 + streaming 序列 |
| | 响应完整性 (integrity) | 5% | stream/non-stream 一致性 (5 项子检查) |
| | 消息标识规范 (message_id) | 5% | id/toolu_/srvtoolu_ 前缀校验 |
| | **总和** | **100%** | |

---

## 三档运行模式

通过 `--mode` 选择检测深度,**对应不同的覆盖度和成本**:

| 模式 | 包含项 | 请求数 | 耗时 | 成本(Haiku) | 适用场景 |
|---|---|---|---|---|---|
| `quick` | 5 项核心 | ~6 | ~15s | ~$0.005 | 快速摸排,检查关键真伪 |
| `standard` | 8 项 | ~12 | ~40s | ~$0.012 | 中等深度,日常用 |
| `full` | 全部 10 项 | ~13 | ~70s | ~$0.020 | 完整对比 baseline,推荐 |

⚠️ **`compare` 命令需要 `full` 模式** — quick / standard 跑出来的报告找不到对应基线(baseline 都是 full 模式收集的)。日常测试用 `--mode full` 最稳。

---

## CLI 详细参考

### `detect` — 跑检测

```bash
./venv/bin/relay-detector detect [OPTIONS]
```

| Flag | 默认 | 说明 |
|---|---|---|
| `--base-url` | `$ANTHROPIC_BASE_URL` (来自 .env) | 中转站根 URL |
| `--api-key` | `$ANTHROPIC_API_KEY` (来自 .env) | API key (sk-...) |
| `--model` | `claude-haiku-4-5` | 测试目标模型 |
| `--mode` | `standard` | `quick` / `standard` / `full` |
| `--max-concurrent` | `3` | 并发请求数(避免压垮中转站) |
| `--timeout` | `30` | 单请求超时秒数 |
| `--output` `-o` | stdout | JSON 报告输出路径 |

**例子**:
```bash
# 用 .env 配置默认值
./venv/bin/relay-detector detect --model claude-haiku-4-5 --mode full -o out/test.json

# 显式覆盖凭据(不动 .env)
./venv/bin/relay-detector detect \
  --base-url https://api.example.com \
  --api-key sk-xxxxx \
  --model claude-opus-4-7 \
  --mode full \
  -o out/example_opus.json
```

### `compare` — 跟官方基线对比

```bash
./venv/bin/relay-detector compare <relay_report.json> [OPTIONS]
```

| Flag | 默认 | 说明 |
|---|---|---|
| 第 1 个参数 | (必填) | relay 检测报告路径(detect 命令的输出) |
| `--baseline` `-b` | (自动) | 显式指定基线文件 |
| `--baseline-dir` | `data/baselines` | 自动查找基线时的目录 |
| `--output` `-o` | stdout | JSON 比对报告输出路径 |

**例子**:
```bash
# 自动找基线(按 model + mode 在 data/baselines/ 查)
./venv/bin/relay-detector compare out/test.json

# 显式指定
./venv/bin/relay-detector compare out/test.json -b data/baselines/claude-opus-4-7_full.json

# 输出 JSON 给后续脚本用
./venv/bin/relay-detector compare out/test.json -o out/test_diff.json
```

### `ping` — 单次连通性测试

```bash
./venv/bin/relay-detector ping --model claude-haiku-4-5
```

打印响应字段 + usage + latency,适合**快速验证 base_url/api_key 能不能用**。耗时 1-3 秒,成本几乎为零。

### `version`

```bash
./venv/bin/relay-detector version
```

---

## 收集官方基线 (bench.sh)

工具自带 `bench.sh` 用来跑官方 Anthropic API 收集"真品参考"。**只在 baseline 缺失或需要刷新时才需要跑**。

```bash
# 收集 4 个模型的官方基线(默认输出 /tmp/baselines/)
# 默认模型: claude-opus-4-7 / claude-sonnet-4-6 / claude-haiku-4-5 / claude-opus-4-6
OFFICIAL_KEY=sk-ant-XXXXX  ./bench.sh

# 输出到项目内 data/baselines/(让 compare 自动发现)
OFFICIAL_KEY=sk-ant-XXXXX  ./bench.sh -o data/baselines

# 仅跑指定模型
OFFICIAL_KEY=sk-ant-XXXXX  ./bench.sh --models 'claude-opus-4-7 claude-haiku-4-5'

# 看完整 flag
./bench.sh --help
```

**注意**:
- `OFFICIAL_KEY` 必须是真**官方** Anthropic API key (`sk-ant-...`),不能是中转站 key
- 跑一次成本约 $0.15(4 个模型 × full 模式)
- baselines 输出后建议放在 `data/baselines/` 让 `compare` 自动发现

---

## 部署/同步代码

本地修改代码后,通过 `deploy.sh` 同步到服务器(`./deploy.sh` 跟服务器是 git push 类似关系):

```bash
# 在本地跑
./deploy.sh                    # 增量同步代码
./deploy.sh --reinstall        # 改了 pyproject.toml 后重装依赖
./deploy.sh --test             # 同步后远程跑 pytest 验证
./deploy.sh --dry-run          # 预览会改什么,不动文件
```

**deploy.sh 不会同步**:`venv/`、`__pycache__/`、`.git/`、`.env`、`.env.bak`、`*.bak`、`baselines/`、`out/`、`tmp/`。

也就是说,**服务器上的 `.env` 是独立维护的** — 本地修改 `.env` 不会推到服务器。这是设计选择,因为本地和服务器测的中转站常常不同。

---

## 项目结构

```
relay-detector/
├── README.md                           # 本文档
├── DESIGN.md                           # 详细技术设计
├── pyproject.toml                      # 依赖 + 包配置
├── bench.sh                            # 收集官方基线脚本
├── deploy.sh                           # 部署同步脚本
├── .env / .env.example                 # 中转站凭据
├── data/baselines/                     # 已验证的官方基线 JSON
│   ├── README.md
│   ├── claude-opus-4-7_full.json       # Opus 4.7 基线 (100/100)
│   ├── claude-sonnet-4-6_full.json     # Sonnet 4.6 基线
│   ├── claude-haiku-4-5_full.json      # Haiku 4.5 基线
│   └── claude-opus-4-6_full.json       # Opus 4.6 (legacy) 基线
├── scripts/
│   └── build_test_pdf.py               # 生成 PDF 测试文档
├── src/relay_detector/
│   ├── cli.py                          # typer CLI 入口 (detect/compare/ping)
│   ├── client.py                       # AnthropicClient + ThrottledClient
│   ├── runner.py                       # 调度 (并行 active + passive observe)
│   ├── scorer.py                       # 加权评分 + verdict 阈值
│   ├── report.py                       # rich 表格 + JSON 序列化
│   ├── comparator.py                   # baseline 对比逻辑
│   ├── models.py                       # pydantic 数据模型 + Mode enum
│   ├── config.py                       # 权重 / 模型参数表
│   ├── detectors/                      # 10 个 detector
│   │   ├── identity.py
│   │   ├── behavioral_signature.py
│   │   ├── thinking_signature.py       # ⭐ 核心
│   │   ├── consistency.py
│   │   ├── knowledge.py
│   │   ├── pdf.py
│   │   ├── structured_output.py
│   │   ├── protocol.py
│   │   ├── integrity.py
│   │   └── message_id.py
│   └── data/                           # detector 内置数据
│       ├── behavioral_signatures.json  # 3 道行为指纹题
│       ├── knowledge_questions.json    # 5 道 Anthropic 知识题
│       └── test_document.pdf           # PDF 检测测试文档
├── tests/                              # 66 个单元测试
└── out/                                # 测试输出目录(gitignored)
```

---

## 评分体系

```
total_score = Σ (detector.score × detector.weight) / Σ effective_weight
              for detector if status != "skip"

verdict:
  ≥ 85       passed (优秀)
  70 – 84    passed (通过)
  50 – 69    marginal (基本合格)
  <  50      failed (未达标)
```

skip 的检测项不参与分母。

---

## 已知 Anthropic API 协议漂移

工具开发过程中发现的 7 处官方文档与实测不符,每处都已在代码里防御处理:

| # | drift | 处理 |
|---|---|---|
| 1 | `anthropic-request-id` header 实测不返回 | 不再校验该 header |
| 2 | 模型自报 cutoff 不准 | 删除该题 |
| 3 | `tool_use.caller` 实际是 dict 不是 string | caller 非 string 时不扣分,记录 keys |
| 4 | Opus 4.7 `temperature` 参数 deprecated,传了 400 | 客户端层按 model 派发剥离 |
| 5 | Opus 4.7 `enabled+budget_tokens` thinking 模式被禁用 | 改用 adaptive thinking |
| 6 | Opus 4.7 `effort` 参数应放 `output_config.effort` | 移到正确位置 |
| 7 | Opus 4.7 streaming 模式 thinking 块不出现(non-stream 正常) | thinking detector 切非流式 |

详见 [DESIGN.md](DESIGN.md)。

---

## ❓ 常见问题

### Q: `compare` 报错"找不到基线文件"

A: `compare` 自动按 `target_model + mode` 在 `data/baselines/` 找。如果你测的 model 没有对应基线(比如 `claude-opus-4-1` 这种 legacy):
```bash
# 选项 1: 跑 bench.sh 收集
OFFICIAL_KEY=sk-ant-XXX  ./bench.sh -o data/baselines --models claude-opus-4-1

# 选项 2: 显式指定一个相近的基线(只是参考,不是严格对比)
./venv/bin/relay-detector compare out/test.json -b data/baselines/claude-sonnet-4-6_full.json
```

### Q: 中转站的 model 名是 `claude-sonnet-4-6-thinking` (带 -thinking 后缀)

A: 这是某些中转站的 routing 约定,模型名带 `-thinking` 表示自动启用 thinking。这跟 `tool_choice: "any"` 不兼容(Anthropic 官方禁止),会导致 StructuredOutputDetector 报 400 错误。**改用不带后缀的模型名**(如 `claude-sonnet-4-6`)即可,detector 自己会按需开 thinking。

### Q: detect 跑了一次,JSON 里 base_url 还是上一次的中转站

A: 检查 `.env` 是不是真的改了:
```bash
grep ^ANTHROPIC_BASE_URL .env
```
如果不对,你可能改的是本地 `.env` 但跑的是服务器(或反过来)。也可能是 `./deploy.sh` 把本地 `.env` 推到了服务器 — 现在 `.env` 已被加入 deploy 排除项,不再有这问题。

### Q: 总分 100 但某些 detector 显示"分数差距 -20 (无具体差异定位)"

A: 这是 comparator 的 fallback 文案,意思是 detector 整体扣了 20 分,但 comparator 还没针对这个字段写专门的字段对比逻辑。这是已知改进项 — 关键 detector(thinking_signature/pdf/tool_use 等)都有具体定位,只有 consistency / structured_output 的某些子项暂时只显示分数差距。

### Q: 中转站延迟 50+ 秒,正常吗?

A: **不正常**,真原生 Claude API 全流程通常 < 30 秒。延迟过长 + 多次 429 退避(`backoff_events > 0`) 是中转站负载或限流严重的信号。本身不直接判定真假,但可以作为质量参考。

### Q: 我想测 OpenAI 兼容协议(/v1/chat/completions),不是 Anthropic 协议

A: 当前工具**只支持 Anthropic Messages API 协议**(`POST /v1/messages`)。OpenAI 兼容路径不在 MVP 范围,见 [DESIGN.md §11](DESIGN.md)。

### Q: 我想加个新的 detector

A: 见 [DESIGN.md §6.2](DESIGN.md) 关于 ActiveDetector / PassiveDetector 的设计,大致步骤:
1. `src/relay_detector/detectors/` 新建文件
2. 继承 `ActiveDetector` 或 `PassiveDetector`
3. 实现 `run()` (active) 或 `observe()` + `finalize()` (passive)
4. 注册到 `detectors/__init__.py` 的 `build_all()`
5. `config.py` 加权重和 mode 映射
6. 写测试

---

## 开发(本地)

```bash
# 装本地依赖(用于跑测试,不要求联网)
python3 -m venv venv
./venv/bin/pip install -e ".[dev]"

# 跑全部 66 个测试
./venv/bin/pytest tests/ -v

# 重新生成 PDF 测试文档
./venv/bin/python scripts/build_test_pdf.py

# 同步到服务器
./deploy.sh
```

---

## License

待定。
