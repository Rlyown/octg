import type { FileNode, Todo } from '../types.js';

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

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
