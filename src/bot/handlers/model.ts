import type { Context } from 'telegraf';
import type { Message, Update } from 'telegraf/types';
import type { RequestOverrides, TelegramSession } from '../../types.js';
import type { HandlerContext } from './index.js';
import { getLogger } from '../../logger.js';

export class ModelHandler {
  private static readonly FALLBACK_MODEL = 'openai/gpt-5.4';
  private static readonly AGENT_MODE_LABELS: Record<string, string> = {
    primary: 'primary',
    subagent: 'subagent',
    all: 'all',
  };
  private logger = getLogger('model');

  constructor(private hctx: HandlerContext) {}

  async handleModel(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.hctx.ensureSession(ctx);
    if (!session) return;

    const message = ctx.message as Message.TextMessage;
    const args = message.text.split(' ').slice(1);
    const normalized = args.join(' ').trim();

    this.logger.info(`handleModel called, args: "${normalized}"`);

    if (!normalized) {
      const resolvedModel = await this.getResolvedModelInfo(session);
      this.logger.info(`showing current model: ${resolvedModel}`);

      await ctx.reply(
        `🧠 当前模型\n\n` +
        `${resolvedModel}\n\n` +
        `用法：\n` +
        `/model <provider/model> 设置模型\n` +
        `/model <index> 按编号设置模型\n` +
        `/model clear 清除模型覆盖\n` +
        `/model list 列出可用模型`
      );
      return;
    }

    if (args[0] === 'list') {
      this.logger.info('listing available models');
      try {
        const config = await this.hctx.opencode.getConfigProviders();
        const indexedModels = this.buildIndexedModels(config);
        this.logger.info(`found ${config.providers.length} providers and ${indexedModels.length} models`);
        const lines = config.providers.map((provider) => {
          const providerModels = indexedModels.filter((entry) => entry.provider === provider.provider);
          const models = providerModels.slice(0, 5).map((entry) => `${entry.index}. ${entry.model}`).join(', ');
          const more = providerModels.length > 5 ? `... (+${providerModels.length - 5})` : '';
          return `• ${provider.provider}: ${models}${more}`;
        });
        await ctx.reply(`🧠 可用模型 (${config.providers.length} providers)\n\n${lines.join('\n')}`);
        this.logger.info('model list sent successfully');
      } catch (error) {
        this.logger.error('failed to get model list:', error);
        await ctx.reply(`❌ 获取模型列表失败: ${error}`);
      }
      return;
    }

    if (normalized === 'clear') {
      this.logger.info('clearing model override');
      delete session.preferredModel;
      this.hctx.sessions.set(session);
      await ctx.reply(`✅ 已清除模型覆盖\n\n后续消息将优先使用 OpenCode 默认模型；如果服务端默认无法解析，则回退到 ${ModelHandler.FALLBACK_MODEL}`);
      return;
    }

    const selectedByIndex = await this.resolveModelByIndex(normalized);
    if (selectedByIndex) {
      session.preferredModel = selectedByIndex.label;
      this.logger.info(`model set by index ${normalized}: ${selectedByIndex.label}`);
      this.hctx.sessions.set(session);
      await ctx.reply(`✅ 已按编号设置模型\n\n${normalized} → ${selectedByIndex.label}`);
      return;
    }

    if (/^\d+$/.test(normalized)) {
      await ctx.reply(`❌ 模型编号 ${normalized} 不存在\n\n请先执行 /model list 查看可用编号。`);
      return;
    }

    session.preferredModel = normalized;
    this.logger.info(`model set to: ${normalized}`);
    this.hctx.sessions.set(session);
    this.logger.info('model saved to session');
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
    const modelOverride = this.parseModelOverride(resolvedModel);
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

  async getResolvedModelInfo(session: TelegramSession): Promise<string> {
    if (session.preferredModel) {
      return session.preferredModel;
    }

    const providers = await this.hctx.opencode.getConfigProviders().catch(() => null);
    const configuredDefault = this.getConfiguredDefaultModelLabel(providers);

    if (configuredDefault) {
      return configuredDefault;
    }

    return ModelHandler.FALLBACK_MODEL;
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

  private buildIndexedModels(config: { providers: Array<{ provider: string; models: string[] }> }): Array<{
    index: number;
    provider: string;
    model: string;
    label: string;
  }> {
    const entries: Array<{ index: number; provider: string; model: string; label: string }> = [];
    let index = 1;

    for (const provider of config.providers) {
      for (const model of provider.models) {
        entries.push({
          index,
          provider: provider.provider,
          model,
          label: `${provider.provider}/${model}`,
        });
        index += 1;
      }
    }

    return entries;
  }

  private async resolveModelByIndex(input: string): Promise<{ index: number; label: string } | null> {
    if (!/^\d+$/.test(input)) {
      return null;
    }

    const index = Number.parseInt(input, 10);
    if (!Number.isFinite(index) || index <= 0) {
      return null;
    }

    const config = await this.hctx.opencode.getConfigProviders();
    const indexedModels = this.buildIndexedModels(config);
    const matched = indexedModels.find((entry) => entry.index === index);

    if (!matched) {
      return null;
    }

    return {
      index: matched.index,
      label: matched.label,
    };
  }
}
