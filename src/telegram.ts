import { Bot, GrammyError, type Context } from 'grammy';
import { cardKeyboard, CALLBACK, formatWarsawTime, renderCard } from './card.js';
import type { Config } from './config.js';
import type { Notifier } from './scanner.js';
import type { ScanOutcome, Store } from './store.js';
import type { Lead } from './types.js';

export interface Owner { ownerUserId: number; chatId: number }

/** Only the configured owner, in the configured private chat. Nobody else, ever. */
export function isOwner(owner: Owner, fromId: number | undefined, chatId: number | undefined, chatType: string | undefined): boolean {
  return fromId === owner.ownerUserId && chatId === owner.chatId && chatType === 'private';
}

export type DecisionResult =
  | { kind: 'unauthorized' }
  | { kind: 'invalid' }
  | { kind: 'not_found' }
  | { kind: 'unchanged'; lead: Lead }
  | { kind: 'updated'; lead: Lead };

/** Pure handler for "Ответил"/"Пропустить" taps (testable without Telegram). */
export function handleDecision(
  store: Store, owner: Owner,
  input: { fromId: number | undefined; chatId: number | undefined; chatType: string | undefined; data: string; now: number },
): DecisionResult {
  if (!isOwner(owner, input.fromId, input.chatId, input.chatType)) return { kind: 'unauthorized' };
  const parsed = CALLBACK.parse(input.data);
  if (!parsed) return { kind: 'invalid' };
  const res = store.setDecision(parsed.postId, parsed.decision, input.now);
  if (res === 'not_found') return { kind: 'not_found' };
  const lead = store.getLead(parsed.postId)!;
  return { kind: res, lead };
}

const OUTCOME_RU: Record<ScanOutcome, string> = {
  ok: 'успешно',
  partial: 'частично (часть запросов к Threads не удалась)',
  auth_error: 'ошибка: токен Threads истёк или недействителен',
  permission_denied: 'ошибка: нет разрешения Threads на поиск',
  rate_limited: 'ошибка: превышен лимит запросов Threads',
  provider_error: 'ошибка: Threads недоступен',
  cooldown: 'пауза после лимита Threads',
};

function ago(now: number, t: number): string {
  const min = Math.round((now - t) / 60_000);
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} ч назад` : `${Math.round(h / 24)} дн назад`;
}

export function buildStatusText(store: Store, cfg: Pick<Config, 'scanIntervalMinutes' | 'lookbackHours'>, now: number, scanning: boolean): string {
  const last = store.lastScan();
  const ok = store.lastSuccessfulScan();
  const s = store.stats(now - 24 * 3600_000);
  const lines = ['📊 <b>Статус</b>', ''];
  lines.push(ok?.finishedAt
    ? `Последний успешный скан: ${formatWarsawTime(ok.finishedAt)} (${ago(now, ok.finishedAt)}), найдено новых: ${ok.newLeads}`
    : 'Успешных сканов ещё не было.');
  if (last?.finishedAt && last.outcome) {
    lines.push(`Последняя попытка: ${formatWarsawTime(last.finishedAt)} — ${OUTCOME_RU[last.outcome]}`);
    if (last.providerError) lines.push(`Ошибка Threads: <code>${escape(last.providerError)}</code>`);
    lines.push(last.deliveryError
      ? `Ошибка доставки в Telegram: <code>${escape(last.deliveryError)}</code>`
      : 'Доставка в Telegram: без ошибок');
  }
  lines.push(
    '',
    `Лиды: всего ${s.total}, за 24 ч ${s.recent}, ждут отправки ${s.pending}`,
    `Решения: ответил ${s.replied}, пропущено ${s.skipped}`,
    `Скан каждые ${cfg.scanIntervalMinutes} мин, окно ${cfg.lookbackHours} ч${scanning ? ' · сейчас идёт скан' : ''}`,
  );
  return lines.join('\n');
}

const escape = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function createBot(cfg: Config): Bot {
  return new Bot(cfg.telegramBotToken, { client: { timeoutSeconds: 30 } });
}

export class TelegramNotifier implements Notifier {
  constructor(private readonly bot: Bot, private readonly chatId: number) {}

  async sendLead(lead: Lead): Promise<number> {
    const msg = await this.bot.api.sendMessage(this.chatId, renderCard(lead), {
      parse_mode: 'HTML',
      reply_markup: cardKeyboard(lead),
      link_preview_options: { is_disabled: true },
    });
    return msg.message_id;
  }

  async sendNotice(text: string): Promise<void> {
    await this.bot.api.sendMessage(this.chatId, text, { link_preview_options: { is_disabled: true } });
  }
}

const HELP = [
  '🥊 Бот ищет в Threads запросы на тренировки по боксу в Варшаве и присылает их сюда.',
  '',
  'Под каждой карточкой: «Открыть в Threads», «Ответил», «Пропустить».',
  '/status — состояние последнего скана',
].join('\n');

export function registerHandlers(bot: Bot, store: Store, cfg: Config, isScanning: () => boolean): void {
  const owner: Owner = { ownerUserId: cfg.ownerUserId, chatId: cfg.chatId };

  // Gate: drop every update that is not from the owner in the private chat.
  bot.use(async (ctx: Context, next) => {
    if (isOwner(owner, ctx.from?.id, ctx.chat?.id, ctx.chat?.type)) return next();
    if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: 'Нет доступа' }).catch(() => undefined);
    // Messages from strangers are ignored silently: no ownership is ever granted.
  });

  bot.command(['start', 'help'], (ctx) => ctx.reply(HELP));
  bot.command('status', (ctx) =>
    ctx.reply(buildStatusText(store, cfg, Date.now(), isScanning()), { parse_mode: 'HTML' }));

  bot.on('callback_query:data', async (ctx) => {
    const res = handleDecision(store, owner, {
      fromId: ctx.from.id, chatId: ctx.chat?.id, chatType: ctx.chat?.type, data: ctx.callbackQuery.data, now: Date.now(),
    });
    switch (res.kind) {
      case 'unauthorized': return void (await ctx.answerCallbackQuery({ text: 'Нет доступа' }));
      case 'invalid':
      case 'not_found': return void (await ctx.answerCallbackQuery({ text: 'Лид не найден' }));
      case 'unchanged': return void (await ctx.answerCallbackQuery({ text: 'Уже отмечено' }));
      case 'updated':
        await ctx.answerCallbackQuery({ text: res.lead.decision === 'replied' ? 'Отмечено: ответил' : 'Пропущено' });
        try {
          await ctx.editMessageText(renderCard(res.lead), {
            parse_mode: 'HTML', reply_markup: cardKeyboard(res.lead), link_preview_options: { is_disabled: true },
          });
        } catch (e) {
          if (!(e instanceof GrammyError && e.description.includes('message is not modified'))) throw e;
        }
    }
  });

  bot.catch((err) => console.error(`[bot] update ${err.ctx.update.update_id} failed: ${err.error instanceof Error ? err.error.message : String(err.error)}`));
}
