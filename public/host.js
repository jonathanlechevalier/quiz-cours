const socket = io();
const $ = (id) => document.getElementById(id);
const screens = ['pick', 'lobby', 'question', 'end'];
const screensWithSession = ['lobby', 'question'];

function show(name) {
  for (const s of screens) $('screen-' + s).classList.toggle('hidden', s !== name);
  $('end-btn').classList.toggle('hidden', !screensWithSession.includes(name));
}

let currentQuestion = null;
let countdownTimer = null;
let qrGenerated = false;
let currentIndex = 0;
let totalQuestions = 0;

async function init() {
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    $('admin-link-wrap').classList.remove('hidden');
  }
  try {
    const quizzes = await fetch('/api/quizzes').then(r => r.json());
    $('public-url').textContent = window.location.origin;
    const sel = $('quiz-select');
    if (!quizzes.length) {
      const o = document.createElement('option');
      o.textContent = 'Aucun quiz trouvé dans /quizzes';
      o.disabled = true;
      sel.appendChild(o);
      $('create-btn').disabled = true;
      return;
    }
    quizzes.forEach(q => {
      const o = document.createElement('option');
      o.value = q.id;
      o.textContent = `${q.title} — ${q.count} questions`;
      sel.appendChild(o);
    });
    if (!qrGenerated) {
      new QRCode($('qr-canvas'), {
        text: window.location.origin,
        width: 220, height: 220,
        correctLevel: QRCode.CorrectLevel.M,
      });
      qrGenerated = true;
    }
  } catch (e) {
    alert('Erreur de chargement : ' + e.message);
  }
}
init();

$('create-btn').onclick = () => {
  const quizId = $('quiz-select').value;
  socket.emit('host:create', { quizId }, (res) => {
    if (res.error) { alert(res.error); return; }
    $('lobby-title').textContent = res.title;
    show('lobby');
  });
};

$('end-btn').onclick = () => {
  if (!confirm('Terminer la session ?\nTous les étudiants verront les résultats finaux.')) return;
  socket.emit('host:end');
  if (countdownTimer) clearInterval(countdownTimer);
  show('pick');
};

socket.on('lobby:update', ({ players }) => {
  $('player-count').textContent = players.length;
  const ul = $('players');
  ul.innerHTML = '';
  players.forEach(p => {
    const li = document.createElement('li');
    li.textContent = p.name;
    ul.appendChild(li);
  });
});

$('start-btn').onclick = () => socket.emit('host:next');

socket.on('question:start', ({ index, total, question, playerCount }) => {
  currentQuestion = question;
  currentIndex = index;
  totalQuestions = total;
  $('hq-progress').textContent = `Question ${index + 1} / ${total}`;
  $('hq-text').textContent = question.q;

  // Réinitialise le récap et le bouton
  $('hq-counts').classList.add('hidden');
  $('hq-counts').innerHTML = '';
  $('next-q-btn').classList.add('hidden');

  const opts = $('hq-options');
  opts.innerHTML = '';

  if (question.type === 'qcm') {
    question.options.forEach((opt, i) => {
      const div = document.createElement('div');
      div.className = 'option opt-' + i;
      div.textContent = opt;
      opts.appendChild(div);
    });
  } else {
    [['Vrai', 3], ['Faux', 0]].forEach(([label, colorIdx]) => {
      const div = document.createElement('div');
      div.className = 'option opt-' + colorIdx;
      div.textContent = label;
      opts.appendChild(div);
    });
  }

  $('answer-count').textContent = '0';
  $('answer-total').textContent = playerCount || '?';
  let remaining = question.time;
  $('timer').textContent = remaining;
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    remaining--;
    $('timer').textContent = Math.max(0, remaining);
    if (remaining <= 0) clearInterval(countdownTimer);
  }, 1000);

  show('question');
});

socket.on('question:answer-count', ({ count, total }) => {
  $('answer-count').textContent = count;
  $('answer-total').textContent = total;
});

// Timer fini — affiche le récap texte et le bouton pour passer
socket.on('question:pending', ({ dist }) => {
  if (countdownTimer) clearInterval(countdownTimer);
  $('timer').textContent = '0';

  if (currentQuestion && dist) {
    renderCounts($('hq-counts'), currentQuestion, dist);
    $('hq-counts').classList.remove('hidden');
  }

  const isLast = currentIndex >= totalQuestions - 1;
  const btn = $('next-q-btn');
  btn.textContent = isLast ? '🏁 Terminer le quiz' : '▶ Question suivante';
  btn.classList.remove('hidden');
});

$('next-q-btn').onclick = () => {
  $('next-q-btn').classList.add('hidden');
  socket.emit('host:next');
};

socket.on('session:end', ({ avgRate }) => {
  if (countdownTimer) clearInterval(countdownTimer);
  const val = (avgRate !== null && avgRate !== undefined) ? `${avgRate}%` : '—';
  $('avg-score-host').textContent = val;
  show('end');
});

function renderCounts(container, question, dist) {
  container.innerHTML = '';
  const labels  = question.type === 'qcm' ? ['A', 'B', 'C', 'D'] : ['Vrai', 'Faux'];
  const options = question.type === 'qcm' ? question.options : ['Vrai', 'Faux'];
  const colors  = question.type === 'qcm' ? ['opt-0','opt-1','opt-2','opt-3'] : ['opt-3','opt-0'];

  labels.forEach((label, i) => {
    const count = dist.counts[i] || 0;
    const row = document.createElement('div');
    row.className = 'count-row';
    row.innerHTML = `
      <span class="count-label ${colors[i]}">${label}</span>
      <span class="count-text">${escape(options[i] || label)}</span>
      <span class="count-votes">${count} vote${count !== 1 ? 's' : ''}</span>
    `;
    container.appendChild(row);
  });
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}
