#!/usr/bin/env node

/**
 * Simple bot connectivity test
 * Usage: node scripts/test-bot.js
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

async function testConnectivity() {
  console.log('Testing bot connectivity...\n');
  
  // 1. Check bot info
  console.log('1. Checking bot info...');
  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`);
    const data = await response.json();
    
    if (data.ok) {
      console.log(`   ✅ Bot active: @${data.result.username}`);
    } else {
      console.log(`   ❌ Bot check failed: ${data.description}`);
      return;
    }
  } catch (error) {
    console.log(`   ❌ Network error: ${error.message}`);
    return;
  }
  
  // 2. Send test message
  console.log('\n2. Sending test message...');
  const testMsg = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: '🧪 Bot connectivity test\nPlease reply with /status to verify bot is working',
      disable_notification: true
    })
  });
  
  const msgData = await testMsg.json();
  if (msgData.ok) {
    console.log(`   ✅ Message sent (ID: ${msgData.result.message_id})`);
  } else {
    console.log(`   ❌ Send failed: ${msgData.description}`);
  }
  
  // 3. Check for recent bot responses
  console.log('\n3. Checking for bot responses...');
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  const updates = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?limit=10`);
  const updatesData = await updates.json();
  
  if (updatesData.ok && updatesData.result.length > 0) {
    const recent = updatesData.result.slice(-5).reverse();
    console.log(`   Found ${recent.length} recent messages:`);
    
    recent.forEach((update, i) => {
      const msg = update.message;
      if (msg) {
        const from = msg.from?.is_bot ? 'Bot' : 'User';
        const text = msg.text?.substring(0, 50) || '[no text]';
        console.log(`   ${i + 1}. [${from}] ${text}`);
      }
    });
  } else {
    console.log('   ℹ️ No recent messages found');
  }
  
  console.log('\n✅ Test complete!');
  console.log('\nNext steps:');
  console.log('  1. Check Telegram for the test message');
  console.log('  2. If bot responds, run: node scripts/run-tests.js');
}

testConnectivity().catch(console.error);
