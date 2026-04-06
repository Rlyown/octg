import type { Context } from 'telegraf';
import type { Message, Update } from 'telegraf/types';
import type { RequestOverrides, TelegramSession } from '../../types.js';
import type { HandlerContext } from './index.js';

export class ModelHandler {
  private static readonly FALLBACK_MODEL = 'openai/gpt-5.4';
  private static readonly AGENT_MODE_LABELS: Record<string, string> = {
    primary: 'primary',
    subagent: 'subagent',
    all: 'all',
  };

  constructor(private hctx: HandlerContext) {}

  async handleModel(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.hctx.ensureSession(ctx);
    if (!session) return;

    const message = ctx.message as Message.TextMessage;
    const args = message.text.split(' ').slice(1);
    const normalized = args.join(' ').trim();

    if (!normalized) {
      const resolvedModel = await this.getResolvedModelInfo(session);

      await ctx.reply(
        `🧠 当前模型\n\n` +
        `${resolvedModel.label}\n` +
        `来源：${resolvedModel.source}\n\n` +
        `用法：\n` +
        `/model <provider/model> 设置模型\n` +
        `/model clear 清除模型覆盖\n` +
        `/model list 列出可用模型`
      );
      return;
    }

    if (args[0] === 'list') {
      try {
        const config = await this.hctx.opencode.getConfigProviders();
        const lines = config.providers.map(p => {
          const models = p.models.slice(0, 5).join(', ');
          const more = p.models.length > 5 ? `... (+${p.models.length - 5})` : '';
          return `• ${p.provider}: ${models}${more}`;
        });
        await ctx.reply(`🧠 可用模型 (${config.providers.length} providers)\n\n${lines.join('\n')}`);
      } catch (error) {
        await ctx.reply(`❌ 获取模型列表失败: ${error}`);
      }
      return;
    }

    if (normalized === 'clear') {
      delete session.preferredModel;
      this.hctx.sessions.set(session);
      await ctx.reply(`✅ 已清除模型覆盖\n\n后续消息将优先使用 OpenCode 默认模型；如果服务端默认无法解析，则回退到 ${ModelHandler.FALLBACK_MODEL}`);
      return;
    }

    session.preferredModel = normalized;
    this.hctx.sessions.set(session);
    await ctx.reply(`✅ 已设置模型\n\n${normalized}`);
  }

  async handleAgents(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.hctx.ensureSession(ctx);
    if (!session) return;

    const message = ctx.message as Message.TextMessage;
    const args = message.text.split(' ').slice(1);
    const normalized = args.join(' ').trim();

    if (!normalized) {
      await ctx.reply(
        `🤖 当前 agent\n\n` +
        `${session.preferredAgent || 'default'}\n\n` +
        `用法：\n` +
        `/agents <name> 设置 agent\n` +
        `/agents clear 清除 agent 覆盖\n` +
        `/agents list 列出可用 agent`
      );
      return;
    }

    if (normalized === 'list') {
      try {
        const agents = (await this.hctx.opencode.listAgents()).filter((agent) => !agent.hidden);
        const lines = agents.map((agent) => {
          const mode = ModelHandler.AGENT_MODE_LABELS[agent.mode || 'all'] || agent.mode || 'unknown';
          const description = agent.description ? ` - ${agent.description}` : '';
          return `• ${agent.name} (${mode})${description}`;
        });
        await ctx.reply(`🤖 可用 Agents (${agents.length})\n\n${lines.join('\n')}`);
      } catch (error) {
        await ctx.reply(`❌ 获取 agent 列表失败: ${error}`);
      }
      return;
    }

    if (normalized === 'clear') {
      delete session.preferredAgent;
      this.hctx.sessions.set(session);
      await ctx.reply('✅ 已清除 agent 覆盖，后续消息将使用默认 agent');
      return;
    }

    await this.setPreferredAgent(ctx, session, normalized);
  }

  async handleNamedAgent(ctx: Context<Update.MessageUpdate>, agentName: string): Promise<void> {
    const session = await this.hctx.ensureSession(ctx);
    if (!session) return;

    await this.setPreferredAgent(
      ctx,
      session,
      agentName,
      `✅ 已切换到 ${agentName} agent\n\n仅对当前 octg 进程临时生效；如果 octg 重启，需要重新执行 /${agentName}。`,
    );
  }

  private async setPreferredAgent(
    ctx: Context<Update.MessageUpdate>,
    session: TelegramSession,
    agentName: string,
    successMessage?: string,
  ): Promise<void> {
    session.preferredAgent = agentName;
    this.hctx.sessions.set(session);
    await ctx.reply(successMessage || `✅ 已设置 agent\n\n${agentName}`);
  }

  async getOverrides(session: TelegramSession): Promise<RequestOverrides> {
    const overrides: RequestOverrides = {};

    const resolvedModel = await this.getResolvedModelInfo(session);
    const modelOverride = this.parseModelOverride(resolvedModel.label);
    if (modelOverride) {
      overrides.model = modelOverride;
    }

    if (session.preferredAgent) {
      overrides.agent = session.preferredAgent;
    }

    return overrides;
  }

  parseModelOverride(modelLabel?: string): RequestOverrides['model'] | undefined {
    if (!modelLabel) {
      return undefined;
    }

    const parts = modelLabel.split('/');
    if (parts.length < 2) {
      return undefined;
    }

    return {
      providerID: parts[0],
      modelID: parts.slice(1).join('/'),
    };
  }

  async getResolvedModelInfo(session: TelegramSession): Promise<{ label: string; source: string }> {
    if (session.preferredModel) {
      return {
        label: session.preferredModel,
        source: '本地覆盖',
      };
    }

    const providers = await this.hctx.opencode.getConfigProviders().catch(() => null);
    const configuredDefault = this.getConfiguredDefaultModelLabel(providers);

    if (configuredDefault) {
      return {
        label: configuredDefault,
        source: 'OpenCode 默认',
      };
    }

    return {
      label: ModelHandler.FALLBACK_MODEL,
      source: '回退默认',
    };
  }

  getConfiguredDefaultModelLabel(config: { default?: unknown } | null): string | undefined {
    if (!config?.default || typeof config.default !== 'object') {
      return undefined;
    }

    const defaults = config.default as Record<string, unknown>;
    const knownPairs: Array<[string, string]> = [
      ['providerID', 'modelID'],
      ['providerId', 'modelId'],
      ['provider', 'model'],
    ];

    for (const [providerKey, modelKey] of knownPairs) {
      const provider = defaults[providerKey];
      const model = defaults[modelKey];
      if (typeof provider === 'string' && typeof model === 'string' && provider && model) {
        return `${provider}/${model}`;
      }
    }

    const nestedModel = defaults.model;
    if (nestedModel && typeof nestedModel === 'object') {
      const parsedNestedModel = this.getConfiguredDefaultModelLabel({ default: nestedModel });
      if (parsedNestedModel) {
        return parsedNestedModel;
      }
    }

    const entries = Object.entries(defaults).filter(([, value]) => typeof value === 'string' && value.length > 0);
    if (entries.length === 1) {
      const [provider, model] = entries[0];
      if (typeof model === 'string') {
        return `${provider}/${model}`;
      }
    }

    return undefined;
  }
}
