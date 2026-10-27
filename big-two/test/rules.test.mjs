import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, beats, checkPlay, penalty, FIVE, RANKS } from '../js/rules.js';
import { newGame, startRound, play, pass, standings } from '../js/game.js';
import { chooseMove } from '../js/ai.js';

// "3d" "10s" "2h" → card id
const C = s => {
  const suit = 'dchs'.indexOf(s.at(-1));
  return RANKS.indexOf(s.slice(0, -1).toUpperCase()) * 4 + suit;
};
const H = str => str.split(' ').map(C);
const ev = str => evaluate(H(str));

test('card order: 3♦ lowest, 2♠ highest, suits ♦ < ♣ < ♥ < ♠', () => {
  assert.equal(C('3d'), 0);
  assert.equal(C('2s'), 51);
  assert.ok(beats(ev('3s'), ev('3h')));
  assert.ok(beats(ev('3h'), ev('3c')));
  assert.ok(beats(ev('3c'), ev('3d')));
  assert.ok(beats(ev('2d'), ev('As')));
});

test('pairs and triples', () => {
  assert.equal(ev('3d 4d'), null);
  assert.ok(beats(ev('5c 5h'), ev('3d 3c'))); // slide example: pair of 5s beats pair of 3s
  assert.ok(beats(ev('5d 5s'), ev('5c 5h'))); // pair holding the spade wins
  assert.ok(beats(ev('4d 4c 4h'), ev('3c 3h 3s')));
  assert.equal(beats(ev('4d 4c'), ev('3c 3h 3s')), false); // different sizes never compare
});

test('no two pair, no bare four of a kind', () => {
  assert.equal(ev('3d 3c 4d 4c 5h'), null);
  assert.equal(ev('Qh Qs Qd Qc'), null);
  assert.equal(ev('Qh Qs Qd Qc 5d').cat, FIVE.FOUR_KIND);
});

test('five-card categories rank straight < flush < full house < quads < straight flush < royal', () => {
  const straight = ev('9c 10h Jd Qs Kh');
  const flush = ev('Ad Jd 8d 5d 7d');
  const full = ev('Kc Kh Ks 10c 10s');
  const quads = ev('8c Ad Ac As Ah');
  const sf = ev('5s 6s 7s 8s 9s');
  const royal = ev('10h Jh Qh Kh Ah');
  assert.deepEqual([straight, flush, full, quads, sf, royal].map(c => c.cat), [1, 2, 3, 4, 5, 6]);
  const order = [straight, flush, full, quads, sf, royal];
  for (let i = 1; i < order.length; i++) assert.ok(beats(order[i], order[i - 1]));
});

test('straights: top card decides, then its suit; A-2-3-4-5 is lowest, 10-J-Q-K-A highest, no wrap', () => {
  assert.ok(beats(ev('8c 9h 10d Jc Qd'), ev('7c 8h 9d 10c Js')));
  assert.ok(beats(ev('8c 9h 10d Jc Qs'), ev('8d 9c 10h Js Qh')));
  assert.equal(ev('Ad 2c 3h 4s 5d').cat, FIVE.STRAIGHT);
  assert.ok(beats(ev('2c 3h 4s 5d 6d'), ev('Ad 2c 3h 4s 5s')));
  assert.ok(beats(ev('10c Jh Qs Kd Ad'), ev('9c 10h Jd Qs Ks')));
  assert.equal(ev('Jc Qh Ks Ad 2d'), null);
});

test('flushes: higher suit first, then higher top card', () => {
  assert.ok(beats(ev('3c 5c 7c 9c Jc'), ev('Ad Kd Jd 8d 5d'))); // clubs flush beats diamonds flush
  assert.ok(beats(ev('Ad Jd 8d 5d 7d'), ev('Kd Qd 8d 5d 7d')));
  assert.ok(beats(ev('2d 4d 6d 8d 10d'), ev('Ad Kd Jd 9d 7d'))); // 2 is the high card
});

test('full house / four of a kind rank by the big group', () => {
  assert.ok(beats(ev('Kc Kh Ks 10c 10s'), ev('8s 8d 8c Kc Kd')));
  assert.ok(beats(ev('Ac Ad Ah As 8c'), ev('Qc Qd Qh Qs 5d')));
});

test('straight flushes: suit first, then rank; royal flush of spades is the top hand', () => {
  assert.ok(beats(ev('5s 6s 7s 8s 9s'), ev('9h 10h Jh Qh Kh')));
  assert.ok(beats(ev('9s 10s Js Qs Ks'), ev('5s 6s 7s 8s 9s')));
  assert.ok(beats(ev('10s Js Qs Ks As'), ev('10h Jh Qh Kh Ah')));
  assert.ok(beats(ev('10h Jh Qh Kh Ah'), ev('9s 10s Js Qs Ks')));
});

test('first play must contain the 3♦', () => {
  assert.equal(checkPlay(H('3c'), null, true).ok, false);
  assert.equal(checkPlay(H('3d 3c'), null, true).ok, true);
  assert.equal(checkPlay(H('4c 4d'), ev('3d 3c'), false).ok, true);
  assert.equal(checkPlay(H('4c'), ev('3d 3c'), false).ok, false);
});

test('scoring from the slides', () => {
  assert.equal(penalty(0, true), 0);
  assert.equal(penalty(5, true), 5);
  assert.equal(penalty(8, true), 8);
  assert.equal(penalty(9, true), 18);
  assert.equal(penalty(12, true), 24);
  assert.equal(penalty(13, false), 39);
});

function seeded(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function autoplay(players, endMode, seed) {
  const rand = seeded(seed);
  const s = newGame({ players, endMode, rounds: 5, points: 50 }, rand);
  let guard = 0;
  while (s.phase !== 'gameEnd') {
    if (s.phase === 'roundEnd') {
      const total = s.players.reduce((a, p) => a + p.hand.length, 0);
      assert.ok(total > 0);
      startRound(s, rand);
      continue;
    }
    if (s.firstPlay && s.trick.length === 0) {
      const all = s.players.flatMap(p => p.hand);
      assert.equal(all.length, 52, 'every card dealt');
      assert.equal(new Set(all).size, 52);
    }
    const move = chooseMove(s, s.turn, rand);
    if (move) play(s, s.turn, move); else pass(s, s.turn);
    assert.ok(++guard < 20000, 'game terminates');
  }
  return s;
}

test('bots finish full 4-player and 3-player games without illegal moves', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const s4 = autoplay(4, 'rounds', seed);
    assert.equal(s4.round, 5);
    assert.ok(s4.players.every(p => p.history.length === 5));
    const s3 = autoplay(3, 'points', seed);
    assert.ok(s3.players.some(p => p.total >= 50));
    assert.equal(standings(s3).length, 3);
  }
});
