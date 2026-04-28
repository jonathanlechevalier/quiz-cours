const socket = io();
const $ = (id) => document.getElementById(id);
const screens = ['join', 'lobby', 'question', 'reveal', 'end'];
function show(name) {
  for (const s of screens) $('screen-' + s).classList.toggle('hidden', s !== name);
}

let myName = '';

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
  $('q-progress').textContent = `Question ${index + 1} / ${total}`;
  $('q-text').textContent = question.q;
  const opts = $('q-options');
  opts.innerHTML = '';
  $('q-waiting').classList.add('hidden');

  if (question.type === 'qcm') {
    question.options.forEach((opt, i) => {
      const b = document.createElement('button');
      b.className = 'option opt-' + i;
      b.textContent = opt;
      b.onclick = () => sendAnswer(i, opts);
      opts.appendChild(b);
    });
  } else {
    [['Vrai', true], ['Faux', false]].forEach(([label, val], i) => {
      const b = document.createElement('button');
      b.className = 'option opt-' + (val ? 3 : 0);
      b.textContent = label;
      b.onclick = () => sendAnswer(val, opts);
      opts.appendChild(b);
    });
  }
  show('question');
});

function sendAnswer(choice, opts) {
  socket.emit('player:answer', { choice });
  for (const b of opts.children) b.disabled = true;
  $('q-waiting').classList.remove('hidden');
}

socket.on('question:end', ({ results }) => {
  const me = results.find(r => r.name === myName);
  if (me) {
    $('reveal-result').textContent = me.correct ? '✅ Bonne réponse !' : '❌ Raté';
    $('reveal-points').textContent = me.correct ? `+${me.points} points` : '0 point';
    $('reveal-total').textContent = me.total + ' pts';
  }
  show('reveal');
});

socket.on('session:end', ({ leaderboard }) => {
  const ol = $('final-leaderboard');
  ol.innerHTML = '';
  (leaderboard || []).forEach(p => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escape(p.name)}</span><strong>${p.score} pts</strong>`;
    ol.appendChild(li);
  });
  show('end');
});

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
