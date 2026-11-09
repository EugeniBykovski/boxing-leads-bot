/**
 * Editable matching rules.
 *
 * Every pattern is a regular-expression fragment applied to NORMALIZED text:
 *   - lower-case
 *   - Polish letters folded to ASCII (ą→a, ł→l, ó→o, ś→s, ż/ź→z, …)
 *   - Russian ё→е
 * A pattern always has to start at a word boundary. By default it is a PREFIX
 * (so "trener" also matches "trenera", "trenerem"). End a pattern with "$" to
 * require a word end as well ("wawa$" matches "wawa" but not "wawaxyz").
 */

export interface Cue {
  /** Human-readable label (Russian, shown in the Telegram card). */
  label: string;
  patterns: string[];
}

/** Evidence that the post is about boxing. Kickboxing is removed beforehand. */
export const BOXING: string[] = [
  'boks', // boks, boksu, boksem, bokser, bokserski
  'boxing', 'boxer', 'boxe$',
  'бокс', // бокс, боксу, боксом, боксер(ский)
];

/** Strings removed before the boxing check so they do not count as boxing. */
export const NOT_BOXING: string[] = [
  'kick[- ]?bo(?:ks|x)', 'кик[- ]?бокс', 'кік[- ]?бокс', 'thai[- ]?bo(?:ks|x)', 'тайск\\S* бокс', 'tajski\\S* boks',
];

/** The author is ASKING (request / recommendation / search). */
export const REQUEST: string[] = [
  // Polish
  'szuka', 'poszukuj', 'poleci', 'polecac', 'polecen', 'polecis', 'polecc', 'czy ktos', 'ktos zna', 'znacie',
  'gdzie (?:moge|mozna|warto|najlepiej|isc|pojsc|zaczac|trenowac)', 'chce (?:zaczac|sprobowac|trenowac|nauczyc)',
  'chcial(?:a)?bym', 'potrzebuje', 'rekomend', 'jakis dobr', 'jakies dobr', 'jaki klub', 'jaka sekcj',
  // Russian
  'ищу', 'ищем', 'поищу', 'посовет', 'подскаж', 'порекоменд', 'кто знает', 'знаете',
  'где (?:можно|найти|лучше|начать|заниматься|позаниматься)', 'хочу (?:начать|заниматься|попробовать|научиться)',
  'нужен тренер', 'нужна секция', 'рекоменд',
  // Ukrainian
  'шукаю', 'шукаємо', 'порад', 'підкаж', 'хто знає', 'знаєте',
  'де (?:можна|знайти|краще|почати|займатися|позайматися)', 'хочу (?:почати|займатися|спробувати|навчитися)',
  'потрібен тренер', 'потрібна секція',
  // English
  'looking for', 'searching for', 'any recommend', 'recommend', 'suggest', 'can anyone', 'can someone',
  'does anyone', 'anyone know', 'where (?:can|should|do) (?:i|we)', 'where to', 'want to (?:start|learn|try|get into)',
  'need an? (?:coach|trainer)', 'wanted$', 'needed$',
  // "needed" in all languages
  'potrzebn', 'poszukiwan', 'нужен', 'нужна', 'требуется', 'потрібн',
];

/** Question words: count as a request only when the post contains "?". */
export const QUESTION_WORDS: string[] = [
  'gdzie$', 'jaki$', 'jaka$', 'jakie$', 'jakis$', 'kto$',
  'где$', 'какой$', 'какую$', 'какие$', 'кто$',
  'де$', 'який$', 'яку$', 'які$', 'хто$',
  'where$', 'which$', 'who$', 'any good',
];

/** What kind of training is asked for. Order matters for the card reason. */
export const TRAINING: Record<'individual' | 'beginner' | 'coach' | 'place' | 'lessons', string[]> = {
  individual: [
    'indywidualn', 'personaln', '1 ?na ?1$', '1:1', 'индивидуальн', 'персональн', 'індивідуальн',
    'personal', 'private', 'one[- ]on[- ]one', '1[- ]on[- ]1',
  ],
  beginner: [
    'poczatkuj', 'od zera', 'nowicjusz', 'новичок', 'новичк', 'с нуля', 'початківц', 'новачок', 'з нуля',
    'beginner', 'newbie', 'novice', 'never boxed', 'from scratch',
  ],
  coach: ['trener', 'instruktor', 'тренер', 'инструктор', 'інструктор', 'coach', 'trainer', 'instructor'],
  place: [
    'klub', 'sekcj', 'sala$', 'sali$', 'silowni', 'szkol', 'miejsc', 'akademi',
    'клуб', 'секци', 'секці', 'зал$', 'зале$', 'школ', 'место', 'места$', 'місц',
    'gym', 'club', 'school', 'place to', 'academy',
  ],
  lessons: [
    'trening', 'trenowa', 'zajec', 'zajeci', 'lekcj', 'zaczac', 'zaczynam', 'nauczyc', 'sprobowac',
    'трениров', 'заняти', 'заниматься', 'позаниматься', 'урок', 'начать', 'научиться', 'попробовать',
    'тренуван', 'занятт', 'займатис', 'позайматис', 'почати', 'навчитис', 'спробувати',
    'class', 'lesson', 'training', 'train$', 'session', 'start', 'learn', 'get into',
  ],
};

/** The author is SELLING / advertising training. Overrides everything. */
export const ADVERTISEMENT: Cue[] = [
  {
    label: 'реклама тренировок',
    patterns: [
      'zapraszam', 'zapraszamy', 'wolne terminy', 'mam wolne', 'wolne miejsca', 'prowadze', 'oferuje', 'oferujemy',
      'zapisy', 'zapisz sie', 'cennik', 'promocj', 'pierwszy trening gratis', 'darmowy trening', 'zglos sie',
      'приглашаю', 'приглашаем', 'набор в', 'набираю', 'записывайтесь', 'запись открыта', 'провожу', 'веду тренировки',
      'свободные окна', 'мои тренировки', 'бесплатная тренировка', 'прайс',
      'запрошую', 'запрошуємо', 'набір', 'записуйтесь', 'проводжу', 'веду тренування', 'вільні вікна',
      'мої тренування', 'безкоштовне тренування',
      'i offer', 'we offer', 'join my', 'join our', 'book your', 'book now', 'sign up', 'spots available',
      'slots available', 'free trial', 'my classes', 'i teach', 'i coach', 'limited spots',
      '\\d+ ?(?:zl|pln|злот|eur|usd)$', '\\d+ ?€',
    ],
  },
];

/** Tickets, events, news and fight discussion. Overrides everything. */
export const OFF_TOPIC: Cue[] = [
  { label: 'билеты/мероприятие', patterns: ['bilet', 'билет', 'квит', 'ticket', 'gala$', 'gali$', 'gale$', 'turniej', 'турнир', 'fight night', 'event', 'transmisj', 'трансляц', 'stream', 'ppv', 'pay per view'] },
  { label: 'обсуждение боёв/новости', patterns: ['vs\\.?$', 'walka$', 'walki$', 'walke$', 'walce$', 'бой$', 'боя$', 'поединок', 'ksw$', 'nokaut', 'нокаут', 'knockout', 'wygra(?:l|la)?$', 'przegra(?:l|la)?$', 'чемпион', 'champion', 'mistrz', 'zaklad', 'ставк', 'betting'] },
];

/** Warsaw itself. */
export const WARSAW: string[] = [
  'warszaw', 'warsaw', 'warschau', 'wawa$', 'wawie$', 'wawy$', 'wawe$', 'wawka$', 'wwa$', 'w-wa$', 'варшав',
];

/**
 * Warsaw districts and well-known neighbourhoods. Names that are also ordinary
 * words (Wola = "will", Ochota = "desire", Praga = "Prague", Włochy = "Italy")
 * are only accepted with the preposition Varsovians actually use.
 */
export const DISTRICTS: Cue[] = [
  { label: 'Мокотув', patterns: ['mokotow', 'мокотув', 'мокотов'] },
  { label: 'Жолибож', patterns: ['zoliborz', 'жолибож', 'жолібож'] },
  { label: 'Урсинув', patterns: ['ursynow', 'урсинов', 'урсинув'] },
  { label: 'Вилянув', patterns: ['wilanow', 'вилянов', 'вилянув', 'вілянув'] },
  { label: 'Бемово', patterns: ['bemow', 'бемов'] },
  { label: 'Беляны', patterns: ['bielan', 'белян', 'білян'] },
  { label: 'Бялоленка', patterns: ['bialolek', 'бялоленк', 'білоленк', 'белоленк'] },
  { label: 'Таргувек', patterns: ['targowk', 'targowek', 'таргувек', 'таргувк'] },
  { label: 'Вавер', patterns: ['wawer', 'wawrze$', 'вавер'] },
  { label: 'Урсус', patterns: ['ursus'] },
  { label: 'Рембертув', patterns: ['rembertow'] },
  { label: 'Воля', patterns: ['na woli$', 'na wole$', 'in wola$', 'wola district'] },
  { label: 'Охота', patterns: ['na ochocie', 'in ochota$'] },
  { label: 'Прага', patterns: ['na pradze', 'praga[- ]?(?:poludnie|polnoc|p\\.?n|p\\.?d)', 'in praga$'] },
  { label: 'Влохи', patterns: ['we wlochach', 'na wlochach'] },
  { label: 'Весола', patterns: ['na wesolej', 'w wesolej'] },
  { label: 'Сьрудмесьце', patterns: ['srodmiesc\\S* warszaw', 'warszaw\\S* srodmiesc'] },
  { label: 'Саска Кэмпа', patterns: ['saska kep', 'saskiej kep'] },
  { label: 'Кабаты', patterns: ['kabat'] },
  { label: 'Гоцлав', patterns: ['goclaw'] },
  { label: 'Тархомин', patterns: ['tarchomin'] },
  { label: 'Муранув', patterns: ['muranow'] },
  { label: 'Повисле', patterns: ['powisl'] },
  { label: 'Служевец', patterns: ['sluzewc', 'sluzewiec'] },
  { label: 'Садыба', patterns: ['sadyb'] },
  { label: 'Брудно', patterns: ['brodn'] },
  { label: 'Натолин', patterns: ['natolin'] },
];

/**
 * District names that are also ordinary words, accepted in their bare form only
 * when Capitalised in the middle of a sentence ("…najlepiej Wola albo Ochota").
 * Matched against the ORIGINAL text (case-sensitive).
 */
export const CAPITALISED_DISTRICTS: Cue[] = [
  { label: 'Воля', patterns: ['Wol(?:a|i|ę|ą)'] },
  { label: 'Охота', patterns: ['Ochot(?:a|ę|y)', 'Ochocie'] },
];

/** Other cities: if training is requested THERE, the post is skipped. */
export const OTHER_CITIES: Cue[] = [
  { label: 'Краков', patterns: ['krakow(?!sk)', 'cracow', 'krakau', 'краков(?!ск)', 'краків', 'кракові'] },
  { label: 'Вроцлав', patterns: ['wroclaw(?!sk)', 'вроцлав'] },
  { label: 'Гданьск', patterns: ['gdansk', 'гданьск', 'гданськ', 'gdyni', 'gdynia', 'sopot'] },
  { label: 'Познань', patterns: ['poznan', 'познан'] },
  { label: 'Лодзь', patterns: ['lodz(?!k)', 'лодз'] },
  { label: 'Катовице', patterns: ['katowic', 'катовиц'] },
  { label: 'Люблин', patterns: ['lublin', 'люблин'] },
  { label: 'Щецин', patterns: ['szczecin', 'щецин'] },
  { label: 'Белосток', patterns: ['bialystok', 'bialymstoku', 'белосток', 'білосток'] },
  { label: 'Торунь', patterns: ['torun', 'торун'] },
  { label: 'Жешув', patterns: ['rzeszow', 'жешув'] },
  { label: 'Быдгощ', patterns: ['bydgoszcz', 'быдгощ'] },
  { label: 'Прага (Чехия)', patterns: ['w pradze', 'prague', 'praha', 'в праге', 'у празі'] },
  { label: 'Киев', patterns: ['kyiv', 'kiev', 'kijow', 'киев', 'київ', 'києв'] },
  { label: 'Львов', patterns: ['lviv', 'lwow', 'львов', 'львів'] },
  { label: 'Минск', patterns: ['minsk', 'минск', 'мінськ'] },
  { label: 'Вильнюс', patterns: ['vilnius', 'wilno', 'wilnie', 'вильнюс', 'вільнюс'] },
  { label: 'Берлин', patterns: ['berlin', 'берлин', 'берлін'] },
  { label: 'Лондон', patterns: ['london', 'londyn', 'лондон'] },
  { label: 'Москва', patterns: ['moscow', 'moskw', 'москв'] },
];

/**
 * Words just before a city that mean "I live there / I am from there"
 * rather than "I want to train there".
 */
export const RESIDENCE_BEFORE_CITY: string[] = [
  'mieszkam', 'mieszkamy', 'mieszkajac', 'jestem z', 'pochodze z', 'przeprowadzam sie z', 'wyjezdzam z',
  'живу', 'живем', 'проживаю', 'я из', 'переезжаю из', 'уезжаю из',
  'мешкаю', 'живемо', 'я з', 'переїжджаю з',
  'i live', 'living in', 'based in', "i'm from", 'im from', 'i am from', 'moving from',
];
