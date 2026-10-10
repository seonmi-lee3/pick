// 경제토크쇼픽 방송본 대시보드: JSON을 읽어 수를 세고, 검색·분기 필터·초기화·상세 보기를 처리한다.
// 자료의 글자는 모두 textContent로 넣는다. 자료 안의 글자가 코드로 실행되지 않게 하기 위해서다.

const MATERIALS_URL = 'data/materials.json';
const TRANSCRIPTS_URL = 'data/transcripts.json';
const VIEWS_URL = 'data/views.json'; // "조회수 가져오기"를 한 번도 누르지 않았으면 없다
const VIEWS_REFRESH_URL = '/api/views/refresh';
const EPISODES_REFRESH_URL = '/api/episodes/refresh';

const els = {
  totalCount: document.getElementById('totalCount'),
  keywordStats: document.getElementById('keywordStats'),
  keywordPie: document.getElementById('keywordPie'),
  guestStats: document.getElementById('guestStats'),
  viewsButton: document.getElementById('viewsButton'),
  episodesButton: document.getElementById('episodesButton'),
  episodesStatus: document.getElementById('episodesStatus'),
  viewsStatus: document.getElementById('viewsStatus'),
  viewChart: document.getElementById('viewChart'),
  viewStats: document.getElementById('viewStats'),
  viewStatsNote: document.getElementById('viewStatsNote'),
  searchInput: document.getElementById('searchInput'),
  kindSelect: document.getElementById('kindSelect'),
  resetButton: document.getElementById('resetButton'),
  transcriptNotice: document.getElementById('transcriptNotice'),
  resultCount: document.getElementById('resultCount'),
  pageInfo: document.getElementById('pageInfo'),
  pager: document.getElementById('pager'),
  loadError: document.getElementById('loadError'),
  emptyMessage: document.getElementById('emptyMessage'),
  emptyResetButton: document.getElementById('emptyResetButton'),
  cards: document.getElementById('cards'),
};

const state = {
  items: [],
  transcripts: null, // 자막 JSON을 읽지 못하면 null로 남는다
  views: {}, // 자료 id → 조회수
  viewsCheckedAt: null, // 조회수를 가져온 시각
  query: '',
  kind: '',
  tag: '', // 상단의 제목 키워드를 눌러 고른 것
  guest: '', // 출연 횟수 그래프에서 눌러 고른 사람
  itemId: '', // 조회수 순위 그래프에서 눌러 고른 회차
  page: 1, // 목록에서 보고 있는 쪽
  openId: null,
};

const TOP_KEYWORDS = 10; // 제목 키워드 순위에 보여 줄 개수
const MIN_APPEARANCES = 2; // 출연 횟수 묶음에 보여 줄 최소 출연 횟수
const FOLD_FROM = 15; // 한 묶음에 이 수 이상이면 접어 둔다
const TOP_VIEWED = 10; // 조회수 순위에 보여 줄 개수
const PAGE_SIZE = 10; // 목록 한 쪽에 보여 줄 제목 수

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// 글에서 검색어와 일치하는 부분을 <mark>로 감싼 조각을 만든다. 대소문자는 구분하지 않는다.
function highlighted(text, query) {
  const fragment = document.createDocumentFragment();
  if (!query) { fragment.append(text); return fragment; }
  const lower = text.toLowerCase();
  let from = 0;
  for (let at = lower.indexOf(query); at !== -1; at = lower.indexOf(query, from)) {
    if (at > from) fragment.append(text.slice(from, at));
    fragment.append(el('mark', '', text.slice(at, at + query.length)));
    from = at + query.length;
  }
  fragment.append(text.slice(from));
  return fragment;
}

let shared = null; // 공유용 페이지에서 비밀번호로 푼 자료 (주소 → 내용)

async function loadJson(url) {
  if (shared) {
    if (!(url in shared)) throw new Error(`${url} 없음`);
    return shared[url];
  }
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url} ${response.status}`);
  return response.json();
}

// 날짜가 최신인 것이 위로, 날짜가 없는 것은 맨 뒤로 간다.
function byDateDesc(a, b) {
  if (a.date === b.date) return 0;
  if (a.date === null) return 1;
  if (b.date === null) return -1;
  return a.date < b.date ? 1 : -1;
}

function prepare(materials) {
  return materials.map((item) => ({
    ...item,
    guest_names: item.guest_names || [],
    title_keywords: item.title_keywords || [],
    metaText: [item.title, item.summary, ...item.guests].join('\n').toLowerCase(),
    transcriptText: '',
  })).sort(byDateDesc);
}

function attachTranscripts(transcripts) {
  state.transcripts = transcripts;
  for (const item of state.items) {
    const segments = transcripts[item.id] || [];
    item.transcriptText = segments.map((s) => s.text).join('\n').toLowerCase();
  }
}

// 분기 이름을 시간 순서로 놓는다. '분기 미상'은 맨 뒤.
function kindsInOrder() {
  const counts = new Map();
  for (const item of state.items) counts.set(item.kind, (counts.get(item.kind) || 0) + 1);
  return [...counts.entries()].sort(([a], [b]) => {
    if (a === '분기 미상') return 1;
    if (b === '분기 미상') return -1;
    return a.localeCompare(b, 'ko', { numeric: true });
  });
}

// 상단 통계(제목 키워드, 출연 횟수)에서 하나를 눌렀을 때.
// 통계에 적힌 수와 결과 수가 같아야 하므로, 누르는 순간 다른 조건(다른 통계 선택, 검색어, 분기)은 모두 푼다.
// 그 뒤에 검색어나 분기를 걸면 그 안에서 더 좁혀진다. 눌려 있는 것을 다시 누르면 그것만 풀린다.
function chooseFromStats(field, value) {
  if (state[field] === value) {
    state[field] = '';
  } else {
    state.tag = '';
    state.guest = '';
    state.itemId = '';
    state.query = '';
    state.kind = '';
    els.searchInput.value = '';
    els.kindSelect.value = '';
    state[field] = value;
  }
  state.openId = null;
  state.page = 1;
  render();
}

// 제목에서 뽑은 키워드(title_keywords)가 나온 제목 수를 세어 많은 것부터 돌려준다.
// 수가 같으면 같은 순위이고, 그 안에서는 가나다순이다.
function topKeywords() {
  const counts = new Map();
  for (const item of state.items) {
    for (const keyword of item.title_keywords) counts.set(keyword, (counts.get(keyword) || 0) + 1);
  }
  const sorted = [...counts.entries()]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b, 'ko'))
    .slice(0, TOP_KEYWORDS);
  return sorted.map(([keyword, count]) => ({
    keyword,
    count,
    rank: sorted.findIndex(([, other]) => other === count) + 1,
  }));
}

// 원그래프의 색: 한 가지 보라색을 진한 것(1위)에서 연한 것(10위)으로. 조각 사이에는 흰 틈을 둔다.
const PIE_COLORS = ['#2e1a7a', '#3a2190', '#4325a5', '#5236b5', '#6349c2', '#7660cd', '#8b78d7', '#a091e0', '#b6aae9', '#cbc3f1'];
const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attributes) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

function renderKeywordPie(keywords, sum) {
  const center = 100;
  const radius = 96;
  const point = (degrees, r) => {
    const radians = ((degrees - 90) * Math.PI) / 180;
    return [center + r * Math.cos(radians), center + r * Math.sin(radians)];
  };
  els.keywordPie.replaceChildren();
  let start = 0;
  for (const [index, { keyword, count, rank }] of keywords.entries()) {
    const sweep = (count / sum) * 360;
    const [x1, y1] = point(start, radius);
    const [x2, y2] = point(start + sweep, radius);
    const slice = svgEl('path', {
      d: `M ${center} ${center} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${radius} ${radius} 0 ${sweep > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`,
      fill: PIE_COLORS[index % PIE_COLORS.length],
      class: 'slice',
      tabindex: '0',
      role: 'button',
    });
    slice.dataset.keyword = keyword;
    const tip = svgEl('title', {});
    tip.textContent = `${rank}위 ${keyword}: 제목 ${count}개 (상위 10개 중 ${Math.round((count / sum) * 100)}%)`;
    slice.append(tip);
    slice.addEventListener('click', () => chooseFromStats('tag', keyword));
    slice.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseFromStats('tag', keyword); }
    });
    els.keywordPie.append(slice);

    // 조각이 충분히 클 때만 조각 위에 이름을 적는다. 나머지는 범례에서 읽는다.
    if (sweep >= 30) {
      const [tx, ty] = point(start + sweep / 2, radius * 0.62);
      const label = svgEl('text', { x: tx.toFixed(2), y: ty.toFixed(2), class: index < 7 ? 'slice-label' : 'slice-label dark' });
      label.textContent = keyword;
      els.keywordPie.append(label);
    }
    start += sweep;
  }
}

function renderCounts() {
  els.totalCount.textContent = String(state.items.length);
  els.kindSelect.replaceChildren(new Option('전체 분기', ''));
  for (const [kind, count] of kindsInOrder()) {
    els.kindSelect.append(new Option(`${kind} (${count})`, kind));
  }
  els.kindSelect.value = state.kind;

  // 제목 키워드 순위: 원그래프와 그 옆의 범례. 조각과 범례 줄 모두 누를 수 있다.
  // 비중은 상위 10개의 합을 100으로 본 것이다(한 제목에 키워드가 여럿 있을 수 있다).
  const keywords = topKeywords();
  const sum = keywords.reduce((total, k) => total + k.count, 0) || 1;
  renderKeywordPie(keywords, sum);
  els.keywordStats.replaceChildren();
  for (const [index, { keyword, count, rank }] of keywords.entries()) {
    const share = Math.round((count / sum) * 100);
    const button = el('button', 'legend-row');
    button.type = 'button';
    button.dataset.keyword = keyword;
    button.title = `${rank}위 ${keyword}: 제목 ${count}개에 나옴 (상위 10개 중 ${share}%)`;
    const swatch = el('span', 'swatch');
    swatch.style.background = PIE_COLORS[index % PIE_COLORS.length];
    button.append(el('span', 'bar-rank', String(rank)), swatch, el('span', 'bar-name', keyword), el('span', 'bar-value', `${count}개 · ${share}%`));
    button.addEventListener('click', () => chooseFromStats('tag', keyword));
    const li = el('li');
    li.append(button);
    els.keywordStats.append(li);
  }
}

// 사람별 출연 횟수(그 사람이 출연자로 적힌 자료 수)를 세어 많은 것부터 돌려준다.
function frequentGuests() {
  const counts = new Map();
  for (const item of state.items) {
    for (const name of item.guest_names) counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= MIN_APPEARANCES)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b, 'ko'));
}

// 출연 횟수별로 묶어 이름을 늘어놓는다. 이름 하나가 버튼이라 누르면 그 사람이 나온 회차만 남는다.
// 사람이 많은 묶음(FOLD_FROM명 이상)은 접어 두고, 눌러서 펼친다.
function renderGuestStats() {
  const guests = frequentGuests();
  const groups = new Map(); // 횟수 → 이름들
  for (const [name, count] of guests) {
    if (!groups.has(count)) groups.set(count, []);
    groups.get(count).push(name);
  }
  els.guestStats.replaceChildren();
  for (const [count, names] of groups) {
    const chips = el('div', 'chips');
    for (const name of names) {
      const button = el('button', 'name-chip', name);
      button.type = 'button';
      button.dataset.guest = name;
      button.title = `${name}: ${count}회 출연`;
      button.addEventListener('click', () => chooseFromStats('guest', name));
      chips.append(button);
    }
    const label = el('span', 'group-label');
    label.append(el('strong', '', `${count}회`), ` ${names.length}명`);
    if (names.length >= FOLD_FROM) {
      const fold = el('details', 'group');
      fold.dataset.count = String(count);
      const summary = el('summary');
      summary.append(label);
      fold.append(summary, chips);
      els.guestStats.append(fold);
    } else {
      const row = el('div', 'group');
      row.append(label, chips);
      els.guestStats.append(row);
    }
  }
  els.guestStats.closest('.chart').hidden = guests.length === 0;
}

// 그래프의 줄에 쓸 짧은 제목: 앞뒤의 [경제토크쇼픽 ○회] 표시를 떼고 회차를 앞에 붙인다.
function shortTitle(item) {
  const text = item.title.replace(/\[[^\]]*경제토크쇼[^\]]*\]/g, ' ').replace(/^\s*제목\s*:/, ' ').replace(/\s+/g, ' ').trim();
  return item.episode !== null ? `${item.episode}회 ${text}` : text;
}

// 조회수가 많은 순서로 상위 회차를 가로 막대 그래프로 보여 준다. 조회수를 가져온 적이 없으면 숨긴다.
function renderViewStats() {
  const ranked = state.items
    .filter((item) => state.views[item.id] !== undefined)
    .sort((a, b) => state.views[b.id] - state.views[a.id])
    .slice(0, TOP_VIEWED);
  els.viewChart.hidden = ranked.length === 0;
  els.viewStats.replaceChildren();
  if (!ranked.length) return;
  els.viewStatsNote.textContent = `상위 ${ranked.length}개 · ${formatTime(state.viewsCheckedAt)} 기준`;
  const max = state.views[ranked[0].id] || 1;
  ranked.forEach((item, index) => {
    const count = state.views[item.id];
    const button = el('button', 'bar-row');
    button.type = 'button';
    button.dataset.itemId = item.id;
    button.title = `${index + 1}위: ${item.title} (조회수 ${count.toLocaleString('ko-KR')}회)`;
    const track = el('span', 'bar-track');
    const fill = el('span', 'bar-fill');
    fill.style.width = `${(count / max) * 100}%`;
    track.append(fill);
    button.append(el('span', 'bar-rank', String(index + 1)), el('span', 'bar-name', shortTitle(item)), track, el('span', 'bar-value', `${count.toLocaleString('ko-KR')}회`));
    button.addEventListener('click', () => chooseFromStats('itemId', item.id));
    const li = el('li');
    li.append(button);
    els.viewStats.append(li);
  });
}

function renderKeywordSelection() {
  for (const node of [...els.keywordStats.querySelectorAll('.legend-row'), ...els.keywordPie.querySelectorAll('.slice')]) {
    node.setAttribute('aria-pressed', String(node.dataset.keyword === state.tag));
  }
  els.keywordPie.classList.toggle('has-selection', Boolean(state.tag));
  for (const button of els.guestStats.querySelectorAll('.name-chip')) {
    const pressed = button.dataset.guest === state.guest;
    button.setAttribute('aria-pressed', String(pressed));
    if (pressed) { const fold = button.closest('details'); if (fold) fold.open = true; }
  }
  for (const button of els.viewStats.querySelectorAll('.bar-row')) {
    button.setAttribute('aria-pressed', String(button.dataset.itemId === state.itemId));
  }
}

// 조건에 맞는 항목과, 각 항목을 어디에서 찾았는지 돌려준다.
function search() {
  const query = state.query.trim().toLowerCase();
  const results = [];
  for (const item of state.items) {
    if (state.kind && item.kind !== state.kind) continue;
    if (state.tag && !item.title_keywords.includes(state.tag)) continue;
    if (state.guest && !item.guest_names.includes(state.guest)) continue;
    if (state.itemId && item.id !== state.itemId) continue;
    if (!query) { results.push({ item, inTranscript: false, foundOnlyInTranscript: false }); continue; }
    const inMeta = item.metaText.includes(query);
    const inTranscript = item.transcriptText.includes(query);
    if (inMeta || inTranscript) results.push({ item, inTranscript, foundOnlyInTranscript: !inMeta && inTranscript });
  }
  return { query, results };
}

function detailRow(list, label, value) {
  list.append(el('dt', '', label));
  const dd = el('dd');
  if (value instanceof Node) dd.append(value); else dd.textContent = value;
  list.append(dd);
}

function youtubeLink(url, text, seconds) {
  const link = el('a', '', text);
  link.href = seconds ? `${url}${url.includes('?') ? '&' : '?'}t=${seconds}` : url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function passagesOf(item, query) {
  if (!query || !state.transcripts) return [];
  return (state.transcripts[item.id] || []).filter((s) => s.text.toLowerCase().includes(query));
}

function renderDetail(item, query) {
  const detail = el('div', 'detail');
  const list = el('dl');
  detailRow(list, '제목', highlighted(item.title, query));
  detailRow(list, '방송 날짜', item.date || '날짜 미상');
  detailRow(list, '회차', item.episode !== null ? `${item.episode}회` : '회차 정보 없음');
  detailRow(list, '방송 구분', item.broadcast_type || '-');
  detailRow(list, '출연자', item.guests.length ? highlighted(item.guests.join(', '), query) : '출연자 정보 없음');
  detailRow(list, '요약', highlighted(item.summary, query));
  detailRow(list, '태그', item.keywords.length ? item.keywords.join(', ') : '-');
  detailRow(list, '유튜브', youtubeLink(item.youtube_url, item.youtube_url));
  detailRow(list, '조회수', viewsText(item));
  detailRow(list, '원본 파일', item.source_file);
  detail.append(list);

  const passages = passagesOf(item, query);
  if (passages.length) {
    const box = el('div', 'passages');
    box.append(el('h4', '', `자막에서 찾은 대목 ${passages.length}개`));
    const ol = el('ol');
    for (const segment of passages) {
      const li = el('li');
      li.append(segment.t
        ? youtubeLink(item.youtube_url, segment.t, segment.sec)
        : el('span', 'no-time', '시간 없음'));
      li.firstChild.classList.add(segment.t ? 'time' : 'no-time');
      const passage = el('span');
      passage.append(highlighted(segment.text, query));
      li.append(passage);
      ol.append(li);
    }
    box.append(ol);
    detail.append(box);
  }

  const close = el('button', 'button close', '닫기');
  close.type = 'button';
  close.addEventListener('click', () => { state.openId = null; render(); });
  detail.append(close);
  return detail;
}

function renderCard({ item, foundOnlyInTranscript }, query) {
  const open = state.openId === item.id;
  const card = el('article', open ? 'card open' : 'card');

  const head = el('button', 'card-head');
  head.type = 'button';
  head.setAttribute('aria-expanded', String(open));
  // 목록에는 방송 제목만 보여 준다. 나머지는 눌러서 펼친 상세 보기에 있다.
  const title = el('h3', 'card-title');
  title.append(highlighted(item.title, query));
  head.append(title);
  if (foundOnlyInTranscript) head.append(el('span', 'badge found', '자막에서 찾음'));
  if (state.views[item.id] !== undefined) {
    head.append(el('span', 'card-views', `조회수 ${state.views[item.id].toLocaleString('ko-KR')}회`));
  }
  head.addEventListener('click', () => {
    state.openId = open ? null : item.id;
    render();
  });
  card.append(head);

  if (open) card.append(renderDetail(item, query));
  return card;
}

// 쪽 번호 줄. 쪽이 많으면 처음, 끝, 지금 쪽의 앞뒤만 보여 주고 사이는 …로 줄인다.
function renderPager(pageCount) {
  els.pager.replaceChildren();
  els.pager.hidden = pageCount <= 1;
  if (pageCount <= 1) return;

  const go = (page) => {
    state.page = page;
    state.openId = null;
    render();
    els.resultCount.scrollIntoView({ block: 'start' });
  };
  const button = (label, page, { disabled = false, current = false } = {}) => {
    const node = el('button', current ? 'page current' : 'page', label);
    node.type = 'button';
    node.disabled = disabled;
    if (current) node.setAttribute('aria-current', 'page');
    else node.addEventListener('click', () => go(page));
    return node;
  };

  els.pager.append(button('이전', state.page - 1, { disabled: state.page === 1 }));
  const shown = new Set([1, pageCount, state.page - 2, state.page - 1, state.page, state.page + 1, state.page + 2]);
  let previous = 0;
  for (let page = 1; page <= pageCount; page++) {
    if (!shown.has(page)) continue;
    if (page - previous > 1) els.pager.append(el('span', 'gap', '…'));
    els.pager.append(button(String(page), page, { current: page === state.page }));
    previous = page;
  }
  els.pager.append(button('다음', state.page + 1, { disabled: state.page === pageCount }));
}

function render() {
  const { query, results } = search();
  renderKeywordSelection();
  els.resultCount.textContent = String(results.length);
  els.emptyMessage.hidden = results.length > 0 || state.items.length === 0;

  // 한 쪽에 PAGE_SIZE개씩 보여 준다.
  const pageCount = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  state.page = Math.min(Math.max(1, state.page), pageCount);
  const first = (state.page - 1) * PAGE_SIZE;
  const shown = results.slice(first, first + PAGE_SIZE);
  els.pageInfo.textContent = results.length > PAGE_SIZE ? ` · ${first + 1}–${first + shown.length}번째 (${state.page}/${pageCount}쪽)` : '';
  els.cards.replaceChildren(...shown.map((result) => renderCard(result, query)));
  renderPager(pageCount);
}

function formatTime(iso) {
  return new Date(iso).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

function viewsText(item) {
  const count = state.views[item.id];
  if (count === undefined) return '조회수 정보 없음';
  return `${count.toLocaleString('ko-KR')}회 (${formatTime(state.viewsCheckedAt)} 기준)`;
}

function applyViews(data) {
  state.views = data.views || {};
  state.viewsCheckedAt = data.checked_at || null;
  const count = Object.keys(state.views).length;
  if (count && state.viewsCheckedAt) {
    els.viewsStatus.textContent = `조회수 ${count}건, ${formatTime(state.viewsCheckedAt)} 기준`;
  }
  renderViewStats();
}

async function loadViews() {
  try {
    applyViews(await loadJson(VIEWS_URL));
  } catch {
    // 아직 가져온 적이 없으면 파일이 없다. 처음 문구를 그대로 둔다.
  }
}

// 서버에 유튜브 조회수를 다시 읽어 달라고 한다. 진행 상황이 한 줄씩 온다.
async function refreshViews() {
  els.viewsButton.disabled = true;
  els.viewsStatus.textContent = '조회수를 가져오는 중입니다…';
  let finished = null;
  try {
    const response = await fetch(VIEWS_REFRESH_URL, { method: 'POST' });
    if (response.status === 409) throw new Error('이미 가져오는 중입니다.');
    if (!response.ok || !response.body) throw new Error('조회수를 가져올 수 없습니다. 로컬 서버(scripts/serve.mjs)로 열었는지 확인해 주세요.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines.filter(Boolean)) {
        const message = JSON.parse(line);
        if (message.type === 'progress') els.viewsStatus.textContent = `조회수를 가져오는 중입니다… ${message.done}/${message.total}`;
        if (message.type === 'error') throw new Error(message.message);
        if (message.type === 'done') finished = message;
      }
    }
    if (!finished) throw new Error('가져오는 도중에 연결이 끊겼습니다.');
    if (finished.updated === 0) {
      throw new Error(finished.blocked
        ? '유튜브가 요청을 잠시 막았습니다. 몇 시간 뒤에 다시 눌러 주세요.'
        : '유튜브에서 한 건도 읽지 못했습니다.');
    }
    await loadViews();
    if (finished.blocked) els.viewsStatus.textContent += ` (이번에 ${finished.updated}건만 새로 읽음. 유튜브가 중간에 요청을 막았습니다)`;
    else if (finished.failed) els.viewsStatus.textContent += ` (${finished.failed}건은 가져오지 못함)`;
    render();
  } catch (error) {
    console.error(error);
    els.viewsStatus.textContent = `조회수를 가져오지 못했습니다. ${error.message}`;
  } finally {
    els.viewsButton.disabled = false;
  }
}

// "새 방송 확인": 서버가 유튜브 재생목록에서 새 영상을 찾아 방송본 파일과 JSON을 만든다.
// 새 방송이 들어오면 자료를 다시 읽어 화면을 새로 그린다.
async function checkNewEpisodes() {
  els.episodesButton.disabled = true;
  els.episodesStatus.hidden = false;
  els.episodesStatus.textContent = '유튜브 재생목록에서 새 방송을 확인하는 중입니다…';
  try {
    const response = await fetch(EPISODES_REFRESH_URL, { method: 'POST' });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) {
      throw new Error((data && data.message) || '로컬 서버(scripts/serve.mjs)로 열었는지 확인해 주세요.');
    }
    if (!data.added.length) {
      els.episodesStatus.textContent = `새 방송이 없습니다. 최근에 올라온 영상 ${data.checked}개를 확인했습니다.`;
      return;
    }
    const lines = [
      `새 방송 ${data.added.length}건을 추가했습니다: ${data.added.map((a) => a.title).join(' / ')}`,
      '자막은 자동으로 가져오지 못합니다. 새로 추가한 방송은 제목·요약·출연자로만 찾을 수 있습니다.',
      ...data.warnings,
    ];
    els.episodesStatus.textContent = lines.join(' ');
    state.page = 1;
    await start();
  } catch (error) {
    console.error(error);
    els.episodesStatus.textContent = `새 방송을 확인하지 못했습니다. ${error.message}`;
  } finally {
    els.episodesButton.disabled = false;
  }
}

function reset() {
  state.query = '';
  state.kind = '';
  state.tag = '';
  state.guest = '';
  state.itemId = '';
  state.openId = null;
  state.page = 1;
  els.searchInput.value = '';
  els.kindSelect.value = '';
  render();
}

function showLoadError() {
  els.loadError.hidden = false;
  els.searchInput.disabled = true;
  els.kindSelect.disabled = true;
  els.viewsButton.disabled = true;
  els.episodesButton.disabled = true;
  els.totalCount.textContent = '0';
  els.resultCount.textContent = '0';
}

// 조건이 바뀌면 첫 쪽으로 돌아간다.
els.searchInput.addEventListener('input', () => { state.query = els.searchInput.value; state.page = 1; render(); });
els.kindSelect.addEventListener('change', () => { state.kind = els.kindSelect.value; state.page = 1; render(); });
els.resetButton.addEventListener('click', reset);
els.emptyResetButton.addEventListener('click', reset);
els.viewsButton.addEventListener('click', refreshViews);
els.episodesButton.addEventListener('click', checkNewEpisodes);

async function start() {
  try {
    state.items = prepare(await loadJson(MATERIALS_URL));
  } catch (error) {
    console.error(error);
    showLoadError();
    return;
  }
  renderCounts();
  renderGuestStats();
  render();
  loadViews().then(render);

  try {
    attachTranscripts(await loadJson(TRANSCRIPTS_URL));
    render();
  } catch (error) {
    console.error(error);
    els.transcriptNotice.hidden = false;
  }
}

// 공유용 페이지(share/lock.js)에서는 비밀번호로 자료를 푼 뒤에 시작한다.
if (window.sharedData) window.sharedData.then((data) => { shared = data; start(); });
else start();
