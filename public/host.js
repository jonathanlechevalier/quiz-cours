const socket = io();
const $ = (id) => document.getElementById(id);
const screens = ['pick', 'lobby', 'question', 'reveal', 'end'];
function show(name) {
  for (const s of screens) $('screen-' + s).classList.toggle('hidden', s !== name);
}

let currentQuestion = null;
let countdownTimer = null;

async function init() {
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
    $('code').textContent = res.code;
    show('lobby');
  });
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

socket.on('question:end', ({ correct, leaderboard, isLast }) => {
  if (countdownTimer) clearInterval(countdownTimer);
  let label = '';
  if (currentQuestion.type === 'qcm') {
    label = currentQuestion.options[correct];
  } else {
    label = correct ? 'Vrai' : 'Faux';
  }
  $('reveal-correct').textContent = `✅ Bonne réponse : ${label}`;
  const ol = $('leaderboard');
  ol.innerHTML = '';
  leaderboard.forEach(p => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escape(p.name)}</span><strong>${p.score} pts</strong>`;
    ol.appendChild(li);
  });
  $('next-btn').textContent = isLast ? 'Voir le classement final' : 'Question suivante';
  show('reveal');
});

socket.on('session:end', ({ leaderboard }) => {
  const ol = $('final-leaderboard');
  ol.innerHTML = '';
  leaderboard.forEach((p, i) => {
    const medal = ['🥇', '🥈', '🥉'][i] || '';
    const li = document.createElement('li');
    li.innerHTML = `<span>${medal} ${escape(p.name)}</span><strong>${p.score} pts</strong>`;
    ol.appendChild(li);
  });
  show('end');
});

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
