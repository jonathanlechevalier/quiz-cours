const socket = io();
const $ = (id) => document.getElementById(id);
const screens = ['pick', 'lobby', 'question', 'reveal', 'end'];
const screensWithSession = ['lobby', 'question', 'reveal'];

function show(name) {
  for (const s of screens) $('screen-' + s).classList.toggle('hidden', s !== name);
  $('end-btn').classList.toggle('hidden', !screensWithSession.includes(name));
}

let currentQuestion = null;
let countdownTimer = null;
let qrGenerated = false;

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
$('next-btn').onclick = () => socket.emit('host:next');

socket.on('question:start', ({ index, total, question }) => {
  currentQuestion = question;
  $('hq-progress').textContent = `Question ${index + 1} / ${total}`;
  $('hq-text').textContent = question.q;
  const opts = $('hq-options');
  opts.innerHTML = '';
  $('hq-distribution').innerHTML = '';

  if (question.type === 'qcm') {
    question.options.forEach((opt, i) => {
      const div = document.createElement('div');
      div.className = 'option opt-' + i;
      div.textContent = opt;
      opts.appendChild(div);
    });
  } else {
    [['Vrai', 3], ['Faux', 1]].forEach(([label, colorIdx]) => {
      const div = document.createElement('div');
      div.className = 'option opt-' + colorIdx;
      div.textContent = label;
      opts.appendChild(div);
    });
  }

  $('answer-count').textContent = '0';
  $('answer-total').textContent = '0';
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

// Live distribution on question screen
socket.on('question:distribution', (dist) => {
  if (!currentQuestion) return;
  renderBars($('hq-distribution'), currentQuestion, dist, null);
});

// Timer fini — affiche le bouton de révélation
socket.on('question:pending', ({ dist }) => {
  if (countdownTimer) clearInterval(countdownTimer);
  $('timer').textContent = '0';
  if (currentQuestion && dist) renderBars($('hq-distribution'), currentQuestion, dist, null);
  $('reveal-btn').classList.remove('hidden');
});

$('reveal-btn').onclick = () => {
  $('reveal-btn').classList.add('hidden');
  socket.emit('host:reveal');
};

socket.on('question:end', ({ correct, leaderboard, isLast, dist }) => {
  if (countdownTimer) clearInterval(countdownTimer);
  const label = currentQuestion.type === 'qcm'
    ? currentQuestion.options[correct]
    : (correct ? 'Vrai' : 'Faux');
  $('reveal-correct').textContent = `✅ Bonne réponse : ${label}`;

  if (dist && currentQuestion) {
    renderBars($('reveal-dist'), currentQuestion, dist, correct);
  }

  const ol = $('leaderboard');
  ol.innerHTML = '';
  leaderboard.forEach(p => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escape(p.name)}</span><strong>${p.score} pts</strong>`;
    ol.appendChild(li);
  });
  $('next-btn').textContent = isLast ? 'Voir les résultats' : 'Question suivante';
  show('reveal');
});

socket.on('session:end', ({ avgRate }) => {
  if (countdownTimer) clearInterval(countdownTimer);
  const val = (avgRate !== null && avgRate !== undefined) ? `${avgRate}%` : '—';
  $('avg-score-host').textContent = val;
  show('end');
});

function renderBars(container, question, dist, correct) {
  container.innerHTML = '';
  const labels  = question.type === 'qcm' ? ['A', 'B', 'C', 'D'] : ['Vrai', 'Faux'];
  const choices = question.type === 'qcm' ? [0, 1, 2, 3] : [true, false];
  const colors  = question.type === 'qcm' ? ['opt-0','opt-1','opt-2','opt-3'] : ['opt-3','opt-1'];
  const total = Math.max(dist.total, 1);

  labels.forEach((label, i) => {
    const count = dist.counts[i] || 0;
    const pct = Math.round(count / total * 100);
    const revealed = correct !== null;
    const isCorrect = revealed && choices[i] === correct;
    let barClass = colors[i];
    if (revealed) barClass = isCorrect ? 'bar-correct' : 'bar-dim';

    const row = document.createElement('div');
    row.className = 'dist-row';
    row.innerHTML = `
      <div class="dist-label ${colors[i]}">${label}</div>
      <div class="dist-track">
        <div class="dist-bar ${barClass}" style="width:${pct}%"></div>
      </div>
      <span class="dist-pct">${pct}%</span>
    `;
    container.appendChild(row);
  });
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}
