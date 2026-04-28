const socket = io();
const $ = (id) => document.getElementById(id);
const screens = ['join', 'lobby', 'question', 'reveal', 'end'];
function show(name) {
  for (const s of screens) $('screen-' + s).classList.toggle('hidden', s !== name);
}

let myName = '';
let currentQuestion = null;
let hasAnswered = false;
let timerInterval = null;

function startTimer(duration) {
  const fill = $('player-timer-fill');
  const sec  = $('player-timer-sec');

  // Reset animation
  fill.classList.remove('running');
  fill.style.setProperty('--t', duration + 's');
  fill.style.background = '';
  void fill.offsetWidth; // force reflow
  fill.classList.add('running');

  let remaining = duration;
  sec.textContent = remaining;
  sec.style.color = '';

  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    remaining--;
    sec.textContent = Math.max(0, remaining);
    const ratio = remaining / duration;
    const color = ratio > 0.4 ? '#4ade80' : ratio > 0.15 ? '#f59e0b' : '#ef4444';
    sec.style.color = color;
    fill.style.background = color;
    if (remaining <= 0) clearInterval(timerInterval);
  }, 1000);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  const fill = $('player-timer-fill');
  fill.classList.remove('running');
  fill.style.width = '0%';
  $('player-timer-sec').textContent = '0';
  $('player-timer-sec').style.color = '#ef4444';
}

$('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('name').value.trim();
  $('join-error').textContent = '';
  socket.emit('player:join', { name }, (res) => {
    if (res.error) { $('join-error').textContent = res.error; return; }
    myName = res.name;
    $('player-name').textContent = res.name;
    show('lobby');
  });
});

socket.on('question:start', ({ index, total, question }) => {
  currentQuestion = question;
  hasAnswered = false;
  $('q-progress').textContent = `Question ${index + 1} / ${total}`;
  $('q-text').textContent = question.q;
  startTimer(question.time);
  const opts = $('q-options');
  opts.innerHTML = '';
  opts.classList.remove('hidden');
  $('q-distribution').classList.add('hidden');
  $('dist-bars').innerHTML = '';

  if (question.type === 'qcm') {
    question.options.forEach((opt, i) => {
      const b = document.createElement('button');
      b.className = 'option opt-' + i;
      b.textContent = opt;
      b.onclick = () => sendAnswer(i);
      opts.appendChild(b);
    });
  } else {
    [['Vrai', true], ['Faux', false]].forEach(([label, val]) => {
      const b = document.createElement('button');
      b.className = 'option opt-' + (val ? 3 : 1);   // Vrai=vert, Faux=bleu
      b.textContent = label;
      b.onclick = () => sendAnswer(val);
      opts.appendChild(b);
    });
  }
  show('question');
});

function sendAnswer(choice) {
  if (hasAnswered) return;
  hasAnswered = true;
  socket.emit('player:answer', { choice });
  $('q-options').classList.add('hidden');
  $('q-distribution').classList.remove('hidden');
}

socket.on('question:distribution', (dist) => {
  if (!currentQuestion) return;
  renderBars($('dist-bars'), currentQuestion, dist, null);
});

// Timer écoulé — on attend que l'animateur révèle
socket.on('question:pending', ({ dist }) => {
  stopTimer();
  $('dist-hint').textContent = '⏳ En attente de l\'animateur…';
  if (currentQuestion && dist) renderBars($('dist-bars'), currentQuestion, dist, null);
  if (!hasAnswered) {
    // L'étudiant n'a pas répondu à temps — affiche les barres quand même
    $('q-options').classList.add('hidden');
    $('q-distribution').classList.remove('hidden');
  }
});

// L'animateur a cliqué "Afficher les résultats"
socket.on('question:end', ({ results, correct, dist }) => {
  const me = results.find(r => r.name === myName);
  if (me) {
    $('reveal-result').textContent = me.correct ? '✅ Bonne réponse !' : '❌ Raté';
  }
  if (dist && currentQuestion) {
    renderBars($('reveal-bars'), currentQuestion, dist, correct);
  }
  show('reveal');
});

socket.on('session:end', ({ avgRate }) => {
  const val = (avgRate !== null && avgRate !== undefined) ? `${avgRate}%` : '—';
  $('avg-score').textContent = val;
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
