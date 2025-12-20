# 登录问题诊断报告

生成时间: 2025-12-19

## 问题描述

用户 `admin` 无法使用密码 `MoonTV2024!` 登录系统。

## 根本原因

### 环境变量文件优先级冲突

Next.js 加载环境变量的优先级是：

1. `.env.local` (最高优先级)
2. `.env`

**问题发现**：

- `.env` 文件中：`PASSWORD=MoonTV2024!`
- `.env.local` 文件中：`PASSWORD=admin123`

由于 `.env.local` 优先级更高，服务器实际使用的密码是 `admin123`，而不是 `MoonTV2024!`。

### 登录逻辑问题

登录代码逻辑（`src/app/api/login/route.ts` 第 136-163 行）：

```typescript
// 可能是站长，直接读环境变量
if (username === process.env.USERNAME && password === process.env.PASSWORD) {
  // 登录成功
  return response;
} else if (username === process.env.USERNAME) {
  // 如果用户名匹配但密码不匹配，直接返回错误
  return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
}
// 只有用户名不匹配环境变量时，才会继续检查数据库
```

**问题**：

- 当 `username === process.env.USERNAME`（即 `admin`）时，如果密码不匹配环境变量，代码会在第 162 行直接返回错误
- **不会继续检查数据库**，即使 Redis 中存储了正确的密码

## 验证结果

### 环境变量检查

通过 `/api/debug-env` 端点检查：

```json
{
  "has_username": true,
  "username": "admin",
  "has_password": true,
  "password_length": 8,
  "password_match": false, // 不匹配 MoonTV2024!
  "password_first_char": "a",
  "password_last_char": "3",
  "storage_type": "redis"
}
```

### 文件内容

**`.env` 文件**：

```
PASSWORD=MoonTV2024!
USERNAME=admin
```

**`.env.local` 文件**：

```
PASSWORD=admin123
USERNAME=admin
```

## 解决方案

### 方案 1：使用正确的密码登录（推荐）

使用 `.env.local` 中的密码 `admin123` 登录：

```bash
curl -X POST http://localhost:3003/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

✅ **验证结果**：登录成功

### 方案 2：统一环境变量文件

修改 `.env.local` 文件，使其与 `.env` 一致：

```bash
# 修改 .env.local
PASSWORD=MoonTV2024!
USERNAME=admin
```

然后重启服务器。

### 方案 3：修改登录逻辑（长期方案）

修改登录逻辑，允许在环境变量检查失败后继续检查数据库：

```typescript
// 可能是站长，直接读环境变量
if (username === process.env.USERNAME && password === process.env.PASSWORD) {
  // 登录成功
  return response;
}
// 移除 else if，直接继续检查数据库
// 这样即使环境变量不匹配，也可以从数据库验证
```

## 当前可用凭证

### 环境变量用户（站长账号）

- **用户名**: admin
- **密码**: admin123 (来自 `.env.local`)
- **角色**: owner
- **状态**: ✅ 可用

### 数据库用户

- **用户名**: testuser
- **密码**: testpass
- **存储**: Redis (`u:testuser:pwd`)
- **状态**: ✅ 可用

## 建议

1. **环境变量管理**：

   - 统一使用一个环境变量文件（建议使用 `.env.local`）
   - 或者明确文档说明环境变量文件的优先级

2. **登录逻辑优化**：

   - 考虑修改登录逻辑，允许环境变量用户失败后继续检查数据库
   - 或者明确区分环境变量用户和数据库用户

3. **文档更新**：
   - 在 README 中说明环境变量文件的优先级
   - 说明如何配置管理员账号

---

**诊断完成时间**: 2025-12-19
**问题状态**: ✅ 已解决
**根本原因**: 环境变量文件优先级冲突
**解决方案**: 使用 `.env.local` 中的密码 `admin123` 登录
