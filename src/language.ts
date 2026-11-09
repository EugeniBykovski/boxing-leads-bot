export type Lang = 'pl' | 'ru' | 'uk' | 'en';

export const LANG_NAME_RU: Record<Lang, string> = {
  pl: 'польский',
  ru: 'русский',
  uk: 'украинский',
  en: 'английский',
};

function countMatches(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

const W = (words: string[]) => new RegExp(`(?<![\\p{L}])(?:${words.join('|')})(?![\\p{L}])`, 'gu');

const UK_WORDS = W(['шукаю', 'порадьте', 'підкажіть', 'де', 'як', 'хто', 'що', 'з', 'у', 'або', 'будь', 'ласка', 'дякую', 'тренування', 'займатися', 'почати', 'мені', 'який', 'яку']);
const RU_WORDS = W(['ищу', 'посоветуйте', 'подскажите', 'где', 'как', 'кто', 'что', 'или', 'пожалуйста', 'спасибо', 'тренировки', 'заниматься', 'начать', 'мне', 'какой', 'какую', 'я', 'по']);
const PL_WORDS = W(['czy', 'ktoś', 'szukam', 'gdzie', 'jakiś', 'się', 'na', 'w', 'i', 'jest', 'mam', 'boksu', 'trenera', 'poleci', 'polecicie', 'dla', 'może', 'mnie']);
const EN_WORDS = W(['the', 'a', 'an', 'for', 'any', 'in', 'looking', 'where', 'i', 'to', 'is', 'and', 'anyone', 'recommend', 'my', 'with']);

/** Lightweight detector for the four languages we care about. */
export function detectLanguage(text: string): Lang {
  const t = text.toLowerCase();
  const cyr = countMatches(t, /[а-яёіїєґ]/gu);
  const lat = countMatches(t, /[a-ząćęłńóśźż]/gu);
  if (cyr > lat) {
    const uk = countMatches(t, /[іїєґ]/gu) * 2 + countMatches(t, UK_WORDS);
    const ru = countMatches(t, /[ыэъё]/gu) * 2 + countMatches(t, RU_WORDS);
    return uk > ru ? 'uk' : 'ru';
  }
  const pl = countMatches(t, /[ąćęłńóśźż]/gu) * 2 + countMatches(t, PL_WORDS);
  const en = countMatches(t, EN_WORDS);
  return pl > en ? 'pl' : 'en';
}
