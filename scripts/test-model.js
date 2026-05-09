#!/usr/bin/env node

/**
 * Automated test: Check bot responses by retrieving messages from Telegram API
 * This script waits for messages, sends test commands, and validates responses
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      process.env[match[1].trim()] = match[2].trim();
    }
  });
}

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_TEST_CHAT_ID;

let lastUpdateId = 0;

async function getUpdates() {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&limit=20`;
  const response = await fetch(url);
  const data = await response.json();
  
  if (data.ok && data.result.length > 0) {
    for (const update of data.result) {
      lastUpdateId = Math.max(lastUpdateId, update.update_id);
    }
    return data.result;
  }
  return [];
}

async function waitForMessage(expectedText, timeout = 30000, fromBot = true) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const updates = await getUpdates();
    
    for (const update of updates) {
      const msg = update.message;
      if (!msg) continue;
      
      const isFromBot = msg.from?.is_bot;
      const text = msg.text || '';
      
      // If looking for bot response, check fromBot
      // If looking for user message, check !fromBot
      if (fromBot === isFromBot && text.includes(expectedText)) {
        return {
          found: true,
          text: text,
          fromBot: isFromBot,
          timestamp: msg.date
        };
      }
    }
    
    await new Promise(r => setTimeout(r, 1000));
  }
  
  return { found: false, text: '' };
}

function printHeader(text) {
  console.log('\n' + '='.repeat(60));
  console.log(text);
  console.log('='.repeat(60));
}

function printResult(testName, success, details = '') {
  const icon = success ? '✅' : '❌';
  const status = success ? 'PASS' : 'FAIL';
  console.log(`${icon} ${testName.padEnd(40)} [${status}]`);
  if (details) {
    console.log(`   ${details}`);
  }
}

// Main test function
async function runTests() {
  printHeader('Starting Automated Telegram Bot Tests');
  console.log('This test will:');
  console.log('1. Send commands to the bot');
  console.log('2. Automatically retrieve and verify bot responses');
  console.log('3. Check if features work correctly\n');
  console.log('Waiting for bot to be ready...');
  await new Promise(r => setTimeout(r, 3000));
  
  const tests = [];
  
  // Test 1: /model command
  printHeader('Test 1: /model command');
  console.log('Sending: /model');
  
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: '/model'
    })
  });
  
  const modelResponse = await waitForMessage('当前模型', 15000, true);
  tests.push({
    name: '/model shows current model',
    success: modelResponse.found,
    details: modelResponse.found ? `Response: "${modelResponse.text.substring(0, 50)}..."` : 'No response received'
  });
  
  // Test 2: /model list
  printHeader('Test 2: /model list command');
  console.log('Sending: /model list');
  
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: '/model list'
    })
  });
  
  const listResponse = await waitForMessage('可用模型', 15000, true);
  tests.push({
    name: '/model list shows available models',
    success: listResponse.found,
    details: listResponse.found ? `Found ${listResponse.text.split('•').length - 1} providers` : 'No response received'
  });
  
  // Test 3: Set model
  printHeader('Test 3: Set model command');
  console.log('Sending: /model github-copilot/claude-sonnet-4');
  
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: '/model github-copilot/claude-sonnet-4'
    })
  });
  
  const setResponse = await waitForMessage('已设置模型', 15000, true);
  tests.push({
    name: '/model <provider/model> sets model',
    success: setResponse.found,
    details: setResponse.found ? 'Model set successfully' : 'No confirmation received'
  });
  
  // Test 4: Verify model persistence
  printHeader('Test 4: Verify model persistence');
  console.log('Sending: /model (to verify it persists)');
  
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: '/model'
    })
  });
  
  const verifyResponse = await waitForMessage('github-copilot/claude-sonnet-4', 15000, true);
  tests.push({
    name: 'Model persists after setting',
    success: verifyResponse.found,
    details: verifyResponse.found ? 'Model persisted correctly' : 'Model did not persist'
  });
  
  // Print results
  printHeader('Test Results');
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    printResult(test.name, test.success, test.details);
    if (test.success) passed++;
    else failed++;
  }
  
  console.log('\n' + '='.repeat(60));
  console.log(`Total: ${tests.length} | ✅ Passed: ${passed} | ❌ Failed: ${failed}`);
  console.log('='.repeat(60) + '\n');
  
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
