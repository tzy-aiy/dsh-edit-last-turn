# dsh-edit-last-turn

**Edit a message you already sent — and let the model think again from it.**

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) has no built-in way to fix a message after you press send. This plugin adds one: a small entry under the composer lists every message you sent in the session, lets you rewrite one, and then rewrites the conversation from that point and starts a fresh turn from the edited text.

## What it does

- A dock entry under the composer: **Edit a sent message**.
- Pick the newest message (default) or step back to an earlier one — everything after the message you pick is rewritten away, and the model answers the edited message instead.
- If a turn is still running, it is cancelled first (its pending inbox is kept), so the rewrite never races the model.
- The edit is a normal `surface` rewrite, so the transcript, the model history and the token count all agree afterwards.

## Install

From the plugin market (once listed), or directly:

```sh
dsh plugin add github:tzy-aiy/dsh-edit-last-turn
```

Published on npm as `dsh-edit-last-turn`, if you prefer the registry:

```sh
dsh plugin add dsh-edit-last-turn
```

Restart the Host (or toggle the plugin off and on) after installing; reload the browser page once so the composer entry appears.

## How it works

Two halves, no build step:

- `index.js` (Host) registers two loopback-only HTTP routes. `/dsh-edit-last-turn/state` lists the user messages still on the session surface; `/dsh-edit-last-turn/apply` appends an edited `user/message` carrying a surface `replace` intent from that message to the end of the surface — the same mechanism compaction uses to rewrite history — and then wakes the agent.
- `client.js` (browser) is the composer-dock cell: a button, a small editor, and a picker when the session has more than one user message.

Waking the agent is the interesting part. Appending a surface message does not make the model think; a turn that claims no inbox message ends immediately. So the Host enqueues one message whose source is `runtime-context` with no sections: the agent loop claims it, opens a turn, appends nothing of its own, and builds the request from the surface that was just rewritten. The model is woken without the wake itself appearing in the transcript.

## Limits worth knowing

- Only the model's view of history is rolled back. Tool side effects that already happened (files written, commands run) are not undone.
- The session log is append-only: old turns stay in the log file, they are only folded out of the surface.
- A session that is currently running is cancelled before the rewrite, so anything it was mid-way through is lost — that is the point, but it is worth knowing.
- Context-compression plugins that keep their own ledger over the surface (for example `billion-context`) may re-derive it after a rewrite; prefer a fresh session when trying this on a long conversation.

## 中文

**改写已经发出去的消息，并让模型按改写后的内容重新思考。**

DeepSeek Harness 发出去的消息改不了。这个插件补上这一步：输入框下面多一个入口，列出本会话里你发过的每一条消息，改完之后从那条开始重写对话，并基于新文本重新跑一轮。

- 默认取最新一条，也可以挑更早的一条；被挑中那条之后的整段对话会被重写掉。
- 如果此刻模型还在跑，会先取消当前回合（保留待发送队列），避免改写和模型抢。
- 改写走的是 DSH 自己的 `surface` 机制（和压缩改写历史用的是同一套），所以会话记录、模型历史、token 数在改写后是一致的。

安装：

```sh
dsh plugin add github:tzy-aiy/dsh-edit-last-turn
```

装完重启 Host（或在插件页把这插件关掉再打开），并刷新一次页面。

注意：

- 只回滚“模型看到的历史”，已发生的工具副作用（写过的文件、跑过的命令）不会撤销。
- 会话日志本身是只追加的，旧回合仍在日志文件里，只是从可见历史里被折叠掉。
- 对很长的会话使用前，建议先开新会话试：自带账本、会跟踪 surface 的压缩类插件（如 `billion-context`）在改写后需要重新归纳。

## License

MIT.
