// Big Two rules engine. Pure functions only, so it runs the same in the
// browser and under `node --test`.
//
// A card is an integer 0..51: id = rank * 4 + suit.
//   rank 0..12  →  3 4 5 6 7 8 9 10 J Q K A 2   (Big Two order, 2 is high)
//   suit 0..3   →  ♦ ♣ ♥ ♠                       (low → high)
// So comparing two single cards is just comparing their ids: 3♦ = 0, 2♠ = 51.

export const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
export const SUITS = ['d', 'c', 'h', 's'];
export const SUIT_NAMES = ['다이아', '클로버', '하트', '스페이드'];
export const THREE_OF_DIAMONDS = 0;

export const rankOf = id => id >> 2;
export const suitOf = id => id & 3;
export const cardName = id => RANKS[rankOf(id)] + '♦♣♥♠'[suitOf(id)];

// Five-card categories, weakest → strongest (PDF slide "Useful poker tip card").
export const FIVE = { STRAIGHT: 1, FLUSH: 2, FULL_HOUSE: 3, FOUR_KIND: 4, STRAIGHT_FLUSH: 5, ROYAL_FLUSH: 6 };

export const COMBO_NAMES = {
  single: '싱글',
  pair: '페어',
  triple: '트리플',
  [FIVE.STRAIGHT]: '스트레이트',
  [FIVE.FLUSH]: '플러시',
  [FIVE.FULL_HOUSE]: '풀하우스',
  [FIVE.FOUR_KIND]: '포카드',
  [FIVE.STRAIGHT_FLUSH]: '스트레이트 플러시',
  [FIVE.ROYAL_FLUSH]: '로열 플러시',
};

export const comboName = c => (c.type === 'five' ? COMBO_NAMES[c.cat] : COMBO_NAMES[c.type]);

// Poker value used only for detecting/ranking straights: 2 → 2, 3 → 3 … K → 13, A → 14.
const pokerValue = rank => (rank === 12 ? 2 : rank + 3);

export function newDeck() {
  return Array.from({ length: 52 }, (_, i) => i);
}

export function shuffle(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const sortByRank = cards => cards.slice().sort((a, b) => a - b);
export const sortBySuit = cards => cards.slice().sort((a, b) => suitOf(a) - suitOf(b) || a - b);

// Straights follow ordinary poker sequences: A-2-3-4-5 up to 10-J-Q-K-A, no
// wrapping (J-Q-K-A-2 is not a straight). The top card decides, so 10-J-Q-K-A
// is the highest straight — which is what makes the royal flush the best hand.
function straightTop(cards) {
  const vals = cards.map(c => pokerValue(rankOf(c))).sort((a, b) => a - b);
  for (let i = 1; i < 5; i++) if (vals[i] === vals[i - 1]) return null;
  if (vals[4] - vals[0] === 4) return { topValue: vals[4], topCard: cards.find(c => pokerValue(rankOf(c)) === vals[4]) };
  // A-2-3-4-5: the ace plays low, so the 5 is the top card.
  if (vals.join() === '2,3,4,5,14') return { topValue: 5, topCard: cards.find(c => pokerValue(rankOf(c)) === 5) };
  return null;
}

function rankCounts(cards) {
  const m = new Map();
  for (const c of cards) m.set(rankOf(c), (m.get(rankOf(c)) || 0) + 1);
  return m;
}

// Returns a combo { type, cat?, key, cards } or null if the cards are not a legal hand.
// Two combos of the same type (and, for five-card hands, the same cat) compare by `key`.
export function evaluate(input) {
  const cards = sortByRank(input);
  const n = cards.length;
  if (n === 1) return { type: 'single', key: cards[0], cards };
  if (n === 2) {
    if (rankOf(cards[0]) !== rankOf(cards[1])) return null;
    // Same rank → the pair holding the higher suit wins.
    return { type: 'pair', key: cards[1], cards };
  }
  if (n === 3) {
    if (rankOf(cards[0]) !== rankOf(cards[2])) return null;
    return { type: 'triple', key: rankOf(cards[0]), cards };
  }
  if (n !== 5) return null;

  const flush = cards.every(c => suitOf(c) === suitOf(cards[0]));
  const st = straightTop(cards);
  const suit = suitOf(cards[0]);

  if (st && flush) {
    // Slides: "between two straight flushes with different suits, the suit with
    // the higher rank is higher; with the same suit, the higher card is higher".
    // The royal flush (10-J-Q-K-A) sits above every other straight flush.
    if (st.topValue === 14) return { type: 'five', cat: FIVE.ROYAL_FLUSH, key: suit, cards };
    return { type: 'five', cat: FIVE.STRAIGHT_FLUSH, key: suit * 100 + st.topValue, cards };
  }

  const counts = [...rankCounts(cards).entries()].sort((a, b) => b[1] - a[1]);
  if (counts[0][1] === 4) {
    // The four cards always need a fifth card; the four-card rank decides.
    return { type: 'five', cat: FIVE.FOUR_KIND, key: counts[0][0], cards };
  }
  if (counts[0][1] === 3 && counts[1][1] === 2) {
    return { type: 'five', cat: FIVE.FULL_HOUSE, key: counts[0][0], cards };
  }
  if (flush) {
    // Higher suit wins first; inside one suit the higher top card wins
    // (then the next card down, and so on).
    const ranks = cards.map(rankOf).sort((a, b) => b - a);
    const lex = ranks.reduce((acc, r) => acc * 13 + r, 0);
    return { type: 'five', cat: FIVE.FLUSH, key: suit * 13 ** 5 + lex, cards };
  }
  if (st) {
    // The top card decides; equal top ranks are split by the top card's suit.
    return { type: 'five', cat: FIVE.STRAIGHT, key: st.topValue * 4 + suitOf(st.topCard), cards };
  }
  return null; // Two pair, a lone four of a kind, etc. are not playable.
}

// Does `a` beat `b`? Both must be the same number of cards.
// Any five-card hand beats a lower five-card category (a flush beats any straight).
export function beats(a, b) {
  if (!a || !b || a.cards.length !== b.cards.length || a.type !== b.type) return false;
  if (a.type === 'five' && a.cat !== b.cat) return a.cat > b.cat;
  return a.key > b.key;
}

// Is `cards` a legal play right now?
//   lastCombo     – the combo to beat, or null when leading a new trick
//   mustInclude3D – the very first play of a round has to contain the 3♦
export function checkPlay(cards, lastCombo, mustInclude3D) {
  const combo = evaluate(cards);
  if (!combo) return { ok: false, reason: '낼 수 없는 조합이에요' };
  if (mustInclude3D && !cards.includes(THREE_OF_DIAMONDS)) return { ok: false, reason: '첫 수에는 3♦가 들어가야 해요', combo };
  if (lastCombo) {
    if (cards.length !== lastCombo.cards.length) return { ok: false, reason: `${lastCombo.cards.length}장으로 내야 해요`, combo };
    if (!beats(combo, lastCombo)) return { ok: false, reason: '앞의 패보다 약해요', combo };
  }
  return { ok: true, combo };
}

function* subsets(arr, k, start = 0, acc = []) {
  if (acc.length === k) { yield acc.slice(); return; }
  for (let i = start; i <= arr.length - (k - acc.length); i++) {
    acc.push(arr[i]);
    yield* subsets(arr, k, i + 1, acc);
    acc.pop();
  }
}

// Every legal combo that can be formed from `hand`.
export function allCombos(hand) {
  const out = [];
  const byRank = new Map();
  for (const c of sortByRank(hand)) {
    if (!byRank.has(rankOf(c))) byRank.set(rankOf(c), []);
    byRank.get(rankOf(c)).push(c);
  }
  for (const c of hand) out.push(evaluate([c]));
  for (const group of byRank.values()) {
    for (const s of subsets(group, 2)) out.push(evaluate(s));
    for (const s of subsets(group, 3)) out.push(evaluate(s));
  }
  if (hand.length >= 5) {
    for (const s of subsets(sortByRank(hand), 5)) {
      const c = evaluate(s);
      if (c) out.push(c);
    }
  }
  return out;
}

// Global strength order for sorting combos of the same size, weakest first.
export function compareCombos(a, b) {
  if (a.type === 'five' && b.type === 'five' && a.cat !== b.cat) return a.cat - b.cat;
  return a.key - b.key;
}

// Penalty points for the cards left in a hand when someone else goes out.
// 1 point per card; 9–12 cards → 2 points per card; never played a card
// (all 13 still in hand) → 3 points per card, i.e. 39.
export function penalty(cardsLeft, playedAny) {
  if (cardsLeft === 0) return 0;
  if (!playedAny) return cardsLeft * 3;
  if (cardsLeft >= 9) return cardsLeft * 2;
  return cardsLeft;
}
