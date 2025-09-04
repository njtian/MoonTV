/**
 * Electron 环境配置
 */

const isDev = process.env.NODE_ENV === 'development';

// 服务器配置
const serverConfig = {
  development: {
    url: 'http://localhost:3000',
    name: '开发环境',
    description: '本地开发服务器',
  },
  production: {
    url: 'https://mtv.080604.xyz',
    name: '生产环境',
    description: '正式服务器',
  },
};

// 获取当前环境配置
const getCurrentConfig = () => {
  const env = isDev ? 'development' : 'production';
  return {
    ...serverConfig[env],
    isDev,
    env,
  };
};

// 获取服务器 URL
const getServerUrl = () => {
  // 优先使用环境变量
  if (process.env.SERVER_URL) {
    return process.env.SERVER_URL;
  }

  const config = getCurrentConfig();
  return config.url;
};

module.exports = {
  getCurrentConfig,
  getServerUrl,
  serverConfig,
};
