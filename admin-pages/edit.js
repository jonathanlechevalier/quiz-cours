const params = new URLSearchParams(location.search);
const quizId = params.get('id');
let quiz = null;
let dirty = false;

const $ = (s) => document.querySelector(s);

async function load() {
  if (!quizId) { alert('ID manquant'); location.href = '/admin/'; return; }
  const res = await fetch('/api/admin/quiz/' + encodeURIComponent(quizId));
  if (!res.ok) { alert('Quiz introuvable'); location.href = '/admin/'; return; }
  quiz = await res.json();
  $('#quiz-id').textContent = quizId + '.json';
  $('#title').value = quiz.title || '';
  renderQuestions();
}

function renderQuestions() {
  const list = $('#questions');
  list.innerHTML = '';
  quiz.questions.forEach((q, i) => list.appendChild(renderQuestion(q, i)));
}

function renderQuestion(q, i) {
  const card = document.createElement('div');
  card.className = 'q-card';
  const total = quiz.questions.length;

  const optionsHtml = q.type === 'qcm'
    ? `<p class="answer-hint">Sélectionne la bonne réponse avec le bouton radio à gauche.</p>` +
      [0, 1, 2, 3].map(j => `
        <div class="option-row">
          <input type="radio" name="answer-${i}" value="${j}" ${q.answer === j ? 'checked' : ''}>
          <span class="opt-letter">${'ABCD'[j]}</span>
          <input type="text" class="opt-input" data-opt="${j}" value="${escapeAttr(q.options[j] || '')}" placeholder="Option ${'ABCD'[j]}">
        </div>
      `).join('')
    : `<p class="answer-hint">Quelle est la bonne réponse ?</p>
       <label class="yesno-row">
         <input type="radio" name="answer-${i}" value="true" ${q.answer === true ? 'checked' : ''}> Vrai
       </label>
       <label class="yesno-row">
         <input type="radio" name="answer-${i}" value="false" ${q.answer === false ? 'checked' : ''}> Faux
       </label>`;

  card.innerHTML = `
    <div class="q-header">
      <span class="q-num">Question ${i + 1}</span>
      <button class="btn-icon move-up" ${i === 0 ? 'disabled' : ''} title="Monter">↑</button>
      <button class="btn-icon move-down" ${i === total - 1 ? 'disabled' : ''} title="Descendre">↓</button>
      <button class="btn-icon delete-q" title="Supprimer">✕</button>
    </div>
    <label>Type
      <select class="q-type">
        <option value="qcm" ${q.type === 'qcm' ? 'selected' : ''}>QCM (4 choix)</option>
        <option value="yesno" ${q.type === 'yesno' ? 'selected' : ''}>Vrai / Faux</option>
      </select>
    </label>
    <label>Énoncé
      <textarea class="q-text" rows="2" placeholder="Tape ta question ici…">${escapeText(q.q || '')}</textarea>
    </label>
    <div class="answer-block">${optionsHtml}</div>
    <label>Durée (en secondes — entre 5 et 300)
      <input type="number" class="q-time" min="5" max="300" value="${q.time}">
    </label>
  `;

  card.querySelector('.q-type').addEventListener('change', e => changeType(i, e.target.value));
  card.querySelector('.q-text').addEventListener('input', e => { quiz.questions[i].q = e.target.value; markDirty(); });
  card.querySelector('.q-time').addEventListener('input', e => { quiz.questions[i].time = Number(e.target.value) || 20; markDirty(); });
  card.querySelectorAll('.opt-input').forEach(inp => inp.addEventListener('input', e => {
    quiz.questions[i].options[Number(e.target.dataset.opt)] = e.target.value;
    markDirty();
  }));
  card.querySelectorAll(`input[name="answer-${i}"]`).forEach(r => r.addEventListener('change', e => {
    quiz.questions[i].answer = q.type === 'qcm' ? Number(e.target.value) : e.target.value === 'true';
    markDirty();
  }));
  card.querySelector('.move-up').addEventListener('click', () => moveQ(i, -1));
  card.querySelector('.move-down').addEventListener('click', () => moveQ(i, 1));
  card.querySelector('.delete-q').addEventListener('click', () => deleteQ(i));

  return card;
}

function changeType(i, type) {
  const q = quiz.questions[i];
  q.type = type;
  if (type === 'qcm') {
    if (!Array.isArray(q.options) || q.options.length !== 4) q.options = ['', '', '', ''];
    if (typeof q.answer !== 'number') q.answer = 0;
  } else {
    delete q.options;
    if (typeof q.answer !== 'boolean') q.answer = true;
  }
  renderQuestions();
  markDirty();
}

function moveQ(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= quiz.questions.length) return;
  [quiz.questions[i], quiz.questions[j]] = [quiz.questions[j], quiz.questions[i]];
  renderQuestions();
  markDirty();
}

function deleteQ(i) {
  if (quiz.questions.length === 1) { alert('Un quiz doit avoir au moins une question.'); return; }
  if (!confirm(`Supprimer la question ${i + 1} ?`)) return;
  quiz.questions.splice(i, 1);
  renderQuestions();
  markDirty();
}

function addQ() {
  quiz.questions.push({ type: 'qcm', q: '', options: ['', '', '', ''], answer: 0, time: 20 });
  renderQuestions();
  markDirty();
  document.querySelector('#questions').lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function markDirty() {
  dirty = true;
  setStatus('● Modifications non enregistrées', '');
}

function setStatus(text, cls) {
  const el = $('#save-status');
  el.textContent = text;
  el.className = 'save-status' + (cls ? ' ' + cls : '');
}

async function save() {
  quiz.title = $('#title').value.trim();
  const res = await fetch('/api/admin/quiz/' + encodeURIComponent(quizId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(quiz),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { setStatus('❌ ' + (data.error || 'erreur'), 'error'); return; }
  dirty = false;
  setStatus('✓ Enregistré', 'success');
  setTimeout(() => { if (!dirty) setStatus('', ''); }, 2500);
}

function escapeAttr(s) { return String(s).replace(/[&"<>]/g, c => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c]); }
function escapeText(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]); }

document.getElementById('add-q').addEventListener('click', addQ);
document.getElementById('save').addEventListener('click', save);
document.getElementById('title').addEventListener('input', markDirty);

document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); }
});

window.addEventListener('beforeunload', e => {
  if (dirty) { e.preventDefault(); e.returnValue = ''; }
});

load();
