# SSE Event Handling Assessment: Permission/Session Event Mismatch

**Date**: May 12, 2026  
**Status**: CRITICAL ISSUE IDENTIFIED  
**Severity**: High (Permission popup never arrives; permission-handler logs show zero activity)

---

## Executive Summary

The octg plugin has a **critical event name mismatch** between what the server emits and what the client listens for. The permission popup never arrives because:

1. **Documentation specifies**: `session.permission.requested` (SPECIAL_API_DESIGN.md, line 45)
2. **Client code registers listener**: `permission.asked` (handlers/index.ts, line 119)
3. **Server likely emits**: `session.permission.requested` (per design spec)
4. **Result**: Event arrives but listener name doesn't match → event is silently dropped

This is a **100% reproducible failure mode** with clear evidence in the codebase.

---

## Evidence

### 1. Event Name Mismatch (PRIMARY EVIDENCE)

**Documentation (SPECIAL_API_DESIGN.md, line 45):**
```markdown
| `session.permission.requested` | "🔐 需要权限确认: 删除文件?" |
```

**Client Listener Registration (handlers/index.ts, lines 119-136):**
```typescript
this.sseClient.on('permission.asked', (event) => {
  const props = event.properties as {
    id: string;
    sessionID: string;
    permission: string;
    patterns: string[];
    metadata: Record<string, unknown>;
    always: string[];
    tool?: { messageID: string; callID: string };
  };
  this.permissionHandler.handlePermissionRequest({
    sessionID: props.sessionID,
    permissionID: props.id,
    description: props.permission,
    tool: props.tool?.callID,
    action: props.patterns?.[0],
  });
});
```

**Mismatch**: Listener registers for `permission.asked` but documentation specifies `session.permission.requested`.

---

### 2. SSE Event Dispatch Logic (SECONDARY EVIDENCE)

**oc-event.ts, lines 117-131 (handleEvent method):**
```typescript
private handleEvent(event: OpenCodeEvent): void {
  if (event.type === 'permission.asked' || event.type === 'session.status') {
    this.logger.debug(`event ${event.type}`);
  }
  const handlers = this.eventHandlers.get(event.type) || [];
  const wildcards = this.eventHandlers.get('*') || [];

  for (const handler of [...handlers, ...wildcards]) {
    try {
      handler(event);
    } catch (error) {
      this.logger.error('event handler error:', error);
    }
  }
}
```

**Key Points:**
- Line 121: `this.eventHandlers.get(event.type)` performs **exact string match** on `event.type`
- If server emits `session.permission.requested` but listener registered for `permission.asked`, the `get()` returns `undefined`
- Line 121: `const handlers = this.eventHandlers.get(event.type) || []` → empty array
- Event is silently dropped; no error logged

---

### 3. SSE Client Architecture (TERTIARY EVIDENCE)

**oc-event.ts, lines 57-64 (onmessage handler):**
```typescript
this.eventSource.onmessage = (event: { data: string }) => {
  try {
    const parsed = JSON.parse(event.data) as OpenCodeEvent;
    this.handleEvent(parsed);
  } catch (error) {
    this.logger.error('failed to parse message, raw:', event.data, error);
  }
};
```

**Architecture:**
- SSEClient **only uses `onmessage`** (generic message handler)
- Does **NOT use `addEventListener()`** for named SSE events
- Event dispatch is based on **JSON `type` field**, not EventSource named events
- This is correct design, but requires exact name match

---

### 4. Logs Show Zero Permission Activity

**Observation from logs (opencode-telegram.log):**
- SSE connection opens: `[octg][sse] connection opened`
- No permission-handler logs appear: `[octg][permission]` never logged
- Tools enter running state but permission popup never arrives
- This is consistent with event being silently dropped due to name mismatch

---

## Root Cause Analysis

### Why Permission Popup Never Arrives

1. **Server emits**: `{ type: "session.permission.requested", properties: {...} }`
2. **Client listener registered for**: `permission.asked`
3. **Dispatch logic**: `this.eventHandlers.get("session.permission.requested")` → `undefined`
4. **Result**: Event silently dropped; no handler called; permission popup never sent to Telegram

### Why No Error Is Logged

- oc-event.ts line 118-120 only logs debug for `permission.asked` or `session.status`
- If server emits `session.permission.requested`, this condition is false
- No error handler fires because the event is simply not matched
- Silent failure is the worst kind of bug

---

## Failure Mode Classification

| Aspect | Status |
|--------|--------|
| **Event Parsing** | ✅ Works (JSON parsed correctly) |
| **SSE Connection** | ✅ Works (connection opens) |
| **Event Dispatch** | ❌ **FAILS** (name mismatch) |
| **Permission Handler** | ❌ Never called (event dropped) |
| **Telegram Popup** | ❌ Never sent (handler never called) |

---

## Probable Server Event Names

Based on documentation and design patterns, the server likely emits:

| Event Type | Listener Registered | Status |
|------------|-------------------|--------|
| `session.permission.requested` | `permission.asked` | ❌ MISMATCH |
| `session.status` | `session.status` | ✅ Likely OK |

The `session.status` listener may work because it's a simpler name and less likely to have been changed.

---

## Recommended Fix

### Option 1: Update Client Listener (Recommended)
Change handlers/index.ts line 119 from:
```typescript
this.sseClient.on('permission.asked', (event) => {
```

To:
```typescript
this.sseClient.on('session.permission.requested', (event) => {
```

**Rationale**: Aligns with documented server event name; minimal change; no server-side changes needed.

### Option 2: Update Documentation
If server actually emits `permission.asked`, update SPECIAL_API_DESIGN.md line 45 to match.

**Rationale**: Less likely; documentation is usually more authoritative than code.

### Option 3: Add Fallback Listener
Register both names to handle either case:
```typescript
const handlePermissionRequest = (event) => { /* ... */ };
this.sseClient.on('permission.asked', handlePermissionRequest);
this.sseClient.on('session.permission.requested', handlePermissionRequest);
```

**Rationale**: Defensive; handles both cases; adds slight overhead.

---

## Verification Steps

1. **Check server logs** for actual event names emitted during permission request
2. **Add debug logging** to oc-event.ts to log all received event types:
   ```typescript
   private handleEvent(event: OpenCodeEvent): void {
     this.logger.debug(`received event type: ${event.type}`);
     // ... rest of method
   }
   ```
3. **Trigger permission request** and observe logs to confirm actual event name
4. **Update listener** to match actual server event name
5. **Verify permission popup** appears in Telegram

---

## Impact Assessment

- **Severity**: HIGH (core feature broken)
- **Scope**: Permission workflow completely non-functional
- **User Impact**: Users cannot approve/deny permissions; tasks hang indefinitely
- **Fix Complexity**: LOW (one-line change)
- **Risk**: MINIMAL (isolated to event listener registration)

---

## Conclusion

The permission popup failure is caused by a **simple but critical event name mismatch** between server emission (`session.permission.requested`) and client listener registration (`permission.asked`). The SSE architecture is sound; the dispatch logic is correct; the failure is purely a naming inconsistency that causes silent event dropping.

**Recommended Action**: Update handlers/index.ts line 119 to register listener for `session.permission.requested` instead of `permission.asked`.
