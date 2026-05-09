#!/usr/bin/env node

/**
 * OpenCode Telegram Bot 自动化测试脚本
 * Usage: node scripts/run-tests.js [--chat-id=<id>] [--test-suite=<basic|full>]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 颜色定义
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function logHeader(title) {
  console.log('\n' + '='.repeat(60));
  log(title, 'cyan');
  console.log('='.repeat(60));
}

function logTest(name, status, details = '') {
  const statusColor = status === 'PASS' ? 'green' : status === 'FAIL' ? 'red' : 'yellow';
  const icon = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '⚠';
  log(`${icon} ${name.padEnd(40)} [${status}]`, statusColor);
  if (details) {
    log(`  ${details}`, 'reset');
  }
}

// 加载环境变量
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim();
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    });
  }
}

loadEnv();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.argv.find(arg => arg.startsWith('--chat-id='))?.split('=')[1] || 
                          process.env.TELEGRAM_TEST_CHAT_ID;
const TEST_SUITE = process.argv.find(arg => arg.startsWith('--test-suite='))?.split('=')[1] || 'basic';

// 测试统计
const stats = {
  total: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
};

// Telegram API 调用
async function callTelegramAPI(method, params = {}) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      ...params
    })
  });
  return response.json();
}

// 发送消息
async function sendMessage(text) {
  return callTelegramAPI('sendMessage', { 
    text, 
    parse_mode: 'Markdown',
    disable_notification: true 
  });
}

// 获取更新（等待响应）
async function getUpdates(offset = 0, timeout = 30) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${offset}&limit=10`;
  const response = await fetch(url);
  const data = await response.json();
  return data;
}

// 等待响应
async function waitForResponse(expectedText, timeout = 30000) {
  const startTime = Date.now();
  let lastUpdateId = 0;
  
  while (Date.now() - startTime < timeout) {
    const updates = await getUpdates(lastUpdateId + 1);
    
    if (updates.ok && updates.result.length > 0) {
      for (const update of updates.result) {
        lastUpdateId = Math.max(lastUpdateId, update.update_id);
        
        // 检查是否是来自 bot 的响应
        const message = update.message;
        if (message && message.chat.id.toString() === TELEGRAM_CHAT_ID) {
          // 简单检查响应是否包含期望文本的一部分
          if (message.text && (
            message.text.includes(expectedText) || 
            expectedText.includes(message.text.substring(0, 20))
          )) {
            return { success: true, text: message.text, updateId: lastUpdateId };
          }
        }
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  return { success: false, text: 'Timeout', updateId: lastUpdateId };
}

// 运行单个测试
async function runTest(name, command, expectedKeywords = [], timeout = 30000) {
  stats.total++;
  
  try {
    log(`Testing: ${name}`, 'blue');
    
    // 发送命令
    const sendResult = await sendMessage(command);
    if (!sendResult.ok) {
      logTest(name, 'FAIL', `发送失败: ${sendResult.description}`);
      stats.failed++;
      return false;
    }
    
    // 等待响应
    const response = await waitForResponse(expectedKeywords[0] || command, timeout);
    
    if (!response.success) {
      logTest(name, 'FAIL', '等待响应超时');
      stats.failed++;
      return false;
    }
    
    // 检查期望关键词
    const missingKeywords = expectedKeywords.filter(kw => 
      !response.text.toLowerCase().includes(kw.toLowerCase())
    );
    
    if (missingKeywords.length > 0) {
      logTest(name, 'FAIL', `缺少关键词: ${missingKeywords.join(', ')}`);
      stats.failed++;
      return false;
    }
    
    // 检查错误信息
    if (response.text.includes('❌') || response.text.includes('Error') || response.text.includes('error')) {
      logTest(name, 'FAIL', `响应包含错误: ${response.text.substring(0, 100)}`);
      stats.failed++;
      return false;
    }
    
    logTest(name, 'PASS', `响应: ${response.text.substring(0, 50)}...`);
    stats.passed++;
    return true;
    
  } catch (error) {
    logTest(name, 'FAIL', `异常: ${error.message}`);
    stats.failed++;
    return false;
  }
}

// 测试套件定义
const testSuites = {
  basic: [
    {
      name: '/start - 启动命令',
      command: '/start',
      expected: ['欢迎使用', '帮助', '命令'],
      timeout: 10000
    },
    {
      name: '/help - 帮助命令',
      command: '/help',
      expected: ['命令', 'help', 'start', 'status'],
      timeout: 10000
    },
    {
      name: '/status - 状态命令',
      command: '/status',
      expected: ['OpenCode', '状态', 'running', 'version'],
      timeout: 15000
    },
    {
      name: '/new - 创建会话',
      command: '/new Test Session',
      expected: ['会话', 'session', '创建', 'success', '✓'],
      timeout: 15000
    },
    {
      name: '/sessions - 列出会话',
      command: '/sessions',
      expected: ['会话', 'session', '列表', 'list'],
      timeout: 10000
    },
    {
      name: '/ls - 列出文件',
      command: '/ls',
      expected: ['文件', '目录', 'file', 'directory', 'README', 'package'],
      timeout: 10000
    },
    {
      name: '/cat - 读取文件',
      command: '/cat package.json',
      expected: ['{', '}', '"name"', 'version', 'opencode'],
      timeout: 10000
    },
    {
      name: '/model - 查看模型',
      command: '/model',
      expected: ['模型', 'model', 'provider', '当前'],
      timeout: 10000
    },
    {
      name: '/agents - 查看Agent',
      command: '/agents',
      expected: ['agent', 'build', 'plan', 'oracle'],
      timeout: 10000
    },
    {
      name: '/cwd - 查看当前目录',
      command: '/cwd',
      expected: ['目录', 'path', 'workspace', 'GitProject', '/Users'],
      timeout: 10000
    },
    {
      name: '/todos - 查看待办',
      command: '/todos',
      expected: ['待办', 'todo', '完成', '列表'],
      timeout: 10000
    },
    {
      name: '普通对话',
      command: '你好！请简单介绍一下自己',
      expected: ['你好', 'OpenCode', 'AI', '助手', 'help'],
      timeout: 20000
    },
    {
      name: '代码请求',
      command: '请写一个简单的 hello world 函数',
      expected: ['function', 'hello', 'world', '```', 'code'],
      timeout: 30000
    }
  ],
  
  full: []
};

// full 测试套件包含 basic + 额外测试
testSuites.full = [
  ...testSuites.basic,
  
  // 会话管理
  { name: '/rename - 重命名', command: '/rename Renamed Session', expected: ['重命名', 'rename', '成功'], timeout: 10000 },
  { name: '/share - 分享', command: '/share', expected: ['分享', 'share', '链接'], timeout: 10000 },
  { name: '/diff - 查看变更', command: '/diff', expected: ['变更', 'diff', '修改'], timeout: 10000 },
  { name: '/summarize - 总结', command: '/summarize', expected: ['总结', 'summary', '会话'], timeout: 20000 },
  
  // 文件操作
  { name: '/search - 搜索', command: '/search handleMessage', expected: ['搜索', '结果', 'handleMessage'], timeout: 15000 },
  { name: '/findfile - 查找文件', command: '/findfile *.ts', expected: ['文件', 'find', '*.ts'], timeout: 10000 },
  { name: '/git_status - Git状态', command: '/git_status', expected: ['git', 'status', '修改'], timeout: 10000 },
  
  // 模型和 Agent
  { name: '/model list - 模型列表', command: '/model list', expected: ['模型', '列表', 'provider'], timeout: 10000 },
  { name: '/agents list - Agent列表', command: '/agents list', expected: ['agent', '列表', 'build', 'plan'], timeout: 10000 },
  { name: '/plan - 切换到plan', command: '/plan', expected: ['plan', 'agent', '切换'], timeout: 10000 },
  { name: '/build - 切换到build', command: '/build', expected: ['build', 'agent', '切换'], timeout: 10000 },
  
  // 项目命令
  { name: '/projects - 项目列表', command: '/projects', expected: ['项目', 'project', '列表'], timeout: 10000 },
  { name: '/config - 查看配置', command: '/config', expected: ['配置', 'config', '设置'], timeout: 10000 },
  { name: '/providers - 提供商', command: '/providers', expected: ['provider', '模型', '列表'], timeout: 10000 },
  { name: '/commands - 内置命令', command: '/commands', expected: ['命令', 'command', 'OpenCode'], timeout: 10000 },
  { name: '/tools - 工具列表', command: '/tools', expected: ['工具', 'tool', '列表'], timeout: 10000 },
  
  // 对话类型测试
  { name: '长文本测试', command: '请详细解释 JavaScript 的 Promise 和 async/await 机制，包括原理、使用场景和最佳实践', expected: ['Promise', 'async', 'await', '详细', '解释'], timeout: 30000 },
  { name: '代码调试', command: '帮我找出这段代码的问题: function add(a,b) { return a + b }', expected: ['代码', '问题', '正确', 'fix'], timeout: 25000 },
  { name: '文件操作', command: '请查看 README.md 文件并告诉我这个项目是做什么的', expected: ['README', '项目', '介绍', 'Telegram'], timeout: 20000 },
];

// 验证配置
function validateConfig() {
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'your_bot_token_from_botfather') {
    log('错误: TELEGRAM_BOT_TOKEN 未配置', 'red');
    log('请在 .env 文件中设置 TELEGRAM_BOT_TOKEN', 'yellow');
    process.exit(1);
  }
  
  if (!TELEGRAM_CHAT_ID) {
    log('错误: TELEGRAM_CHAT_ID 未配置', 'red');
    log('请使用 --chat-id=<id> 参数或在 .env 中设置 TELEGRAM_TEST_CHAT_ID', 'yellow');
    process.exit(1);
  }
  
  log(`配置检查通过:`, 'green');
  log(`  Chat ID: ${TELEGRAM_CHAT_ID}`, 'cyan');
  log(`  Test Suite: ${TEST_SUITE}`, 'cyan');
  log('');
}

// 主函数
async function main() {
  logHeader('OpenCode Telegram Bot 自动化测试');
  
  validateConfig();
  
  const tests = testSuites[TEST_SUITE];
  if (!tests) {
    log(`未知的测试套件: ${TEST_SUITE}`, 'red');
    log('可用套件: basic, full', 'yellow');
    process.exit(1);
  }
  
  log(`开始执行 ${tests.length} 个测试...\n`, 'blue');
  
  const startTime = Date.now();
  
  // 执行测试
  for (let i = 0; i < tests.length; i++) {
    const test = tests[i];
    log(`\n[${i + 1}/${tests.length}] `, 'cyan');
    await runTest(test.name, test.command, test.expected, test.timeout);
    
    // 测试间隔，避免频率限制
    if (i < tests.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  const duration = Date.now() - startTime;
  
  // 输出报告
  logHeader('测试报告');
  log(`总测试数: ${stats.total}`, 'blue');
  log(`通过: ${stats.passed}`, 'green');
  log(`失败: ${stats.failed}`, 'red');
  log(`跳过: ${stats.skipped}`, 'yellow');
  log(`通过率: ${((stats.passed / stats.total) * 100).toFixed(1)}%`, 'blue');
  log(`耗时: ${(duration / 1000).toFixed(1)}s`, 'blue');
  
  // 退出码
  process.exit(stats.failed > 0 ? 1 : 0);
}

// 处理未捕获的异常
process.on('unhandledRejection', (error) => {
  log(`未处理的异常: ${error}`, 'red');
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  log(`未捕获的异常: ${error}`, 'red');
  process.exit(1);
});

// 运行测试
main().catch(error => {
  log(`测试失败: ${error.message}`, 'red');
  process.exit(1);
});
