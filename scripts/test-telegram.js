#!/usr/bin/env node

/**
 * Telegram Bot Test Script
 * Usage: node scripts/test-telegram.js [message]
 * 
 * This script sends a test message to your configured Telegram bot
 * without needing to start the full server.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
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
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_TEST_CHAT_ID;

if (!TELEGRAM_BOT_TOKEN) {
  console.error('❌ Error: TELEGRAM_BOT_TOKEN not found');
  console.error('   Please set it in .env file');
  process.exit(1);
}

async function getUpdates() {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates`
    );
    const data = await response.json();
    
    if (!data.ok) {
      console.error('❌ Failed to get updates:', data.description);
      return;
    }

    if (data.result.length === 0) {
      console.log('ℹ️  No messages received yet');
      console.log('   Send a message to your bot first!');
      return;
    }

    console.log('\n📨 Recent messages:');
    console.log('-------------------');
    
    // Get last 5 unique chats
    const chats = new Map();
    for (const update of data.result.slice(-20).reverse()) {
      const chat = update.message?.chat || update.callback_query?.message?.chat;
      if (chat && !chats.has(chat.id)) {
        chats.set(chat.id, {
          id: chat.id,
          title: chat.title || chat.username || `${chat.first_name || ''} ${chat.last_name || ''}`.trim(),
          type: chat.type
        });
      }
    }

    chats.forEach(chat => {
      console.log(`  Chat ID: ${chat.id}`);
      console.log(`  Name: ${chat.title}`);
      console.log(`  Type: ${chat.type}`);
      console.log('');
    });

    if (chats.size > 0) {
      const firstChat = chats.values().next().value;
      console.log('💡 To send messages to this chat, set in .env:');
      console.log(`   TELEGRAM_TEST_CHAT_ID=${firstChat.id}`);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function sendMessage(message) {
  if (!TELEGRAM_CHAT_ID) {
    console.error('❌ Error: TELEGRAM_TEST_CHAT_ID not found');
    console.error('   Run without arguments first to see available chats');
    process.exit(1);
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: 'HTML'
        })
      }
    );

    const data = await response.json();

    if (!data.ok) {
      console.error('❌ Failed to send message:', data.description);
      process.exit(1);
    }

    console.log('✅ Message sent successfully!');
    console.log(`   Chat ID: ${data.result.chat.id}`);
    console.log(`   Message ID: ${data.result.message_id}`);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

async function main() {
  const message = process.argv[2];

  if (!message) {
    console.log('Telegram Bot Test Script\n');
    console.log('Usage:');
    console.log('  node scripts/test-telegram.js <message>');
    console.log('\nExample:');
    console.log('  node scripts/test-telegram.js "Hello from test script!"');
    console.log('\nFirst run without message to see available chats:\n');
    
    await getUpdates();
  } else {
    console.log(`Sending: "${message}"\n`);
    await sendMessage(message);
  }
}

main();
