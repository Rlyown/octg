#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match && !process.env[match[1].trim()]) {
        process.env[match[1].trim()] = match[2].trim();
      }
    });
  }
}

loadEnv();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_TEST_CHAT_ID;

class LogMonitor {
  constructor(logPath) {
    this.logPath = logPath;
    this.position = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
    this.patterns = [];
    this.results = [];
  }

  addPattern(name, regex, timeout = 10000) {
    this.patterns.push({ name, regex, timeout, found: false, timer: null });
  }

  async start() {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        try {
          const stats = fs.statSync(this.logPath);
          if (stats.size > this.position) {
            const fd = fs.openSync(this.logPath, 'r');
            const buffer = Buffer.alloc(stats.size - this.position);
            fs.readSync(fd, buffer, 0, buffer.length, this.position);
            fs.closeSync(fd);
            
            const newContent = buffer.toString();
            this.position = stats.size;
            
            this.patterns.forEach(p => {
              if (!p.found && p.regex.test(newContent)) {
                p.found = true;
                this.results.push({ name: p.name, status: 'PASS', timestamp: Date.now() });
                if (p.timer) clearTimeout(p.timer);
              }
            });
            
            if (this.patterns.every(p => p.found)) {
              clearInterval(checkInterval);
              resolve(this.results);
            }
          }
        } catch (e) {
          // Ignore file read errors
        }
      }, 500);

      this.patterns.forEach(p => {
        p.timer = setTimeout(() => {
          if (!p.found) {
            p.found = true;
            this.results.push({ name: p.name, status: 'TIMEOUT' });
          }
        }, p.timeout);
      });

      setTimeout(() => {
        clearInterval(checkInterval);
        resolve(this.results);
      }, 30000);
    });
  }
}

async function sendTelegramCommand(command) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: command
      })
    });
    return await response.json();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// All tests
const tests = [
  // Basic commands
  {
    category: '基础命令',
    items: [
      {
        name: '/start',
        command: '/start',
        patterns: [
          { regex: /handleStart/, name: 'handler invoked', timeout: 5000 },
        ]
      },
      {
        name: '/help',
        command: '/help',
        patterns: [
          { regex: /handleHelp/, name: 'handler invoked', timeout: 5000 },
        ]
      },
      {
        name: '/status',
        command: '/status',
        patterns: [
          { regex: /handleStatus/, name: 'handler invoked', timeout: 5000 },
        ]
      },
    ]
  },
  
  // Session management
  {
    category: '会话管理',
    items: [
      {
        name: '/new - Create session',
        command: '/new Test Session',
        patterns: [
          { regex: /handleNewSession/, name: 'handler invoked', timeout: 5000 },
          { regex: /Auto-selected session/, name: 'session created', timeout: 10000 },
        ]
      },
      {
        name: '/sessions - List sessions',
        command: '/sessions',
        patterns: [
          { regex: /handleSessions/, name: 'handler invoked', timeout: 5000 },
        ]
      },
      {
        name: '/rename - Rename session',
        command: '/rename Renamed Session',
        patterns: [
          { regex: /handleRenameSession/, name: 'handler invoked', timeout: 5000 },
        ]
      },
      {
        name: '/cwd - Show working directory',
        command: '/cwd',
        patterns: [
          { regex: /handleCwd/, name: 'handler invoked', timeout: 5000 },
        ]
      },
    ]
  },
  
  // Model & Agent
  {
    category: '模型和 Agent',
    items: [
      {
        name: '/model - Show current model',
        command: '/model',
        patterns: [
          { regex: /handleModel.*args: ""/, name: 'handler invoked', timeout: 5000 },
          { regex: /showing current model/, name: 'model displayed', timeout: 5000 },
        ]
      },
      {
        name: '/model list - List models',
        command: '/model list',
        patterns: [
          { regex: /handleModel.*args: "list"/, name: 'list command', timeout: 5000 },
          { regex: /found \d+ providers/, name: 'providers loaded', timeout: 10000 },
        ]
      },
      {
        name: '/model <provider/model> - Set model',
        command: '/model github-copilot/claude-sonnet-4',
        patterns: [
          { regex: /model set to:/, name: 'model set', timeout: 5000 },
          { regex: /model saved to session/, name: 'model persisted', timeout: 5000 },
        ]
      },
      {
        name: '/agents - Show current agent',
        command: '/agents',
        patterns: [
          { regex: /handleAgents/, name: 'handler invoked', timeout: 5000 },
        ]
      },
      {
        name: '/agents list - List agents',
        command: '/agents list',
        patterns: [
          { regex: /handleAgents/, name: 'handler invoked', timeout: 5000 },
        ]
      },
      {
        name: '/plan - Switch to plan agent',
        command: '/plan',
        patterns: [
          { regex: /handleNamedAgent/, name: 'handler invoked', timeout: 5000 },
        ]
      },
      {
        name: '/build - Switch to build agent',
        command: '/build',
        patterns: [
          { regex: /handleNamedAgent/, name: 'handler invoked', timeout: 5000 },
        ]
      },
    ]
  },
  
  // File operations
  {
    category: '文件操作',
    items: [
      {
        name: '/ls - List directory',
        command: '/ls',
        patterns: [
          { regex: /handleListFiles/, name: 'handler invoked', timeout: 5000 },
        ]
      },
      {
        name: '/cat - Read file',
        command: '/cat package.json',
        patterns: [
          { regex: /handleReadFile/, name: 'handler invoked', timeout: 5000 },
        ]
      },
      {
        name: '/search - Search text',
        command: '/search handleMessage',
        patterns: [
          { regex: /handleSearch/, name: 'handler invoked', timeout: 5000 },
        ]
      },
      {
        name: '/findfile - Find file',
        command: '/findfile *.ts',
        patterns: [
          { regex: /handleFindFile/, name: 'handler invoked', timeout: 5000 },
        ]
      },
      {
        name: '/symbol - Find symbol',
        command: '/symbol OpenCodeClient',
        patterns: [
          { regex: /handleSymbol/, name: 'handler invoked', timeout: 5000 },
        ]
      },
      {
        name: '/git_status - Git status',
        command: '/git_status',
        patterns: [
          { regex: /handleGitStatus/, name: 'handler invoked', timeout: 5000 },
        ]
      },
    ]
  },
  
  // Task & Shell
  {
    category: '任务和 Shell',
    items: [
      {
        name: '/task - Submit async task',
        command: '/task create a simple function',
        patterns: [
          { regex: /handleTask/, name: 'handler invoked', timeout: 5000 },
          { regex: /代码任务已提交/, name: 'task submitted', timeout: 5000 },
        ]
      },
      {
        name: '/shell - Execute shell command',
        command: '/shell pwd',
        patterns: [
          { regex: /handleShell/, name: 'handler invoked', timeout: 5000 },
        ]
      },
    ]
  },
  
  // Project & Config
  {
    category: '项目和配置',
    items: [
      {
        name: '/projects - List projects',
        command: '/projects',
        patterns: [
          { regex: /handleProjects/, name: 'handler invoked', timeout: 5000 },
        ]
      },
      {
        name: '/config - Show config',
        command: '/config',
        patterns: [
          { regex: /handleConfig/, name: 'handler invoked', timeout: 5000 },
        ]
      },
      {
        name: '/providers - List providers',
        command: '/providers',
        patterns: [
          { regex: /handleProviders/, name: 'handler invoked', timeout: 5000 },
        ]
      },
      {
        name: '/commands - List commands',
        command: '/commands',
        patterns: [
          { regex: /handleCommands/, name: 'handler invoked', timeout: 5000 },
        ]
      },
      {
        name: '/tools - List tools',
        command: '/tools',
        patterns: [
          { regex: /handleTools/, name: 'handler invoked', timeout: 5000 },
        ]
      },
      {
        name: '/init - Initialize project',
        command: '/init',
        patterns: [
          { regex: /handleInit/, name: 'handler invoked', timeout: 5000 },
        ]
      },
    ]
  },
  
  // Todos & History
  {
    category: '待办和历史',
    items: [
      {
        name: '/todos - Show todos',
        command: '/todos',
        patterns: [
          { regex: /handleTodos/, name: 'handler invoked', timeout: 5000 },
        ]
      },
      {
        name: '/history - Show history',
        command: '/history',
        patterns: [
          { regex: /handleHistory/, name: 'handler invoked', timeout: 5000 },
        ]
      },
    ]
  },
  
  // Session operations
  {
    category: '会话操作',
    items: [
      {
        name: '/fork - Fork session',
        command: '/fork',
        patterns: [
          { regex: /handleForkSession/, name: 'handler invoked', timeout: 5000 },
        ]
      },
      {
        name: '/diff - Show diff',
        command: '/diff',
        patterns: [
          { regex: /handleDiff/, name: 'handler invoked', timeout: 5000 },
        ]
      },
      {
        name: '/summarize - Summarize session',
        command: '/summarize',
        patterns: [
          { regex: /handleSummarize/, name: 'handler invoked', timeout: 10000 },
        ]
      },
      {
        name: '/children - Show children',
        command: '/children',
        patterns: [
          { regex: /handleChildren/, name: 'handler invoked', timeout: 5000 },
        ]
      },
      {
        name: '/share - Share session',
        command: '/share',
        patterns: [
          { regex: /handleShareSession/, name: 'handler invoked', timeout: 5000 },
        ]
      },
      {
        name: '/unshare - Unshare session',
        command: '/unshare',
        patterns: [
          { regex: /handleUnshareSession/, name: 'handler invoked', timeout: 5000 },
        ]
      },
      {
        name: '/status_all - All sessions status',
        command: '/status_all',
        patterns: [
          { regex: /handleStatusAll/, name: 'handler invoked', timeout: 5000 },
        ]
      },
    ]
  },
  
  // Long running task
  {
    category: '长时间任务测试',
    items: [
      {
        name: 'Long task test (>5 min)',
        command: '/task sleep 400',
        patterns: [
          { regex: /handleTask/, name: 'task handler invoked', timeout: 5000 },
          { regex: /代码任务已提交/, name: 'task submitted', timeout: 5000 },
          { regex: /代码任务完成|代码任务超时/, name: 'task completed or timeout', timeout: 360000 },
        ]
      },
    ]
  },
  
  // Normal conversation
  {
    category: '普通对话测试',
    items: [
      {
        name: 'Normal message',
        command: '你好，请简单介绍一下自己',
        patterns: [
          { regex: /stage=message_request start/, name: 'message processing started', timeout: 5000 },
          { regex: /message_request ok/, name: 'message processed', timeout: 30000 },
        ]
      },
    ]
  },
];

async function runTests() {
  log('🧪 OpenCode Telegram Bot - Full Test Suite', 'cyan');
  log('='.repeat(60), 'cyan');
  log('');
  
  const logPath = path.join(__dirname, '..', 'logs', 'opencode-telegram.log');
  const allResults = [];
  let totalTests = 0;
  let passedTests = 0;
  
  for (const category of tests) {
    log(`\n📁 ${category.category}`, 'blue');
    log('-'.repeat(60), 'gray');
    
    for (const test of category.items) {
      totalTests++;
      process.stdout.write(`  ${test.name.padEnd(40)} `);
      
      const monitor = new LogMonitor(logPath);
      test.patterns.forEach(p => monitor.addPattern(p.name, p.regex, p.timeout));
      
      const sendPromise = sendTelegramCommand(test.command);
      const monitorPromise = monitor.start();
      
      await sendPromise;
      const patternResults = await monitorPromise;
      
      const allPassed = patternResults.every(r => r.status === 'PASS');
      
      if (allPassed) {
        log('✅ PASS', 'green');
        passedTests++;
      } else {
        log('❌ FAIL', 'red');
        patternResults.filter(r => r.status !== 'PASS').forEach(r => {
          log(`      ${r.name}: ${r.status}`, 'yellow');
        });
      }
      
      allResults.push({
        category: category.category,
        test: test.name,
        status: allPassed ? 'PASS' : 'FAIL',
        patterns: patternResults
      });
      
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  
  // Summary
  log('\n' + '='.repeat(60), 'cyan');
  log('📊 Test Summary', 'cyan');
  log('='.repeat(60), 'cyan');
  log(`Total Tests: ${totalTests}`, 'blue');
  log(`✅ Passed: ${passedTests}`, 'green');
  log(`❌ Failed: ${totalTests - passedTests}`, 'red');
  log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`, 'cyan');
  log('='.repeat(60), 'cyan');
  
  // Show failed tests by category
  const failedByCategory = {};
  allResults.filter(r => r.status === 'FAIL').forEach(r => {
    if (!failedByCategory[r.category]) failedByCategory[r.category] = [];
    failedByCategory[r.category].push(r.test);
  });
  
  if (Object.keys(failedByCategory).length > 0) {
    log('\n❌ Failed Tests:', 'red');
    Object.entries(failedByCategory).forEach(([cat, items]) => {
      log(`\n  ${cat}:`, 'yellow');
      items.forEach(item => log(`    - ${item}`, 'red'));
    });
  }
  
  process.exit(passedTests === totalTests ? 0 : 1);
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
