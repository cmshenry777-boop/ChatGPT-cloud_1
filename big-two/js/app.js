// UI: renders the game for a portrait phone screen and paces the bots so a
// person can follow every play.

import { RANKS, SUITS, rankOf, suitOf, cardName, comboName, evaluate, checkPlay, allCombos, compareCombos, sortByRank } from './rules.js';
import { newGame, startRound, play, pass, leadCombo, standings, BOT_NAMES } from './game.js';
import { chooseMove } from './ai.js';
import { sfx, unlockAudio } from './sound.js';

const SAVE_KEY = 'bigtwo.save.v1';
const PREFS_KEY = 'bigtwo.prefs.v2';
const DEFAULT_PREFS = {
  players: 4, endMode: 'rounds', rounds: 5, points: 50,
  speed: 'normal', fourColor: false, sort: 'rank', sortDir: 1, vibrate: true, sound: true,
};
// How long a bot "thinks" before playing, and how long a finished trick stays on the table.
const BOT_DELAY = { slow: 2100, normal: 1400, fast: 800 };
const TRICK_PAUSE = { slow: 2000, normal: 1600, fast: 1000 };
const ROUND_END_PAUSE = 2200;

const $ = sel => document.querySelector(sel);

const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } },
};

let prefs = { ...DEFAULT_PREFS, ...(store.get(PREFS_KEY) || {}) };
let state = store.get(SAVE_KEY);
if (!state || !Array.isArray(state.players) || !Array.isArray(state.log)) state = newGame(prefs);
state.players.forEach((p, i) => { if (i > 0) p.name = BOT_NAMES[i - 1]; });

const selected = new Set();
let trickEnd = null; // { trick, winner } – a finished trick kept on the table for a moment
let hints = null; // legal plays for the hint button, cycled on each press
let hintIndex = 0;
let timer = null;
let dealing = true; // animate the hand being dealt on the next render
let floats = null; // "+N" points shown on each seat after a round

// ── Korean helpers ──────────────────────────────────────

const hasBatchim = word => {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0;
};
const nameOf = i => (i === 0 ? '나' : state.players[i].name);
// "영희가" / "철수가" / "길동이" / "내가"
const subj = i => (i === 0 ? '내가' : nameOf(i) + (hasBatchim(nameOf(i)) ? '이' : '가'));

// Browsers ignore vibrate() before the first tap, and log a warning for it.
const buzz = ms => { if (prefs.vibrate && navigator.userActivation?.hasBeenActive) navigator.vibrate?.(ms); };
const sound = (name, arg) => { if (prefs.sound) sfx(name, arg); };
const delay = table => table[prefs.speed] || table.normal;

// ── card elements ───────────────────────────────────────

const suitSvg = (s, cls) => `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true"><use href="#suit-${SUITS[s]}"/></svg>`;

function cardEl(id) {
  const r = RANKS[rankOf(id)];
  const s = suitOf(id);
  const el = document.createElement('div');
  el.className = `card suit-${SUITS[s]}`;
  el.dataset.id = id;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', cardName(id));
  el.innerHTML = `<span class="idx"><b class="rk${r === '10' ? ' ten' : ''}">${r}</b>${suitSvg(s, 'is')}</span>`
    + `<span class="pip">${suitSvg(s, 'ps')}</span>`;
  return el;
}

const chip = id => `<span class="chip suit-${SUITS[suitOf(id)]}">${RANKS[rankOf(id)]}${suitSvg(suitOf(id), '')}</span>`;

// ── what is on the table ────────────────────────────────

const myTurn = () => state.phase === 'play' && state.turn === 0 && !trickEnd;

// A player's latest action in the current trick. Like the original game, it
// stays in front of them until their next turn comes around.
function groundOf(i) {
  const trick = trickEnd ? trickEnd.trick : state.trick;
  if (!trickEnd && state.phase === 'play' && state.turn === i) return null;
  for (let k = trick.length - 1; k >= 0; k--) if (trick[k].player === i) return trick[k];
  return null;
}

function highPlayer() {
  if (trickEnd) return trickEnd.winner;
  return state.lead ? state.lead.player : -1;
}

// ── rendering ───────────────────────────────────────────

function render() {
  document.body.classList.toggle('four', prefs.fourColor);
  const s = state.settings;
  $('#round-label').textContent = s.endMode === 'points'
    ? `라운드 ${state.round} · ${s.points}점 종료`
    : `라운드 ${state.round} / ${s.rounds}`;
  $('#btn-sound').innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-${prefs.sound ? 'sound' : 'mute'}"/></svg>`;
  $('#btn-sound').setAttribute('aria-label', prefs.sound ? '소리 끄기' : '소리 켜기');
  renderTable();
  renderHand();
  updateControls();
}

// Seats: clockwise from me, the next player sits on the left, then across, then right.
const SEAT_AREAS = { 4: ['me', 'left', 'top', 'right'], 3: ['me', 'left', 'right'] };

function renderTable() {
  const table = $('#table');
  const n = state.players.length;
  table.dataset.n = n;
  table.innerHTML = '';
  const high = highPlayer();

  state.players.forEach((p, i) => {
    const zone = document.createElement('div');
    const active = state.phase === 'play' && state.turn === i && !trickEnd;
    zone.className = `zone z-${SEAT_AREAS[n][i]}${active ? ' active' : ''}`;
    zone.style.gridArea = SEAT_AREAS[n][i];

    const warn = p.hand.length === 1 && state.phase === 'play';
    const info = document.createElement('div');
    info.className = 'who';
    info.innerHTML = i === 0
      ? `<span class="nm">나</span><span class="cnt">${p.hand.length}장</span><span class="pts">${p.total}점</span>`
      : `<span class="avatar">${p.name[0]}</span><span class="nm">${p.name}</span>`
        + `<span class="cnt${warn ? ' warn' : ''}"><i class="mini-back"></i>${p.hand.length}</span><span class="pts">${p.total}점</span>`;
    if (floats) info.insertAdjacentHTML('beforeend', `<span class="float">+${floats[i]}</span>`);

    const ground = document.createElement('div');
    ground.className = 'ground';
    const g = groundOf(i);
    let caption = '';
    if (active && i !== 0) {
      ground.innerHTML = '<span class="tag think">생각 중</span>';
    } else if (active) {
      ground.innerHTML = '<span class="tag mine">내 차례</span>';
    } else if (g && g.cards === null) {
      ground.innerHTML = '<span class="tag">패스</span>';
    } else if (g) {
      ground.classList.add(`n${g.cards.length}`);
      if (i === high) ground.classList.add('high');
      g.cards.forEach(c => ground.appendChild(cardEl(c)));
      caption = comboName(evaluate(g.cards));
    }
    const cap = document.createElement('div');
    cap.className = 'gcap';
    cap.textContent = caption;
    if (i === high && caption) cap.classList.add('high');

    if (i === 0) zone.append(ground, cap, info);
    else zone.append(info, ground, cap);
    table.appendChild(zone);
  });

  const center = document.createElement('div');
  center.className = 'center';
  center.style.gridArea = 'center';
  center.innerHTML = centerMessage();
  table.appendChild(center);
}

function centerMessage() {
  if (state.phase !== 'play') {
    const w = state.roundResult?.winner;
    return w === undefined ? '' : `<b>${subj(w)}</b><br>다 털었어요!`;
  }
  if (trickEnd) return `모두 패스<br><b>${subj(trickEnd.winner)}</b> 가져가요`;
  const lead = leadCombo(state);
  let html = '';
  if (state.firstPlay) {
    html = `<b>${subj(state.turn)}</b> 3♦로<br>시작해요`;
    if (state.leftover !== null && state.leftover !== undefined) {
      html += `<div class="small">남은 1장 ${chip(state.leftover)} → ${nameOf(state.leftoverTaker)}</div>`;
    }
  } else if (!lead) {
    html = `<b>${subj(state.turn)}</b><br>새로 시작해요`;
  } else {
    html = `<span class="small">이겨야 할 패</span><br><b>${lead.cards.length}장 ${comboName(lead)}</b>`;
  }
  html += '<button class="log-btn" id="btn-log">기록</button>';
  return html;
}

function myHandOrdered() {
  const hand = state.players[0].hand;
  const d = prefs.sortDir;
  const cmp = prefs.sort === 'suit'
    ? (a, b) => d * (suitOf(a) - suitOf(b) || a - b)
    : (a, b) => d * (a - b);
  return hand.slice().sort(cmp);
}

// Lays the hand out in one or two overlapping rows, as large as the box allows.
function renderHand() {
  const box = $('#hand');
  const hand = myHandOrdered();
  box.innerHTML = '';
  box.classList.toggle('waiting', !myTurn());
  for (const id of [...selected]) if (!hand.includes(id)) selected.delete(id);
  const n = hand.length;
  if (!n) return;

  // Measure the most room the hand may take, then shrink the box to what the
  // cards need so a one-row hand doesn't leave a gap above it.
  box.style.height = '';
  const W = box.clientWidth;
  const maxH = box.clientHeight;
  const lift = 18;
  const rows = n > 8 ? 2 : 1;
  const perRow = Math.ceil(n / rows);
  const rowOverlap = 0.56; // the second row covers the lower part of the first
  const rowsH = 1.4 + 1.4 * rowOverlap * (rows - 1);
  let cw = Math.min(W / 3.6, 120);
  cw = Math.min(cw, (maxH - lift - 4) / rowsH);
  const H = Math.ceil(lift + 4 + cw * rowsH);
  box.style.height = `${H}px`;
  const step = perRow > 1 ? Math.min(cw * 1.04, (W - cw) / (perRow - 1)) : 0;
  // Sit the cards at the bottom of the box, right above the buttons.
  const top0 = Math.max(lift, H - 4 - cw * 1.4 * (1 + rowOverlap * (rows - 1)));

  hand.forEach((id, k) => {
    const row = Math.floor(k / perRow);
    const col = k % perRow;
    const inRow = Math.min(perRow, n - row * perRow);
    const x0 = (W - (cw + step * (inRow - 1))) / 2;
    const el = cardEl(id);
    el.style.setProperty('--cw', `${cw}px`);
    el.style.left = `${x0 + col * step}px`;
    el.style.top = `${top0 + row * cw * 1.4 * rowOverlap}px`;
    el.style.zIndex = k + 1;
    if (dealing) {
      el.classList.add('deal');
      el.style.animationDelay = `${k * 45}ms`;
    }
    if (selected.has(id)) el.classList.add('sel');
    box.appendChild(el);
  });
  dealing = false;
}

function legalPlays() {
  const lead = leadCombo(state);
  return allCombos(state.players[0].hand).filter(c => checkPlay(c.cards, lead, state.firstPlay).ok);
}

function updateControls() {
  const mine = myTurn();
  const sel = [...selected];
  const lead = leadCombo(state);
  const res = sel.length ? checkPlay(sel, lead, state.firstPlay) : null;

  $('#btn-play').disabled = !(mine && res?.ok);
  $('#btn-pass').disabled = !(mine && lead);
  $('#btn-hint').disabled = !mine;
  $('#btn-pass').classList.remove('suggest');

  const rankBtn = $('#sort-rank');
  const suitBtn = $('#sort-suit');
  const arrow = prefs.sortDir === 1 ? '↑' : '↓';
  rankBtn.classList.toggle('on', prefs.sort === 'rank');
  suitBtn.classList.toggle('on', prefs.sort === 'suit');
  rankBtn.textContent = prefs.sort === 'rank' ? `숫자 ${arrow}` : '숫자';
  suitBtn.textContent = prefs.sort === 'suit' ? `무늬 ${arrow}` : '무늬';

  const status = $('#status');
  status.className = 'status';
  if (state.phase !== 'play') status.textContent = '';
  else if (!mine) status.textContent = sel.length ? `${sel.length}장 골라 둠` : trickEnd ? '' : `${nameOf(state.turn)} 차례…`;
  else if (!sel.length) {
    if (lead && !legalPlays().length) {
      status.textContent = '낼 수 있는 패가 없어요 → 패스';
      $('#btn-pass').classList.add('suggest');
    } else {
      status.textContent = state.firstPlay ? '3♦를 넣어서 내 주세요'
        : lead ? `${lead.cards.length}장 ${comboName(lead)}보다 센 패` : '아무 패로 시작하세요';
    }
  } else if (res.ok) {
    status.textContent = `${comboName(res.combo)} ✓`;
    status.classList.add('ok');
  } else {
    status.textContent = res.combo ? `${comboName(res.combo)} · ${res.reason}` : res.reason;
    status.classList.add('bad');
  }
}

// ── selecting cards: tap, or slide a finger across several ──

function toggle(id, on) {
  if (on) selected.add(id); else selected.delete(id);
  document.querySelector(`#hand .card[data-id="${id}"]`)?.classList.toggle('sel', on);
  hints = null;
  updateControls();
}

function clearSelection() {
  if (!selected.size) return;
  selected.clear();
  hints = null;
  renderHand();
  updateControls();
}

function bindHand() {
  const box = $('#hand');
  let paint = null;
  const cardAt = (x, y) => {
    const el = document.elementFromPoint(x, y)?.closest('.card');
    return el && box.contains(el) ? +el.dataset.id : null;
  };
  box.addEventListener('pointerdown', e => {
    const id = cardAt(e.clientX, e.clientY);
    if (id === null) return;
    paint = { on: !selected.has(id), seen: new Set([id]) };
    toggle(id, paint.on);
    sound('select');
    buzz(8);
    box.setPointerCapture(e.pointerId);
  });
  box.addEventListener('pointermove', e => {
    if (!paint) return;
    const id = cardAt(e.clientX, e.clientY);
    if (id !== null && !paint.seen.has(id)) {
      paint.seen.add(id);
      toggle(id, paint.on);
      sound('select');
    }
  });
  const end = () => { paint = null; };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
  $('#table').addEventListener('click', e => {
    if (e.target.closest('#btn-log')) showLog();
    else clearSelection();
  });
}

// ── turn flow ───────────────────────────────────────────

function save() { store.set(SAVE_KEY, state); }

function afterChange() {
  save();
  render();
  schedule();
}

function schedule() {
  clearTimeout(timer);
  if (state.phase !== 'play') {
    timer = setTimeout(showRoundEnd, ROUND_END_PAUSE);
  } else if (trickEnd) {
    // Leave the finished trick on the table long enough to read, then sweep it away.
    timer = setTimeout(() => {
      trickEnd = null;
      sound('sweep');
      render();
      schedule();
    }, delay(TRICK_PAUSE));
  } else if (state.turn !== 0) {
    timer = setTimeout(botTurn, delay(BOT_DELAY) + Math.random() * 400);
  } else {
    sound('turn');
    buzz(25);
  }
}

function doPlay(p, cards) {
  play(state, p, cards);
  sound('play', Math.min(cards.length, 5));
  if (state.phase !== 'play') {
    floats = state.roundResult.scores;
    setTimeout(() => sound(state.roundResult.winner === 0 ? 'win' : 'lose'), 500);
  }
}

function doPass(p) {
  const before = state.trick.slice();
  const lead = state.lead;
  const result = pass(state, p);
  sound('pass');
  if (result) trickEnd = { trick: [...before, { player: p, cards: null }], winner: lead.player };
}

function botTurn() {
  const p = state.turn;
  const move = chooseMove(state, p);
  if (move) doPlay(p, move); else doPass(p);
  afterChange();
}

function humanPlay() {
  if ($('#btn-play').disabled) return;
  doPlay(0, [...selected]);
  selected.clear();
  hints = null;
  afterChange();
}

function humanPass() {
  if ($('#btn-pass').disabled) return;
  selected.clear();
  hints = null;
  doPass(0);
  afterChange();
}

function hint() {
  if (!myTurn()) return;
  if (!hints) {
    const legal = legalPlays().sort((a, b) => a.cards.length - b.cards.length || compareCombos(a, b));
    // The bot's own pick goes first, then everything else that is legal.
    const pick = chooseMove(state, 0, () => 1);
    const key = cards => sortByRank(cards).join();
    hints = pick ? [evaluate(pick), ...legal.filter(c => key(c.cards) !== key(pick))] : legal;
    hintIndex = 0;
  }
  if (!hints.length) {
    toast('낼 수 있는 패가 없어요. 패스하세요');
    sound('error');
    return;
  }
  const h = hints[hintIndex % hints.length];
  hintIndex += 1;
  const keep = hints;
  selected.clear();
  h.cards.forEach(c => selected.add(c));
  renderHand();
  hints = keep;
  updateControls();
  if (hints.length > 1) toast(`힌트 ${((hintIndex - 1) % hints.length) + 1} / ${hints.length}`, 900);
}

// Tap the active sort again to flip between ascending and descending.
function setSort(kind) {
  if (prefs.sort === kind) prefs.sortDir *= -1;
  else { prefs.sort = kind; prefs.sortDir = 1; }
  store.set(PREFS_KEY, prefs);
  renderHand();
  updateControls();
}

// ── sheets (round end, scores, log, menu, settings, rules) ──

function openSheet(html, bind) {
  $('#sheet-body').innerHTML = html;
  $('#overlay').hidden = false;
  $('.sheet').scrollTop = 0;
  bind?.($('#sheet-body'));
}
function closeSheet() { $('#overlay').hidden = true; }

function showRoundEnd() {
  const r = state.roundResult;
  if (!r) return;
  const over = state.phase === 'gameEnd';
  const rows = state.players.map((p, i) => `
    <tr class="${i === r.winner ? 'best' : ''}">
      <td>${nameOf(i)}${i === r.winner ? ' 🏆' : ''}
        ${r.hands[i].length ? `<div class="left-cards">${sortByRank(r.hands[i]).map(chip).join('')}</div>` : ''}</td>
      <td>${r.hands[i].length}장</td>
      <td>+${r.scores[i]}</td>
      <td>${p.total}</td>
    </tr>`).join('');
  const title = r.winner === 0 ? '🎉 라운드 승리!' : `${subj(r.winner)} 다 털었어요`;
  openSheet(`
    <h2>라운드 ${state.round} 결과 · ${title}</h2>
    <table>
      <thead><tr><th>플레이어</th><th>남은</th><th>벌점</th><th>합계</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="note">1~8장은 장당 1점, 9장 이상은 장당 2점, 한 장도 못 냈으면 장당 3점이에요.</p>
    <div class="btns">
      <button class="btn primary" id="next">${over ? '최종 결과 보기' : `라운드 ${state.round + 1} 시작`}</button>
      <button class="btn" id="see-log">이번 라운드 기록 보기</button>
    </div>`,
  body => {
    body.querySelector('#next').onclick = () => (over ? showGameEnd() : nextRound());
    body.querySelector('#see-log').onclick = () => showLog(showRoundEnd);
  });
}

function nextRound() {
  closeSheet();
  trickEnd = null;
  floats = null;
  selected.clear();
  startRound(state);
  dealing = true;
  sound('deal');
  afterChange();
}

function showGameEnd() {
  const order = standings(state);
  const medal = ['🥇', '🥈', '🥉', '4위'];
  const best = state.players[order[0]].total;
  const rows = order.map((i, k) => `<tr class="${state.players[i].total === best ? 'best' : ''}"><td>${medal[k]} ${nameOf(i)}</td><td>${state.players[i].total}점</td></tr>`).join('');
  const win = state.players[0].total === best;
  openSheet(`
    <h2>${win ? '🏆 최종 우승! 축하해요' : `${subj(order[0])} 우승했어요`}</h2>
    <table><tbody>${rows}</tbody></table>
    <p class="note">점수가 가장 낮은 사람이 이겨요.</p>
    <div class="btns">
      <button class="btn primary" id="again">새 게임</button>
      <button class="btn" id="sheet">라운드별 점수 보기</button>
    </div>`,
  body => {
    body.querySelector('#again').onclick = startNewGame;
    body.querySelector('#sheet').onclick = showScores;
  });
}

function showScores() {
  const ps = state.players;
  const rounds = Math.max(...ps.map(p => p.history.length));
  const best = Math.min(...ps.map(p => p.total));
  let body = '';
  for (let r = 0; r < rounds; r++) {
    body += `<tr><td>라운드 ${r + 1}</td>${ps.map(p => `<td>${p.history[r] === 0 ? '<b>승</b>' : p.history[r] ?? ''}</td>`).join('')}</tr>`;
  }
  openSheet(`
    <h2>점수표</h2>
    <table>
      <thead><tr><th></th>${ps.map((_, i) => `<th>${nameOf(i)}</th>`).join('')}</tr></thead>
      <tbody>${body || `<tr><td colspan="${ps.length + 1}">아직 끝난 라운드가 없어요</td></tr>`}</tbody>
      <tfoot><tr><td>합계</td>${ps.map(p => `<td class="${p.total === best && rounds ? 'lead' : ''}">${p.total}</td>`).join('')}</tr></tfoot>
    </table>
    <p class="note">${state.settings.endMode === 'points' ? `누군가 ${state.settings.points}점 이상이 되면 끝나요.` : `${state.settings.rounds}라운드가 끝나면 게임이 끝나요.`} 낮은 점수가 이겨요.</p>
    <div class="btns"><button class="btn" id="close">닫기</button></div>`,
  b => b.querySelector('#close').onclick = state.phase === 'gameEnd' ? showGameEnd : closeSheet);
}

function trickResult(t, isLast) {
  if (t.won !== undefined) return `<b>${subj(t.won)}</b> 가져감`;
  if (isLast && state.phase !== 'play') return `<b>${subj(state.roundResult.winner)}</b> 다 털어서 라운드 끝`;
  return '진행 중';
}

// Everything played this round, newest first, one trick per block.
function showLog(back) {
  const tricks = [[]];
  for (const e of state.log) {
    if ('won' in e) { tricks[tricks.length - 1].won = e.won; tricks.push([]); } else tricks[tricks.length - 1].push(e);
  }
  if (!tricks[tricks.length - 1].length) tricks.pop();
  const html = tricks.map((t, k) => `
    <div class="trick">
      <div class="trick-head">${k + 1}번째 판 · ${trickResult(t, k === tricks.length - 1)}</div>
      ${t.map(e => `<div class="log-row"><span class="log-name">${nameOf(e.player)}</span>${e.cards
        ? `<span class="log-cards">${e.cards.map(chip).join('')}</span><span class="log-combo">${comboName(evaluate(e.cards))}</span>`
        : '<span class="log-pass">패스</span>'}</div>`).join('')}
    </div>`).reverse().join('');
  openSheet(`
    <h2>라운드 ${state.round} 기록</h2>
    ${html || '<p>아직 아무도 내지 않았어요.</p>'}
    <div class="btns"><button class="btn" id="log-close">닫기</button></div>`,
  b => b.querySelector('#log-close').onclick = back || closeSheet);
}

function showMenu() {
  openSheet(`
    <h2>메뉴</h2>
    <div class="btns">
      <button class="btn" id="m-log">이번 라운드 기록</button>
      <button class="btn" id="m-rules">규칙 보기</button>
      <button class="btn" id="m-settings">설정</button>
      <button class="btn" id="m-full">전체 화면</button>
      <button class="btn danger" id="m-new">새 게임 시작</button>
      <button class="btn" id="m-close">닫기</button>
    </div>`,
  b => {
    b.querySelector('#m-log').onclick = () => showLog();
    b.querySelector('#m-rules').onclick = showRules;
    b.querySelector('#m-settings').onclick = showSettings;
    b.querySelector('#m-full').onclick = () => { document.documentElement.requestFullscreen?.().catch(() => {}); closeSheet(); };
    b.querySelector('#m-new').onclick = confirmNewGame;
    b.querySelector('#m-close').onclick = closeSheet;
  });
}

function confirmNewGame() {
  openSheet(`
    <h2>새 게임을 시작할까요?</h2>
    <p>지금 게임은 저장되지 않고 사라져요.</p>
    <div class="btns">
      <button class="btn primary" id="c-yes">새 게임 시작</button>
      <button class="btn" id="c-no">계속하기</button>
    </div>`,
  b => {
    b.querySelector('#c-yes').onclick = startNewGame;
    b.querySelector('#c-no').onclick = closeSheet;
  });
}

function startNewGame() {
  closeSheet();
  trickEnd = null;
  floats = null;
  selected.clear();
  state = newGame(prefs);
  dealing = true;
  sound('deal');
  afterChange();
}

function seg(key, options) {
  return `<div class="seg" data-key="${key}">${options.map(([v, label]) =>
    `<button data-v="${v}" class="${String(prefs[key]) === String(v) ? 'on' : ''}">${label}</button>`).join('')}</div>`;
}

function showSettings() {
  openSheet(`
    <h2>설정</h2>
    <div class="row-label">봇 속도</div>${seg('speed', [['slow', '느리게'], ['normal', '보통'], ['fast', '빠르게']])}
    <div class="row-label">소리</div>${seg('sound', [[true, '켜기'], [false, '끄기']])}
    <div class="row-label">진동</div>${seg('vibrate', [[true, '켜기'], [false, '끄기']])}
    <div class="row-label">카드 색</div>${seg('fourColor', [[false, '2색 (기본)'], [true, '4색 (♦파랑 ♣초록)']])}
    <div class="row-label">인원</div>${seg('players', [[4, '4명 (13장)'], [3, '3명 (17장)']])}
    <div class="row-label">게임 끝나는 조건</div>${seg('endMode', [['rounds', '라운드 수'], ['points', '점수 도달']])}
    <div class="row-label">라운드 수</div>${seg('rounds', [[3, '3'], [5, '5'], [10, '10']])}
    <div class="row-label">종료 점수</div>${seg('points', [[30, '30점'], [50, '50점'], [100, '100점']])}
    <p class="note">인원과 종료 조건은 새 게임부터 적용돼요.</p>
    <div class="btns">
      <button class="btn primary" id="s-new">이 설정으로 새 게임</button>
      <button class="btn" id="s-close">닫기</button>
    </div>`,
  b => {
    b.querySelectorAll('.seg').forEach(group => group.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const key = group.dataset.key;
      const raw = btn.dataset.v;
      prefs[key] = raw === 'true' ? true : raw === 'false' ? false : /^\d+$/.test(raw) ? +raw : raw;
      store.set(PREFS_KEY, prefs);
      group.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === btn));
      render();
    }));
    b.querySelector('#s-new').onclick = confirmNewGame;
    b.querySelector('#s-close').onclick = closeSheet;
  });
}

function showRules() {
  openSheet(`
    <h2>빅투 규칙</h2>
    <h3>목표</h3>
    <p>내 카드를 가장 먼저 다 털면 라운드 승리. 남은 카드만큼 벌점을 받고, <b>점수가 가장 낮은 사람</b>이 최종 우승이에요.</p>
    <h3>카드 순서</h3>
    <p>3 &lt; 4 &lt; … &lt; K &lt; A &lt; <b>2</b> · 무늬는 ♦ &lt; ♣ &lt; ♥ &lt; ♠<br>제일 약한 카드는 3♦, 제일 센 카드는 2♠.</p>
    <h3>진행</h3>
    <ul>
      <li>3♦를 가진 사람이 먼저, <b>3♦를 포함한</b> 패로 시작해요. 그다음 시계 방향(나 → 왼쪽 → 맞은편 → 오른쪽).</li>
      <li>뒤 사람은 <b>같은 장수</b>로 더 센 패만 낼 수 있어요. 숫자가 같으면 무늬로 비교.</li>
      <li>언제든 패스할 수 있어요. 나머지가 모두 패스하면 마지막에 낸 사람이 아무 패로 새로 시작해요.</li>
    </ul>
    <h3>낼 수 있는 패</h3>
    <ul>
      <li>싱글 · 페어 · 트리플</li>
      <li>5장 패 (약 → 강): 스트레이트 &lt; 플러시 &lt; 풀하우스 &lt; 포카드(+1장) &lt; 스트레이트 플러시 &lt; 로열 플러시</li>
      <li>5장 패끼리는 족보가 높으면 이겨요. 투페어는 없고, 포카드는 반드시 1장을 붙여야 해요.</li>
      <li>스트레이트: 맨 위 카드로 비교 (A-2-3-4-5가 가장 낮고 10-J-Q-K-A가 가장 높음, J-Q-K-A-2처럼 넘어가는 건 안 돼요)</li>
      <li>플러시·스트레이트 플러시: 무늬가 높은 쪽이 먼저 이기고, 같은 무늬면 높은 카드로 비교</li>
    </ul>
    <h3>점수 (벌점)</h3>
    <ul>
      <li>남은 카드 1~8장: 장당 1점</li>
      <li>9장 이상: 장당 2점</li>
      <li>한 장도 못 냈으면: 장당 3점 (13장 → 39점)</li>
    </ul>
    <h3>3명일 때</h3>
    <p>17장씩 받고 남은 1장은 3♦를 가진 사람이 가져가요. 남은 카드가 3♦라면 3♣를 가진 사람이 가져가고 먼저 시작해요.</p>
    <h3>화면 보는 법</h3>
    <p>각자 낸 카드는 자기 자리 앞에 놓이고, <b>자기 차례가 다시 올 때까지</b> 남아 있어요. 지금 이겨야 하는 패는 금색으로 표시돼요. 가운데 <b>기록</b>을 누르면 이번 라운드에 누가 뭘 냈는지 전부 볼 수 있어요.</p>
    <h3>조작</h3>
    <p>카드를 탭하거나 손가락으로 쓸어서 여러 장을 고르고 <b>내기</b>. 테이블을 탭하면 선택이 풀려요. <b>숫자·무늬</b> 버튼으로 정렬하고, 같은 버튼을 한 번 더 누르면 오름차순/내림차순이 바뀌어요. <b>힌트</b>를 누를 때마다 낼 수 있는 패를 하나씩 골라 줘요.</p>
    <div class="btns"><button class="btn" id="r-close">닫기</button></div>`,
  b => b.querySelector('#r-close').onclick = closeSheet);
}

let toastTimer = null;
function toast(text, ms = 1800) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// ── boot ────────────────────────────────────────────────

$('#btn-play').addEventListener('click', humanPlay);
$('#btn-pass').addEventListener('click', humanPass);
$('#btn-hint').addEventListener('click', hint);
$('#sort-rank').addEventListener('click', () => setSort('rank'));
$('#sort-suit').addEventListener('click', () => setSort('suit'));
$('#btn-menu').addEventListener('click', showMenu);
$('#btn-score').addEventListener('click', showScores);
$('#btn-sound').addEventListener('click', () => {
  prefs.sound = !prefs.sound;
  store.set(PREFS_KEY, prefs);
  render();
  toast(prefs.sound ? '소리 켬' : '소리 끔', 800);
});
$('#overlay').addEventListener('click', e => {
  // Tapping the dimmed area closes plain sheets, but not the round-end one.
  if (e.target.id === 'overlay' && state.phase === 'play') closeSheet();
});
document.addEventListener('pointerdown', unlockAudio, { capture: true });
bindHand();
window.addEventListener('resize', () => renderHand());

render();
if (state.phase === 'play') schedule();
else showRoundEnd();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
