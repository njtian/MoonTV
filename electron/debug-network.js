/**
 * 网络调试工具
 * 用于诊断 Electron 应用的网络连接问题
 */

const { net } = require('electron');

async function debugNetwork(url) {
  console.log('🔍 开始网络诊断...');
  console.log('目标URL:', url);

  // 解析URL
  try {
    const urlObj = new URL(url);
    console.log('协议:', urlObj.protocol);
    console.log('主机:', urlObj.hostname);
    console.log(
      '端口:',
      urlObj.port || (urlObj.protocol === 'https:' ? '443' : '80')
    );
    console.log('路径:', urlObj.pathname);
  } catch (error) {
    console.error('URL解析失败:', error.message);
    return;
  }

  // 测试DNS解析
  console.log('\n🌐 测试DNS解析...');
  const dns = require('dns');
  const { promisify } = require('util');
  const lookup = promisify(dns.lookup);

  try {
    const urlObj = new URL(url);
    const result = await lookup(urlObj.hostname);
    console.log('DNS解析成功:', result);
  } catch (error) {
    console.error('DNS解析失败:', error.message);
  }

  // 测试HTTP连接
  console.log('\n🔗 测试HTTP连接...');
  const connectionTest = await testHttpConnection(url);
  console.log('HTTP连接测试结果:', connectionTest);

  // 测试HTTPS连接
  if (url.startsWith('https:')) {
    console.log('\n🔒 测试HTTPS连接...');
    const httpsTest = await testHttpsConnection(url);
    console.log('HTTPS连接测试结果:', httpsTest);
  }

  return connectionTest;
}

function testHttpConnection(url) {
  return new Promise((resolve) => {
    const request = net.request({
      method: 'HEAD',
      url: url,
      timeout: 15000,
    });

    const startTime = Date.now();

    request.on('response', (response) => {
      const endTime = Date.now();
      resolve({
        success: true,
        statusCode: response.statusCode,
        headers: response.headers,
        responseTime: endTime - startTime,
      });
    });

    request.on('error', (error) => {
      const endTime = Date.now();
      resolve({
        success: false,
        error: error.message,
        code: error.code,
        responseTime: endTime - startTime,
      });
    });

    request.on('timeout', () => {
      resolve({
        success: false,
        error: '连接超时',
        responseTime: 15000,
      });
    });

    request.end();
  });
}

function testHttpsConnection(url) {
  return new Promise((resolve) => {
    const https = require('https');
    const urlObj = new URL(url);

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname,
      method: 'HEAD',
      timeout: 15000,
    };

    const startTime = Date.now();
    const req = https.request(options, (res) => {
      const endTime = Date.now();
      resolve({
        success: true,
        statusCode: res.statusCode,
        headers: res.headers,
        responseTime: endTime - startTime,
      });
    });

    req.on('error', (error) => {
      const endTime = Date.now();
      resolve({
        success: false,
        error: error.message,
        code: error.code,
        responseTime: endTime - startTime,
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        success: false,
        error: 'HTTPS连接超时',
        responseTime: 15000,
      });
    });

    req.setTimeout(15000);
    req.end();
  });
}

module.exports = { debugNetwork };
