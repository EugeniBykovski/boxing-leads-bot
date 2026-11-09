import { InlineKeyboard } from 'grammy';
import { LANG_NAME_RU } from './language.js';
import type { Decision, Lead } from './types.js';

export const TIME_ZONE = 'Europe/Warsaw';
const EXCERPT_LIMIT = 700;

/** Escape third-party text for Telegram parse_mode=HTML. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function formatWarsawTime(epochMs: number): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: TIME_ZONE,
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(epochMs));
}

export function excerpt(text: string, limit = EXCERPT_LIMIT): string {
  const chars = [...text.trim()];
  if (chars.length <= limit) return chars.join('');
  const cut = chars.slice(0, limit).join('');
  const space = cut.lastIndexOf(' ');
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Only canonical HTTPS Threads links are turned into a button. */
export function safePermalink(url: string): string | null {
  try {
    const u = new URL(url);
    const hostOk = /^(?:www\.)?threads\.(?:net|com)$/.test(u.hostname);
    return u.protocol === 'https:' && hostOk ? u.toString() : null;
  } catch {
    return null;
  }
}

const DECISION_LINE: Record<Decision, string> = {
  replied: '✅ <b>Ответил</b>',
  skipped: '⏭ <b>Пропущено</b>',
};

export const CALLBACK = {
  replied: (postId: string) => `d:r:${postId}`,
  skipped: (postId: string) => `d:s:${postId}`,
  parse(data: string): { decision: Decision; postId: string } | null {
    const m = /^d:([rs]):(\d{1,40})$/.exec(data);
    if (!m) return null;
    return { decision: m[1] === 'r' ? 'replied' : 'skipped', postId: m[2]! };
  },
};

/** Telegram HTML text of a lead card. */
export function renderCard(lead: Lead): string {
  const lines = [
    '🥊 <b>Запрос на тренировки по боксу</b>',
    '',
    `<blockquote>${escapeHtml(excerpt(lead.text))}</blockquote>`,
    `👤 @${escapeHtml(lead.username)}`,
    `🕒 ${formatWarsawTime(lead.publishedAt)} (Варшава)`,
    `💡 ${escapeHtml(lead.reason)}`,
    '',
    `✍️ <b>Вариант ответа</b> (${LANG_NAME_RU[lead.language]}, отредактируйте перед отправкой):`,
    `<pre>${escapeHtml(lead.reply)}</pre>`,
  ];
  if (!safePermalink(lead.permalink)) lines.push('', '⚠️ Ссылка на пост некорректна — найдите его по автору.');
  if (lead.decision && lead.decidedAt) {
    lines.push('', `${DECISION_LINE[lead.decision]} · ${formatWarsawTime(lead.decidedAt)}`);
  }
  return lines.join('\n');
}

export function cardKeyboard(lead: Lead): InlineKeyboard {
  const kb = new InlineKeyboard();
  const link = safePermalink(lead.permalink);
  if (link) kb.url('Открыть в Threads', link).row();
  kb.text(lead.decision === 'replied' ? '✅ Ответил' : 'Ответил', CALLBACK.replied(lead.postId));
  kb.text(lead.decision === 'skipped' ? '⏭ Пропустить' : 'Пропустить', CALLBACK.skipped(lead.postId));
  return kb;
}

/** Plain-text preview of the card for the console (demo). */
export function renderCardPreview(lead: Lead): string {
  const text = renderCard(lead)
    .replace(/<blockquote>/g, '┃ ').replace(/<\/blockquote>/g, '')
    .replace(/<pre>/g, '┌──────────\n').replace(/<\/pre>/g, '\n└──────────')
    .replace(/<\/?b>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const buttons = cardKeyboard(lead).inline_keyboard
    .map((row) => row.map((b) => `[ ${b.text} ]`).join(' '))
    .join('\n');
  return `${text}\n${buttons}`;
}
