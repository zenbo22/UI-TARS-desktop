# Agent TARS CLI Web UI 运行文档

本文档说明如何在本仓库中本地启动 Agent TARS CLI 的 Web UI，并包含常见问题的排查方式。文档假设当前工作目录为 `/Users/baibai/project/UI-TARS-desktop`。

## 1. 环境要求

需要 Node.js 与 pnpm，仓库要求 pnpm 9。若你当前 pnpm 版本不是 9，请通过 Corepack 调用指定版本。

```bash
corepack pnpm@9.10.0 -v
```

## 2. 安装依赖

使用 pnpm 9 在仓库根目录安装依赖。

```bash
cd /Users/baibai/project/UI-TARS-desktop
corepack pnpm@9.10.0 install
```

如果只需要重建 UI，可以单独安装 `agent-ui` 子包依赖。

```bash
corepack pnpm@9.10.0 -C multimodal/tarko/agent-ui install
```

## 3. 构建 Web UI 静态资源

Web UI 的静态文件输出到 `multimodal/tarko/agent-ui-builder/static`，启动前需要确保该目录已构建。

```bash
corepack pnpm@9.10.0 -C multimodal/tarko/agent-ui build
```

## 4. 启动 Agent TARS Web UI

使用 agent-tars CLI 启动交互式 Web UI。推荐显式指定端口，避免端口冲突与缓存影响。

```bash
cd /Users/baibai/project/UI-TARS-desktop
OPENAI_API_KEY="$OPENAI_API_KEY" node multimodal/agent-tars/cli/bin/cli.js run --port 8890
```

启动成功后会输出访问地址，浏览器访问：

```
http://localhost:8890
```

如果需要无痕模式与缓存隔离，可使用带参数的 URL：

```
http://localhost:8890/?v=2
```

## 5. 常见问题与排查

### 5.1 页面闪一下后消失

通常是前端资源缓存或 React 版本冲突导致。建议做三件事：

1. 使用无痕窗口打开 `http://localhost:8890/?v=2`。
2. 确认 `multimodal/tarko/agent-ui` 已重新构建。
3. 确认 `react-icons` 不再携带嵌套 React 19（使用 pnpm 9 安装依赖后即可稳定）。

### 5.2 API 正常但 UI 白屏

先确认服务是否仍在运行：

```bash
curl -s http://localhost:8890/api/v1/health
```

返回 `{"status":"ok"}` 表示后端正常，问题多半在前端缓存或构建产物不一致。

### 5.3 需要换端口

可直接换端口重启：

```bash
OPENAI_API_KEY="$OPENAI_API_KEY" node multimodal/agent-tars/cli/bin/cli.js run --port 8891
```

## 6. 停止服务

找到并结束进程：

```bash
pgrep -f "agent-tars/cli/bin/cli.js run"
kill <PID1> <PID2>
```

---

如果需要我继续补充“模型配置示例”或“自定义 Web UI 配置”，告诉我即可。
