# 编辑上一条消息 · 设计说明

## 它解决什么

DSH 的原生流程里，一条消息发出去之后就只能排队、取消或另开分支（fork），没有办法「把刚才那句改一下，再让你重新想一遍」。这个插件补上了这一步：在输入框下方提供一个入口，把**上一条用户消息**就地改写，然后让模型从改写后的内容重新推理。

## 工作方式

关闭状态下只是一个很轻的按钮（`conversation.composer.dock` 插槽，`order: 20`）。点开后经本机 HTTP 路由读取当前会话表面上的全部用户消息原文：默认填入**最新一条**；会话里有多条时可从下拉框里挑更早的一条来改写（改更早的那条，等于把它之后的所有轮次一起重来）。保存时把选中消息的 `seq` 与新文本交给 Host。

Host 端做三件事：

1. **停**：如果模型正在回答，先 `agent.cancel({ kind: 'user' }, { keepInbox: true })` 并等待 `whenIdle()`。队列里的其他消息保留。
2. **改**：在会话表面（surface）上追加一条 `user/message`，带上
   `surfaceOp: { op: 'replace', startSeq, endSeq }` 与 `sourceEventSeqs` 列出被遮蔽的全部节点。
   `startSeq` 是选中的那条 `source.kind === 'user'` 消息，`endSeq` 是表面最后一个节点 —— 也就是说，
   这条消息本身以及它之后的全部内容（回答、工具结果、后续轮次、上下文快照）都被折叠掉。
   这与压缩（compaction）改写历史用的是同一套机制，只是范围小得多。
3. **唤醒**：调用 `agent.followup()` 投递一条 `source.kind === 'runtime-context'` 的空内容消息。
   主循环的 `step()` 对这类消息只登记、不追加到表面（它是「不可见」的），于是这一回合仅凭改写后的表面
   就向模型发起了请求 —— 模型看到的最末尾一条用户消息，正是你刚改写的那条。

## 边界

- 可编辑表面上仍存在的任意一条用户消息；改更早的那条会丢弃它之后的所有轮次（这是「重新思考」的代价）。
- 只保留文本块；原消息里的图片等非文本块在改写后不再保留。
- 会话必须能被 Host 接管（冷会话会按需 resume）；子代理拥有的会话返回 409。
- 所有路由仅限本机回环地址 + 同源写请求。
- 改写后客户端会收到 `replace` 类事件，从而重载该窗口内的消息。
- 旧的轮次并没有被删除：会话日志是只追加的，表面（surface）只是换了一套视图，原始记录仍可在字节层面回溯。

## 路由

- `GET  /dsh-edit-last-turn/state?sessionId=…&resume=1` → `{ live, editable, running, text, seq, messages: [{ seq, text, preview }] }`
- `POST /dsh-edit-last-turn/apply` `{ sessionId, text, clientTimeZone, seq? }` → `{ ok, seq, startSeq, endSeq, shadowed }`
