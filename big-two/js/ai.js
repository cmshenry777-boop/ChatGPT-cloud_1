// Bot players. A small, readable heuristic: shed weak cards in big groups,
// hold on to 2s and aces, don't break pairs for singles, and get aggressive
// when somebody is about to go out.

import { allCombos, checkPlay, beats, rankOf, compareCombos, THREE_OF_DIAMONDS } from './rules.js';
import { leadCombo } from './game.js';

const TWO = 12;
const ACE = 11;

function rankCounts(hand) {
  const m = new Map();
  for (const c of hand) m.set(rankOf(c), (m.get(rankOf(c)) || 0) + 1);
  return m;
}

// How much playing `combo` hurts the rest of the hand. Lower is better.
function cost(combo, hand, counts, danger) {
  const ranks = combo.cards.map(rankOf);
  const avg = ranks.reduce((a, r) => a + r, 0) / ranks.length;
  let c = avg / 12 * 4; // weak cards first
  const twos = ranks.filter(r => r === TWO).length;
  const aces = ranks.filter(r => r === ACE).length;
  const late = hand.length <= 4 || danger;
  c += twos * (late ? 0.5 : 4);
  c += aces * (late ? 0.2 : 1.2);
  // Breaking up a pair/triple to play part of it wastes a combo.
  if (combo.type === 'single' && counts.get(ranks[0]) >= 2) c += 2;
  if (combo.type === 'pair' && counts.get(ranks[0]) === 3) c += 0.8;
  if (combo.type === 'five') c -= 0.3; // five cards gone in one go
  return c;
}

// Returns the cards to play, or null to pass.
export function chooseMove(state, p, rand = Math.random) {
  const hand = state.players[p].hand;
  const lead = leadCombo(state);
  const counts = rankCounts(hand);
  const others = state.players.map((pl, i) => (i === p ? Infinity : pl.hand.length));
  const minOther = Math.min(...others);
  const next = (p + 1) % state.players.length;
  const nextCount = state.players[next].hand.length;
  const danger = minOther <= 2;

  let combos = allCombos(hand);
  if (state.firstPlay) combos = combos.filter(c => c.cards.includes(THREE_OF_DIAMONDS));

  // Can we go out right now?
  if (checkPlay(hand, lead, state.firstPlay).ok) return hand.slice();

  if (!lead) return chooseLead(combos, hand, counts, danger, nextCount);

  const options = combos.filter(c => beats(c, lead)).sort(compareCombos);
  if (!options.length) return null;

  // The next player is down to one card and this is a singles trick:
  // block with the strongest single we have.
  if (lead.type === 'single' && nextCount === 1) return options[options.length - 1].cards;

  let best = options[0];
  let bestCost = Infinity;
  for (const o of options) {
    const k = cost(o, hand, counts, danger);
    if (k < bestCost) { best = o; bestCost = k; }
  }

  // Sometimes it's better to hold a 2 than to spend it on a cheap trick.
  const usesTwo = best.cards.some(c => rankOf(c) === TWO);
  if (!danger && hand.length > 6 && usesTwo && rand() < 0.65) return null;
  if (!danger && bestCost > 6 && rand() < 0.5) return null;
  return best.cards;
}

function chooseLead(combos, hand, counts, danger, nextCount) {
  let best = null;
  let bestScore = Infinity;
  for (const c of combos) {
    let s = cost(c, hand, counts, danger) - c.cards.length * 0.9;
    // Never lead a low single into a player who has one card left.
    if (c.type === 'single' && nextCount === 1) s += 50 - c.key / 10;
    if (s < bestScore) { best = c; bestScore = s; }
  }
  return best.cards;
}
