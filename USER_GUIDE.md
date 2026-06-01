# BannerMorph 用户指南

> **一句话**:把 Banner 模板上的商品图换成你的 N 个商品,一次跑完,自动出图 + 报告。

---

## 一、功能说明

### 1.1 定位

BannerMorph 是一个 **AI 工作台 skill**(支持 Claude Code / Qoder / Trae),把电商运营常见的「**模板 + 批量商品图 = N 张成品 Banner**」流程自动化。运营在对话框里说一句话,3 分钟拿到 5-10 张 Banner + 一份质量评估报告。

### 1.2 解决的场景痛点

| 旧流程 | BannerMorph |
|---|---|
| 运营要发个促销,跟设计师排队等 banner | 运营自助,3 分钟出图 |
| 一张 banner 改 5 个商品要手动改 5 次 | 一次跑完,5 张同时输出 |
| 大促换主推商品,周末值班只能干等 | 复制 Excel + 模板,直接出 |
| 出图质量没法批量评估,只能逐张人工看 | 自动评分 + 报告,问题图一眼定位 |

### 1.3 核心亮点

- **🎯 模板忠实**:文字 / 装饰 / 背景 100% 像素级保留,只替换商品主体
- **📦 4 种商品来源**:单图 / 文件夹 / Excel(图片 URL 列) / URL 列表
- **⚡ 5 张并发**:`gemini-3.1-flash-image-preview`,~20s/张,5 张 30s 跑完
- **🛡 配额预警**:本小时配额超额前就提醒,不让你跑到一半被拒
- **🤖 自动评分**:5 个并发子 agent 评分,通过 / 建议重试 / 失败 三档,~15s
- **📊 漂亮报告**:Markdown + HTML 双格式,HTML 浏览器双击即可看,支持邮件附件
- **🔄 智能重试**:评分员发现问题会直接给"可执行的提示词",retry 自动用上
- **📁 多次跑互不覆盖**:每次自动建 `batch-{时间戳}/` 子目录归档

### 1.4 适用 vs 不适用

**适用**:
- 模板已设计好,要批量换不同商品图(主推商品轮播 / 大促 SKU 切换)
- 商品数量 1-100 张
- 模板文字保持不变(促销文案 / 副标题 / 价签)

**不适用**:
- 需要按商品改 banner 文字内容(这个 skill **不替换文字**)
- 想从零创作 banner(用 Midjourney / Figma)
- 单张一次性 banner(直接跟 Claude 对话生成更快)

---

## 二、使用说明

### 2.1 完整流程

```
┌────────────────────────────────────────────────────────────────┐
│   用户:"用这个模板给我 5 个商品做 banner"                       │
│        + 拖入模板图 + 粘贴 Excel 路径                            │
└─────────────────────────┬──────────────────────────────────────┘
                          ▼
   ┌──────────────────────────────────────────────┐
   │ Step 1  导入模板 + Vision 分析                │
   │ (import_template.js + 主 Claude vision)       │
   └────────────────────┬─────────────────────────┘
                        ▼
   ┌──────────────────────────────────────────────┐
   │ Step 2  解析商品 → 5 张本地路径               │
   │ (parse_products.js)                          │
   └────────────────────┬─────────────────────────┘
                        ▼
   ┌──────────────────────────────────────────────┐
   │ Step 3  并发生图 ~30s + 进度日志              │
   │ (generate_batch.js)                           │
   │ ✓ 配额预检 / ✓ 自动建子目录 / ✓ 进度落盘      │
   └────────────────────┬─────────────────────────┘
                        ▼
   ┌──────────────────────────────────────────────┐
   │ Step 4  5 子 agent 并发评分 ~15s              │
   └────────────────────┬─────────────────────────┘
                        ▼
   ┌──────────────────────────────────────────────┐
   │ Step 5  生成报告(MD + HTML)                  │
   │ (write_report.js)                            │
   └────────────────────┬─────────────────────────┘
                        ▼
              ✅ 5 张 banner + report.html
```

**总耗时**:5 张 ~90 秒(下载 5s + 生成 30s + 评分 15s + 报告 1s + IO 留量)。

### 2.2 实战案例:Lazada 促销 Banner

#### 输入物料

**模板** (`~/.claude/image-cache/.../21.png` 或任意路径):

![template](/Users/soran/.claude/skills/bannermorph/work/template-1779680780586-66de2ced.png)

Lazada 大促 banner,顶部 `UP TO 70% OFF` + `FREE SHIPPING`,中间 `STUDDED TRAINING SOCCER SHOES`,左下角 `WINNER'S TOP PICK!!`,右下 `*T&Cs apply`,中央偏右是一双足球鞋。

**商品 Excel** (`~/Downloads/AItest/test.xlsx`):

| SKU | 商品图链接 | 商品名 |
|-----|----------|--------|
| A001 | https://....jpg | Polo Ralph Lauren 红色手袋 |
| A002 | https://....png | Lancome 紫色喷雾 |
| A003 | https://....jpg | Aesop 棕色洗发水 |
| A004 | https://....png | Kérastase 粉色洗发水 |
| A005 | https://....jpg | MAC 粉饼 |

#### 触发方式

打开 Claude Code,在对话框拖入模板图,然后输入:

> 用这个模板,把 `~/Downloads/AItest/test.xlsx` 里的 5 个商品都做成 banner

或更短:

> 做一批 banner

Claude 识别到关键词后自动调用 BannerMorph skill。

#### 中间过程(你看到什么)

```
我帮你跑这一批:
  • 模板:Lazada 促销 banner(70% OFF + 足球鞋)
  • 商品:5 个(Polo / Lancome / Aesop / Kérastase / MAC)
  • 预估:90 秒

[Step 1] 已导入模板到稳定位置
[Step 2] Excel 解析:5 个商品图下载完毕
[Step 3] 配额检查:本小时已用 0/10,剩 10 张,本批 5 张 → 可以跑
[Step 3] 并发生成中...

  [generate_batch] 1/5 ✓ Polo (17.5s)
  [generate_batch] 2/5 ✓ Lancome (17.7s)
  [generate_batch] 3/5 ✓ Aesop (18.8s)
  [generate_batch] 4/5 ✓ Kérastase (18.9s)
  [generate_batch] 5/5 ✓ MAC (21.3s)

[Step 4] 5 个评分员并发审核中...
[Step 5] 报告已生成

✅ 已完成 5 张  (默认 ideaLAB key, 用 5/10)
   📁 图片: ~/Downloads/AItest/output/batch-20260527-172221/
   📄 报告: 同目录下 report.html(双击可看)
   通过 5 / 建议重试 0 / 失败 0
```

#### 输出样本

5 张 banner(模板的足球鞋被换成各自商品,文字/装饰/草地外框全部 1:1 保留):

| 商品 | 输出 |
|---|---|
| Polo 红手袋 | `01-...-aa2fpg.png` |
| Lancome 紫瓶 | `02-...-353xel.png` |
| Aesop 棕瓶 | `03-...-dd475i.png` |
| Kérastase 粉瓶 | `04-...-yol91w.png` |
| MAC 粉饼 | `05-...-ntz2mx.png` |

#### 报告长这样

`report.html`(13 KB,html-light 模式,双击浏览器即可看):

```
┌──────────────────────────────────────────────────────┐
│ Banner 批量生成报告                                   │
│ 2026-05-27 09:46:40                                  │
├──────────────────────────────────────────────────────┤
│ ┌────────────┐  ┌────┬────┬────┬────┐               │
│ │            │  │ 5  │ 5  │ 0  │ 0  │               │
│ │ [模板缩略图]│  │总数 │通过 │重试 │失败 │               │
│ │            │  └────┴────┴────┴────┘               │
│ └────────────┘  模板路径 / 输出目录                   │
├──────────────────────────────────────────────────────┤
│ ✅ 通过 (5)                                          │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐              │
│ │[Polo 图] │ │[Lancome] │ │[Aesop]   │              │
│ │[通过] 01-Polo  │              │ │              │              │
│ └──────────┘ └──────────┘ └──────────┘              │
│ ┌──────────┐ ┌──────────┐                            │
│ │[Kérastase]│ │[MAC]    │                           │
│ │ ...      │ │ ...      │                           │
│ └──────────┘ └──────────┘                            │
└──────────────────────────────────────────────────────┘
```

每个卡片只显示 **`[绿色 pill: 通过] 商品名`** + 图(通过的不再啰嗦展示评分文案,运营秒过)。

如果有"建议重试"的卡,会多出一行:

```
[黄色 pill: 建议重试] 04-Kerastase
  ⚠ 商品偏离模板原位置较多
  💡 重试提示词: 新商品占画面比例 ≈ 模板原商品的 100%,严格放在模板原位置
```

**Tip**:`重试提示词`这一行是可以**直接拿去 retry** 的指令,不需要你自己翻译。

### 2.3 重试流程

报告里有"建议重试"的卡,直接跟 Claude 说:

> retry 那些不达标的

Claude 自动:
1. 提取 needs_retry 的商品 ID
2. 把每张的 `retry_suggestion` 拼成 prompt addon
3. 调用 `retry_batch.js` 重生(用相同 output_dir,覆盖原图)
4. 重评 + 出新报告
5. 报告里有「评分变化」对比:`#04 6 → 9 ✅`

**重试上限 2 轮** — 同一张图 2 轮仍不达标,Claude 会建议你换源商品图(常见是源图分辨率太低 / 角度不对)。

### 2.4 实用 Tips

#### 拖图直接用
- 拖入模板图后,路径会是 `~/.claude/image-cache/<session>/<n>.png`,Claude 自动用 `import_template.js` 复制到 skill 工作区,你不用管路径细节。

#### Excel 列名很灵活
- "图片 URL" / "Banner URL" / "产品直链" / "PIC" 都识别(数据采样优先,列名启发式兜底)。
- 列里只要是以 `.jpg/.png/.webp/.gif` 结尾的 https 直链就 OK。

#### 配额监控
随时查:
```bash
node ~/.claude/skills/bannermorph/scripts/quota_status.js
```
返回:
```json
{
  "used_last_hour": 5,
  "limit": 10,
  "remaining": 5,
  "reset_estimate_at": "..."
}
```

#### 超过 10 张怎么办
默认 ideaLAB key 每小时 10 张上限。3 个选项:
1. **先跑前 10 张,等下小时再跑剩下的**
2. **换自己的付费 API key**(OpenAI / Gemini / OpenRouter 兼容 OpenAI 协议都行):
   ```bash
   node ~/.claude/skills/bannermorph/scripts/config.js '{
     "api_key": "sk-or-xxx",
     "base_url": "https://openrouter.ai/api/v1",
     "model": "google/gemini-2.5-flash-image"
   }'
   ```
3. **减少数量** 到 10 张以内

#### 大批量(>20 张)报告体积
默认 `format: "both-light"` — HTML 用相对路径不嵌 base64,100 张报告 <100 KB。要发邮件给老板:把整个 `batch-*` 文件夹打 zip 发,HTML 在对方那里双击仍能看图。

如果要 HTML 完全自包含(单文件可邮件附件直发),用 `format: "both"`(base64 inline),代价是 5 张 ~10 MB,100 张 ~180 MB,不适合大批量。

#### 中断恢复
如果 `generate_batch` 跑到一半 panic 或被 Ctrl-C,已经成功的图已经写盘了。读 `_progress.jsonl` 拿到结果:
```bash
node ~/.claude/skills/bannermorph/scripts/recover_results.js \
  '{"output_dir":"/path/to/batch-xxx"}'
```

#### 维护缓存
两个目录会随时间积累:
- `/tmp/bannermorph-products/` — 下载的商品图
- `~/.claude/skills/bannermorph/work/` — 复制的模板图

定期清理:
```bash
# 看哪些会被删(不删)
node ~/.claude/skills/bannermorph/scripts/cleanup.js '{"days":7,"dry_run":true}'

# 真删
node ~/.claude/skills/bannermorph/scripts/cleanup.js '{"days":7}'
```

加到 cron 每周扫一次:
```cron
0 3 * * 0  node ~/.claude/skills/bannermorph/scripts/cleanup.js >/dev/null 2>&1
```

---

## 三、安装说明

### 3.1 支持平台

| 平台 | 安装路径 | 加载方式 |
|---|---|---|
| **Claude Code** | `~/.claude/skills/bannermorph/` | 自动加载,SKILL.md 触发短语命中即生效 |
| **Qoder** | `~/.qoder/skills/bannermorph/` | 同上 |
| **Trae** | `~/.trae/skills/bannermorph/` | 同上 |

三个平台**同一份代码**,SKILL.md 格式遵循 Anthropic Skills 标准。

### 3.2 安装步骤

#### Claude Code(推荐示范)

```bash
# 1. 复制 skill 到加载目录
cp -r /path/to/bannermorph-skill ~/.claude/skills/bannermorph

# 2. 安装依赖(只装 xlsx)
cd ~/.claude/skills/bannermorph && npm install

# 3. 首次跑烟测(纯本地,无网络)
node scripts/smoke_test.js
# 期望: 11 passed, 0 failed
```

#### Qoder

```bash
cp -r /path/to/bannermorph-skill ~/.qoder/skills/bannermorph
cd ~/.qoder/skills/bannermorph && npm install
node scripts/smoke_test.js
```

#### Trae

```bash
cp -r /path/to/bannermorph-skill ~/.trae/skills/bannermorph
cd ~/.trae/skills/bannermorph && npm install
node scripts/smoke_test.js
```

### 3.3 首次配置 API Key

```bash
node ~/.claude/skills/bannermorph/scripts/config.js '{"api_key":"YOUR_IDEALAB_KEY"}'
```

返回 `✅ 已保存配置`,key 保存到 skill 目录的 `.env`(`chmod 0600`,仅 owner 可读写)。

如果使用第三方付费 key(OpenRouter / OpenAI / Gemini 兼容 OpenAI 协议):
```bash
node ~/.claude/skills/bannermorph/scripts/config.js '{
  "api_key": "sk-or-xxx",
  "base_url": "https://openrouter.ai/api/v1",
  "model": "google/gemini-2.5-flash-image"
}'
```

### 3.4 快速使用

配置完成后,打开 AI 工作台,直接说:

- "做一批 banner"
- "批量生成 banner"
- "把这些商品图放进 banner 模板"
- "用这个模板生成多张商品图"
- "make a batch of banners with this template"

主 Claude 会自动启动 BannerMorph skill,引导你提供模板和商品来源。

### 3.5 升级

```bash
# 备份你的 .env(里面有 API key)
cp ~/.claude/skills/bannermorph/.env /tmp/bannermorph-env-backup

# 覆盖安装新版本
rm -rf ~/.claude/skills/bannermorph
cp -r /path/to/new-version ~/.claude/skills/bannermorph
cd ~/.claude/skills/bannermorph && npm install

# 恢复 .env
cp /tmp/bannermorph-env-backup ~/.claude/skills/bannermorph/.env

# 验证
node scripts/smoke_test.js
```

---

## 四、附录

### 4.1 文件结构

```
~/.claude/skills/bannermorph/
├── SKILL.md                  # 给 AI 看的工作流定义
├── USER_GUIDE.md             # 本文件
├── .env                      # API key(gitignored)
├── .env.example
├── .gitignore
├── package.json              # 仅依赖 xlsx
├── references/               # 详细文档,按需加载
│   ├── api-config.md         # 自定义 API endpoint
│   ├── error-codes.md        # 错误码 → 用户文案
│   ├── retry-prompts.md      # issue → addon 映射
│   ├── scoring-rubric.md     # 评分规则
│   ├── score-agent-prompt.md # 评分子 agent 模板
│   └── template-analysis-schema.md  # 模板分析 JSON schema
├── scripts/
│   ├── _lib.js               # 共享工具(args / env / 配额日志)
│   ├── config.js             # 写 .env
│   ├── import_template.js    # 复制模板到 work/
│   ├── parse_products.js     # 4 种商品来源
│   ├── quota_status.js       # 查本小时配额
│   ├── generate_batch.js     # 并发生图
│   ├── retry_batch.js        # 子集重生
│   ├── recover_results.js    # 从 _progress.jsonl 恢复
│   ├── write_report.js       # MD + HTML 报告
│   ├── cleanup.js            # 清理 /tmp + work/
│   └── smoke_test.js         # 本地无网络烟测
└── work/                     # 模板工作区(gitignored)
```

### 4.2 配额规则

**默认 ideaLAB key**:
- 每小时 10 次调用上限
- 单批 ≤ 10 张
- 配额追踪在本地 `.quota-log`(仅存 hash,不存明文 key)
- 跑前自动预检,超额时拒绝并提示选项

**用户自带 key**(传 `api_config.base_url` + `api_key`):
- 无配额限制
- 跳过单批 10 张上限

### 4.3 故障排查

| 错误码 | 含义 | 怎么办 |
|---|---|---|
| `AK_NOT_CONFIGURED` | 没配 API key | 跑 `config.js` 保存 key |
| `QUOTA_PRECHECK` | 本小时配额不够 | 减少数量 / 等下小时 / 换 key |
| `QUOTA_EXCEEDED` | 默认 key 单批超 10 张 | 减少数量 / 分批 / 换 key |
| `QUOTA_EXHAUSTED` | 跑到一半 429 | 等 30 分钟 / 换 key |
| `FILE_NOT_FOUND` | 模板或 Excel 路径不对 | 检查路径 |
| `NO_PRODUCTS` | Excel 没识别到图片列 | 检查列内容是不是 .jpg/.png 直链 |
| `DOWNLOAD_FAILED` | 商品图下载失败 | 检查 URL 是不是公网可达 |
| `INVALID_FORMAT` | 模板不是支持的图片格式 | 用 png / jpg / webp / gif / bmp |

详细列表见 `references/error-codes.md`。

### 4.4 设计原则(给二次开发者)

- **prompt 中绝不 mention 不想要的视觉元素** — 任何"sparkle / 星形 / confetti"等具体名词都会被 Gemini attention 反向激活并复制到输出。所有 prompt 用纯正向描述("像素级复刻模板的非商品区域")。
- **评分系统不污染生成质量** — score-agent 只看图直接比对,不接收任何"模板应该有 X"的预设清单。Step 1 的幻觉数据无法污染下游。
- **评分输出严禁回流 generate prompt** — retry addon 必须用 `retry-prompts.md` 的抽象映射表,不能复制评分里的具体词。
- **配额追踪只存 hash** — `.quota-log` 用 sha256 前 16 位代替明文 key。
- **进度落盘容灾** — `_progress.jsonl` 每张完成就 append,中断不丢成功数据。

完整设计 postmortem 见 `references/template-analysis-schema.md` 末尾的 "Developer postmortem"。

---

## 五、变更/版本

- v0.1.0 — Wave 1-6 迭代完成,核心 4 步流程稳定,UI 精简到 3 档 verdict + 隐藏评分文案 + retry 提示词可直接当 addon。
