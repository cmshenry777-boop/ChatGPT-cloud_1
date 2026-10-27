// Game state machine. The state is a plain JSON object so it can be saved to
// localStorage and restored when the phone reloads the page.

import { newDeck, shuffle, sortByRank, evaluate, checkPlay, penalty, THREE_OF_DIAMONDS } from './rules.js';

// Placeholder names, so they never clash with the real people at the table.
export const BOT_NAMES = ['철수', '영희', '길동'];

export function newGame(settings, rand = Math.random) {
  const n = settings.players === 3 ? 3 : 4;
  const players = [{ name: '나', human: true }];
  for (let i = 1; i < n; i++) players.push({ name: BOT_NAMES[i - 1], human: false });
  const state = {
    settings: { ...settings, players: n },
    round: 0,
    players: players.map(p => ({ ...p, hand: [], playedAny: false, total: 0, history: [] })),
    phase: 'play',
  };
  startRound(state, rand);
  return state;
}

export function startRound(state, rand = Math.random) {
  const n = state.players.length;
  const deck = shuffle(newDeck(), rand);
  const per = n === 4 ? 13 : 17;
  state.players.forEach((p, i) => {
    p.hand = sortByRank(deck.slice(i * per, (i + 1) * per));
    p.playedAny = false;
  });
  // 3 players: 17 cards each and one card left over, dealt face up. The player
  // holding the 3♦ takes it; if the leftover *is* the 3♦, the 3♣ holder takes it.
  state.leftover = null;
  if (n === 3) {
    const extra = deck[51];
    state.leftover = extra;
    const target = extra === THREE_OF_DIAMONDS ? 1 /* 3♣ */ : THREE_OF_DIAMONDS;
    const taker = state.players.find(p => p.hand.includes(target));
    taker.hand = sortByRank([...taker.hand, extra]);
    state.leftoverTaker = state.players.indexOf(taker);
  }
  state.round += 1;
  state.turn = state.players.findIndex(p => p.hand.includes(THREE_OF_DIAMONDS));
  state.lead = null; // { player, cards } – the hand to beat in this trick
  state.passes = 0; // consecutive passes since the lead was played
  state.firstPlay = true; // the opening play must include the 3♦
  state.trick = []; // [{ player, cards|null }] everything that happened in this trick
  state.log = []; // the whole round: [{ player, cards|null }] and { won: player } at each trick end
  state.phase = 'play';
  state.roundResult = null;
  return state;
}

export const leadCombo = state => (state.lead ? evaluate(state.lead.cards) : null);
export const nextPlayer = (state, p) => (p + 1) % state.players.length; // clockwise

export function canPass(state, p) {
  return state.phase === 'play' && state.turn === p && state.lead !== null;
}

export function play(state, p, cards) {
  if (state.phase !== 'play' || state.turn !== p) throw new Error('not your turn');
  const hand = state.players[p].hand;
  if (!cards.length || !cards.every(c => hand.includes(c)) || new Set(cards).size !== cards.length) {
    throw new Error('cards not in hand');
  }
  const res = checkPlay(cards, leadCombo(state), state.firstPlay);
  if (!res.ok) throw new Error(res.reason);

  const player = state.players[p];
  player.hand = hand.filter(c => !cards.includes(c));
  player.playedAny = true;
  state.firstPlay = false;
  state.lead = { player: p, cards: sortByRank(cards) };
  state.passes = 0;
  state.trick.push({ player: p, cards: sortByRank(cards) });
  state.log.push({ player: p, cards: sortByRank(cards) });

  if (player.hand.length === 0) {
    endRound(state, p);
    return;
  }
  state.turn = nextPlayer(state, p);
}

export function pass(state, p) {
  if (!canPass(state, p)) throw new Error('cannot pass now');
  state.passes += 1;
  state.trick.push({ player: p, cards: null });
  state.log.push({ player: p, cards: null });
  // Everyone else passed → whoever played last wins the trick and leads anything.
  if (state.passes >= state.players.length - 1) {
    state.turn = state.lead.player;
    state.log.push({ won: state.turn });
    state.lead = null;
    state.passes = 0;
    state.trick = [];
    return { trickWonBy: state.turn };
  }
  state.turn = nextPlayer(state, p);
  return null;
}

function endRound(state, winner) {
  const scores = state.players.map(pl => penalty(pl.hand.length, pl.playedAny));
  state.players.forEach((pl, i) => {
    pl.total += scores[i];
    pl.history.push(scores[i]);
  });
  state.roundResult = {
    winner,
    scores,
    hands: state.players.map(pl => pl.hand.slice()),
  };
  const s = state.settings;
  const over = s.endMode === 'points'
    ? state.players.some(pl => pl.total >= s.points)
    : state.round >= s.rounds;
  state.phase = over ? 'gameEnd' : 'roundEnd';
}

// Lowest total wins. Returns player indices, best first.
export function standings(state) {
  return state.players.map((_, i) => i).sort((a, b) => state.players[a].total - state.players[b].total);
}
