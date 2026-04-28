const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const QUIZ_DIR = path.join(__dirname, 'quizzes');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

function localhostOnly(req, res, next) {
  const ip = (req.ip || req.connection.remoteAddress || '').replace(/^::ffff:/, '');
  if (ip === '127.0.0.1' || ip === '::1') return next();
  res.status(403).send("Cette interface est accessible uniquement en local (npm start sur ton Mac).");
}

app.use('/admin', localhostOnly, express.static(path.join(__dirname, 'admin-pages')));
app.use('/api/admin', localhostOnly, express.json());

app.get('/api/admin/quiz/:id', (req, res) => {
  if (!/^[a-z0-9-]+$/i.test(req.params.id)) return res.status(400).json({ error: 'id invalide' });
  const file = path.join(QUIZ_DIR, req.params.id + '.json');
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'introuvable' });
  try { res.json(JSON.parse(fs.readFileSync(file, 'utf8'))); }
  catch (e) { res.status(500).json({ error: 'fichier illisible' }); }
});

app.put('/api/admin/quiz/:id', (req, res) => {
  if (!/^[a-z0-9-]+$/i.test(req.params.id)) return res.status(400).json({ error: 'id invalide' });
  const error = validateQuiz(req.body);
  if (error) return res.status(400).json({ error });
  fs.writeFileSync(path.join(QUIZ_DIR, req.params.id + '.json'), JSON.stringify(req.body, null, 2) + '\n');
  res.json({ ok: true });
});

app.delete('/api/admin/quiz/:id', (req, res) => {
  if (!/^[a-z0-9-]+$/i.test(req.params.id)) return res.status(400).json({ error: 'id invalide' });
  const file = path.join(QUIZ_DIR, req.params.id + '.json');
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'introuvable' });
  fs.unlinkSync(file);
  res.json({ ok: true });
});

function validateQuiz(data) {
  if (!data || typeof data !== 'object') return 'données invalides';
  if (!data.title || typeof data.title !== 'string' || !data.title.trim()) return 'titre manquant';
  if (!Array.isArray(data.questions) || data.questions.length === 0) return 'au moins 1 question requise';
  for (let i = 0; i < data.questions.length; i++) {
    const q = data.questions[i];
    const tag = `Question ${i + 1}`;
    if (!q || !['qcm', 'yesno'].includes(q.type)) return `${tag} : type invalide`;
    if (!q.q || typeof q.q !== 'string' || !q.q.trim()) return `${tag} : énoncé manquant`;
    if (typeof q.time !== 'number' || q.time < 5 || q.time > 300) return `${tag} : durée invalide (5-300 s)`;
    if (q.type === 'qcm') {
      if (!Array.isArray(q.options) || q.options.length !== 4) return `${tag} : un QCM doit avoir 4 options`;
      if (q.options.some(o => !o || typeof o !== 'string' || !o.trim())) return `${tag} : option vide`;
      if (typeof q.answer !== 'number' || q.answer < 0 || q.answer > 3) return `${tag} : sélectionne la bonne réponse`;
    } else {
      if (typeof q.answer !== 'boolean') return `${tag} : sélectionne Vrai ou Faux`;
    }
  }
  return null;
}

app.get('/api/quizzes', (req, res) => {
  if (!fs.existsSync(QUIZ_DIR)) return res.json([]);
  const files = fs.readdirSync(QUIZ_DIR).filter(f => f.endsWith('.json')).sort();
  const list = files.map(f => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(QUIZ_DIR, f), 'utf8'));
      return { id: f.replace(/\.json$/, ''), title: data.title, count: data.questions.length };
    } catch (e) {
      return { id: f.replace(/\.json$/, ''), title: `⚠️ ${f} (erreur de format)`, count: 0 };
    }
  });
  res.json(list);
});

function loadQuiz(id) {
  const file = path.join(QUIZ_DIR, id + '.json');
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return null; }
}

// Session unique — un seul formateur à la fois
let currentSession = null;

function publicQuestion(q) {
  return { type: q.type, q: q.q, options: q.options || null, time: q.time };
}

function leaderboard(session) {
  return [...session.players.values()]
    .sort((a, b) => b.score - a.score)
    .map(p => ({ name: p.name, score: p.score }));
}

function endQuestion(session) {
  if (session.state !== 'question') return;
  if (session.timer) { clearTimeout(session.timer); session.timer = null; }
  const q = session.quiz.questions[session.currentQuestion];
  const results = [];
  for (const [, player] of session.players) {
    const ans = session.answers.get(player.socketId);
    let correct = false, points = 0;
    if (ans) {
      correct = ans.choice === q.answer;
      if (correct) {
        const ratio = Math.min(1, ans.elapsed / (q.time * 1000));
        points = Math.round(1000 * (1 - 0.5 * ratio));
      }
    }
    player.score += points;
    results.push({ name: player.name, correct, points, total: player.score });
  }
  session.state = 'reveal';
  io.to(session.roomId).emit('question:end', {
    correct: q.answer,
    results: results.sort((a, b) => b.total - a.total),
    leaderboard: leaderboard(session),
    isLast: session.currentQuestion >= session.quiz.questions.length - 1,
  });
}

function closeSession(reason) {
  if (!currentSession) return;
  if (currentSession.timer) clearTimeout(currentSession.timer);
  io.to(currentSession.roomId).emit('session:end', {
    leaderboard: leaderboard(currentSession),
    reason,
  });
  currentSession = null;
}

io.on('connection', (socket) => {

  socket.on('host:create', ({ quizId }, cb) => {
    const quiz = loadQuiz(quizId);
    if (!quiz) return cb({ error: 'Quiz introuvable' });
    if (currentSession) closeSession('Nouvelle session démarrée');
    const roomId = `room-${Date.now()}`;
    currentSession = {
      roomId, quiz, hostId: socket.id,
      players: new Map(),      // socketId → { name, score, socketId }
      currentQuestion: -1,
      state: 'lobby',
      answers: new Map(),      // socketId → { choice, elapsed }
      timer: null,
      questionStart: 0,
    };
    socket.join(roomId);
    socket.data.role = 'host';
    socket.data.roomId = roomId;
    cb({ title: quiz.title, total: quiz.questions.length });
  });

  socket.on('host:end', () => {
    if (!currentSession || currentSession.hostId !== socket.id) return;
    closeSession('Session terminée par le formateur');
  });

  socket.on('player:join', ({ name }, cb) => {
    if (!currentSession) return cb({ error: 'Aucune session ouverte pour le moment. Réessaie dans quelques secondes.' });
    if (currentSession.state !== 'lobby') return cb({ error: 'La partie a déjà démarré.' });
    name = (name || '').trim().slice(0, 20);
    if (!name) return cb({ error: 'Prénom requis' });
    if ([...currentSession.players.values()].some(p => p.name.toLowerCase() === name.toLowerCase())) {
      return cb({ error: 'Ce prénom est déjà pris' });
    }
    currentSession.players.set(socket.id, { name, score: 0, socketId: socket.id });
    socket.join(currentSession.roomId);
    socket.data.role = 'player';
    socket.data.roomId = currentSession.roomId;
    socket.data.name = name;
    io.to(currentSession.hostId).emit('lobby:update', {
      players: [...currentSession.players.values()].map(p => ({ name: p.name })),
    });
    cb({ ok: true, name });
  });

  socket.on('host:next', () => {
    if (!currentSession || currentSession.hostId !== socket.id) return;
    if (currentSession.state === 'question') return;
    currentSession.currentQuestion++;
    if (currentSession.currentQuestion >= currentSession.quiz.questions.length) {
      currentSession.state = 'end';
      io.to(currentSession.roomId).emit('session:end', { leaderboard: leaderboard(currentSession) });
      return;
    }
    const q = currentSession.quiz.questions[currentSession.currentQuestion];
    currentSession.answers = new Map();
    currentSession.state = 'question';
    currentSession.questionStart = Date.now();
    io.to(currentSession.roomId).emit('question:start', {
      index: currentSession.currentQuestion,
      total: currentSession.quiz.questions.length,
      question: publicQuestion(q),
    });
    currentSession.timer = setTimeout(() => endQuestion(currentSession), q.time * 1000);
  });

  socket.on('player:answer', ({ choice }) => {
    if (!currentSession || currentSession.state !== 'question') return;
    if (!currentSession.players.has(socket.id)) return;
    if (currentSession.answers.has(socket.id)) return;
    const elapsed = Date.now() - currentSession.questionStart;
    currentSession.answers.set(socket.id, { choice, elapsed });
    io.to(currentSession.hostId).emit('question:answer-count', {
      count: currentSession.answers.size,
      total: currentSession.players.size,
    });
    if (currentSession.players.size > 0 && currentSession.answers.size >= currentSession.players.size) {
      endQuestion(currentSession);
    }
  });

  socket.on('disconnect', () => {
    if (!currentSession) return;
    if (socket.data.role === 'host' && currentSession.hostId === socket.id) {
      closeSession("Le formateur s'est déconnecté");
    } else if (socket.data.role === 'player' && currentSession.players.has(socket.id)) {
      currentSession.players.delete(socket.id);
      if (currentSession.hostId) {
        io.to(currentSession.hostId).emit('lobby:update', {
          players: [...currentSession.players.values()].map(p => ({ name: p.name })),
        });
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`🎯 Quiz PM en ligne sur le port ${PORT}`);
});
