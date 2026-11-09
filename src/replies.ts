import type { Lang } from './language.js';
import type { TrainingKind } from './matcher.js';

type Variant = 'individual' | 'beginner' | 'place' | 'coach';

/**
 * Suggested replies. Short, personal, and they promise nothing concrete:
 * no prices, addresses, schedules or credentials — you add those yourself.
 */
export const REPLY_TEMPLATES: Record<Lang, Record<Variant, string>> = {
  pl: {
    coach: 'Cześć! Jestem trenerem boksu w Warszawie. Jeśli nadal szukasz, napisz do mnie — chętnie opowiem, jak wyglądają moje treningi.',
    beginner: 'Cześć! Jestem trenerem boksu w Warszawie i pracuję też z osobami, które zaczynają od zera. Jeśli chcesz, napisz do mnie — opowiem, jak wygląda pierwszy trening.',
    individual: 'Cześć! Jestem trenerem boksu w Warszawie i prowadzę treningi indywidualne. Napisz do mnie, jeśli chcesz — porozmawiamy o tym, czego szukasz.',
    place: 'Cześć! Jestem trenerem boksu w Warszawie. Jeśli szukasz miejsca, żeby zacząć, napisz do mnie — opowiem, gdzie i jak trenuję.',
  },
  ru: {
    coach: 'Привет! Я тренер по боксу в Варшаве. Если ещё ищете, напишите мне — расскажу, как проходят мои тренировки.',
    beginner: 'Привет! Я тренер по боксу в Варшаве, работаю в том числе с теми, кто начинает с нуля. Если интересно, напишите мне — расскажу, как проходит первая тренировка.',
    individual: 'Привет! Я тренер по боксу в Варшаве, провожу индивидуальные тренировки. Напишите мне, если интересно — обсудим, что вам нужно.',
    place: 'Привет! Я тренер по боксу в Варшаве. Если ищете, где начать, напишите мне — расскажу, где и как я тренирую.',
  },
  uk: {
    coach: 'Привіт! Я тренер з боксу у Варшаві. Якщо ще шукаєте, напишіть мені — розповім, як проходять мої тренування.',
    beginner: 'Привіт! Я тренер з боксу у Варшаві, працюю також із тими, хто починає з нуля. Якщо цікаво, напишіть мені — розповім, як проходить перше тренування.',
    individual: 'Привіт! Я тренер з боксу у Варшаві, проводжу індивідуальні тренування. Напишіть мені, якщо цікаво — обговоримо, що вам потрібно.',
    place: 'Привіт! Я тренер з боксу у Варшаві. Якщо шукаєте, де почати, напишіть мені — розповім, де і як я треную.',
  },
  en: {
    coach: "Hi! I'm a boxing coach in Warsaw. If you're still looking, feel free to message me — happy to tell you how my sessions work.",
    beginner: "Hi! I'm a boxing coach in Warsaw and I work with complete beginners too. If you'd like, send me a message and I'll tell you what a first session looks like.",
    individual: "Hi! I'm a boxing coach in Warsaw and I do one-on-one sessions. Feel free to message me and we can talk about what you're looking for.",
    place: "Hi! I'm a boxing coach in Warsaw. If you're looking for a place to start, message me and I'll tell you where and how I train.",
  },
};

export function suggestReply(lang: Lang, wants: readonly TrainingKind[]): string {
  const variant: Variant = wants.includes('individual')
    ? 'individual'
    : wants.includes('beginner')
      ? 'beginner'
      : !wants.includes('coach') // asked where/how to start, not for a specific coach
        ? 'place'
        : 'coach';
  return REPLY_TEMPLATES[lang][variant];
}
