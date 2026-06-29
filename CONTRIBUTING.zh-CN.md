# 参与贡献 Monkeys Memory

简体中文 | [English](CONTRIBUTING.md)

感谢你帮助建设 Monkeys Memory。这个项目是隐私敏感的开源开发者基础设施，
所以我们会认真对待清晰度、测试和安全示例。

## 产品原则

- 保持 Monkeys Memory 作为完整开源产品可运行、可理解、可贡献。
- 优先选择简单直接的设计，不为了假设中的未来需求增加复杂度。
- 控制台保持轻量、实用、本地优先。
- SaaS-only 的运维、计费、客户数据、专有 UI 和私有部署细节不进入本仓库。
- 不要提交真实团队记忆、客户数据或 secret。

## 开发环境

使用 Node.js 22+。

```bash
npm --prefix apps/api install
npm run api:build
npm run api:test
npm run compose:config
```

启动完整产品：

```bash
npm run dev:docker
```

## PR 检查清单

- 说明用户可见变化，以及它为什么属于开源产品。
- 行为变化需要包含测试。
- 运行相关验证命令，并在 PR 中列出。
- 行为变化时，同步更新 `README.md`、`README.zh-CN.md`、API 文档、控制台文档或部署文档。
- 明确迁移、配置、兼容性或安全影响。
- 项目讨论请遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

## 测试要求

选择能证明改动正确的最小验证集合：

- API 或数据库变化：`npm run api:build` 和 `npm run api:test`
- Docker 或配置变化：`npm run compose:config`
- 控制台 JavaScript 变化：`node --check apps/console/app.js`

跨边界改动需要运行更完整的检查。

## 公开仓库边界

不要提交：

- 私有记忆数据
- 数据库 dump 或本地 volume
- OAuth credentials、tokens、API keys 或真实密钥
- 客户数据或生产域名细节
- 私有运维文档

## 代码风格

- 遵循你正在编辑区域的既有风格。
- 控制器保持薄，把 API 行为放进 service/shared modules。
- 控制台默认保持静态和轻量，除非真实用户流程需要更重的前端栈。
- 只有在能解释非显然行为时才添加注释。
- feature 或 bugfix PR 中避免无关重构。

## 安全报告

请不要在公开 issue 中发布 secret 或漏洞细节。敏感安全问题请通过私有维护者渠道报告，具体见 [SECURITY.md](SECURITY.md)。
