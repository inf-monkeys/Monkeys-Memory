# Monkeys Memory

简体中文 | [English](README.md)

Monkeys Memory 给 coding agent 一层项目记忆。

把它跑在本地，把仓库接进来。agent 可以从真实改动里记录经验，把经验编译成
可复用的规则，并在下一次任务开始前取回真正相关的几条。它解决的是一个很具体
的问题：同一个项目里，已经踩过的坑、已经定下来的工程习惯，不应该在每个新会话
里重新发现一遍。

这个仓库包含完整的开源产品：Fastify API、后台 workers、PostgreSQL、Redis、
Qdrant、轻量控制台和 Docker Compose。启动后会有一个本地 owner workspace，
可以直接走完整流程，不需要先创建用户。

## 包含什么

- 数据库驱动的记忆捕获、检索、审查、反馈、策略、审计日志和 agent actions
- 基于 `memory-evaluate` 事件的 agent 上报记忆有效性分数，并在本地控制台展示
- 用于编译、审计处理和一致性任务的后台 workers
- 一个小控制台，用来管理本地组织和仓库，也可以快速试捕获和检索
- 使用 Qdrant 作为产品化向量索引，PostgreSQL 仍然保存 canonical memory 内容
- 配置后优先使用 OpenAI-compatible embeddings；未配置时 fallback 到确定性的本地 hash embeddings
- 一条 Docker Compose 命令启动 PostgreSQL、Redis、Qdrant、API、workers 和控制台
- 和开源 `monkeys-memory` 命令兼容的 API

## 快速开始

你需要 Docker 和 Docker Compose。

启动整套系统：

```bash
git clone https://github.com/inf-monkeys/Monkeys-Memory.git
cd Monkeys-Memory
docker compose up --build
```

打开控制台：

```text
http://localhost:8080
```

API 地址：

```text
http://localhost:3000
```

你可以在控制台里创建或选择本地组织、添加仓库，并尝试捕获和检索记忆。默认
配置面向本地使用，quickstart 里的开发凭据只应该用于本地环境。

## CLI 设置

Monkeys Memory CLI 也开源：
[Ruiruiz30/Monkeys-Memory-Cli](https://github.com/Ruiruiz30/Monkeys-Memory-Cli)。
它是 agent 在命令行里接入 Monkeys Memory 的入口，负责仓库扫描、
agent-friendly JSON commands 和官方 agent skill 安装。

安装 CLI，把它指向本地 API，并给一个本地占位 token：

```bash
npm install -g @inf-monkeys-tech/monkeys-memory-cli
monkeys-memory config set api-url http://localhost:3000
export MONKEYS_MEMORY_TOKEN=local
monkeys-memory retrieve --repo my-repo --path src/index.ts --task feature
monkeys-memory capture --repo my-repo --title "Adapter rule" --claim "Always validate through the adapter." --path "src/adapter/**" --task feature
monkeys-memory memory-evaluate --repo my-repo --rule-id rule_1 --outcome outdated --adopted false --correct-claim "Use the new adapter boundary." --correct-path "src/adapter/**"
```

local 模式下，API 会把请求归到本地 owner workspace。这里不需要浏览器设置
流程，也不需要云端 token。

当 agent 把某条检索到的记忆标记为 `outdated` 或 `failed` 时，本地 API 会把
旧的 source memory 从运行时检索中退役。如果这次反馈里带了修正版，Monkeys
Memory 会捕获新的修正记忆，并把旧 source 标记为已被替代。

本地控制台会展示 0-100 的记忆有效性分数。这个分数来自 agent 上报的有效结果、
采纳、通过测试/构建/检查的任务成功、纠错、证据和返回经验覆盖率；不依赖人工
主观有效性问卷，也不是用户感觉。

## 项目结构

```text
apps/
  api/       Fastify + TypeScript API、TypeORM migrations 和 workers
  console/   由 Nginx 提供服务的轻量静态控制台
compose.yaml 一条命令启动 PostgreSQL、Redis、Qdrant、API 和控制台
```

Compose 启动的服务：

- `postgres`: PostgreSQL 16
- `redis`: Redis 7
- `qdrant`: 已编译记忆 embeddings 的向量索引
- `api`: Monkeys Memory API、migrations、compile worker、audit worker
- `console`: 静态控制台，并代理同源 `/api` 和 `/health`

## 配置

API 从这里读取配置：

```text
apps/api/config.yaml.example
```

Compose 会把这个示例配置挂载到 `/etc/monkeys-memory/config.yaml`，并通过环境
变量覆盖 Docker 网络中的连接信息。

真实部署时，请复制示例配置，并按你的环境调整数据库、Redis、Qdrant、CORS 和
embedding 配置。

几个需要知道的默认值：

- `deployment.mode: local`
- `embeddings.provider: auto`
- `vectorStore.provider: qdrant`
- `database.name: monkeys_memory`

默认 Compose 会启动本地 Qdrant，并把 API 指向 `http://qdrant:6333`。如果你要
使用线上或托管的 Qdrant，设置：

```bash
VECTOR_STORE_URL=https://your-qdrant.example
VECTOR_STORE_API_KEY=your-qdrant-api-key
```

配置 `EMBEDDINGS_API_KEY` 或 `OPENAI_API_KEY` 后，API 会优先使用
OpenAI-compatible embeddings。没有 key 时会 fallback 到本地 hash embedder，
所以 OSS 版本依然可以离线跑通。

如果要在 localhost 之外暴露服务，请先配置 HTTPS、私有网络访问控制，并替换默认数据库凭据。

## 开发

使用 Node.js 22+。

```bash
npm run api:build
npm run api:test
npm test
npm run compose:config
```

常用命令：

- `npm run dev:docker`: 用 Docker Compose 运行完整产品
- `npm run api:build`: 编译 API
- `npm run api:test`: 运行 API 测试
- `npm test`: 运行默认测试套件
- `npm run compose:config`: 校验 Compose 配置

## 贡献

提交 PR 前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 或
[CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md)。

## 安全

不要提交本地记忆数据、数据库卷、token、客户数据或真实密钥。Docker
quickstart 凭据只用于本地开发。漏洞报告方式见 [SECURITY.md](SECURITY.md)。

## License

[MIT](LICENSE)
