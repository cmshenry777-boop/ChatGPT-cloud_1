// UI: renders the game state for a portrait phone screen and drives the bots.

import { RANKS, SUITS, rankOf, suitOf, cardName, comboName, evaluate, checkPlay, allCombos, compareCombos, sortByRank, sortBySuit } from './rules.js';
import { newGame, startRound, play, pass, leadCombo, standings } from './game.js';
import { chooseMove } from './ai.js';

const SAVE_KEY = 'bigtwo.save.v1';
const PREFS_KEY = 'bigtwo.prefs.v1';
const DEFAULT_PREFS = { players: 4, endMode: 'rounds', rounds: 5, points: 50, speed: 'normal', fourColor: false, sort: 'rank', vibrate: true };
const BOT_DELAY = { slow: 1500, normal: 900, fast: 420 };

const $ = sel => document.querySelector(sel);

const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } },
};

let prefs = { ...DEFAULT_PREFS, ...(store.get(PREFS_KEY) || {}) };
let state = store.get(SAVE_KEY);
if (!state || !Array.isArray(state.players)) state = newGame(prefs);

const selected = new Set();
let ghost = null; // the trick just won, shown faded until the next play: { player, cards }
let hints = null; // legal plays for the hint button, cycled on each press
let hintIndex = 0;
let botTimer = null;

// ── Korean helpers ──────────────────────────────────────

const hasBatchim = word => {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0;
};
const nameOf = i => state.players[i].name;
// "민지가" / "도윤이" / "내가"
const subj = i => (i === 0 ? '내가' : nameOf(i) + (hasBatchim(nameOf(i)) ? '이' : '가'));
// Browsers ignore vibrate() before the first tap, and log a warning for it.
const buzz = ms => { if (prefs.vibrate && navigator.userActivation?.hasBeenActive) navigator.vibrate?.(ms); };
const turnLabel = i => (i === 0 ? '내 차례' : `${nameOf(i)} 차례`);

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

// ── rendering ───────────────────────────────────────────

function render() {
  document.body.classList.toggle('four', prefs.fourColor);
  const s = state.settings;
  $('#round-label').textContent = s.endMode === 'points'
    ? `라운드 ${state.round} · ${s.points}점 종료`
    : `라운드 ${state.round} / ${s.rounds}`;
  renderSeats();
  renderTable();
  renderHand();
  updateControls();
}

function lastAction(i) {
  for (let k = state.trick.length - 1; k >= 0; k--) if (state.trick[k].player === i) return state.trick[k];
  return null;
}

function renderSeats() {
  const box = $('#seats');
  box.dataset.n = state.players.length;
  box.innerHTML = '';
  // Clockwise from me: the next player sits on the left, then across, then right.
  for (let i = 1; i < state.players.length; i++) {
    const p = state.players[i];
    const active = state.phase === 'play' && state.turn === i;
    const passed = lastAction(i)?.cards === null;
    const el = document.createElement('div');
    el.className = `seat${active ? ' active' : ''}${p.hand.length === 1 ? ' one' : ''}`;
    el.innerHTML = `
      <div class="seat-head"><span class="avatar">${p.name[0]}</span><span class="seat-name">${p.name}</span></div>
      <div class="seat-count"><span class="mini-back"></span><b>${p.hand.length}</b>장</div>
      <div class="seat-score">${p.total}점</div>
      ${p.hand.length === 1 && state.phase === 'play' ? '<span class="bubble warn">1장!</span>' : ''}
      ${active ? '<span class="bubble think"></span>' : passed ? '<span class="bubble">패스</span>' : ''}`;
    box.appendChild(el);
  }
}

function renderTable() {
  const cardsBox = $('#trick-cards');
  const caption = $('#trick-caption');
  const msg = $('#table-msg');
  cardsBox.innerHTML = '';
  cardsBox.classList.remove('ghost');
  msg.textContent = '';

  if (state.lead) {
    const combo = evaluate(state.lead.cards);
    state.lead.cards.forEach(c => cardsBox.appendChild(cardEl(c)));
    caption.innerHTML = `<b>${state.lead.player === 0 ? '나' : nameOf(state.lead.player)}</b> · ${comboName(combo)}`;
    if (state.phase === 'play') {
      const passes = state.trick.filter(t => t.cards === null && t.player !== state.lead.player).length;
      msg.textContent = passes ? `패스 ${passes}명 · ${turnLabel(state.turn)}` : turnLabel(state.turn);
    }
    return;
  }

  if (ghost) {
    ghost.cards.forEach(c => cardsBox.appendChild(cardEl(c)));
    cardsBox.classList.add('ghost');
    caption.innerHTML = `모두 패스 → <b>${subj(ghost.player)}</b> 새로 시작`;
  } else if (state.firstPlay) {
    caption.innerHTML = `3♦를 가진 <b>${subj(state.turn)}</b> 먼저 시작해요`;
    if (state.leftover !== null && state.leftover !== undefined) {
      msg.innerHTML = `남은 1장 ${chip(state.leftover)} → ${state.leftoverTaker === 0 ? '내 패로' : nameOf(state.leftoverTaker) + '에게'}`;
    }
  } else {
    caption.innerHTML = `<b>${subj(state.turn)}</b> 새로 시작해요`;
  }
}

function myHandOrdered() {
  const hand = state.players[0].hand;
  return prefs.sort === 'suit' ? sortBySuit(hand) : sortByRank(hand);
}

// Lays the hand out in one or two overlapping rows, as large as the box allows.
function renderHand() {
  const box = $('#hand');
  const hand = myHandOrdered();
  box.innerHTML = '';
  box.classList.toggle('waiting', !(state.phase === 'play' && state.turn === 0));
  for (const id of [...selected]) if (!hand.includes(id)) selected.delete(id);
  const n = hand.length;
  if (!n) return;

  const W = box.clientWidth;
  const H = box.clientHeight;
  const lift = 18;
  const rows = n > 8 ? 2 : 1;
  const perRow = Math.ceil(n / rows);
  const rowOverlap = 0.56; // the second row covers the lower part of the first
  let cw = Math.min(W / 3.6, 120);
  cw = Math.min(cw, (H - lift - 4) / (1.4 + 1.4 * rowOverlap * (rows - 1)));
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
    if (selected.has(id)) el.classList.add('sel');
    box.appendChild(el);
  });
}

function updateControls() {
  const myTurn = state.phase === 'play' && state.turn === 0;
  const me = state.players[0];
  const sel = [...selected];
  const lead = leadCombo(state);
  const res = sel.length ? checkPlay(sel, lead, state.firstPlay) : null;

  $('#btn-play').disabled = !(myTurn && res?.ok);
  $('#btn-pass').disabled = !(myTurn && lead);
  $('#btn-hint').disabled = !myTurn;
  $('#me-label').textContent = `나 · ${me.hand.length}장 · ${me.total}점`;

  const status = $('#status');
  status.classList.remove('bad');
  if (state.phase !== 'play') status.textContent = '';
  else if (!myTurn) status.textContent = sel.length ? `${sel.length}장 선택됨` : '';
  else if (!sel.length) {
    status.textContent = state.firstPlay ? '3♦를 넣어서 내 주세요'
      : lead ? `${lead.cards.length}장으로 이겨 보세요` : '아무 패로 시작하세요';
  } else if (res.ok) status.textContent = `${comboName(res.combo)} ✓`;
  else {
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
    buzz(8);
    box.setPointerCapture(e.pointerId);
  });
  box.addEventListener('pointermove', e => {
    if (!paint) return;
    const id = cardAt(e.clientX, e.clientY);
    if (id !== null && !paint.seen.has(id)) {
      paint.seen.add(id);
      toggle(id, paint.on);
    }
  });
  const end = () => { paint = null; };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
  // Tapping the table clears the selection.
  document.querySelector('.table').addEventListener('click', () => {
    if (!selected.size) return;
    selected.clear();
    hints = null;
    renderHand();
    updateControls();
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
  clearTimeout(botTimer);
  if (state.phase === 'play' && state.turn !== 0) {
    botTimer = setTimeout(botTurn, BOT_DELAY[prefs.speed] || BOT_DELAY.normal);
  } else if (state.phase === 'play') {
    buzz(25);
  } else {
    botTimer = setTimeout(showRoundEnd, 1100);
  }
}

function doPass(p) {
  const lead = state.lead;
  const result = pass(state, p);
  if (result) ghost = { player: lead.player, cards: lead.cards };
}

function botTurn() {
  const p = state.turn;
  const move = chooseMove(state, p);
  if (move) {
    ghost = null;
    play(state, p, move);
  } else {
    doPass(p);
  }
  afterChange();
}

function humanPlay() {
  if ($('#btn-play').disabled) return;
  ghost = null;
  play(state, 0, [...selected]);
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
  if (!(state.phase === 'play' && state.turn === 0)) return;
  if (!hints) {
    const lead = leadCombo(state);
    const legal = allCombos(state.players[0].hand)
      .filter(c => checkPlay(c.cards, lead, state.firstPlay).ok)
      .sort((a, b) => a.cards.length - b.cards.length || compareCombos(a, b));
    // The bot's own pick goes first, then everything else that is legal.
    const pick = chooseMove(state, 0, () => 1);
    const key = cards => sortByRank(cards).join();
    hints = pick ? [evaluate(pick), ...legal.filter(c => key(c.cards) !== key(pick))] : legal;
    hintIndex = 0;
  }
  if (!hints.length) {
    toast('낼 수 있는 패가 없어요. 패스하세요');
    return;
  }
  const h = hints[hintIndex % hints.length];
  hintIndex += 1;
  selected.clear();
  h.cards.forEach(c => selected.add(c));
  renderHand();
  updateControls();
  if (hints.length > 1) toast(`힌트 ${((hintIndex - 1) % hints.length) + 1} / ${hints.length}`, 1000);
}

function toggleSort() {
  prefs.sort = prefs.sort === 'rank' ? 'suit' : 'rank';
  store.set(PREFS_KEY, prefs);
  renderHand();
  toast(prefs.sort === 'rank' ? '숫자순 정렬' : '무늬순 정렬', 900);
}

// ── sheets (round end, scores, menu, settings, rules) ───

function openSheet(html, bind) {
  $('#sheet-body').innerHTML = html;
  $('#overlay').hidden = false;
  bind?.($('#sheet-body'));
}
function closeSheet() { $('#overlay').hidden = true; }

function showRoundEnd() {
  const r = state.roundResult;
  if (!r) return;
  const over = state.phase === 'gameEnd';
  const rows = state.players.map((p, i) => `
    <tr class="${i === r.winner ? 'best' : ''}">
      <td>${p.name}${i === r.winner ? ' 🏆' : ''}
        ${r.hands[i].length ? `<div class="left-cards">${sortByRank(r.hands[i]).map(chip).join('')}</div>` : ''}</td>
      <td>${r.hands[i].length}장</td>
      <td>+${r.scores[i]}</td>
      <td>${p.total}</td>
    </tr>`).join('');
  const title = r.winner === 0 ? '🎉 라운드 승리!' : `${subj(r.winner)} 다 털었어요`;
  openSheet(`
    <h2>${title}</h2>
    <table>
      <thead><tr><th>플레이어</th><th>남은</th><th>벌점</th><th>합계</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="note">1~8장은 장당 1점, 9장 이상은 장당 2점, 한 장도 못 냈으면 장당 3점이에요.</p>
    <div class="btns"><button class="btn primary" id="next">${over ? '최종 결과 보기' : `라운드 ${state.round + 1} 시작`}</button></div>`,
  body => body.querySelector('#next').onclick = () => (over ? showGameEnd() : nextRound()));
}

function nextRound() {
  closeSheet();
  ghost = null;
  selected.clear();
  startRound(state);
  afterChange();
}

function showGameEnd() {
  const order = standings(state);
  const medal = ['🥇', '🥈', '🥉', '4위'];
  const rows = order.map((i, k) => `<tr class="${k === 0 ? 'best' : ''}"><td>${medal[k]} ${state.players[i].name}</td><td>${state.players[i].total}점</td></tr>`).join('');
  const win = order[0] === 0;
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
      <thead><tr><th></th>${ps.map(p => `<th>${p.name}</th>`).join('')}</tr></thead>
      <tbody>${body || `<tr><td colspan="${ps.length + 1}">아직 끝난 라운드가 없어요</td></tr>`}</tbody>
      <tfoot><tr><td>합계</td>${ps.map(p => `<td style="color:${p.total === best && rounds ? 'var(--felt)' : 'inherit'}">${p.total}</td>`).join('')}</tr></tfoot>
    </table>
    <p class="note">${state.settings.endMode === 'points' ? `누군가 ${state.settings.points}점 이상이 되면 끝나요.` : `${state.settings.rounds}라운드가 끝나면 게임이 끝나요.`} 낮은 점수가 이겨요.</p>
    <div class="btns"><button class="btn" id="close">닫기</button></div>`,
  b => b.querySelector('#close').onclick = state.phase === 'gameEnd' ? showGameEnd : closeSheet);
}

function showMenu() {
  openSheet(`
    <h2>메뉴</h2>
    <div class="btns">
      <button class="btn" id="m-rules">규칙 보기</button>
      <button class="btn" id="m-settings">설정</button>
      <button class="btn" id="m-full">전체 화면</button>
      <button class="btn danger" id="m-new">새 게임 시작</button>
      <button class="btn" id="m-close">닫기</button>
    </div>`,
  b => {
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
  ghost = null;
  selected.clear();
  state = newGame(prefs);
  afterChange();
}

function seg(key, options) {
  return `<div class="seg" data-key="${key}">${options.map(([v, label]) =>
    `<button data-v="${v}" class="${String(prefs[key]) === String(v) ? 'on' : ''}">${label}</button>`).join('')}</div>`;
}

function showSettings() {
  openSheet(`
    <h2>설정</h2>
    <div class="row-label">인원</div>${seg('players', [[4, '4명 (13장)'], [3, '3명 (17장)']])}
    <div class="row-label">게임 끝나는 조건</div>${seg('endMode', [['rounds', '라운드 수'], ['points', '점수 도달']])}
    <div class="row-label">라운드 수</div>${seg('rounds', [[3, '3'], [5, '5'], [10, '10']])}
    <div class="row-label">종료 점수</div>${seg('points', [[30, '30점'], [50, '50점'], [100, '100점']])}
    <p class="note">인원과 종료 조건은 새 게임부터 적용돼요.</p>
    <div class="row-label">봇 속도</div>${seg('speed', [['slow', '느리게'], ['normal', '보통'], ['fast', '빠르게']])}
    <div class="row-label">카드 색</div>${seg('fourColor', [[false, '2색 (기본)'], [true, '4색 (♦파랑 ♣초록)']])}
    <div class="row-label">진동</div>${seg('vibrate', [[true, '켜기'], [false, '끄기']])}
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
    b.querySelector('#s-new').onclick = startNewGame;
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
      <li>3♦를 가진 사람이 먼저, <b>3♦를 포함한</b> 패로 시작해요. 그다음 시계 방향.</li>
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
    <h3>조작</h3>
    <p>카드를 탭하거나 손가락으로 쓸어서 여러 장을 고르고 <b>내기</b>. 테이블을 탭하면 선택이 풀려요. <b>힌트</b>를 누를 때마다 낼 수 있는 패를 하나씩 골라 줘요.</p>
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
$('#btn-sort').addEventListener('click', toggleSort);
$('#btn-menu').addEventListener('click', showMenu);
$('#btn-score').addEventListener('click', showScores);
$('#overlay').addEventListener('click', e => {
  // Tapping the dimmed area closes plain sheets, but not the round-end one.
  if (e.target.id === 'overlay' && state.phase === 'play') closeSheet();
});
bindHand();
window.addEventListener('resize', () => renderHand());

render();
if (state.phase === 'play') schedule();
else showRoundEnd();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
