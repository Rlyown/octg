import type { Context } from 'telegraf';
import type { Message, Update } from 'telegraf/types';
import { formatFileList } from '../formatters.js';
import type { HandlerContext } from './index.js';

export class FileHandler {
  constructor(private hctx: HandlerContext) {}

  async handleListFiles(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.hctx.ensureSession(ctx);
    if (!session) return;

    const message = ctx.message as Message.TextMessage;
    const args = message.text.split(' ').slice(1);
    const path = args[0] || '';

    try {
      const files = await this.hctx.opencode.listFiles(path);
      await ctx.reply(formatFileList(files, path));
    } catch (error) {
      await ctx.reply(`❌ 无法列出文件: ${error}`);
    }
  }

  async handleReadFile(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.hctx.ensureSession(ctx);
    if (!session) return;

    const message = ctx.message as Message.TextMessage;
    const args = message.text.split(' ').slice(1);
    const path = args[0];

    if (!path) {
      await ctx.reply('请提供文件路径，例如: /cat README.md');
      return;
    }

    try {
      const file = await this.hctx.opencode.readFile(path);

      let content = file.content;
      if (content.length > this.hctx.config.app.maxMessageLength - 100) {
        content = content.slice(0, this.hctx.config.app.maxMessageLength - 100) + '\n\n... (已截断)';
      }

      await ctx.reply(`📄 ${path}\n\n\`\`\`\n${content}\n\`\`\``);
    } catch (error) {
      await ctx.reply(`❌ 无法读取文件: ${error}`);
    }
  }

  async handleSearch(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.hctx.ensureSession(ctx);
    if (!session) return;

    const message = ctx.message as Message.TextMessage;
    const pattern = message.text.replace('/search', '').trim();

    if (!pattern) {
      await ctx.reply('请提供搜索关键词，例如: /search function');
      return;
    }

    const processingMsg = await ctx.reply(`🔍 搜索: ${pattern}...`);

    try {
      const results = await this.hctx.opencode.findText(pattern);
      await ctx.deleteMessage(processingMsg.message_id);

      if (results.length === 0) {
        await ctx.reply('未找到匹配结果');
        return;
      }

      const lines = results.slice(0, 10).map((result, index) => {
        const resultLines = result.lines.slice(0, 3).map(l => `   ${l.line_number}: ${l.content.slice(0, 60)}`).join('\n');
        return `${index + 1}. ${result.path}\n${resultLines}`;
      });

      const more = results.length > 10 ? `\n\n... 还有 ${results.length - 10} 个结果` : '';
      await ctx.reply(`🔍 搜索结果 (${results.length} 个文件)${more}\n\n${lines.join('\n\n')}`);
    } catch (error) {
      await ctx.deleteMessage(processingMsg.message_id);
      await ctx.reply(`❌ 搜索失败: ${error}`);
    }
  }

  async handleFindFile(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.hctx.ensureSession(ctx);
    if (!session) return;

    const message = ctx.message as Message.TextMessage;
    const query = message.text.replace('/findfile', '').trim();

    if (!query) {
      await ctx.reply('请提供文件名，例如: /findfile README');
      return;
    }

    try {
      const results = await this.hctx.opencode.findFile(query);
      if (results.length === 0) {
        await ctx.reply('未找到匹配文件');
        return;
      }

      const lines = results.slice(0, 20).map((path, index) => `${index + 1}. ${path}`);
      const more = results.length > 20 ? `\n\n... 还有 ${results.length - 20} 个结果` : '';
      await ctx.reply(`📁 找到 ${results.length} 个文件${more}\n\n${lines.join('\n')}`);
    } catch (error) {
      await ctx.reply(`❌ 查找失败: ${error}`);
    }
  }

  async handleGitStatus(ctx: Context<Update.MessageUpdate>): Promise<void> {
    try {
      const files = await this.hctx.opencode.getFileStatus();
      if (!Array.isArray(files) || files.length === 0) {
        await ctx.reply('工作区干净，没有变更');
        return;
      }

      const staged = files.filter((f: any) => f.staged);
      const unstaged = files.filter((f: any) => !f.staged);

      let result = `📊 Git 文件状态 (${files.length})\n\n`;

      if (staged.length > 0) {
        result += `✅ 已暂存 (${staged.length}):\n${staged.slice(0, 10).map((f: any) => `  • ${f.path}`).join('\n')}\n\n`;
      }

      if (unstaged.length > 0) {
        result += `📝 未暂存 (${unstaged.length}):\n${unstaged.slice(0, 10).map((f: any) => `  • ${f.path}`).join('\n')}`;
      }

      await ctx.reply(result);
    } catch (error) {
      await ctx.reply(`❌ 获取 Git 状态失败: ${error}`);
    }
  }

  async handleSymbol(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const message = ctx.message as Message.TextMessage;
    const query = message.text.replace('/symbol', '').trim();

    if (!query) {
      await ctx.reply('请提供符号名称，例如: /symbol handleMessage');
      return;
    }

    try {
      const symbols = await this.hctx.opencode.findSymbol(query);
      if (!Array.isArray(symbols) || symbols.length === 0) {
        await ctx.reply('未找到匹配符号');
        return;
      }

      const lines = symbols.slice(0, 15).map((s: any, index: number) => {
        const name = s.name || 'Unknown';
        const path = s.path || '';
        const line = s.line || 0;
        return `${index + 1}. ${name}\n   ${path}:${line}`;
      });

      const more = symbols.length > 15 ? `\n\n... 还有 ${symbols.length - 15} 个结果` : '';
      await ctx.reply(`🔍 符号搜索结果 (${symbols.length})${more}\n\n${lines.join('\n\n')}`);
    } catch (error) {
      await ctx.reply(`❌ 搜索失败: ${error}`);
    }
  }

  async handleInit(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.hctx.ensureSession(ctx);
    if (!session) return;

    const processingMsg = await ctx.reply('📝 正在分析项目并创建 AGENTS.md...');

    try {
      const success = await this.hctx.opencode.initSession(
        session.openCodeSessionId,
        session.preferredModel?.split('/')[0],
        session.preferredModel?.split('/')[1]
      );
      await ctx.deleteMessage(processingMsg.message_id);

      if (success) {
        await ctx.reply('✅ 项目分析完成，已创建 AGENTS.md');
      } else {
        await ctx.reply('⚠️ 分析失败');
      }
    } catch (error) {
      await ctx.deleteMessage(processingMsg.message_id);
      await ctx.reply(`❌ 分析失败: ${error}`);
    }
  }

  async handleTools(ctx: Context<Update.MessageUpdate>): Promise<void> {
    try {
      const tools = await this.hctx.opencode.listToolIds();
      if (!tools || typeof tools !== 'object') {
        await ctx.reply('暂无工具信息');
        return;
      }

      const entries = Object.entries(tools as Record<string, string[]>);
      if (entries.length === 0) {
        await ctx.reply('暂无可用工具');
        return;
      }

      const lines = entries.slice(0, 10).map(([category, ids]) => {
        const count = Array.isArray(ids) ? ids.length : 0;
        return `• ${category}: ${count} 个工具`;
      });

      const more = entries.length > 10 ? `\n\n... 还有 ${entries.length - 10} 个分类` : '';
      await ctx.reply(`🛠️ 可用工具 (${entries.length} 分类)${more}\n\n${lines.join('\n')}`);
    } catch (error) {
      await ctx.reply(`❌ 获取工具列表失败: ${error}`);
    }
  }
}
