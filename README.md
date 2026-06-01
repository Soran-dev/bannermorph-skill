# BannerMorph

一个把 **Banner 模板上的商品图换成 N 个新商品** 的 AI 工作台 skill。运营拖入模板 + 商品 Excel,3 分钟拿回 5-10 张成品 Banner + 一份质量评估报告。

支持 Claude Code / Qoder / Trae 等 Anthropic Skills 兼容的工作台。

---

## ⚡ 快速安装(60 秒)

```bash
# 1. clone 到你的 skill 目录(以 Claude Code 为例)
git clone https://github.com/Soran-dev/bannermorph-skill ~/.claude/skills/bannermorph

# 2. 装依赖(只需 xlsx 一个)
cd ~/.claude/skills/bannermorph && npm install

# 3. 自检
node scripts/smoke_test.js
# 期望: 11 passed, 0 failed
```

其他平台路径:
- Qoder: `~/.qoderwork/skills/bannermorph`
- Trae: `~/.trae/skills/bannermorph`

---

## 🚀 试用

在 AI 工作台对话框里:

1. 拖入 banner 模板图
2. 输入触发短语(任意一条):
   - "做一批 banner"
   - "批量生成 banner"
   - "用这个模板生成多张商品图"
   - "把这些商品图放进 banner 模板"
3. AI 会引导你提供商品来源(单图 / 文件夹 / Excel 含 URL 列 / URL 列表)

首次使用会让你配 API key。skill 默认调用 ideaLAB(每小时 10 次),也支持任何 OpenAI 协议兼容的图像生成 API(OpenRouter / Gemini / OpenAI Image API 等)。

---

## ✨ 核心特性

- 🎯 **模板像素级保留** — 文字 / 装饰 / 背景 100% 不动,只替换商品主体
- 📦 **4 种商品来源** — 单图 / 文件夹 / Excel(图片 URL 列) / URL 列表
- ⚡ **并发生图** — 5 张约 30 秒(`gemini-3.1-flash-image-preview`)
- 🛡 **配额预警** — 跑前预检,超额前提醒,不让你跑到一半被拒
- 🤖 **自动评分** — 5 个并发子 agent 评分(通过 / 建议重试 / 失败),约 15 秒
- 📊 **报告产物** — Markdown + HTML 双格式,HTML 浏览器双击即可看
- 🔄 **智能重试** — 评分员发现问题直接给"可执行提示词",retry 自动用上
- 📁 **多次跑互不覆盖** — 每次自动建 `batch-{时间戳}/` 子目录归档

---

## 📚 文档

- [USER_GUIDE.md](./USER_GUIDE.md) — 完整使用指南(实战案例 + 8 个 tips + 故障排查)
- [SKILL.md](./SKILL.md) — 给 AI 看的工作流定义(Skill 规范)
- [references/](./references/) — 详细参考文档(按需加载)
  - `api-config.md` — 自定义 API endpoint
  - `error-codes.md` — 错误码 → 用户文案
  - `retry-prompts.md` — issue → addon 映射
  - `scoring-rubric.md` — 评分规则
  - `score-agent-prompt.md` — 评分子 agent 模板
  - `template-analysis-schema.md` — 模板分析 JSON schema + Developer postmortem

---

## 🧱 文件结构

```
bannermorph-skill/
├── SKILL.md                  # 给 AI 看的工作流定义
├── USER_GUIDE.md             # 详细用户指南
├── README.md                 # 本文件
├── LICENSE                   # MIT
├── .env.example              # 配置模板
├── .gitignore
├── package.json              # 仅依赖 xlsx
├── references/               # 详细文档,按需加载
└── scripts/
    ├── _lib.js               # 共享工具
    ├── config.js             # 写 .env
    ├── import_template.js    # 复制模板到 work/
    ├── parse_products.js     # 4 种商品来源
    ├── quota_status.js       # 查本小时配额
    ├── generate_batch.js     # 并发生图
    ├── retry_batch.js        # 子集重生
    ├── recover_results.js    # 从 _progress.jsonl 恢复
    ├── write_report.js       # MD + HTML 报告
    ├── cleanup.js            # 清理 /tmp + work/
    └── smoke_test.js         # 本地无网络烟测
```

---

## 🔬 设计原则(从血泪教训提炼)

经过 6 个迭代版本,沉淀几条铁律:

1. **Prompt 中绝不 mention 不想要的视觉元素** — 任何具体名词(sparkle / star / confetti / 色块等)都会被 Gemini attention 反向激活并复制到输出。`generate_batch` prompt 用纯正向描述("像素级复刻模板的非商品区域")。
2. **评分系统不污染生成质量** — score-agent 只看图直接比对,不接收任何"模板应该有 X"的预设清单。即使 Step 1 的模板分析有幻觉,也不会传染下游评分和下一轮 prompt。
3. **评分输出严禁回流 generate prompt** — retry addon 必须用 `retry-prompts.md` 的抽象映射表,不能复制评分里的具体词。
4. **配额追踪只存 hash** — `.quota-log` 用 sha256 前 16 位代替明文 key。

完整事故复盘见 [`references/template-analysis-schema.md`](./references/template-analysis-schema.md) 末尾的 "Developer postmortem"。

---

## 🤝 贡献

欢迎 Issue / PR。

如果有新模板类型(festival / new_arrival / category 等)需要适配,主要工作量在 `references/template-analysis-schema.md` 的 schema 字段,不需要改脚本。

---

## 📄 License

[MIT](./LICENSE)
