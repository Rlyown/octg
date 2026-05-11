import type { Context } from 'telegraf';
import type { Message, Update } from 'telegraf/types';
import type { RequestOverrides, TelegramSession, ConfigProviders } from '../../types.js';
import type { HandlerContext } from './index.js';
import { getLogger } from '../../logger.js';

interface IndexedModel {
  index: number;
  provider: string;
  model: string;
  label: string;
}

interface ProviderGroup {
  provider: string;
  models: string[];
}

export class ModelHandler {
  private static readonly FALLBACK_MODEL = 'openai/gpt-5.4';
  private static readonly AGENT_MODE_LABELS: Record<string, string> = {
    primary: 'primary',
    subagent: 'subagent',
    all: 'all',
  };
  private static readonly PROVIDERS_PER_PAGE = 8;
  private static readonly MODELS_PER_PAGE = 8;
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
        `/model clear 清除模型覆盖\n` +
        `/model list 列出可用模型`
      );
      return;
    }

    if (args[0] === 'list') {
      this.logger.info('listing available models');
      try {
        const config = await this.hctx.opencode.getConfigProviders();
        this.logger.info(`found ${config.providers.length} providers`);
        await this.renderProviderList(ctx, config, session, 1);
        this.logger.info('provider list sent successfully');
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

  async handleModelAction(ctx: Context<Update.CallbackQueryUpdate>): Promise<void> {
    const callbackData = this.getCallbackData(ctx);
    if (!callbackData) {
      await ctx.answerCbQuery();
      return;
    }

    const providerMatch = callbackData.match(/^models:provider:(.+)$/);
    if (providerMatch) {
      const providerName = providerMatch[1];
      const session = this.getCurrentSession();
      if (!session) {
        await ctx.answerCbQuery('当前没有可用会话');
        return;
      }

      try {
        const config = await this.hctx.opencode.getConfigProviders();
        await this.renderModelListForProvider(ctx, config, providerName, session, 1);
        await ctx.answerCbQuery();
      } catch (error) {
        await ctx.answerCbQuery('加载模型失败');
      }
      return;
    }

    // Handle provider pagination
    const providerPageMatch = callbackData.match(/^models:providers:page:(\d+)$/);
    if (providerPageMatch) {
      const page = Number.parseInt(providerPageMatch[1], 10);
      const session = this.getCurrentSession();
      if (!session) {
        await ctx.answerCbQuery('当前没有可用会话');
        return;
      }

      try {
        const config = await this.hctx.opencode.getConfigProviders();
        await this.renderProviderList(ctx, config, session, page);
        await ctx.answerCbQuery();
      } catch (error) {
        await ctx.answerCbQuery('加载提供商失败');
      }
      return;
    }

    // Handle model pagination within provider
    const modelPageMatch = callbackData.match(/^models:provider:(.+):page:(\d+)$/);
    if (modelPageMatch) {
      const providerName = modelPageMatch[1];
      const page = Number.parseInt(modelPageMatch[2], 10);
      const session = this.getCurrentSession();
      if (!session) {
        await ctx.answerCbQuery('当前没有可用会话');
        return;
      }

      try {
        const config = await this.hctx.opencode.getConfigProviders();
        await this.renderModelListForProvider(ctx, config, providerName, session, page);
        await ctx.answerCbQuery();
      } catch (error) {
        await ctx.answerCbQuery('加载模型失败');
      }
      return;
    }

    // Handle back to providers
    if (callbackData === 'models:back:providers') {
      const session = this.getCurrentSession();
      if (!session) {
        await ctx.answerCbQuery('当前没有可用会话');
        return;
      }

      try {
        const config = await this.hctx.opencode.getConfigProviders();
        await this.renderProviderList(ctx, config, session, 1);
        await ctx.answerCbQuery();
      } catch (error) {
        await ctx.answerCbQuery('加载提供商失败');
      }
      return;
    }

    if (callbackData === 'models:noop') {
      await ctx.answerCbQuery();
      return;
    }

    const selectMatch = callbackData.match(/^models:set:(\d+)$/);
    if (!selectMatch) {
      await ctx.answerCbQuery('无效的模型请求');
      return;
    }

    const index = Number.parseInt(selectMatch[1], 10);
    const session = this.getCurrentSession();
    if (!session) {
      await ctx.answerCbQuery('当前没有可用会话');
      return;
    }

    try {
      const config = await this.hctx.opencode.getConfigProviders();
      const indexedModels = this.buildIndexedModels(config);
      const matched = indexedModels.find((entry) => entry.index === index);
      if (!matched) {
        await ctx.answerCbQuery('模型不存在');
        return;
      }

      session.preferredModel = matched.label;
      this.hctx.sessions.set(session);
      await this.renderModelListForProvider(ctx, config, matched.provider, session, 1, `✅ 已切换到 ${matched.label}`);
      await ctx.answerCbQuery(`已切换到 ${matched.model}`);
    } catch (error) {
      await ctx.answerCbQuery('切换模型失败');
    }
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

  private buildIndexedModels(config: ConfigProviders): IndexedModel[] {
    const entries: IndexedModel[] = [];
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

  private async renderProviderList(
    ctx: Context<Update.MessageUpdate> | Context<Update.CallbackQueryUpdate>,
    config: ConfigProviders,
    session: TelegramSession,
    page: number,
    toast?: string,
  ): Promise<void> {
    const pageSize = ModelHandler.PROVIDERS_PER_PAGE;
    const totalPages = Math.max(1, Math.ceil(config.providers.length / pageSize));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * pageSize;
    const visibleProviders = config.providers.slice(start, start + pageSize);
    const currentModel = await this.getResolvedModelInfo(session);

    const lines = visibleProviders.map((provider) => {
      const modelCount = provider.models.length;
      return `• ${provider.provider} (${modelCount} 个模型)`;
    });

    const textParts = [
      `🏢 可用提供商 (${config.providers.length})`,
      '',
      `当前模型：${currentModel}`,
      '',
      lines.join('\n'),
      '',
      `页码: ${safePage}/${totalPages}`,
      '点击提供商名称查看其模型。',
    ];

    if (toast) {
      textParts.splice(2, 0, toast, '');
    }

    const replyMarkup = this.buildProviderPagination(visibleProviders, safePage, totalPages);

    if ('callback_query' in ctx.update && 'editMessageText' in ctx) {
      const callbackCtx = ctx as unknown as Context<Update.CallbackQueryUpdate>;
      await callbackCtx.editMessageText(textParts.join('\n'), { reply_markup: replyMarkup });
      return;
    }

    await ctx.reply(textParts.join('\n'), { reply_markup: replyMarkup });
  }

  private buildProviderPagination(
    visibleProviders: ProviderGroup[],
    currentPage: number,
    totalPages: number,
  ) {
    const rows: Array<Array<{ text: string; callback_data: string }>> = [];

    for (const provider of visibleProviders) {
      rows.push([{
        text: `🏢 ${provider.provider} (${provider.models.length})`,
        callback_data: `models:provider:${provider.provider}`,
      }]);
    }

    const navigation: Array<{ text: string; callback_data: string }> = [];
    if (currentPage > 1) {
      navigation.push({ text: '⬅️ Prev', callback_data: `models:providers:page:${currentPage - 1}` });
    }
    navigation.push({ text: `${currentPage}/${totalPages}`, callback_data: 'models:noop' });
    if (currentPage < totalPages) {
      navigation.push({ text: 'Next ➡️', callback_data: `models:providers:page:${currentPage + 1}` });
    }

    if (navigation.length > 0) {
      rows.push(navigation);
    }

    return { inline_keyboard: rows };
  }

  private async renderModelListForProvider(
    ctx: Context<Update.MessageUpdate> | Context<Update.CallbackQueryUpdate>,
    config: ConfigProviders,
    providerName: string,
    session: TelegramSession,
    page: number,
    toast?: string,
  ): Promise<void> {
    const provider = config.providers.find(p => p.provider === providerName);
    if (!provider) {
      await this.renderProviderList(ctx, config, session, 1);
      return;
    }

    const pageSize = ModelHandler.MODELS_PER_PAGE;
    const totalPages = Math.max(1, Math.ceil(provider.models.length / pageSize));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * pageSize;
    const visibleModels = provider.models.slice(start, start + pageSize);
    const currentModel = await this.getResolvedModelInfo(session);

    const allModels = this.buildIndexedModels(config);

    const lines = visibleModels.map((model) => {
      const label = `${providerName}/${model}`;
      const current = label === currentModel ? ' 👈 当前' : '';
      return `• ${label}${current}`;
    });

    const textParts = [
      `🧠 ${providerName} 的模型 (${provider.models.length})`,
      '',
      `当前模型：${currentModel}`,
      '',
      lines.join('\n'),
      '',
      `页码: ${safePage}/${totalPages}`,
      '点击下方按钮切换模型。',
    ];

    if (toast) {
      textParts.splice(2, 0, toast, '');
    }

    const replyMarkup = this.buildModelPaginationForProvider(
      providerName,
      visibleModels,
      start,
      allModels,
      safePage,
      totalPages,
      currentModel
    );

    if ('callback_query' in ctx.update && 'editMessageText' in ctx) {
      const callbackCtx = ctx as unknown as Context<Update.CallbackQueryUpdate>;
      await callbackCtx.editMessageText(textParts.join('\n'), { reply_markup: replyMarkup });
      return;
    }

    await ctx.reply(textParts.join('\n'), { reply_markup: replyMarkup });
  }

  private buildModelPaginationForProvider(
    providerName: string,
    visibleModels: string[],
    startIndex: number,
    allModels: IndexedModel[],
    currentPage: number,
    totalPages: number,
    currentModel: string,
  ) {
    const rows: Array<Array<{ text: string; callback_data: string }>> = [];

    for (let i = 0; i < visibleModels.length; i++) {
      const model = visibleModels[i];
      const label = `${providerName}/${model}`;
      const modelEntry = allModels.find(m => m.provider === providerName && m.model === model);
      const index = modelEntry?.index || (startIndex + i + 1);
      const isCurrent = label === currentModel;

      rows.push([{
        text: `${isCurrent ? '✅ ' : ''}${model}`,
        callback_data: `models:set:${index}`,
      }]);
    }

    const navigation: Array<{ text: string; callback_data: string }> = [];
    if (currentPage > 1) {
      navigation.push({ text: '⬅️ Prev', callback_data: `models:provider:${providerName}:page:${currentPage - 1}` });
    }
    navigation.push({ text: `${currentPage}/${totalPages}`, callback_data: 'models:noop' });
    if (currentPage < totalPages) {
      navigation.push({ text: 'Next ➡️', callback_data: `models:provider:${providerName}:page:${currentPage + 1}` });
    }

    if (navigation.length > 0) {
      rows.push(navigation);
    }

    rows.push([{
      text: '🔙 返回提供商列表',
      callback_data: 'models:back:providers',
    }]);

    return { inline_keyboard: rows };
  }

  private getCurrentSession(): TelegramSession | null {
    return this.hctx.sessions.get();
  }

  private getCallbackData(ctx: Context<Update.CallbackQueryUpdate>): string | undefined {
    const callbackQuery = ctx.update.callback_query;
    if (!callbackQuery || typeof callbackQuery !== 'object') {
      return undefined;
    }

    if (!('data' in callbackQuery) || typeof callbackQuery.data !== 'string') {
      return undefined;
    }

    return callbackQuery.data;
  }
}
