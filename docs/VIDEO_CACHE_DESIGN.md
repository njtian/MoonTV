# 剧集文件系统缓存设计方案

## 目录

1. [概述](#1-概述)
2. [设计目标](#2-设计目标)
3. [架构设计](#3-架构设计)
4. [数据结构设计](#4-数据结构设计)
5. [API 接口设计](#5-api接口设计)
6. [核心功能实现](#6-核心功能实现)
7. [M3U8 文件处理](#7-m3u8文件处理)
8. [文件系统操作](#8-文件系统操作)
9. [进度状态管理](#9-进度状态管理)
10. [错误处理](#10-错误处理)
11. [性能优化](#11-性能优化)
12. [安全考虑](#12-安全考虑)
13. [配置选项](#13-配置选项)
14. [监控和日志](#14-监控和日志)
15. [实现计划](#15-实现计划)
16. [测试计划](#16-测试计划)
17. [未来扩展](#17-未来扩展)
18. [客户端使用示例](#18-客户端使用示例)
19. [注意事项](#19-注意事项)

---

## 1. 概述

本文档描述在本地服务器端使用文件系统缓存剧集详情的完整设计方案。该方案包括两部分：

1. **剧集信息缓存**：以**剧集为中心**进行缓存，而非按源+ID。同一个剧集可能来自不同的源，但缓存会统一管理。
2. **视频文件下载缓存**：支持用户下载视频文件到本地，优先使用用户选择的源，失败时自动切换源。

**核心设计理念**：

- **剧集信息缓存**：

  - 缓存以剧集为主，不同源提供同一剧集时共享缓存
  - 同一剧集中不同集可以来自不同源，缓存会合并保存
  - 播放时优先使用缓存，如果缓存中有该集，直接播放（忽略源选择）

- **视频文件下载缓存**：
  - 用户触发下载时，优先使用用户选择的源
  - 如果用户选择的源无法下载，自动切换到最好的源
  - 同一个文件只从同一个源下载（避免重复下载）
  - 下载后记录实际缓存的来源

## 2. 设计目标

- **性能优化**：减少对第三方 API 的请求，提升响应速度
- **离线支持**：在第三方 API 不可用时，仍可提供缓存的剧集信息
- **可管理性**：提供缓存状态查看、清理等管理功能
- **可靠性**：缓存失效机制，确保数据时效性
- **可扩展性**：支持未来扩展更多缓存功能
- **智能识别**：自动识别同一剧集，合并不同源的集数链接
- **播放优先**：播放时自动使用缓存，忽略源选择，提升用户体验
- **下载缓存**：支持视频文件下载到本地，优先用户选择源，失败自动切换
- **来源追踪**：记录每个下载文件的实际来源，便于管理和调试

## 3. 架构设计

### 3.1 整体架构

```
客户端请求
    ↓
/api/detail (集成缓存层)
    ↓
文件系统缓存服务 (VideoCacheService)
    ├── 检查缓存是否存在且有效
    ├── 返回缓存数据 (命中)
    └── 调用第三方API → 写入缓存 (未命中)
    ↓
/api/cache/status (查看缓存状态)
/api/cache/clear (清理缓存)
/api/cache/stats (缓存统计)
```

### 3.3 请求流程图

**获取剧集详情流程**:

```
客户端 → GET /api/detail?source=ffzy&id=12345
    ↓
根据标题/豆瓣ID识别剧集（生成剧集标识）
    ↓
检查该剧集的缓存是否存在
    ├── 是 → 检查是否过期
    │   ├── 未过期 → 合并新源的集数链接 → 返回缓存数据 + _cached: true
    │   └── 已过期 → 删除过期缓存 → 继续
    └── 否 → 继续
    ↓
调用第三方API获取数据
    ├── 成功 → 合并到缓存（如果已存在）或创建新缓存 → 返回数据 + _cached: false
    └── 失败 → 尝试从缓存返回（如果有）
```

**播放时自动识别缓存流程**:

```
客户端 → 播放第N集（用户选择源A，id=12345）
    ↓
1. 获取剧集详情（/api/detail?source=源A&id=12345）
    ↓
2. 服务器端处理：
   ├── 调用第三方API获取数据
   ├── 生成剧集标识（series_key）
   ├── 检查缓存中是否有该剧集的第N集
   │   ├── 有 → 返回缓存链接（优先）→ 客户端直接播放缓存
   │   └── 无 → 返回源A的链接 → 客户端播放源A并更新缓存
   └── 异步更新缓存（合并新源的集数链接）
    ↓
3. 客户端播放：
   ├── 如果响应中包含 _cached_episode_url → 直接播放缓存链接
   └── 否则 → 播放源A的链接
```

**详细说明**:

1. **服务器端自动识别**:

   - 当客户端请求 `/api/detail` 时，服务器会自动检查缓存
   - 如果缓存中有该剧集的任何集，会在响应中提供缓存信息
   - 响应格式：
     ```json
     {
       ...剧集详情,
       "_cached_episodes": {
         "1": "https://cached-url.com/ep1.m3u8",
         "2": "https://cached-url.com/ep2.m3u8"
       },
       "_episode_sources": {
         "1": ["ffzy", "other"],  // 该集可用的源
         "2": ["ffzy"]
       }
     }
     ```

2. **客户端播放逻辑**:
   - 播放第 N 集时，优先检查 `_cached_episodes[N]`
   - 如果存在缓存链接，直接使用（忽略用户选择的源）
   - 如果不存在，使用用户选择的源的链接
   - **播放成功后，客户端通知服务器更新缓存**（见缓存更新机制）

### 3.4 视频文件下载流程

**下载流程（优先用户选择源，失败自动切换）**:

```
客户端 → POST /api/download/start
    {
      series_key: "douban_123456",
      episode_index: 1,
      source: "ffzy",  // 用户选择的源
      url: "https://example.com/ep1.m3u8"
    }
    ↓
1. 检查该集是否已下载
    ├── 已下载 → 返回已下载信息，不重复下载
    └── 未下载 → 继续
    ↓
2. 创建下载任务并加入队列
    ├── 生成 task_id
    ├── 创建任务文件
    ├── 加入下载队列（如果队列为空且无正在下载的任务，立即开始）
    └── 返回 task_id
    ↓
3. 下载队列处理（顺序执行，不支持并发）
    ├── 检查是否有正在下载的任务
    │   ├── 有 → 等待当前任务完成
    │   └── 无 → 从队列取出下一个任务
    ↓
4. 开始下载（优先用户选择的源）
    ├── 尝试从用户选择的源下载
    │   ├── 成功 → 记录实际来源为选择的源 → 完成
    │   └── 失败 → 继续
    ↓
5. 自动切换到最好的源
    ├── 获取该集的所有可用源
    ├── 按优先级排序（速度、稳定性等）
    ├── 依次尝试每个源（顺序尝试，不支持并发）
    │   ├── 成功 → 记录实际来源 → 完成
    │   └── 失败 → 尝试下一个源
    └── 所有源都失败 → 标记任务失败
    ↓
6. 下载完成
    ├── 保存文件到 downloads/{series_key}/{episode_index}/
    ├── 记录下载元数据（实际来源、时间等）
    ├── 更新下载记录
    ├── 更新任务状态为 completed
    └── 处理队列中的下一个任务（如果存在）
```

**下载队列机制**:

1. **队列管理**:

   - 所有下载请求加入队列，按顺序处理
   - 同一时间只处理一个下载任务（不支持并发）
   - 当前任务完成后，自动处理队列中的下一个任务
   - 避免触发源服务器的并发限制或封禁

2. **队列状态**:
   - `pending`: 等待中（在队列中）
   - `downloading`: 正在下载（当前任务）
   - `completed`: 已完成
   - `failed`: 失败
   - `cancelled`: 已取消

**源切换逻辑**:

1. **优先级规则**（综合评分排序）:

   ```typescript
   interface SourceScore {
     source: string;
     score: number; // 综合评分（0-100）
     factors: {
       userSelected: boolean; // 用户选择的源（+50分）
       successRate: number; // 历史成功率（0-1，*30分）
       avgSpeed: number; // 平均下载速度（MB/s，*10分，最高10分）
       stability: number; // 稳定性评分（0-1，*10分）
     };
   }

   function calculateSourceScore(
     source: string,
     userSelected: boolean,
     history: SourceHistory
   ): SourceScore {
     const factors = {
       userSelected,
       successRate: history.successCount / (history.totalAttempts || 1),
       avgSpeed: Math.min(history.avgSpeedMBps || 0, 10), // 最高10MB/s
       stability: calculateStability(history), // 基于错误率、超时率等
     };

     const score =
       (factors.userSelected ? 50 : 0) +
       factors.successRate * 30 +
       factors.avgSpeed * 1 +
       factors.stability * 10;

     return { source, score, factors };
   }

   function calculateStability(history: SourceHistory): number {
     const errorRate = history.errorCount / (history.totalAttempts || 1);
     const timeoutRate = history.timeoutCount / (history.totalAttempts || 1);
     // 稳定性 = 1 - 错误率 - 超时率（最低0）
     return Math.max(0, 1 - errorRate - timeoutRate);
   }
   ```

   **优先级排序算法**:

   ```typescript
   async function getSourcePriority(
     sources: string[],
     userSelectedSource: string,
     seriesKey: string,
     episodeIndex: number
   ): Promise<string[]> {
     // 1. 获取所有源的历史数据
     const sourceHistories = await Promise.all(
       sources.map((source) =>
         getSourceHistory(source, seriesKey, episodeIndex)
       )
     );

     // 2. 计算每个源的综合评分
     const scoredSources = sources.map((source, index) =>
       calculateSourceScore(
         source,
         source === userSelectedSource,
         sourceHistories[index]
       )
     );

     // 3. 按评分降序排序
     scoredSources.sort((a, b) => b.score - a.score);

     // 4. 返回排序后的源列表
     return scoredSources.map((s) => s.source);
   }
   ```

2. **下载速度/稳定性评估机制**:

   ```typescript
   interface SourceHistory {
     source: string;
     totalAttempts: number; // 总尝试次数
     successCount: number; // 成功次数
     errorCount: number; // 错误次数
     timeoutCount: number; // 超时次数
     avgSpeedMBps: number; // 平均下载速度（MB/s）
     lastSuccessTime: number; // 最后成功时间
     lastErrorTime: number; // 最后错误时间
     recentSpeeds: number[]; // 最近N次下载速度（用于计算平均值）
   }

   // 更新源历史数据
   async function updateSourceHistory(
     source: string,
     result: {
       success: boolean;
       speedMBps?: number;
       error?: string;
       timeout?: boolean;
     }
   ): Promise<void> {
     const history = await getSourceHistory(source);

     history.totalAttempts++;

     if (result.success) {
       history.successCount++;
       history.lastSuccessTime = Date.now();
       if (result.speedMBps) {
         history.recentSpeeds.push(result.speedMBps);
         // 只保留最近10次的速度记录
         if (history.recentSpeeds.length > 10) {
           history.recentSpeeds.shift();
         }
         // 重新计算平均速度
         history.avgSpeedMBps =
           history.recentSpeeds.reduce((a, b) => a + b, 0) /
           history.recentSpeeds.length;
       }
     } else {
       if (result.timeout) {
         history.timeoutCount++;
       } else {
         history.errorCount++;
       }
       history.lastErrorTime = Date.now();
     }

     await saveSourceHistory(source, history);
   }
   ```

3. **切换条件**（触发源切换的判断）:

   ```typescript
   interface SwitchCondition {
     timeout: boolean; // 连接超时（>30秒）
     httpError: boolean; // HTTP错误（4xx, 5xx）
     slowSpeed: boolean; // 下载速度过慢（<100KB/s持续10秒）
     corruptFile: boolean; // 文件损坏或格式错误
   }

   function shouldSwitchSource(
     condition: SwitchCondition,
     attemptCount: number
   ): boolean {
     // 如果已经尝试了3次以上，任何错误都切换
     if (attemptCount > 3) {
       return (
         condition.timeout ||
         condition.httpError ||
         condition.slowSpeed ||
         condition.corruptFile
       );
     }

     // 前3次尝试，只有严重错误才切换
     return (
       condition.timeout || // 超时是严重问题
       (condition.httpError && condition.httpError) || // HTTP错误
       condition.corruptFile // 文件损坏
     );
   }

   // 速度监控
   class SpeedMonitor {
     private speeds: number[] = [];
     private startTime: number = Date.now();
     private readonly CHECK_INTERVAL = 10000; // 10秒检查一次
     private readonly MIN_SPEED_KBPS = 100; // 最低速度100KB/s

     updateSpeed(bytesDownloaded: number): void {
       const now = Date.now();
       const elapsed = (now - this.startTime) / 1000; // 秒
       const speedKBps = bytesDownloaded / 1024 / elapsed;
       this.speeds.push(speedKBps);

       // 只保留最近10秒的数据
       const cutoff = now - this.CHECK_INTERVAL;
       this.speeds = this.speeds.filter((_, i) => {
         const time = this.startTime + i * (this.CHECK_INTERVAL / 10);
         return time > cutoff;
       });
     }

     isSpeedTooSlow(): boolean {
       if (this.speeds.length < 2) return false; // 至少需要2个数据点
       const avgSpeed =
         this.speeds.reduce((a, b) => a + b, 0) / this.speeds.length;
       return avgSpeed < this.MIN_SPEED_KBPS;
     }
   }
   ```

4. **切换记录**:

   ```typescript
   interface SourceSwitchRecord {
     from: string; // 原源
     to: string; // 新源
     reason: string; // 切换原因
     timestamp: number; // 切换时间
     error?: string; // 错误信息
   }

   async function recordSourceSwitch(
     taskId: string,
     switchRecord: SourceSwitchRecord
   ): Promise<void> {
     const task = await getDownloadTask(taskId);
     task.source_switches.push(switchRecord);
     task.source_switched = true;
     await saveDownloadTask(task);
   }
   ```

5. **同一文件只从同一源下载**:

   - 如果该集已下载，直接返回已下载信息
   - 如果下载中断，恢复时继续使用原源
   - 只有原源完全失败时才切换
   - **顺序尝试源**：一个源失败后再尝试下一个，不支持并发尝试多个源

6. **源切换实现流程**:

   ```typescript
   async function switchToBestSource(
     seriesKey: string,
     episodeIndex: number,
     failedSource: string,
     taskId: string
   ): Promise<string | null> {
     // 1. 获取该集的所有可用源
     const cachedSeries = await getSeries(seriesKey);
     const availableSources = cachedSeries.episodes[episodeIndex] || [];

     // 2. 排除已失败的源
     const remainingSources = availableSources.filter(
       (s) => s.source !== failedSource
     );

     if (remainingSources.length === 0) {
       return null; // 没有可用源了
     }

     // 3. 获取用户选择的源（如果有）
     const task = await getDownloadTask(taskId);
     const userSelectedSource = task.requested_source;

     // 4. 计算优先级并排序
     const prioritizedSources = await getSourcePriority(
       remainingSources.map((s) => s.source),
       userSelectedSource,
       seriesKey,
       episodeIndex
     );

     // 5. 顺序尝试每个源
     for (const source of prioritizedSources) {
       const sourceInfo = remainingSources.find((s) => s.source === source);
       if (!sourceInfo) continue;

       try {
         const result = await tryDownloadWithSource(
           sourceInfo.url,
           source,
           taskId
         );

         if (result.success) {
           // 记录成功的源切换
           await recordSourceSwitch(taskId, {
             from: failedSource,
             to: source,
             reason: '自动切换',
             timestamp: Date.now(),
           });

           // 更新源历史（成功）
           await updateSourceHistory(source, {
             success: true,
             speedMBps: result.speedMBps,
           });

           return source;
         } else {
           // 更新源历史（失败）
           await updateSourceHistory(source, {
             success: false,
             error: result.error,
             timeout: result.timeout,
           });
         }
       } catch (error) {
         // 记录错误，继续尝试下一个源
         await updateSourceHistory(source, {
           success: false,
           error: error.message,
         });
       }
     }

     return null; // 所有源都失败了
   }
   ```

**查看缓存状态流程**:

```
客户端 → GET /api/cache/status?source=ffzy
    ↓
读取缓存索引文件
    ↓
过滤符合条件的缓存条目
    ↓
读取每个条目的元数据
    ↓
返回状态信息（包含进度、大小等）
```

**清理缓存流程**:

```
客户端 → POST /api/cache/clear { type: "expired" }
    ↓
创建清理任务（返回task_id）
    ↓
后台异步执行清理
    ├── 扫描所有缓存文件
    ├── 检查是否满足清理条件
    ├── 删除符合条件的文件
    └── 更新进度（每处理N个文件）
    ↓
客户端轮询 → GET /api/cache/progress?task_id=xxx
    ↓
返回进度信息
```

### 3.2 核心组件

1. **VideoCacheService** (`src/lib/video-cache.ts`)

   - 缓存读写操作
   - 缓存有效性检查
   - 缓存清理和统计

2. **缓存 API 路由**

   - `/api/cache/status` - 查看缓存状态
   - `/api/cache/clear` - 清理缓存
   - `/api/cache/stats` - 缓存统计信息

3. **缓存目录结构**
   ```
   .cache/
   ├── videos/                      # 剧集信息缓存
   │   ├── {series_key}/           # 剧集标识（基于标题+年份或豆瓣ID）
   │   │   ├── data.json           # 剧集数据（包含所有集的链接）
   │   │   └── meta.json           # 元数据（创建时间、过期时间等）
   ├── downloads/                   # 视频文件下载缓存
   │   ├── {series_key}/           # 剧集标识
   │   │   ├── {episode_index}/    # 集数索引
   │   │   │   ├── video.m3u8      # 下载的视频文件（或分段文件）
   │   │   │   ├── segments/       # 分段文件目录（如果使用分段下载）
   │   │   │   └── download.json   # 下载元数据（来源、时间等）
   │   │   └── downloads.json      # 该剧集的所有下载记录
   ├── tasks/                       # 下载任务管理
   │   ├── {task_id}.json          # 任务信息
   │   └── active.json             # 活跃任务列表
   ├── index.json                  # 缓存索引（快速查询）
   └── stats.json                  # 统计信息
   ```

## 4. 数据结构设计

### 4.1 剧集信息缓存文件结构

**剧集标识生成规则**:

1. 优先使用 `douban_id`（如果存在）：`douban_{douban_id}`
2. 否则使用标准化标题+年份：`title_{normalized_title}_{year}`

**缓存文件** (`{series_key}/data.json`):

```json
{
  "series_key": "douban_123456",
  "title": "剧集标题",
  "poster": "封面URL",
  "year": "2024",
  "class": "分类",
  "desc": "描述",
  "type_name": "类型",
  "douban_id": 123456,
  "episodes": {
    "1": [
      {
        "source": "ffzy",
        "source_name": "源A",
        "url": "https://example.com/ep1.m3u8",
        "cached_at": 1704067200000
      },
      {
        "source": "other",
        "source_name": "源B",
        "url": "https://example2.com/ep1.m3u8",
        "cached_at": 1704067300000
      }
    ],
    "2": [
      {
        "source": "ffzy",
        "source_name": "源A",
        "url": "https://example.com/ep2.m3u8",
        "cached_at": 1704067200000
      }
    ]
  },
  "sources": ["ffzy", "other"],
  "total_episodes": 24,
  "last_updated": 1704067500000
}
```

**元数据文件** (`{series_key}/meta.json`):

```json
{
  "series_key": "douban_123456",
  "title": "剧集标题",
  "created_at": 1704067200000,
  "expires_at": 1704074400000,
  "file_size": 1024,
  "access_count": 5,
  "last_accessed": 1704067500000,
  "episode_count": 24,
  "cached_episodes": [1, 2, 3, 5, 8],
  "source_count": 2
}
```

**缓存索引** (`index.json`):

```json
{
  "version": "1.0.0",
  "last_updated": 1704067200000,
  "entries": [
    {
      "series_key": "douban_123456",
      "title": "剧集标题",
      "year": "2024",
      "douban_id": 123456,
      "episode_count": 24,
      "cached_episodes": [1, 2, 3, 5, 8],
      "sources": ["ffzy", "other"],
      "created_at": 1704067200000,
      "expires_at": 1704074400000,
      "file_path": "videos/douban_123456/data.json"
    }
  ],
  "title_index": {
    "剧集标题_2024": "douban_123456"
  },
  "douban_index": {
    "123456": "douban_123456"
  }
}
```

**统计信息** (`stats.json`):

```json
{
  "total_cached": 150,
  "total_size_bytes": 5242880,
  "total_size_mb": 5.0,
  "oldest_cache": 1704067200000,
  "newest_cache": 1704074400000,
  "hit_count": 1250,
  "miss_count": 350,
  "hit_rate": 0.781,
  "last_cleaned": 1704067200000
}
```

### 4.2 剧集标识生成规则

**剧集标识（series_key）生成逻辑**:

1. **优先使用豆瓣 ID**（如果存在）:

   ```
   series_key = `douban_${douban_id}`
   示例: douban_123456
   ```

2. **使用标准化标题+年份**（如果没有豆瓣 ID）:

   ```
   normalized_title = title
     .toLowerCase()
     .replace(/[^\w\u4e00-\u9fa5]/g, '')  // 移除特殊字符，保留中文和英文
     .trim()
   series_key = `title_${normalized_title}_${year}`
   示例: title_权力的游戏_2011
   ```

3. **文件路径**:
   ```
   数据文件: videos/{series_key}/data.json
   元数据: videos/{series_key}/meta.json
   ```

**示例**:

- 剧集: "权力的游戏" (2011, douban_id: 123456)
- series_key: `douban_123456`
- 文件: `videos/douban_123456/data.json`
- 元数据: `videos/douban_123456/meta.json`

- 剧集: "某剧集" (2024, 无豆瓣 ID)
- series*key: `title*某剧集\_2024`
- 文件: `videos/title_某剧集_2024/data.json`

### 4.3 视频文件下载缓存数据结构

**下载元数据文件** (`downloads/{series_key}/{episode_index}/download.json`):

```json
{
  "series_key": "douban_123456",
  "episode_index": 1,
  "title": "剧集标题",
  "episode_title": "第1集",
  "requested_source": "ffzy",
  "actual_source": "ffzy",
  "source_name": "源A",
  "original_url": "https://example.com/ep1.m3u8",
  "cached_url": "/api/cache/play/douban_123456/1",
  "file_path": "downloads/douban_123456/1/video.m3u8",
  "file_size_bytes": 104857600,
  "file_size_mb": 100.0,
  "download_status": "completed",
  "download_started_at": 1704067200000,
  "download_completed_at": 1704067800000,
  "download_duration_seconds": 600,
  "download_speed_mbps": 0.167,
  "retry_count": 0,
  "source_switched": false,
  "switched_sources": [],
  "error": null,
  "checksum": "sha256:abc123...",
  "last_accessed": 1704068000000,
  "access_count": 5
}
```

**下载任务文件** (`tasks/{task_id}.json`):

```json
{
  "task_id": "download_1704067200000_abc123",
  "series_key": "douban_123456",
  "episode_index": 1,
  "title": "剧集标题",
  "episode_title": "第1集",
  "requested_source": "ffzy",
  "current_source": "ffzy",
  "status": "downloading",
  "progress": 0.65,
  "downloaded_bytes": 68157440,
  "total_bytes": 104857600,
  "download_speed_mbps": 0.167,
  "estimated_time_remaining_seconds": 220,
  "started_at": 1704067200000,
  "updated_at": 1704067500000,
  "error": null,
  "retry_count": 0,
  "source_switches": []
}
```

**剧集下载记录** (`downloads/{series_key}/downloads.json`):

```json
{
  "series_key": "douban_123456",
  "title": "剧集标题",
  "total_episodes": 24,
  "downloaded_episodes": [1, 2, 3, 5, 8],
  "downloads": [
    {
      "episode_index": 1,
      "actual_source": "ffzy",
      "source_name": "源A",
      "file_size_mb": 100.0,
      "downloaded_at": 1704067800000,
      "status": "completed"
    },
    {
      "episode_index": 2,
      "actual_source": "other",
      "source_name": "源B",
      "file_size_mb": 95.5,
      "downloaded_at": 1704067900000,
      "status": "completed",
      "source_switched": true,
      "requested_source": "ffzy"
    }
  ],
  "total_size_mb": 495.5,
  "last_updated": 1704068000000
}
```

**活跃任务列表** (`tasks/active.json`):

```json
{
  "version": "1.0.0",
  "last_updated": 1704067500000,
  "tasks": [
    {
      "task_id": "download_1704067200000_abc123",
      "series_key": "douban_123456",
      "episode_index": 1,
      "status": "downloading",
      "progress": 0.65,
      "started_at": 1704067200000
    }
  ]
}
```

## 5. API 接口设计

### 5.0 接口概览

| 接口                        | 方法 | 功能                             | 权限要求                 |
| --------------------------- | ---- | -------------------------------- | ------------------------ |
| `/api/detail`               | GET  | 获取剧集详情（集成缓存）         | 无                       |
| `/api/cache/status`         | GET  | 查看缓存状态                     | 无（管理员可看详细信息） |
| `/api/cache/stats`          | GET  | 获取缓存统计                     | 无                       |
| `/api/cache/clear`          | POST | 清理缓存                         | 管理员                   |
| `/api/cache/progress`       | GET  | 查看清理进度                     | 无                       |
| `/api/download/start`       | POST | 开始下载视频文件                 | 无                       |
| `/api/download/status`      | GET  | 查看下载状态和进度               | 无                       |
| `/api/download/cancel`      | POST | 取消下载任务                     | 无                       |
| `/api/download/list`        | GET  | 获取已下载文件列表               | 无                       |
| `/api/download/play`        | GET  | 播放已下载的视频文件             | 无                       |
| `/api/download/delete`      | POST | 删除已下载的文件                 | 无                       |
| `/api/cache/update-episode` | POST | 更新集数链接到缓存（客户端通知） | 无                       |

### 5.1 修改现有接口

#### GET `/api/detail`

**功能**: 获取剧集详情（集成缓存）

**请求参数**:

- `source`: 源标识
- `id`: 剧集 ID

**响应**:

```json
{
  "id": "12345",
  "title": "剧集标题",
  "poster": "封面URL",
  "episodes": ["episode1.m3u8"],
  "source": "source_key",
  "source_name": "源名称",
  "class": "分类",
  "year": "2024",
  "desc": "描述",
  "type_name": "类型",
  "douban_id": 123456,
  "_cached": true, // 标识是否来自缓存
  "_cache_age": 3600 // 缓存年龄（秒）
}
```

**流程**:

1. **根据标题/豆瓣 ID 生成剧集标识**（series_key）
2. **检查该剧集的缓存是否存在且有效**
   - 如果缓存有效，合并新源的集数链接，返回缓存数据
   - 如果缓存无效或不存在，继续
3. **调用第三方 API 获取数据**
4. **将新数据写入缓存**（合并到现有缓存或创建新缓存）
5. **返回数据**（包含 `_series_key` 和 `_cached` 标识）

**注意**: 此接口会自动创建或更新剧集信息缓存，确保下载功能可以获取到 `series_key` 和剧集数据。

### 5.2 新增缓存管理接口

#### GET `/api/cache/status`

**功能**: 查看缓存状态和进度

**请求参数**:

- `series_key` (可选): 查看特定剧集的缓存状态
- `title` (可选): 根据标题查找剧集
- `douban_id` (可选): 根据豆瓣 ID 查找剧集

**响应**:

```json
{
  "cache_enabled": true,
  "cache_dir": ".cache/videos",
  "total_cached": 150,
  "total_size_mb": 5.0,
  "entries": [
    {
      "series_key": "douban_123456",
      "title": "剧集标题",
      "year": "2024",
      "douban_id": 123456,
      "episode_count": 24,
      "cached_episodes": [1, 2, 3, 5, 8],
      "cached_episode_count": 5,
      "sources": ["ffzy", "other"],
      "created_at": "2024-01-01T00:00:00Z",
      "expires_at": "2024-01-01T02:00:00Z",
      "age_seconds": 3600,
      "is_expired": false,
      "file_size_bytes": 1024,
      "access_count": 5,
      "last_accessed": "2024-01-01T01:00:00Z"
    }
  ],
  "stats": {
    "hit_count": 1250,
    "miss_count": 350,
    "hit_rate": 0.781
  }
}
```

#### POST `/api/cache/clear`

**功能**: 清理缓存

**请求体**:

```json
{
  "type": "all" | "expired" | "series" | "episode",
  "series_key": "douban_123456",  // type为"series"或"episode"时必填
  "episode_index": 1,  // type为"episode"时必填，清理指定集
  "max_age_hours": 24  // type为"expired"时可选，清理超过指定时间的缓存
}
```

**响应**:

```json
{
  "success": true,
  "deleted_count": 10,
  "freed_space_mb": 0.5,
  "message": "缓存清理完成"
}
```

**清理类型说明**:

- `all`: 清理所有缓存
- `expired`: 只清理已过期的缓存
- `series`: 清理指定剧集的所有缓存
- `episode`: 清理指定剧集的指定集（从缓存中移除该集的链接）

#### GET `/api/cache/stats`

**功能**: 获取缓存统计信息

**响应**:

```json
{
  "total_cached": 150,
  "total_size_bytes": 5242880,
  "total_size_mb": 5.0,
  "oldest_cache": "2024-01-01T00:00:00Z",
  "newest_cache": "2024-01-01T02:00:00Z",
  "hit_count": 1250,
  "miss_count": 350,
  "hit_rate": 0.781,
  "average_file_size_bytes": 34952,
  "series_by_source": {
    "ffzy": {
      "series_count": 40,
      "episode_count": 320
    },
    "other": {
      "series_count": 35,
      "episode_count": 280
    }
  },
  "last_cleaned": "2024-01-01T00:00:00Z"
}
```

#### GET `/api/cache/progress`

**功能**: 获取缓存操作进度（用于长时间操作）

**请求参数**:

- `task_id`: 任务 ID（清理操作返回）

**响应**:

```json
{
  "task_id": "clean-1234567890",
  "status": "running" | "completed" | "failed",
  "progress": 0.65,
  "current": 65,
  "total": 100,
  "message": "正在清理缓存...",
  "started_at": "2024-01-01T00:00:00Z",
  "estimated_completion": "2024-01-01T00:05:00Z"
}
```

### 5.3 视频文件下载接口

#### POST `/api/download/start`

**功能**: 开始下载视频文件

**请求体**（两种方式）:

**方式一：提供完整信息**:

```json
{
  "series_key": "douban_123456",
  "episode_index": 1,
  "source": "ffzy",
  "url": "https://example.com/ep1.m3u8",
  "title": "剧集标题",
  "episode_title": "第1集"
}
```

**方式二：自动查找 URL（推荐）**:

```json
{
  "series_key": "douban_123456",
  "episode_index": 1,
  "source": "ffzy",
  "title": "剧集标题",
  "episode_title": "第1集"
}
```

**响应**:

```json
{
  "success": true,
  "task_id": "download_1704067200000_abc123",
  "message": "下载任务已创建",
  "status": "pending"
}
```

**流程**:

1. **检查该集是否已下载**（避免重复下载）

   - 如果已下载，返回已下载信息

2. **获取下载 URL**（如果未提供）:

   - 如果请求中未提供 `url`，从剧集信息缓存中查找
   - 如果缓存不存在，先调用 `/api/detail` 获取剧集详情并创建缓存
   - 从缓存的 `episodes` 中获取对应 `episode_index` 的 URL

3. **确保剧集信息缓存存在**:

   - 如果 `series_key` 对应的缓存不存在，先创建或更新
   - 调用 `/api/detail` 获取最新数据并写入缓存
   - 确保下载缓存和剧集信息缓存的关联

4. **创建下载任务**:

   - 生成 `task_id`
   - 创建任务文件
   - 加入下载队列

5. **开始下载**（优先用户选择的源）:
   - 如果下载失败，自动切换到最好的源
   - 记录实际使用的源

#### GET `/api/download/status`

**功能**: 查看下载状态和进度

**请求参数**:

- `task_id`: 任务 ID（可选，不提供则返回所有活跃任务）

**响应**:

```json
{
  "task_id": "download_1704067200000_abc123",
  "series_key": "douban_123456",
  "episode_index": 1,
  "title": "剧集标题",
  "episode_title": "第1集",
  "status": "downloading" | "completed" | "failed" | "paused" | "cancelled",
  "progress": 0.65,
  "downloaded_bytes": 68157440,
  "total_bytes": 104857600,
  "download_speed_mbps": 0.167,
  "estimated_time_remaining_seconds": 220,
  "requested_source": "ffzy",
  "actual_source": "ffzy",
  "source_switched": false,
  "switched_sources": [],
  "started_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:05:00Z",
  "error": null
}
```

#### POST `/api/download/cancel`

**功能**: 取消下载任务

**请求体**:

```json
{
  "task_id": "download_1704067200000_abc123"
}
```

**响应**:

```json
{
  "success": true,
  "message": "下载任务已取消"
}
```

#### GET `/api/download/list`

**功能**: 获取已下载文件列表

**请求参数**:

- `series_key` (可选): 过滤特定剧集

**响应**:

```json
{
  "total_downloaded": 10,
  "total_size_mb": 1000.5,
  "downloads": [
    {
      "series_key": "douban_123456",
      "episode_index": 1,
      "title": "剧集标题",
      "episode_title": "第1集",
      "actual_source": "ffzy",
      "source_name": "源A",
      "file_size_mb": 100.0,
      "downloaded_at": "2024-01-01T00:10:00Z",
      "cached_url": "/api/download/play/douban_123456/1"
    }
  ]
}
```

#### GET `/api/download/play`

**功能**: 播放已下载的视频文件

**请求参数**:

- `series_key`: 剧集标识
- `episode_index`: 集数索引

**响应**: 返回视频文件流（支持 Range 请求）

#### POST `/api/download/delete`

**功能**: 删除已下载的文件

**请求体**:

```json
{
  "series_key": "douban_123456",
  "episode_index": 1
}
```

**响应**:

```json
{
  "success": true,
  "message": "文件已删除",
  "freed_space_mb": 100.0
}
```

#### POST `/api/cache/update-episode`

**功能**: 客户端通知服务器播放成功，更新集数链接到缓存

**请求体**:

```json
{
  "series_key": "douban_123456",
  "episode_index": 1,
  "source": "ffzy",
  "url": "https://example.com/ep1.m3u8",
  "source_name": "源A"
}
```

**响应**:

```json
{
  "success": true,
  "message": "缓存已更新",
  "series_key": "douban_123456"
}
```

**流程**:

1. **验证 series_key 对应的缓存是否存在**

   - 如果不存在，先调用 `/api/detail` 获取剧集详情并创建缓存
   - 确保剧集信息缓存和下载缓存的关联

2. **更新集数链接**

   - 将新的链接添加到 `episodes[episode_index]` 数组中
   - 如果该集已有相同 URL 的链接，跳过（去重）
   - 如果该集已有相同源的链接，更新为新的 URL

3. **更新元数据**

   - 更新 `last_updated` 时间
   - 更新 `sources` 列表（如果新源不在列表中）
   - 更新 `cached_episodes` 列表

4. **异步处理**
   - 缓存更新是异步的，不阻塞响应
   - 如果更新失败，记录日志但不影响播放

## 6. 核心功能实现

### 6.1 VideoCacheService 类设计

```typescript
interface CachedSeries {
  series_key: string;
  title: string;
  poster: string;
  year: string;
  class?: string;
  desc?: string;
  type_name?: string;
  douban_id?: number;
  episodes: {
    [episodeIndex: string]: EpisodeLink[];
  };
  sources: string[];
  total_episodes: number;
  last_updated: number;
}

interface EpisodeLink {
  source: string;
  source_name: string;
  url: string;
  cached_at: number;
}

class VideoCacheService {
  private cacheDir: string;
  private indexFile: string;
  private statsFile: string;

  // 初始化缓存目录
  async initialize(): Promise<void>;

  // 生成剧集标识
  generateSeriesKey(data: SearchResult): string;

  // 根据标题/豆瓣ID查找剧集标识（支持模糊匹配）
  async findSeriesKey(
    title: string,
    year?: string,
    doubanId?: number,
    options?: {
      fuzzyMatch?: boolean; // 是否启用模糊匹配
      yearTolerance?: number; // 年份容差（默认0）
    }
  ): Promise<string | null>;

  // 查找可能的重复剧集（用于管理界面）
  async findPossibleDuplicates(
    title: string,
    year?: string
  ): Promise<
    Array<{
      series_key: string;
      title: string;
      year: string;
      similarity: number;
    }>
  >;

  // 获取剧集缓存
  async getSeries(seriesKey: string): Promise<CachedSeries | null>;

  // 设置/更新剧集缓存（合并新源的集数链接）
  async setSeries(seriesKey: string, data: SearchResult): Promise<void>;

  // 获取指定集的播放链接（优先使用缓存）
  async getEpisode(
    seriesKey: string,
    episodeIndex: number
  ): Promise<EpisodeLink | null>;

  // 检查缓存是否存在且有效
  async isValid(seriesKey: string): Promise<boolean>;

  // 删除剧集缓存
  async deleteSeries(seriesKey: string): Promise<boolean>;

  // 删除指定集的缓存
  async deleteEpisode(
    seriesKey: string,
    episodeIndex: number
  ): Promise<boolean>;

  // 获取所有缓存条目
  async getAllEntries(filter?: {
    seriesKey?: string;
    title?: string;
    doubanId?: number;
  }): Promise<CacheEntry[]>;

  // 获取缓存统计
  async getStats(): Promise<CacheStats>;

  // 清理缓存
  async clear(options: ClearOptions): Promise<ClearResult>;

  // 更新索引
  private async updateIndex(): Promise<void>;

  // 更新统计
  private async updateStats(): Promise<void>;

  // 记录缓存命中/未命中
  async recordHit(): Promise<void>;
  async recordMiss(): Promise<void>;
}

// 视频文件下载服务
class VideoDownloadService {
  private downloadDir: string;
  private tasksDir: string;
  private downloadQueue: DownloadTask[] = []; // 下载队列
  private currentDownload: DownloadTask | null = null; // 当前正在下载的任务

  // 开始下载（加入队列，不支持并发）
  async startDownload(options: DownloadOptions): Promise<DownloadTask>;

  // 处理下载队列（顺序执行，一个接一个）
  private async processDownloadQueue(): Promise<void>;

  // 获取下载状态
  async getDownloadStatus(taskId: string): Promise<DownloadStatus | null>;

  // 取消下载
  async cancelDownload(taskId: string): Promise<boolean>;

  // 获取已下载列表
  async getDownloadedList(filter?: {
    seriesKey?: string;
  }): Promise<DownloadedItem[]>;

  // 删除已下载文件
  async deleteDownload(
    seriesKey: string,
    episodeIndex: number
  ): Promise<boolean>;

  // 检查是否已下载
  async isDownloaded(seriesKey: string, episodeIndex: number): Promise<boolean>;

  // 获取下载文件路径
  async getDownloadPath(
    seriesKey: string,
    episodeIndex: number
  ): Promise<string | null>;

  // 源切换逻辑
  private async tryDownloadWithSource(
    url: string,
    source: string,
    taskId: string
  ): Promise<{
    success: boolean;
    error?: string;
    timeout?: boolean;
    speedMBps?: number;
  }>;

  // 自动切换到最好的源
  private async switchToBestSource(
    seriesKey: string,
    episodeIndex: number,
    failedSource: string,
    taskId: string
  ): Promise<string | null>;

  // 计算源优先级（综合评分排序）
  private async getSourcePriority(
    sources: string[],
    userSelectedSource: string,
    seriesKey: string,
    episodeIndex: number
  ): Promise<string[]>;

  // 获取源历史数据
  private async getSourceHistory(
    source: string,
    seriesKey?: string,
    episodeIndex?: number
  ): Promise<SourceHistory>;

  // 更新源历史数据
  private async updateSourceHistory(
    source: string,
    result: {
      success: boolean;
      speedMBps?: number;
      error?: string;
      timeout?: boolean;
    }
  ): Promise<void>;

  // 速度监控
  private createSpeedMonitor(): SpeedMonitor;
}
```

### 6.2 剧集识别和合并逻辑

**剧集识别流程**:

1. **优先使用豆瓣 ID**（最可靠）:

   - 如果 `douban_id` 存在，直接使用 `douban_{douban_id}` 作为 series_key
   - 这是最可靠的识别方式，避免标题匹配的不准确性
   - 建议：在获取剧集详情时，优先使用有豆瓣 ID 的源

2. **使用标题+年份**（降级方案）:

   - 标准化标题：移除特殊字符，转小写，去除空格
   - 格式：`title_{normalized_title}_{year}`
   - 用于没有豆瓣 ID 的剧集
   - **注意**：标题匹配可能不够准确，需要处理各种特殊情况

3. **标题标准化规则**（处理特殊情况）:

   ```typescript
   function normalizeTitle(title: string): string {
     return (
       title
         .toLowerCase()
         // 移除常见的标点符号和特殊字符
         .replace(/[^\w\u4e00-\u9fa5]/g, '')
         // 移除常见的无意义词（可选）
         // .replace(/\b(的|之|与|和|及|或|但|而|等)\b/g, '')
         // 统一处理空格和空白字符
         .replace(/\s+/g, '')
         .trim()
     );
   }
   ```

4. **标题匹配的特殊情况处理**:

   - **标点符号变体**: "权力的游戏" vs "权力的游戏！" → 统一处理
   - **空格差异**: "权力的游戏" vs "权力 的 游戏" → 统一处理
   - **全角半角**: "权力的游戏" vs "权力的游戏" → 统一处理
   - **年份格式**: "2024" vs "2024 年" → 提取数字部分
   - **别名问题**: 同一剧集可能有不同名称（如中英文名）→ 无法自动识别，需要手动关联

5. **识别准确性提升策略**:

   - **优先使用豆瓣 ID**: 在获取剧集详情时，优先选择有豆瓣 ID 的源
   - **标题模糊匹配**: 如果精确匹配失败，可以尝试模糊匹配（编辑距离算法）
   - **年份容差**: 允许年份有 ±1 年的容差（处理跨年剧集）
   - **手动关联**: 提供管理接口，允许管理员手动关联同一剧集的不同标题

6. **识别失败时的降级策略**:

   - 如果无法识别为已有剧集，创建新的缓存条目
   - 记录识别失败的原因（无豆瓣 ID、标题不匹配等）
   - 在管理界面中提示可能的重复剧集，供管理员审核

**缓存合并策略**:

1. **新源数据合并**:

   - 当获取到新源的剧集数据时，检查是否已有该剧集的缓存
   - 如果存在，将新源的集数链接合并到现有缓存中
   - 如果某集已有链接，追加新链接（不覆盖）

2. **集数链接去重**:

   - 相同 URL 的链接只保留一个
   - 保留最早缓存的链接信息

3. **元数据更新**:
   - 更新 `last_updated` 时间
   - 更新 `sources` 列表
   - 更新 `total_episodes`（取最大值）

### 6.3 缓存有效期管理

- **默认 TTL**: 从 `getCacheTime()` 获取（默认 7200 秒/2 小时）
- **过期检查**: 每次读取时检查 `expires_at`
- **自动清理**: 可选的后台任务定期清理过期缓存
- **集数级 TTL**: 每个集的链接可以单独设置过期时间（可选）

### 6.4 缓存更新策略

1. **写时更新**: 每次获取新数据时更新缓存（合并新源）
2. **读时验证**: 读取时检查是否过期
3. **后台刷新**: 可选的后台任务预刷新热门缓存
4. **增量更新**: 只更新变化的集数，不重写整个缓存文件

### 6.5 缓存关联和更新机制

#### 6.5.1 剧集信息缓存与下载缓存的关联

**问题**: 下载时需要知道剧集的 `series_key`，但两个缓存是分开的。

**解决方案**:

1. **下载时自动创建/更新剧集信息缓存**:

   - 如果 `series_key` 对应的缓存不存在，先调用 `/api/detail` 获取数据
   - 确保下载缓存和剧集信息缓存的关联
   - 下载接口支持自动查找 URL（从剧集信息缓存中）

2. **数据一致性保证**:
   - 下载接口会自动检查并创建/更新剧集信息缓存
   - `/api/detail` 接口会自动创建或更新缓存
   - 两个缓存使用相同的 `series_key` 作为关联键

#### 6.5.2 下载 URL 的获取

**问题**: 下载接口需要 URL，但实际使用中需要从 `/api/detail` 获取。

**解决方案**:

1. **支持两种方式**:

   - **方式一**: 提供完整 URL（客户端已获取）
   - **方式二**: 只提供 `series_key` + `episode_index`，服务器自动查找（推荐）

2. **自动查找流程**:
   - 如果请求中未提供 `url`，从剧集信息缓存中查找
   - 如果缓存不存在，先调用 `/api/detail` 获取剧集详情并创建缓存
   - 从缓存的 `episodes` 中获取对应 `episode_index` 的 URL

#### 6.5.3 缓存更新触发机制

**问题**: 播放是在客户端进行的，服务器端如何知道播放成功并更新缓存？

**解决方案**: 客户端主动通知服务器

1. **客户端播放成功通知**:

   ```typescript
   // 客户端播放成功后调用
   async function notifyPlaybackSuccess(
     seriesKey: string,
     episodeIndex: number,
     source: string,
     url: string
   ): Promise<void> {
     await fetch('/api/cache/update-episode', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({
         series_key: seriesKey,
         episode_index: episodeIndex,
         source: source,
         url: url,
       }),
     });
   }
   ```

2. **新增 API 接口**: `POST /api/cache/update-episode`

   **功能**: 客户端通知服务器播放成功，更新缓存

   **请求体**:

   ```json
   {
     "series_key": "douban_123456",
     "episode_index": 1,
     "source": "ffzy",
     "url": "https://example.com/ep1.m3u8"
   }
   ```

   **响应**:

   ```json
   {
     "success": true,
     "message": "缓存已更新"
   }
   ```

   **流程**:

   1. 验证 `series_key` 对应的缓存是否存在
   2. 如果不存在，先创建缓存（调用 `/api/detail` 获取数据）
   3. 将新的集数链接添加到缓存的 `episodes` 中
   4. 更新元数据（`last_updated`、`sources` 等）

3. **自动更新时机**:

   - 客户端播放成功时（推荐）：用户开始播放且播放器成功加载
   - 客户端播放一段时间后：播放超过一定时长（如 10 秒）认为播放成功
   - 服务器端检测（可选）：通过心跳机制检测播放状态（复杂，不推荐）

4. **降级策略**:
   - 如果客户端通知失败，不影响播放
   - 下次获取剧集详情时，服务器端会自动更新缓存
   - 缓存更新是异步的，不阻塞播放流程

## 7. M3U8 文件处理

### 7.1 M3U8 文件格式说明

M3U8 是 HLS (HTTP Live Streaming) 播放列表格式，包含视频分段的元数据：

**主播放列表（Master Playlist）示例**:

```
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=1280000,RESOLUTION=854x480
480p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2560000,RESOLUTION=1280x720
720p.m3u8
```

**媒体播放列表（Media Playlist）示例**:

```
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:10.0,
segment001.ts
#EXTINF:10.0,
segment002.ts
#EXTINF:9.5,
segment003.ts
#EXT-X-ENDLIST
```

### 7.2 M3U8 解析流程

**解析步骤**:

1. **下载 M3U8 文件**:

   ```typescript
   async function downloadM3U8(m3u8Url: string): Promise<string> {
     const response = await fetch(m3u8Url);
     return await response.text();
   }
   ```

2. **解析播放列表**:

   ```typescript
   interface M3U8Segment {
     duration: number;
     url: string;
     sequence: number;
   }

   function parseM3U8(content: string, baseUrl: string): M3U8Segment[] {
     const lines = content.split('\n');
     const segments: M3U8Segment[] = [];
     let currentDuration = 0;
     let sequence = 0;

     for (let i = 0; i < lines.length; i++) {
       const line = lines[i].trim();

       // 解析时长
       if (line.startsWith('#EXTINF:')) {
         const durationMatch = line.match(/#EXTINF:([\d.]+)/);
         if (durationMatch) {
           currentDuration = parseFloat(durationMatch[1]);
         }
       }

       // 解析分段URL
       if (line && !line.startsWith('#')) {
         const segmentUrl = resolveUrl(baseUrl, line);
         segments.push({
           duration: currentDuration,
           url: segmentUrl,
           sequence: sequence++,
         });
       }
     }

     return segments;
   }

   function resolveUrl(baseUrl: string, relativeUrl: string): string {
     if (
       relativeUrl.startsWith('http://') ||
       relativeUrl.startsWith('https://')
     ) {
       return relativeUrl; // 绝对路径
     }
     // 相对路径，需要拼接
     const base = new URL(baseUrl);
     return new URL(relativeUrl, base).href;
   }
   ```

3. **处理嵌套播放列表**:
   - 如果解析到主播放列表，选择最高质量的流
   - 递归下载并解析媒体播放列表

### 7.3 M3U8 分段下载策略

**保持分段结构**

- 下载所有 TS 分段文件到 `segments/` 目录
- 保存修改后的 M3U8 文件，将分段 URL 指向本地文件
- 优点：支持流式播放，节省内存，可以边下载边播放
- 缺点：文件数量多，管理相对复杂

**目录结构**:

```
downloads/{series_key}/{episode_index}/
├── playlist.m3u8          # 修改后的播放列表
├── segments/
│   ├── segment001.ts
│   ├── segment002.ts
│   └── ...
└── download.json
```

**修改后的 M3U8 文件**:

```
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:10.0,
segments/segment001.ts
#EXTINF:10.0,
segments/segment002.ts
#EXTINF:9.5,
segments/segment003.ts
#EXT-X-ENDLIST
```

### 7.4 M3U8 下载实现

```typescript
class M3U8Downloader {
  async downloadM3U8(
    m3u8Url: string,
    outputDir: string,
    taskId: string
  ): Promise<DownloadResult> {
    // 1. 下载并解析 M3U8
    const m3u8Content = await this.downloadM3U8File(m3u8Url);
    const baseUrl =
      new URL(m3u8Url).origin +
      new URL(m3u8Url).pathname.split('/').slice(0, -1).join('/');

    // 2. 检查是否是主播放列表
    if (this.isMasterPlaylist(m3u8Content)) {
      // 选择最高质量的流
      const mediaPlaylistUrl = this.selectBestStream(m3u8Content, baseUrl);
      return this.downloadM3U8(mediaPlaylistUrl, outputDir, taskId);
    }

    // 3. 解析媒体播放列表
    const segments = this.parseMediaPlaylist(m3u8Content, baseUrl);

    // 4. 创建 segments 目录
    const segmentsDir = path.join(outputDir, 'segments');
    await fs.mkdir(segmentsDir, { recursive: true });

    // 5. 顺序下载所有分段（不支持并发，避免源服务器限制）
    const downloadedSegments: string[] = [];
    let totalSize = 0;

    // 顺序下载，一个接一个，避免触发源服务器的并发限制
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const segmentFileName = `segment${String(i + 1).padStart(3, '0')}.ts`;
      const segmentPath = path.join(segmentsDir, segmentFileName);

      try {
        // 顺序下载分段（await 确保前一个完成后再下载下一个）
        const segmentData = await this.downloadSegment(segment.url, taskId);
        await fs.writeFile(segmentPath, segmentData);

        downloadedSegments.push(segmentFileName);
        totalSize += segmentData.length;

        // 更新进度
        await this.updateProgress(taskId, {
          progress: (i + 1) / segments.length,
          downloaded_bytes: totalSize,
        });
      } catch (error) {
        throw new Error(`下载分段失败: ${segment.url} - ${error}`);
      }
    }

    // 6. 生成修改后的 M3U8 文件
    const modifiedM3U8 = this.generateLocalM3U8(segments, downloadedSegments);
    const playlistPath = path.join(outputDir, 'playlist.m3u8');
    await fs.writeFile(playlistPath, modifiedM3U8);

    return {
      success: true,
      file_path: playlistPath,
      file_size: totalSize,
      segment_count: segments.length,
    };
  }

  private async downloadSegment(url: string, taskId: string): Promise<Buffer> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时

    try {
      const response = await fetch(url, {
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      clearTimeout(timeoutId);
      return Buffer.from(arrayBuffer);
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  private generateLocalM3U8(
    segments: M3U8Segment[],
    downloadedSegments: string[]
  ): string {
    let m3u8 = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n';

    segments.forEach((segment, index) => {
      m3u8 += `#EXTINF:${segment.duration.toFixed(1)},\n`;
      m3u8 += `segments/${downloadedSegments[index]}\n`;
    });

    m3u8 += '#EXT-X-ENDLIST\n';
    return m3u8;
  }

  private isMasterPlaylist(content: string): boolean {
    return content.includes('#EXT-X-STREAM-INF');
  }

  private selectBestStream(content: string, baseUrl: string): string {
    const lines = content.split('\n');
    let bestBandwidth = 0;
    let bestUrl = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('#EXT-X-STREAM-INF')) {
        const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
        if (bandwidthMatch) {
          const bandwidth = parseInt(bandwidthMatch[1]);
          if (bandwidth > bestBandwidth) {
            bestBandwidth = bandwidth;
            // 下一行应该是 URL
            if (i + 1 < lines.length && lines[i + 1].trim()) {
              bestUrl = resolveUrl(baseUrl, lines[i + 1].trim());
            }
          }
        }
      }
    }

    return bestUrl || lines[lines.length - 1].trim();
  }
}
```

### 7.5 M3U8 下载元数据

**下载元数据文件** (`download.json`):

```json
{
  "series_key": "douban_123456",
  "episode_index": 1,
  "m3u8_url": "https://example.com/playlist.m3u8",
  "playlist_type": "media",
  "segment_count": 120,
  "total_duration": 1200,
  "download_strategy": "segments",
  "segments_dir": "segments",
  "playlist_file": "playlist.m3u8",
  "actual_source": "ffzy",
  "downloaded_at": 1704067800000
}
```

### 7.6 M3U8 播放支持

**播放已下载的 M3U8**:

1. 客户端请求 `/api/download/play?series_key=xxx&episode_index=1`
2. 服务器返回修改后的 M3U8 文件（分段指向本地文件）
3. 客户端使用 HLS.js 播放，HLS.js 会请求本地分段文件
4. 服务器提供分段文件服务：`/api/download/segment?series_key=xxx&episode_index=1&segment=segment001.ts`

**分段文件服务接口**:

```typescript
// GET /api/download/segment
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const seriesKey = searchParams.get('series_key');
  const episodeIndex = searchParams.get('episode_index');
  const segment = searchParams.get('segment');

  const segmentPath = path.join(
    cacheDir,
    'downloads',
    seriesKey,
    episodeIndex,
    'segments',
    segment
  );

  const fileStream = fs.createReadStream(segmentPath);
  return new NextResponse(fileStream, {
    headers: {
      'Content-Type': 'video/mp2t',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
```

## 8. 文件系统操作

### 8.1 目录结构

```
项目根目录/
├── .cache/                    # 缓存根目录（.gitignore）
│   ├── videos/                # 剧集信息缓存目录
│   │   ├── {series_key}/      # 剧集标识目录
│   │   │   ├── data.json      # 剧集数据
│   │   │   └── meta.json      # 元数据
│   ├── downloads/              # 视频文件下载缓存目录
│   │   ├── {series_key}/      # 剧集标识目录
│   │   │   ├── {episode_index}/ # 集数目录
│   │   │   │   ├── video.m3u8 # 下载的视频文件
│   │   │   │   ├── segments/   # 分段文件（如果使用分段下载）
│   │   │   │   └── download.json # 下载元数据
│   │   │   └── downloads.json # 该剧集的所有下载记录
│   ├── tasks/                  # 下载任务管理目录
│   │   ├── {task_id}.json     # 任务信息
│   │   └── active.json        # 活跃任务列表
│   ├── index.json             # 缓存索引
│   └── stats.json             # 统计信息
```

### 8.2 文件操作

- **原子写入**: 使用临时文件 + 重命名确保数据完整性
- **错误处理**: 文件操作失败时的降级策略
- **并发控制**: 使用文件锁避免并发写入冲突
- **M3U8 分段下载**: **顺序下载**（不支持并发），避免源服务器并发限制

## 9. 进度状态管理

### 8.1 清理操作进度

对于大量缓存的清理操作，使用任务队列和进度跟踪：

```typescript
interface CleanTask {
  task_id: string;
  type: ClearType;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  current: number;
  total: number;
  started_at: number;
  message: string;
}
```

### 8.2 进度更新机制

1. **任务创建**: 清理操作开始时创建任务记录
2. **进度更新**: 每处理 N 个文件更新一次进度
3. **状态查询**: 客户端轮询 `/api/cache/progress` 获取进度
4. **任务清理**: 完成后保留一定时间后自动清理

## 9. 错误处理

### 9.1 错误码定义

| 错误码                    | HTTP 状态码 | 说明           |
| ------------------------- | ----------- | -------------- |
| `CACHE_READ_ERROR`        | 500         | 缓存读取失败   |
| `CACHE_WRITE_ERROR`       | 500         | 缓存写入失败   |
| `CACHE_INVALID_KEY`       | 400         | 无效的缓存键   |
| `CACHE_PERMISSION_DENIED` | 403         | 权限不足       |
| `CACHE_DISK_FULL`         | 507         | 磁盘空间不足   |
| `CACHE_TASK_NOT_FOUND`    | 404         | 任务不存在     |
| `CACHE_INVALID_TYPE`      | 400         | 无效的清理类型 |

### 9.2 缓存失败降级

- **缓存读取失败** → 直接调用第三方 API，记录错误日志
- **缓存写入失败** → 记录日志，不影响正常流程，继续返回数据
- **文件系统错误** → 返回错误信息，不中断服务，降级为无缓存模式

### 9.3 异常情况处理

- **磁盘空间不足**:

  - 自动清理最旧的缓存（按访问时间排序）
  - 清理后仍不足则返回错误，禁用缓存写入
  - 记录告警日志

- **权限问题**:

  - 记录错误日志
  - 禁用缓存功能
  - 返回警告信息，但不中断服务

- **文件损坏**:

  - 检测到损坏文件时自动删除
  - 重新从第三方 API 获取数据
  - 记录错误日志

- **并发冲突**:

  - 使用文件锁机制避免并发写入
  - 读取冲突时重试机制
  - 写入冲突时使用最后写入获胜策略

- **下载并发限制**:
  - **不支持并发下载**: 所有下载任务按顺序执行，避免触发源服务器的并发限制
  - 同一时间只处理一个下载任务
  - 多个下载请求会进入队列，按顺序处理
  - 这样可以避免被源服务器封禁或限流

### 9.4 错误响应格式

```json
{
  "error": true,
  "error_code": "CACHE_READ_ERROR",
  "message": "无法读取缓存文件: EACCES: permission denied",
  "fallback": true, // 是否已降级处理
  "timestamp": "2024-01-01T00:00:00Z"
}
```

## 11. 性能优化

### 10.1 索引优化

- 使用内存索引加速查询
- 定期重建索引（避免索引文件过大）

### 10.2 批量操作

- 批量读取元数据
- 批量删除文件

### 10.3 异步操作

- 缓存写入异步化（不阻塞响应）
- 统计更新异步化

## 11. 安全考虑

### 11.1 路径安全

- 验证 source 和 id 参数，防止路径遍历攻击
- 使用白名单验证 source 值

### 11.2 权限控制

- 缓存管理接口需要管理员权限
- 普通用户只能查看状态，不能清理缓存

## 13. 配置选项

### 12.1 环境变量

```bash
# 缓存目录（默认: .cache）
VIDEO_CACHE_DIR=.cache

# 是否启用缓存（默认: true）
ENABLE_VIDEO_CACHE=true

# 缓存最大大小（MB，默认: 无限制）
VIDEO_CACHE_MAX_SIZE_MB=1000

# 自动清理间隔（小时，默认: 24）
VIDEO_CACHE_AUTO_CLEAN_INTERVAL=24
```

### 12.2 配置接口

在管理员配置中添加缓存相关配置：

- 启用/禁用缓存
- 缓存 TTL 设置
- 最大缓存大小
- 自动清理策略

## 14. 监控和日志

### 13.1 日志记录

- 缓存命中/未命中
- 缓存写入/删除操作
- 错误和异常

### 13.2 指标收集

- 缓存命中率
- 平均响应时间
- 缓存大小趋势

## 15. 实现计划

### 阶段一：核心功能

1. 实现 VideoCacheService 基础功能
2. 修改 `/api/detail` 集成缓存
3. 实现缓存读写和有效性检查

### 阶段二：管理功能

1. 实现 `/api/cache/status` 接口
2. 实现 `/api/cache/stats` 接口
3. 实现 `/api/cache/clear` 接口

### 阶段三：进度和优化

1. 实现进度跟踪功能
2. 添加自动清理任务
3. 性能优化和错误处理完善

### 阶段四：UI 界面

1. 在管理后台添加缓存管理页面
2. 显示缓存状态和统计
3. 提供清理操作界面

## 16. 测试计划

### 15.1 单元测试

- VideoCacheService 各方法测试
- 缓存有效性检查测试
- 清理功能测试

### 15.2 集成测试

- API 接口测试
- 缓存命中/未命中流程测试
- 顺序下载测试（验证不支持并发）
- 下载队列测试

### 15.3 性能测试

- 大量缓存文件的读写性能
- 清理操作的性能
- 内存使用情况

## 17. 未来扩展

1. **多级缓存**: 内存缓存 + 文件系统缓存
2. **缓存预热**: 根据用户行为预加载热门内容
3. **分布式缓存**: 支持多实例共享缓存
4. **缓存压缩**: 压缩存储的 JSON 数据
5. **增量更新**: 只更新变化的字段

## 17. 客户端使用示例

### 17.1 获取剧集详情（自动使用缓存）

```typescript
// 客户端代码示例
async function getVideoDetail(source: string, id: string) {
  const response = await fetch(`/api/detail?source=${source}&id=${id}`);
  const data = await response.json();

  if (data._cached) {
    console.log(`使用缓存数据，缓存年龄: ${data._cache_age}秒`);
    console.log(`剧集标识: ${data._series_key}`);
  } else {
    console.log('从第三方API获取新数据');
  }

  return data;
}
```

### 17.1.1 获取指定集的播放链接（优先使用缓存）

```typescript
// 播放时自动使用缓存
async function getEpisodeUrl(
  seriesKey: string,
  episodeIndex: number
): Promise<string | null> {
  // 优先从缓存获取
  const response = await fetch(
    `/api/detail/episode?series_key=${seriesKey}&episode_index=${episodeIndex}`
  );

  if (!response.ok) {
    return null;
  }

  const data = await response.json();

  if (data.from_cache) {
    console.log(`使用缓存链接: ${data.url}`);
    return data.url;
  }

  return null;
}

// 使用示例：播放时自动识别
async function playEpisode(
  title: string,
  year: string,
  doubanId: number | undefined,
  episodeIndex: number,
  fallbackSource: string,
  fallbackId: string
) {
  // 1. 尝试从缓存获取
  let seriesKey: string | null = null;

  if (doubanId) {
    seriesKey = `douban_${doubanId}`;
  } else {
    // 根据标题查找
    const findResponse = await fetch(
      `/api/cache/find?title=${encodeURIComponent(title)}&year=${year}`
    );
    if (findResponse.ok) {
      const result = await findResponse.json();
      seriesKey = result.series_key;
    }
  }

  if (seriesKey) {
    const cachedUrl = await getEpisodeUrl(seriesKey, episodeIndex);
    if (cachedUrl) {
      // 直接使用缓存链接播放
      return cachedUrl;
    }
  }

  // 2. 缓存未命中，使用用户选择的源
  const detailResponse = await fetch(
    `/api/detail?source=${fallbackSource}&id=${fallbackId}`
  );
  const detail = await detailResponse.json();

  if (detail.episodes && detail.episodes[episodeIndex - 1]) {
    const episodeUrl = detail.episodes[episodeIndex - 1];

    // 3. 播放成功后，通知服务器更新缓存
    // 可以在播放器成功加载后调用
    playVideo(episodeUrl).then(() => {
      if (detail._series_key) {
        notifyPlaybackSuccess(
          detail._series_key,
          episodeIndex,
          fallbackSource,
          episodeUrl
        );
      }
    });

    return episodeUrl;
  }

  return null;
}

// 通知服务器播放成功，更新缓存
async function notifyPlaybackSuccess(
  seriesKey: string,
  episodeIndex: number,
  source: string,
  url: string
): Promise<void> {
  try {
    await fetch('/api/cache/update-episode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        series_key: seriesKey,
        episode_index: episodeIndex,
        source: source,
        url: url,
      }),
    });
    console.log('缓存更新成功');
  } catch (error) {
    console.warn('缓存更新失败（不影响播放）:', error);
  }
}
```

### 17.2 查看缓存状态

```typescript
// 查看所有缓存状态
async function getCacheStatus(source?: string) {
  const url = source
    ? `/api/cache/status?source=${source}`
    : '/api/cache/status';

  const response = await fetch(url);
  const status = await response.json();

  console.log(`总缓存数: ${status.total_cached}`);
  console.log(`总大小: ${status.total_size_mb}MB`);
  console.log(`命中率: ${(status.stats.hit_rate * 100).toFixed(2)}%`);

  return status;
}
```

### 17.3 清理缓存（带进度跟踪）

```typescript
// 清理过期缓存并跟踪进度
async function clearExpiredCache() {
  // 1. 发起清理请求
  const clearResponse = await fetch('/api/cache/clear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'expired',
      max_age_hours: 24,
    }),
  });

  const { task_id } = await clearResponse.json();

  // 2. 轮询进度
  const progressInterval = setInterval(async () => {
    const progressResponse = await fetch(
      `/api/cache/progress?task_id=${task_id}`
    );
    const progress = await progressResponse.json();

    console.log(`进度: ${(progress.progress * 100).toFixed(1)}%`);
    console.log(`状态: ${progress.message}`);

    if (progress.status === 'completed') {
      clearInterval(progressInterval);
      console.log(`清理完成，删除了 ${progress.deleted_count} 个缓存`);
    } else if (progress.status === 'failed') {
      clearInterval(progressInterval);
      console.error('清理失败:', progress.message);
    }
  }, 1000); // 每秒查询一次
}
```

### 17.4 获取缓存统计

```typescript
// 获取缓存统计信息
async function getCacheStats() {
  const response = await fetch('/api/cache/stats');
  const stats = await response.json();

  return {
    total: stats.total_cached,
    size: `${stats.total_size_mb.toFixed(2)}MB`,
    hitRate: `${(stats.hit_rate * 100).toFixed(2)}%`,
    sources: Object.entries(stats.sources).map(
      ([key, value]: [string, any]) => ({
        name: key,
        count: value.count,
        size: `${value.size_mb.toFixed(2)}MB`,
      })
    ),
  };
}
```

### 17.5 视频文件下载示例

```typescript
// 开始下载视频文件（支持自动查找URL）
async function startDownload(
  seriesKey: string,
  episodeIndex: number,
  source: string,
  url: string | undefined, // 可选，如果不提供会自动查找
  title: string,
  episodeTitle: string
) {
  // 1. 检查是否已下载
  const checkResponse = await fetch(
    `/api/download/list?series_key=${seriesKey}`
  );
  const list = await checkResponse.json();

  const existing = list.downloads.find(
    (d: any) => d.episode_index === episodeIndex
  );

  if (existing) {
    console.log('该集已下载，使用缓存:', existing.cached_url);
    return existing.cached_url;
  }

  // 2. 开始下载（优先用户选择的源）
  // 如果未提供url，服务器会自动从缓存中查找
  const requestBody: any = {
    series_key: seriesKey,
    episode_index: episodeIndex,
    source: source, // 用户选择的源
    title: title,
    episode_title: episodeTitle,
  };

  // 如果提供了URL，则包含在请求中；否则服务器会自动查找
  if (url) {
    requestBody.url = url;
  }

  const response = await fetch('/api/download/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  const { task_id } = await response.json();

  // 3. 轮询下载进度
  const progressInterval = setInterval(async () => {
    const statusResponse = await fetch(
      `/api/download/status?task_id=${task_id}`
    );
    const status = await statusResponse.json();

    console.log(`下载进度: ${(status.progress * 100).toFixed(1)}%`);
    console.log(`下载速度: ${status.download_speed_mbps.toFixed(2)}MB/s`);

    if (status.source_switched) {
      console.log(
        `源已切换: ${status.requested_source} -> ${status.actual_source}`
      );
      console.log(`切换原因: ${status.switched_sources[0]?.reason}`);
    }

    if (status.status === 'completed') {
      clearInterval(progressInterval);
      console.log('下载完成！');
      console.log(`实际来源: ${status.actual_source}`);
      console.log(
        `文件大小: ${(status.downloaded_bytes / 1024 / 1024).toFixed(2)}MB`
      );
    } else if (status.status === 'failed') {
      clearInterval(progressInterval);
      console.error('下载失败:', status.error);
    }
  }, 1000); // 每秒查询一次

  return task_id;
}

// 获取已下载文件列表
async function getDownloadedList(seriesKey?: string) {
  const url = seriesKey
    ? `/api/download/list?series_key=${seriesKey}`
    : '/api/download/list';

  const response = await fetch(url);
  const data = await response.json();

  return {
    total: data.total_downloaded,
    size: `${data.total_size_mb.toFixed(2)}MB`,
    downloads: data.downloads.map((d: any) => ({
      episode: d.episode_index,
      title: d.episode_title,
      source: d.actual_source,
      sourceName: d.source_name,
      size: `${d.file_size_mb.toFixed(2)}MB`,
      downloadedAt: new Date(d.downloaded_at),
      playUrl: d.cached_url,
    })),
  };
}

// 播放已下载的文件
async function playDownloaded(
  seriesKey: string,
  episodeIndex: number
): Promise<string | null> {
  const url = `/api/download/play?series_key=${seriesKey}&episode_index=${episodeIndex}`;
  return url; // 返回播放URL
}
```

### 17.6 React 下载组件示例

```tsx
// 视频下载组件
function VideoDownloadButton({
  seriesKey,
  episodeIndex,
  source,
  url,
  title,
  episodeTitle,
}: {
  seriesKey: string;
  episodeIndex: number;
  source: string;
  url: string;
  title: string;
  episodeTitle: string;
}) {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string>('idle');
  const [taskId, setTaskId] = useState<string | null>(null);

  // 检查是否已下载
  useEffect(() => {
    checkDownloaded();
  }, [seriesKey, episodeIndex]);

  const checkDownloaded = async () => {
    const list = await getDownloadedList(seriesKey);
    const existing = list.downloads.find((d) => d.episode === episodeIndex);
    if (existing) {
      setStatus('downloaded');
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    setStatus('downloading');

    try {
      const tid = await startDownload(
        seriesKey,
        episodeIndex,
        source,
        url,
        title,
        episodeTitle
      );
      setTaskId(tid);

      // 轮询进度
      const interval = setInterval(async () => {
        const statusRes = await fetch(`/api/download/status?task_id=${tid}`);
        const downloadStatus = await statusRes.json();

        setProgress(downloadStatus.progress * 100);

        if (downloadStatus.status === 'completed') {
          clearInterval(interval);
          setStatus('downloaded');
          setDownloading(false);
        } else if (downloadStatus.status === 'failed') {
          clearInterval(interval);
          setStatus('failed');
          setDownloading(false);
        }
      }, 1000);
    } catch (error) {
      setStatus('failed');
      setDownloading(false);
    }
  };

  const handleCancel = async () => {
    if (taskId) {
      await fetch('/api/download/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: taskId }),
      });
      setDownloading(false);
      setStatus('cancelled');
    }
  };

  if (status === 'downloaded') {
    return <button disabled>已下载</button>;
  }

  if (downloading) {
    return (
      <div>
        <div>下载中: {progress.toFixed(1)}%</div>
        <button onClick={handleCancel}>取消</button>
      </div>
    );
  }

  return <button onClick={handleDownload}>下载</button>;
}
```

### 17.7 React 缓存管理组件示例

```tsx
// 缓存管理组件示例
function CacheManagement() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/cache/stats')
      .then((res) => res.json())
      .then(setStatus);
  }, []);

  const handleClear = async (type: string) => {
    setLoading(true);
    try {
      const res = await fetch('/api/cache/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      const result = await res.json();
      alert(`清理完成: ${result.message}`);
      // 刷新状态
      const statsRes = await fetch('/api/cache/stats');
      setStatus(await statsRes.json());
    } finally {
      setLoading(false);
    }
  };

  if (!status) return <div>加载中...</div>;

  return (
    <div>
      <h2>缓存统计</h2>
      <p>总缓存数: {status.total_cached}</p>
      <p>总大小: {status.total_size_mb.toFixed(2)}MB</p>
      <p>命中率: {(status.hit_rate * 100).toFixed(2)}%</p>

      <div>
        <button onClick={() => handleClear('expired')} disabled={loading}>
          清理过期缓存
        </button>
        <button onClick={() => handleClear('all')} disabled={loading}>
          清理所有缓存
        </button>
      </div>
    </div>
  );
}
```

## 19. 注意事项

1. **单机部署**: 文件系统缓存仅适用于单机部署，多实例需要共享存储
2. **磁盘空间**: 需要监控缓存目录大小，避免占满磁盘
3. **备份**: 缓存数据不是关键数据，但可以考虑定期备份索引
4. **迁移**: 如果未来改用 Redis 等存储，需要提供迁移工具
5. **剧集识别准确性**:
   - **优先使用豆瓣 ID**: 依赖标题匹配可能不够准确，强烈建议优先使用豆瓣 ID
   - **标题标准化**: 标题标准化规则需要处理各种特殊情况（标点、空格、全角半角等）
   - **年份区分**: 同名不同年份的剧集会被识别为不同剧集（这是正确的，如"权力的游戏"2011 和 2024）
   - **识别失败处理**: 如果无法识别为已有剧集，会创建新的缓存条目，可能导致重复缓存
   - **建议**: 在获取剧集详情时，优先选择有豆瓣 ID 的源，提高识别准确性
   - **管理工具**: 提供管理界面，允许管理员手动合并识别错误的重复剧集
6. **缓存合并冲突**:
   - 不同源可能对同一集有不同的集数编号（如第 1 集 vs 第 0 集）
   - 需要统一集数索引规则（建议从 1 开始）
   - 合并时以集数索引为准，不依赖源提供的集数名称
7. **播放优先级**:
   - 播放时优先使用缓存，但用户仍可选择其他源的链接
   - 缓存中的多个链接按缓存时间排序，优先使用最早的（最稳定的）
8. **下载缓存注意事项**:

   - **同一文件只从同一源下载**: 已下载的文件不会重复下载，即使有更好的源
   - **源切换策略**: 只在用户选择的源完全失败时才切换，避免频繁切换
   - **来源记录**: 必须记录实际下载来源，用于统计和调试
   - **磁盘空间管理**: 下载文件可能很大，需要定期清理和空间监控
   - **下载中断恢复**: 支持断点续传，恢复时继续使用原源
   - **下载队列机制**: **不支持并发下载**，所有下载任务按顺序执行，避免触发源服务器的并发限制
   - **M3U8 处理**: 如果下载的是 M3U8 文件，需要顺序下载所有分段文件（详见 M3U8 处理章节）

9. **缓存关联和更新机制**:
   - **剧集信息缓存与下载缓存的关联**:
     - 下载时会自动检查并创建/更新剧集信息缓存
     - 如果 `series_key` 对应的缓存不存在，先调用 `/api/detail` 获取数据
     - 确保两个缓存之间的数据一致性
   - **下载 URL 的获取**:
     - 下载接口支持两种方式：提供完整 URL 或自动查找
     - 如果未提供 URL，从剧集信息缓存中查找对应集的 URL
     - 如果缓存中没有，先获取剧集详情再下载
   - **缓存更新触发机制**:
     - 客户端播放成功后主动通知服务器（`POST /api/cache/update-episode`）
     - 服务器端在获取剧集详情时自动更新缓存
     - 缓存更新是异步的，不阻塞播放流程
