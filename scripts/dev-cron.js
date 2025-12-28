#!/usr/bin/env node

/* eslint-disable no-console,@typescript-eslint/no-var-requires */
/**
 * 开发环境 Cron 任务自动执行脚本
 * 用于在开发环境下自动执行 cron 任务，清理过期缓存
 */

const http = require('http');

// 从环境变量获取配置，默认使用开发服务器端口
const HOSTNAME = process.env.HOSTNAME || 'localhost';
const PORT = process.env.PORT || 3003; // 开发环境默认端口 3003
const HEALTH_CHECK_URL = `http://${HOSTNAME}:${PORT}/login`;
const CRON_URL = `http://${HOSTNAME}:${PORT}/api/cron`;

// 轮询间隔（毫秒）
const POLL_INTERVAL = 2000; // 2秒检查一次
const CRON_INTERVAL = 60 * 60 * 1000; // 每小时执行一次

let cronIntervalId = null;

/**
 * 执行 cron 任务
 */
function executeCronJob() {
  console.log(`[Cron] Executing cron job: ${CRON_URL}`);

  const req = http.get(CRON_URL, (res) => {
    let data = '';

    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        console.log(`[Cron] ✅ Cron job executed successfully:`, data);
      } else {
        console.error(`[Cron] ❌ Cron job failed:`, res.statusCode, data);
      }
    });
  });

  req.on('error', (err) => {
    console.error(`[Cron] ❌ Error executing cron job:`, err.message);
  });

  req.setTimeout(30000, () => {
    console.error(`[Cron] ❌ Cron job timeout`);
    req.destroy();
  });
}

/**
 * 检查服务器是否已启动
 */
function checkServerHealth() {
  return new Promise((resolve) => {
    const req = http.get(HEALTH_CHECK_URL, (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 300);
    });

    req.on('error', () => {
      resolve(false);
    });

    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * 等待服务器启动并开始 cron 任务
 */
async function startCronScheduler() {
  console.log(`[Cron] 🚀 Starting cron scheduler for development environment`);
  console.log(`[Cron] Waiting for server at ${HEALTH_CHECK_URL}...`);

  // 轮询等待服务器启动
  const healthCheckInterval = setInterval(async () => {
    const isReady = await checkServerHealth();

    if (isReady) {
      console.log(`[Cron] ✅ Server is up, starting cron jobs`);
      clearInterval(healthCheckInterval);

      // 立即执行一次 cron 任务
      executeCronJob();

      // 设置定时执行
      cronIntervalId = setInterval(() => {
        executeCronJob();
      }, CRON_INTERVAL);

      console.log(
        `[Cron] ⏰ Cron jobs will run every ${
          CRON_INTERVAL / 1000 / 60
        } minutes`
      );
    }
  }, POLL_INTERVAL);

  // 优雅退出处理
  process.on('SIGINT', () => {
    console.log(`[Cron] 👋 Shutting down cron scheduler...`);
    if (healthCheckInterval) {
      clearInterval(healthCheckInterval);
    }
    if (cronIntervalId) {
      clearInterval(cronIntervalId);
    }
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log(`[Cron] 👋 Shutting down cron scheduler...`);
    if (healthCheckInterval) {
      clearInterval(healthCheckInterval);
    }
    if (cronIntervalId) {
      clearInterval(cronIntervalId);
    }
    process.exit(0);
  });
}

// 启动 cron 调度器
startCronScheduler().catch((err) => {
  console.error(`[Cron] ❌ Failed to start cron scheduler:`, err);
  process.exit(1);
});
