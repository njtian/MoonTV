# MoonTV 远程遥控功能（Redis Only）

> 本文档记录遥控器功能的需求与首版设计（仅支持 Redis/Upstash 部署，不支持 localStorage）。

## 1. 目标与范围

- 目标：
  - 在 Mac mini 浏览器中运行 MoonTV（屏幕端/被控端）。
  - 在手机浏览器中打开“遥控器页面”（控制端）远程操控屏幕端的页面导航与播放器。
  - 低侵入接入现有架构（Next.js 14 App Router，TypeScript，Tailwind），优先稳定与易部署。
- 范围：
  - 首版使用 Redis Pub/Sub 作为信令与消息通道；服务端提供会话、鉴权、转发、限流。
  - 控制范围包括：导航、播放控制、音量、焦点方向键、搜索跳转等。
- 不在首版范围：
  - WebRTC/TURN 穿透；多控制器协作；屏幕画面镜像；localStorage 模式。

## 2. 部署约束（Redis Only）

- 环境变量：
  - `NEXT_PUBLIC_STORAGE_TYPE=redis`
  - `REDIS_URL`（原生 Redis）或 `UPSTASH_URL` + `UPSTASH_TOKEN`（Upstash）
- 运行平台：Docker/自托管/Vercel/Cloudflare（SSE/轮询可用）。
- Redis 用途：会话存储、控制权锁、速率限制、Pub/Sub。

## 3. 路由与页面

- 屏幕端（现有站内）：任一页面新增“开启遥控”入口，创建会话并显示二维码。
- 控制端（新页面，手机 UI）：
  - 目录：`src/app/controller`
  - URL：`/controller?sid=<sessionId>&t=<token>`（首推），可选：`/controller/[sid]?t=<token>`

## 4. 会话与安全模型

- 每个浏览器窗口对应一个会话 `sid`（永久会话，默认不过期，手动删除或重置才失效）。
- 独占控制权：同一时刻仅允许一个控制端持有控制权；新控制端需“请求接管”或被控端主动“踢出”现控制器。
- 配对凭据：长期配对 token（建议 HMAC：`sid|owner|scope`），支持手动轮换；解绑/重置后失效。
- 访客权限：默认仅可进行导航/播放/音量操作；敏感操作需屏幕端二次确认。

## 5. Redis 键空间（前缀 rc:\*）

- `rc:s:{sid}`（Hash）：`{ ownerUserId, pairingTokenHash, controllerId, status, createdAt }`（永久）
- `rc:lock:{sid}`（String）：当前控制权 `controllerId`（`SET NX EX` + 心跳续期）
- `rc:rl:{sid}:{controllerId}:{bucket}`（String）：速率限制计数
- `rc:ch:{sid}`（Pub/Sub）：控制消息频道

- 会话：永久，不设置 TTL；被控端可删除会话或旋转 token 使旧链接失效。
- 控制权锁：短 TTL（如 30 秒），由控制端心跳续期，断线自动释放。

## 6. API 设计（最小可用集）

- `POST /api/remote/session`：创建会话（需登录）；返回 `{ sid, token, qrcodeUrl }`
- `POST /api/remote/claim`：`sid, token` 抢占控制权（SETNX）
- `POST /api/remote/publish`：`sid, token, message` 校验+限流后发布到 `rc:ch:{sid}`
- `GET /api/remote/stream`：屏幕端用 SSE 订阅控制消息
- `POST /api/remote/release`：释放控制权或销毁会话（仅拥有者可销毁）
- 可选：`GET /api/remote/my-sessions`：列出当前用户的会话

- `POST /api/remote/unbind`：控制端自助解除绑定（清空 `controllerId`）。
- `POST /api/remote/kick`：被控端踢出当前控制器（清空 `controllerId`）。
- `POST /api/remote/token/rotate`：拥有者旋转配对 token（旧链接立即失效）。
- `POST /api/remote/session/resume`：根据 `sid` 恢复订阅并返回当前绑定状态。

返回体：统一 `{ code, message, data }` JSON 结构。

## 7. 控制消息协议

统一包裹：

```json
{
  "type": "navigation|playback|volume|focus|system",
  "payload": {},
  "ts": 1735689600000,
  "controllerId": "uuid",
  "seq": 1
}
```

- `navigation`：`{ path: string, query?: string }`
- `playback`：`{ action: 'play'|'pause'|'seek'|'stop'|'prev'|'next', value?: number }`
- `volume`：`{ level: 0..1, muted?: boolean }`
- `focus`：`{ key: 'up'|'down'|'left'|'right'|'enter'|'back' }`
- `system`：`{ action: 'pair'|'confirm'|'end' }`

客户端对 D-Pad 长按进行节流（80–120ms/次）；服务端做速率限制与丢弃策略。

## 8. 前端集成点

- 屏幕端：
  - “开启遥控” → `POST /api/remote/session` → 显示二维码
  - `GET /api/remote/stream`（SSE）→ 分发到路由、播放器、焦点控制
- 控制端（/controller）：
  - 读取 `sid/t` → `claim` 成功后使用 `publish` 发送命令
  - UI：D-Pad、播放、音量、搜索、快捷入口、连接状态

## 会话保持与重连（永久会话）

- 被控端：持久化 `sid` 与 `deviceId`（cookie 或 sessionStorage），启动尝试 `session/resume`，成功后直接订阅流。
- 控制端：保存带 `sid/t` 的 URL，重新打开后直接 `claim` 恢复控制；可选在本地保存 `controllerId` 仅用于展示。
- 解绑/踢出后：服务端清空 `controllerId` 或轮换 token，旧链接失效，需要重新扫码。

## 9. 安全与合规

- Token 不持久化，仅驻留内存与 URL。
- 会话仅对拥有者可见；访客通过分享链接访问指定 `sid`，权限受限。
- 敏感操作需屏幕端二次确认。
- 管理员：终止任意会话、强制接管、IP/UA 黑名单。

## 10. 里程碑

1. 搭建 API 与 Redis 接入（session/claim/publish/stream/release）
2. `/controller` 极简 UI → 接入 `claim/publish`
3. 屏幕端 SSE 接入并实现导航/播放/音量/焦点
4. 接管/释放流程与二维码分享
5. 速率限制与心跳机制、错误提示与重连策略

## 13. 特性开关与安全

- 环境变量：`NEXT_PUBLIC_ENABLE_REMOTE=true` 时启用遥控入口；且仅在 `NEXT_PUBLIC_STORAGE_TYPE` 为 `redis|upstash` 下显示。
- API 基础安全：同源校验（Origin 必须与站点同源）、签名 token 校验、控制权锁校验、基础速率限制。

---

文档状态：设计初稿 v0.1（Redis Only）。
