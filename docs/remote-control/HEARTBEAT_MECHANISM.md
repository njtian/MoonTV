# 远程控制心跳机制

## 概述

本文档详细说明了 MoonTV 远程控制功能中的心跳机制实现，包括遥控器和播放器如何通过单一 GET 请求实现心跳和状态检查。

## 心跳机制设计原则

1. **单一请求原则**：每个端只需要发送一个 GET 请求，既是心跳又是状态检查
2. **自动更新原则**：服务器收到请求时自动更新发送方的在线时间戳
3. **双向检查原则**：每个端都可以检查对方是否在线

## API 接口

### GET /api/remote/subscribers

**功能**：检查订阅者状态并自动更新发送方的在线时间戳

**参数**：

- `sid`: 会话 ID
- `token`: 认证令牌
- `checkType`: 检查类型（`player` 或 `controller`）

## 心跳逻辑

### 遥控器心跳

**请求**：

```
GET /api/remote/subscribers?sid={sid}&token={token}&checkType=player
```

**服务器处理**：

1. 更新 `controllerLastActive` 时间戳（表示遥控器在线）
2. 检查 `playerLastActive` 时间戳（判断播放器是否在线）
3. 返回播放器在线状态

**代码实现**：

```typescript
// 遥控器请求检查播放器状态：更新controllerLastActive，表示遥控器在线
await hsetDirect(sessionKey, { controllerLastActive: serverTime });
// 检查播放器端是否活跃
hasSubscribers = !!(
  session.playerLastActive &&
  serverTime - parseInt(session.playerLastActive) < 10000
);
```

### 播放器心跳

**请求**：

```
GET /api/remote/subscribers?sid={sid}&token={token}&checkType=controller
```

**服务器处理**：

1. 更新 `playerLastActive` 时间戳（表示播放器在线）
2. 检查 `controllerLastActive` 时间戳（判断遥控器是否在线）
3. 返回遥控器在线状态

**代码实现**：

```typescript
// 播放器请求检查遥控器状态：更新playerLastActive，表示播放器在线
await hsetDirect(sessionKey, { playerLastActive: serverTime });
// 检查遥控器端是否活跃
hasSubscribers = !!(
  session.controllerLastActive &&
  serverTime - parseInt(session.controllerLastActive) < 10000
);
```

## 时间戳字段说明

### controllerLastActive

- **含义**：遥控器最后活跃时间
- **更新时机**：遥控器发送任何 `/api/remote/subscribers` 请求时
- **检查时机**：播放器检查遥控器是否在线时

### playerLastActive

- **含义**：播放器最后活跃时间
- **更新时机**：播放器发送任何 `/api/remote/subscribers` 请求时
- **检查时机**：遥控器检查播放器是否在线时

## 在线状态判断

**判断标准**：时间戳距离当前时间小于 10 秒（10000 毫秒）

```typescript
const isOnline = !!(
  lastActiveTime && serverTime - parseInt(lastActiveTime) < 10000
);
```

## 请求频率

- **遥控器**：每 5 秒发送一次请求
- **播放器**：每 2-5 秒发送一次请求（根据播放状态调整）

## 优势

1. **简化架构**：不需要额外的 POST 请求来发送心跳
2. **减少网络开销**：每个端只需要一个请求
3. **自动同步**：请求和心跳自动同步，避免时序问题
4. **双向检测**：每个端都可以检测对方状态

## 实现细节

### 服务器端实现

```typescript
// 根据请求来源更新对应的lastActive时间戳
if (checkType === 'controller') {
  // 播放器请求检查遥控器状态：更新playerLastActive，表示播放器在线
  await hsetDirect(sessionKey, { playerLastActive: serverTime });
  // 检查遥控器端是否活跃
  hasSubscribers = !!(
    session.controllerLastActive &&
    serverTime - parseInt(session.controllerLastActive) < 10000
  );
} else {
  // 遥控器请求检查播放器状态：更新controllerLastActive，表示遥控器在线
  await hsetDirect(sessionKey, { controllerLastActive: serverTime });
  // 检查播放器端是否活跃（默认）
  hasSubscribers = !!(
    session.playerLastActive &&
    serverTime - parseInt(session.playerLastActive) < 10000
  );
}
```

### 客户端实现

**遥控器端**：

```typescript
// 每5秒检查播放器状态（同时发送自己的心跳）
const res = await fetch(
  `/api/remote/subscribers?sid=${encodeURIComponent(
    localSession.sid
  )}&token=${encodeURIComponent(localSession.token)}&checkType=player`
);
```

**播放器端**：

```typescript
// 每2秒检查遥控器状态（同时发送自己的心跳）
const res = await fetch(
  `/api/remote/subscribers?sid=${encodeURIComponent(
    session.sid
  )}&token=${encodeURIComponent(session.token)}&checkType=controller`
);
```

## 注意事项

1. **时间同步**：使用服务器时间作为标准，避免客户端时间不同步问题
2. **错误处理**：网络错误时不影响心跳发送，确保连接状态准确
3. **角色切换**：当远程控制角色关闭时，立即停止心跳发送
4. **会话清理**：会话过期或无效时，停止心跳发送

---

文档版本：v1.0  
最后更新：2024 年 12 月
