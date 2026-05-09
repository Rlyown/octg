#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
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
          console.error('Log read error:', e.message);
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
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: command
    })
  });
  return response.json();
}

async function runTests() {
  log('🧪 Starting Automated Tests', 'cyan');
  log('');

  const tests = [
    {
      name: '/model - Show current model',
      command: '/model',
      patterns: [
        { regex: /handleModel called.*args: ""/, name: 'handleModel invoked', timeout: 5000 },
        { regex: /showing current model:/, name: 'Model displayed', timeout: 5000 }
      ]
    },
    {
      name: '/model list - List available models',
      command: '/model list',
      patterns: [
        { regex: /handleModel called.*args: "list"/, name: 'list command detected', timeout: 5000 },
        { regex: /listing available models/, name: 'Fetching providers', timeout: 5000 },
        { regex: /found \d+ providers/, name: 'Providers found', timeout: 10000 }
      ]
    },
    {
      name: '/model <provider/model> - Set model',
      command: '/model github-copilot/claude-sonnet-4',
      patterns: [
        { regex: /model set to: github-copilot\/claude-sonnet-4/, name: 'Model set', timeout: 5000 },
        { regex: /model saved to session/, name: 'Model persisted', timeout: 5000 }
      ]
    },
    {
      name: 'Long task test (>5 min)',
      command: '/task sleep 400',
      patterns: [
        { regex: /代码任务已提交/, name: 'Task submitted', timeout: 5000 },
        { regex: /代码任务完成|代码任务超时/, name: 'Task completed or timeout', timeout: 360000 }
      ]
    }
  ];

  const results = [];
  const logPath = path.join(__dirname, '..', 'logs', 'opencode-telegram.log');

  for (const test of tests) {
    log(`\n📋 ${test.name}`, 'blue');
    log(`Command: ${test.command}`, 'yellow');
    
    const monitor = new LogMonitor(logPath);
    test.patterns.forEach(p => monitor.addPattern(p.name, p.regex, p.timeout));
    
    const sendPromise = sendTelegramCommand(test.command);
    const monitorPromise = monitor.start();
    
    await sendPromise;
    const patternResults = await monitorPromise;
    
    const allPassed = patternResults.every(r => r.status === 'PASS');
    results.push({ name: test.name, status: allPassed ? 'PASS' : 'FAIL', details: patternResults });
    
    if (allPassed) {
      log(`✅ PASS`, 'green');
    } else {
      log(`❌ FAIL`, 'red');
      patternResults.forEach(r => {
        if (r.status !== 'PASS') {
          log(`   ${r.name}: ${r.status}`, 'yellow');
        }
      });
    }
    
    await new Promise(r => setTimeout(r, 2000));
  }

  log('\n' + '='.repeat(60), 'cyan');
  log('📊 Test Summary', 'cyan');
  log('='.repeat(60), 'cyan');
  
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  
  results.forEach(r => {
    const icon = r.status === 'PASS' ? '✅' : '❌';
    log(`${icon} ${r.name}`, r.status === 'PASS' ? 'green' : 'red');
  });
  
  log(`\nTotal: ${results.length} | ✅ Passed: ${passed} | ❌ Failed: ${failed}`, 'cyan');
  log('='.repeat(60), 'cyan');
  
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
