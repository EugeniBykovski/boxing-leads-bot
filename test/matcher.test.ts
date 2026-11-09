import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectLanguage } from '../src/language.js';
import { matchPost } from '../src/matcher.js';
import { suggestReply } from '../src/replies.js';

const alert = (text: string) => {
  const r = matchPost(text);
  assert.equal(r.match, true, `expected ALERT for «${text}», got SKIP: ${r.reason}`);
  assert.ok(r.reason.length > 0);
  return r;
};
const skip = (text: string, reasonPart?: RegExp) => {
  const r = matchPost(text);
  assert.equal(r.match, false, `expected SKIP for «${text}», got ALERT: ${r.reason}`);
  if (reasonPart) assert.match(r.reason, reasonPart);
  return r;
};

describe('acceptance examples', () => {
  it('ALERT: Polish, district Mokotów', () => {
    const r = alert('Czy ktoś poleci trenera boksu na Mokotowie?');
    assert.match(r.reason, /Мокотув/);
  });
  it('ALERT: Russian, beginner in Warsaw', () => { alert('Ищу тренера по боксу в Варшаве, я новичок'); });
  it('ALERT: Ukrainian, where to start in Warsaw', () => { alert('Порадьте, де у Варшаві почати займатися боксом'); });
  it('ALERT: English, beginner classes in Warsaw', () => { alert('Any recommendations for beginner boxing classes in Warsaw?'); });

  it('SKIP: trainer advertisement', () => { skip('Zapraszam na treningi boksu w Warszawie, mam wolne terminy', /реклама/); });
  it('SKIP: no location', () => { skip('Looking for a boxing coach', /Варшав/); });
  it('SKIP: lives in Warsaw, wants Kraków', () => { skip('Mieszkam w Warszawie, ale szukam trenera boksu w Krakowie', /Краков/); });
  it('SKIP: tickets', () => { skip('Кто продаёт билеты на бокс в Варшаве?', /билеты/); });
});

describe('new wording (generalisation)', () => {
  for (const text of [
    'Polecicie jakiś klub bokserski na Ursynowie? Chcę zacząć od zera',
    'szukam trenera boksu w wawie, indywidualnie',
    'Hej, gdzie można zacząć trenować boks w WARSZAWIE?',
    'Где в Варшаве можно позаниматься боксом индивидуально?',
    'Підкажіть тренера з боксу на Жолібожі, будь ласка',
    'Can anyone recommend a boxing gym in Wola? I just moved to Warsaw',
    'Does anyone know a good boxing coach on Praga? (Warsaw)',
    'Szukam miejsca do boksu na Pradze-Południe',
    'Jestem z Krakowa, ale teraz szukam trenera boksu w Warszawie',
    'Mieszkam w Warszawie i szukam trenera boksu dla początkujących',
    'Kto zna dobrego trenera boksu? Najlepiej Wola albo Ochota',
    'Boxing coach wanted in Warsaw, DM me if you know someone',
  ]) it(`ALERT: ${text}`, () => { alert(text); });

  for (const [text, reason] of [
    ['Usyk vs Fury — kto wygra walkę? Oglądamy w Warszawie', /не про бокс/],
    ['Usyk vs Fury: boks w Warszawie, kto wygra walkę?', /боёв/],
    ['Prowadzę treningi boksu na Mokotowie, pierwszy trening gratis!', /реклама/],
    ['Szukam trenera kickboxingu w Warszawie', /не про бокс/],
    ['Looking for a boxing coach in Prague', /Прага/],
    ['Ищу тренера по боксу в Кракове', /Краков/],
    ['Polski bokser zdobył złoto, gala w Warszawie była świetna', /билеты/],
    ['Ochota na boks dziś wieczorem, szukam trenera', /Варшав/],
    ['Gdzie kupić rękawice bokserskie w Warszawie?', /нет просьбы/],
    ['Boxing in Warsaw is amazing', /нет просьбы/],
    ['Szukam trenera tenisa w Warszawie', /не про бокс/],
  ] as const) it(`SKIP: ${text}`, () => { skip(text, reason); });
});

describe('normalisation', () => {
  it('handles missing Polish diacritics and capitals', () => {
    alert('CZY KTOS POLECI TRENERA BOKSU NA MOKOTOWIE');
    alert('czy ktoś poleci trenera boksu na mokotowie');
  });
  it('does not match Krakowskie Przedmieście as Kraków', () => {
    alert('Szukam trenera boksu w Warszawie, najlepiej blisko Krakowskiego Przedmieścia');
  });
});

describe('language and reply', () => {
  it('detects the four languages', () => {
    assert.equal(detectLanguage('Czy ktoś poleci trenera boksu na Mokotowie?'), 'pl');
    assert.equal(detectLanguage('Ищу тренера по боксу в Варшаве, я новичок'), 'ru');
    assert.equal(detectLanguage('Порадьте, де у Варшаві почати займатися боксом'), 'uk');
    assert.equal(detectLanguage('Any recommendations for beginner boxing classes in Warsaw?'), 'en');
  });
  it('picks a reply that fits the request and invents nothing', () => {
    const r = matchPost('Ищу тренера по боксу в Варшаве, я новичок');
    assert.ok(r.match);
    const reply = suggestReply('ru', r.wants);
    assert.match(reply, /с нуля/);
    for (const lang of ['pl', 'ru', 'uk', 'en'] as const) {
      for (const wants of [['coach'], ['beginner'], ['individual'], ['place']] as const) {
        const text = suggestReply(lang, wants);
        assert.doesNotMatch(text, /\d|zł|pln|€|\$|ул\.|ul\./i, `reply must not contain prices/addresses: ${text}`);
        assert.ok(text.length < 220);
      }
    }
  });
});
