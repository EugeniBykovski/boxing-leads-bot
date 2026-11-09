import {
  ADVERTISEMENT, BOXING, CAPITALISED_DISTRICTS, DISTRICTS, NOT_BOXING, OFF_TOPIC, OTHER_CITIES, QUESTION_WORDS, REQUEST,
  RESIDENCE_BEFORE_CITY, TRAINING, WARSAW, type Cue,
} from './rules.js';

export type TrainingKind = keyof typeof TRAINING;

export type MatchResult =
  | {
      match: true;
      /** Short Russian explanation for the Telegram card. */
      reason: string;
      /** What exactly was requested (for picking a reply template). */
      wants: TrainingKind[];
      location: string;
    }
  | { match: false; reason: string };

const POLISH_FOLD: Record<string, string> = {
  ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z',
};

/** Lower-case, fold Polish diacritics and ё, unify quotes/whitespace. */
export function normalize(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/gu, (c) => POLISH_FOLD[c] ?? c)
    .replace(/ё/gu, 'е')
    .replace(/[’‘`ʼ]/gu, "'")
    .replace(/\s+/gu, ' ')
    .trim();
}

const START = '(?<![\\p{L}\\p{N}])';
const END = '(?![\\p{L}\\p{N}])';

function compile(patterns: string[]): RegExp {
  const parts = patterns.map((p) => (p.endsWith('$') ? `${p.slice(0, -1)}${END}` : p));
  return new RegExp(`${START}(?:${parts.join('|')})`, 'gu');
}

interface CompiledCue { label: string; re: RegExp }
const compileCues = (cues: Cue[]): CompiledCue[] => cues.map((c) => ({ label: c.label, re: compile(c.patterns) }));

const RE = {
  notBoxing: new RegExp(NOT_BOXING.join('|'), 'gu'),
  boxing: compile(BOXING),
  request: compile(REQUEST),
  question: compile(QUESTION_WORDS),
  training: Object.fromEntries(
    (Object.keys(TRAINING) as TrainingKind[]).map((k) => [k, compile(TRAINING[k])]),
  ) as Record<TrainingKind, RegExp>,
  ads: compileCues(ADVERTISEMENT),
  offTopic: compileCues(OFF_TOPIC),
  warsaw: compile(WARSAW),
  districts: compileCues(DISTRICTS),
  cities: compileCues(OTHER_CITIES),
  residence: compile(RESIDENCE_BEFORE_CITY),
  // Preceded by a letter/comma + space, i.e. not at the start of a sentence.
  capitalised: CAPITALISED_DISTRICTS.map((c) => ({
    label: c.label,
    re: new RegExp(`(?<=[\\p{L},] )(?:${c.patterns.join('|')})${END}`, 'gu'),
  })),
};

function has(re: RegExp, text: string): boolean {
  re.lastIndex = 0;
  const ok = re.test(text);
  re.lastIndex = 0;
  return ok;
}

interface Mention { label: string; index: number; warsaw: boolean }

function findAll(re: RegExp, text: string, label: string, warsaw: boolean): Mention[] {
  re.lastIndex = 0;
  return [...text.matchAll(re)].map((m) => ({ label, index: m.index, warsaw }));
}

/**
 * True when the words right before a city mention say "I live in / I'm from",
 * i.e. the city is where the author lives, not where they want to train.
 * Looks back only within the current clause.
 */
function isResidence(text: string, index: number): boolean {
  if (index < 0) return false;
  let before = text.slice(Math.max(0, index - 40), index);
  const cut = Math.max(
    before.lastIndexOf(','), before.lastIndexOf('.'), before.lastIndexOf(';'),
    before.lastIndexOf('!'), before.lastIndexOf('?'),
    ...[' ale ', ' but ', ' но ', ' але ', ' a ', ' however '].map((w) => before.lastIndexOf(w)),
  );
  if (cut >= 0) before = before.slice(cut + 1);
  return has(RE.residence, before);
}

function locate(text: string, rawText: string):
  | { ok: true; label: string }
  | { ok: false; reason: string } {
  const mentions: Mention[] = [
    ...findAll(RE.warsaw, text, 'Варшава', true),
    ...RE.districts.flatMap((d) => findAll(d.re, text, d.label, true)),
    ...RE.cities.flatMap((c) => findAll(c.re, text, c.label, false)),
  ];
  const raw = rawText.replace(/\s+/gu, ' ');
  for (const d of RE.capitalised) {
    // Positions refer to the raw text; good enough because these never count as residence.
    if (has(d.re, raw)) mentions.push({ label: d.label, index: -1, warsaw: true });
  }
  const target = mentions.filter((m) => !isResidence(text, m.index));
  const warsawTarget = target.filter((m) => m.warsaw);
  const otherTarget = target.filter((m) => !m.warsaw);

  const district = mentions.find((m) => m.warsaw && m.label !== 'Варшава');
  const label = district ? `Варшава, ${district.label}` : 'Варшава';

  if (warsawTarget.length > 0) return { ok: true, label };
  if (otherTarget.length > 0) {
    return { ok: false, reason: `хочет тренироваться в другом городе (${otherTarget[0]!.label})` };
  }
  if (mentions.some((m) => m.warsaw)) return { ok: true, label: `${label} (живёт там)` };
  return { ok: false, reason: 'нет указания на Варшаву или её район' };
}

const WANT_ORDER: TrainingKind[] = ['individual', 'beginner', 'coach', 'place', 'lessons'];

function describeWants(wants: TrainingKind[]): string {
  const main = wants.includes('coach')
    ? 'ищет тренера по боксу'
    : wants.includes('place')
      ? 'ищет, где заниматься боксом'
      : 'ищет занятия по боксу';
  const extras = [
    wants.includes('beginner') ? 'новичок' : null,
    wants.includes('individual') ? 'индивидуально' : null,
  ].filter(Boolean);
  return extras.length ? `${main} (${extras.join(', ')})` : main;
}

/**
 * Decide whether a post is a genuine request for boxing coaching in Warsaw.
 * Needs all three: boxing + a request for coaching/lessons/a place + Warsaw.
 */
export function matchPost(rawText: string): MatchResult {
  const text = normalize(rawText);
  RE.notBoxing.lastIndex = 0;
  const boxingText = text.replace(RE.notBoxing, ' ');

  if (!has(RE.boxing, boxingText)) return { match: false, reason: 'не про бокс' };

  const ad = RE.ads.find((c) => has(c.re, text));
  if (ad) return { match: false, reason: `${ad.label}: автор предлагает, а не ищет` };

  const off = RE.offTopic.find((c) => has(c.re, text));
  if (off) return { match: false, reason: `${off.label}, а не поиск тренировок` };

  const asking = has(RE.request, text) || (rawText.includes('?') && has(RE.question, text));
  const wants = WANT_ORDER.filter((k) => has(RE.training[k], text));
  if (!asking || wants.length === 0) {
    return { match: false, reason: 'нет просьбы о тренере, занятиях или месте для тренировок' };
  }

  const loc = locate(text, rawText);
  if (!loc.ok) return { match: false, reason: loc.reason };

  return { match: true, reason: `${describeWants(wants)} · ${loc.label}`, wants, location: loc.label };
}
