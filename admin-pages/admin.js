async function load() {
  const res = await fetch('/api/quizzes');
  const list = await res.json();
  const container = document.getElementById('quiz-list');
  container.innerHTML = '';
  if (list.length === 0) {
    container.innerHTML = '<p class="muted">Aucun quiz pour le moment. Crée le premier.</p>';
    return;
  }
  list.forEach(q => {
    const card = document.createElement('div');
    card.className = 'quiz-card';
    card.innerHTML = `
      <div>
        <h3>${escape(q.title)}</h3>
        <p class="meta">${q.count} question${q.count > 1 ? 's' : ''} · <code>${escape(q.id)}.json</code></p>
      </div>
      <div class="actions">
        <button class="btn-edit">✏️ Éditer</button>
        <button class="btn-delete">🗑</button>
      </div>
    `;
    card.querySelector('.btn-edit').addEventListener('click', () => {
      location.href = '/admin/edit.html?id=' + encodeURIComponent(q.id);
    });
    card.querySelector('.btn-delete').addEventListener('click', () => deleteQuiz(q.id, q.title));
    container.appendChild(card);
  });
}

async function deleteQuiz(id, title) {
  if (!confirm(`Supprimer "${title}" ?\n\nLe fichier ${id}.json sera supprimé. Action irréversible.`)) return;
  const res = await fetch('/api/admin/quiz/' + encodeURIComponent(id), { method: 'DELETE' });
  if (!res.ok) { alert('Erreur de suppression'); return; }
  load();
}

async function newQuiz() {
  const title = prompt('Nom du nouveau quiz ?', 'Nouveau cours');
  if (!title || !title.trim()) return;
  const baseId = slugify(title);
  if (!baseId) { alert('Nom invalide — utilise des lettres/chiffres'); return; }
  const list = await fetch('/api/quizzes').then(r => r.json());
  let id = baseId, n = 2;
  while (list.some(q => q.id === id)) id = `${baseId}-${n++}`;
  const data = {
    title: title.trim(),
    questions: [{ type: 'qcm', q: '', options: ['', '', '', ''], answer: 0, time: 20 }],
  };
  const res = await fetch('/api/admin/quiz/' + id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert('Erreur de création : ' + (err.error || 'inconnue'));
    return;
  }
  location.href = '/admin/edit.html?id=' + encodeURIComponent(id);
}

function slugify(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

document.getElementById('new-btn').addEventListener('click', newQuiz);
load();
