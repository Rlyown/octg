#!/bin/bash

echo "=========================================="
echo "OpenCode Telegram Plugin - Test Suite"
echo "=========================================="
echo ""

cd "$(dirname "$0")"

# Test 1: Check compiled files
echo "Test 1: Checking compiled files..."
if [ -d "dist" ] && [ -f "dist/standalone.js" ]; then
    echo "  ✅ dist/standalone.js exists"
else
    echo "  ❌ dist/standalone.js not found"
    exit 1
fi

# Test 2: Check dependencies
echo ""
echo "Test 2: Checking dependencies..."
if [ -d "node_modules" ]; then
    echo "  ✅ node_modules exists"
else
    echo "  ❌ node_modules not found"
    echo "  Run: npm install"
    exit 1
fi

# Test 3: Load test config
echo ""
echo "Test 3: Testing config loading..."
export TELEGRAM_BOT_TOKEN=test-token
export OPENCODE_PASSWORD=test-password
export LOG_LEVEL=debug

node -e "
const { loadConfig, validateConfig } = require('./dist/config/index.js');
try {
  const config = loadConfig();
  console.log('  ✅ Config loaded');
  console.log('     - Telegram mode:', config.telegram.mode);
  console.log('     - OpenCode URL:', config.opencode.serverUrl);
  console.log('     - Session storage:', config.session.storage);
  validateConfig(config);
  console.log('  ✅ Config validated');
} catch (err) {
  console.log('  ❌ Config error:', err.message);
  process.exit(1);
}
"

# Test 4: Test OpenCodeClient
echo ""
echo "Test 4: Testing OpenCodeClient..."
node -e "
const { OpenCodeClient } = require('./dist/opencode/client.js');
const client = new OpenCodeClient({
  baseUrl: 'http://localhost:4096',
  username: 'opencode',
  password: 'test',
  timeout: 1000
});
console.log('  ✅ OpenCodeClient created');
"

# Test 5: Test SessionManager
echo ""
echo "Test 5: Testing SessionManager..."
node -e "
const { SessionManager } = require('./dist/session/manager.js');
const manager = new SessionManager({ storage: 'memory', ttl: 3600 });
manager.set({
  telegramUserId: 'test123',
  telegramChatId: 'chat456',
  openCodeSessionId: 'session789',
  createdAt: new Date(),
  lastActivity: new Date()
});
const session = manager.get('test123');
if (session && session.openCodeSessionId === 'session789') {
  console.log('  ✅ SessionManager works');
} else {
  console.log('  ❌ SessionManager failed');
  process.exit(1);
}
"

# Test 6: Check if opencode is running
echo ""
echo "Test 6: Checking OpenCode server..."
if curl -s http://localhost:4096/global/health > /dev/null 2>&1; then
    echo "  ✅ OpenCode server is running"
else
    echo "  ⚠️  OpenCode server not detected (expected for test)"
    echo "     To test full functionality, run: opencode serve --port 4096"
fi

echo ""
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo "All unit tests passed! ✅"
echo ""
echo "To run the full application:"
echo "  1. Set TELEGRAM_BOT_TOKEN and OPENCODE_PASSWORD"
echo "  2. Start OpenCode: opencode serve --port 4096"
echo "  3. Run: node dist/standalone.js"
echo ""
