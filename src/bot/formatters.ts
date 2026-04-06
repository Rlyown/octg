import type { FileNode, OpenCodeSession, RequestOverrides, Todo } from '../types.js';

export function formatFileList(files: FileNode[], currentPath: string): string {
  if (files.length === 0) {
    return `📁 ${currentPath || '根目录'}\n\n(空目录)`;
  }

  const lines = files.map(f => {
    const icon = f.isDirectory ? '📁' : '📄';
    const name = f.name;
    const size = f.size ? ` (${formatBytes(f.size)})` : '';
    return `${icon} ${name}${size}`;
  });

  return `📁 ${currentPath || '根目录'}\n\n${lines.join('\n')}`;
}

export function formatTodos(todos: Todo[]): string {
  if (todos.length === 0) {
    return '✅ 暂无任务';
  }

  const lines = todos.map((todo, index) => {
    const status = todo.completed ? '✅' : '⬜';
    return `${status} ${index + 1}. ${todo.content}`;
  });

  return `📋 任务列表 (${todos.length} 个)\n\n${lines.join('\n')}`;
}

export function formatCodeResponse(text: string): string {
  // Extract code blocks
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
  let formatted = text;
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    const lang = match[1] || '';
    const code = match[2];
    formatted = formatted.replace(
      match[0],
      `\`\`\`${lang}\n${code}\n\`\`\``
    );
  }

  return formatted;
}

export function formatTelegramHtml(text: string): string {
  const blocks: string[] = [];
  const inlines: string[] = [];

  const reserve = (store: string[], value: string, prefix: string): string => {
    const index = store.push(value) - 1;
    return `${prefix}${index}__`;
  };

  let formatted = text.replace(/```(?:\w+)?\n([\s\S]*?)```/g, (_match, code: string) => (
    reserve(blocks, `<pre><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`, '__TG_HTML_BLOCK_')
  ));

  formatted = formatted.replace(/`([^`]+)`/g, (_match, code: string) => (
    reserve(inlines, `<code>${escapeHtml(code)}</code>`, '__TG_HTML_INLINE_')
  ));

  formatted = escapeHtml(formatted)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/__([^_]+)__/g, '<u>$1</u>')
    .replace(/\*([^*]+)\*/g, '<i>$1</i>')
    .replace(/_([^_]+)_/g, '<i>$1</i>');

  formatted = formatted.replace(/__TG_HTML_BLOCK_(\d+)__/g, (_match, index: string) => blocks[Number(index)] || '');
  formatted = formatted.replace(/__TG_HTML_INLINE_(\d+)__/g, (_match, index: string) => inlines[Number(index)] || '');

  return formatted;
}

export function formatStatus(params: {
  version: string;
  project: unknown;
  path: unknown;
  todosCount: number;
  sessionId: string;
  sessionTitle?: string;
  overrides?: RequestOverrides;
  modelLabel?: string;
  agentLabel?: string;
}): string {
  const projectLabel = stringifySummary(params.project);
  const pathLabel = stringifySummary(params.path);
  const modelLabel = params.modelLabel || (params.overrides?.model 
    ? `${params.overrides.model.providerID}/${params.overrides.model.modelID}`
    : 'openai/gpt-5.4');
  const agentLabel = params.agentLabel || params.overrides?.agent || 'OpenCode default';

  return [
    '📊 OpenCode 状态',
    '',
    `🟢 Server  v${params.version}`,
    `🧩 Project  ${projectLabel}`,
    `📂 Path  ${pathLabel}`,
    `🪪 Session  ${params.sessionId.slice(0, 12)}...`,
    `🏷️ Title  ${params.sessionTitle || 'Untitled'}`,
    `📋 Todos  ${params.todosCount}`,
    `🧠 Model  ${modelLabel}`,
    `🤖 Agent  ${agentLabel}`,
  ].join('\n');
}

export function formatSessionOverview(params: {
  sessions: OpenCodeSession[];
  currentSessionId?: string;
  currentSessionTitle?: string;
  query?: string;
  page?: number;
  pageSize?: number;
}): string {
  if (params.sessions.length === 0) {
    const scope = params.query ? `与 "${params.query}" 相关的 ` : '';
    return `📭 没有可用的${scope}Sessions\n\n使用 /new <绝对路径> 创建新 session`;
  }

  const pageSize = params.pageSize ?? 8;
  const currentPage = Math.max(1, params.page ?? 1);
  const totalPages = Math.max(1, Math.ceil(params.sessions.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const visibleSessions = params.sessions.slice(startIndex, startIndex + pageSize);

  const header = params.currentSessionId
    ? [
        '🗂️ 当前 Session',
        `• ${params.currentSessionId.slice(0, 12)}...`,
        `• ${params.currentSessionTitle || 'Untitled'}`,
        '',
        `📚 可用 Sessions (${params.sessions.length})`,
      ]
    : [`📚 可用 Sessions (${params.sessions.length})`];

  const lines = visibleSessions.map((session, index) => {
    const isCurrent = session.id === params.currentSessionId ? ' 👈' : '';
    const title = session.title || 'Untitled';
    const shortId = `${session.id.slice(0, 12)}...`;
    const date = session.time?.updated ? new Date(session.time.updated).toLocaleDateString() : 'Unknown';
    return `${startIndex + index + 1}. ${shortId}${isCurrent}\n   ${title}\n   ${date}`;
  });

  return [
    ...header,
    ...(params.query ? ['', `🔎 检索: ${params.query}`] : []),
    '',
    lines.join('\n\n'),
    '',
    `页码: ${safePage}/${totalPages}`,
    '用法：',
    '• /sessions <序号> 按列表序号载入 session',
    '• /sessions <id或前缀> 载入已有 session',
    '• /remove <序号或id> 删除 session',
    '• /sessions <关键词> 检索 session',
    '• 用下方按钮翻页',
    '• /new <绝对路径> [title] 创建新 session',
  ].join('\n');
}

function stringifySummary(value: unknown): string {
  if (typeof value === 'string') return value;

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const preferredKeys = ['name', 'title', 'path', 'root', 'cwd', 'id'];

    for (const key of preferredKeys) {
      const candidate = record[key];
      if (typeof candidate === 'string' && candidate.length > 0) {
        return candidate;
      }
    }

    const entries = Object.entries(record)
      .filter(([, candidate]) => ['string', 'number', 'boolean'].includes(typeof candidate))
      .slice(0, 3)
      .map(([key, candidate]) => `${key}: ${String(candidate)}`);

    if (entries.length > 0) {
      return entries.join(' | ');
    }
  }

  return 'Unknown';
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
