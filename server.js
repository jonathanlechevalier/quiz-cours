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

const sessions = new Map();

function generateCode() {
  let code;
  do { code = String(Math.floor(1000 + Math.random() * 9000)); }
  while (sessions.has(code));
  return code;
}

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
  for (const [sid, player] of session.players) {
    const ans = session.answers.get(sid);
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
  io.to(session.code).emit('question:end', {
    correct: q.answer,
    results: results.sort((a, b) => b.total - a.total),
    leaderboard: leaderboard(session),
    isLast: session.currentQuestion >= session.quiz.questions.length - 1,
  });
}

io.on('connection', (socket) => {
  socket.on('host:create', ({ quizId }, cb) => {
    const quiz = loadQuiz(quizId);
    if (!quiz) return cb({ error: 'Quiz introuvable' });
    const code = generateCode();
    sessions.set(code, {
      code, quiz, hostId: socket.id,
      players: new Map(),
      currentQuestion: -1,
      state: 'lobby',
      answers: new Map(),
      timer: null,
      questionStart: 0,
    });
    socket.join(code);
    socket.data.role = 'host';
    socket.data.code = code;
    cb({ code, title: quiz.title, total: quiz.questions.length });
  });

  socket.on('player:join', ({ code, name }, cb) => {
    const session = sessions.get(code);
    if (!session) return cb({ error: 'Code invalide' });
    if (session.state !== 'lobby') return cb({ error: 'La partie a déjà démarré' });
    name = (name || '').trim().slice(0, 20);
    if (!name) return cb({ error: 'Prénom requis' });
    if ([...session.players.values()].some(p => p.name.toLowerCase() === name.toLowerCase())) {
      return cb({ error: 'Ce prénom est déjà pris' });
    }
    session.players.set(socket.id, { name, score: 0 });
    socket.join(code);
    socket.data.role = 'player';
    socket.data.code = code;
    socket.data.name = name;
    io.to(session.hostId).emit('lobby:update', {
      players: [...session.players.values()].map(p => ({ name: p.name })),
    });
    cb({ ok: true, name });
  });

  socket.on('host:next', () => {
    const session = sessions.get(socket.data.code);
    if (!session || session.hostId !== socket.id) return;
    if (session.state === 'question') return;
    session.currentQuestion++;
    if (session.currentQuestion >= session.quiz.questions.length) {
      session.state = 'end';
      io.to(session.code).emit('session:end', { leaderboard: leaderboard(session) });
      return;
    }
    const q = session.quiz.questions[session.currentQuestion];
    session.answers = new Map();
    session.state = 'question';
    session.questionStart = Date.now();
    io.to(session.code).emit('question:start', {
      index: session.currentQuestion,
      total: session.quiz.questions.length,
      question: publicQuestion(q),
    });
    session.timer = setTimeout(() => endQuestion(session), q.time * 1000);
  });

  socket.on('player:answer', ({ choice }) => {
    const session = sessions.get(socket.data.code);
    if (!session || session.state !== 'question') return;
    if (session.answers.has(socket.id)) return;
    const elapsed = Date.now() - session.questionStart;
    session.answers.set(socket.id, { choice, elapsed });
    io.to(session.hostId).emit('question:answer-count', {
      count: session.answers.size,
      total: session.players.size,
    });
    if (session.players.size > 0 && session.answers.size >= session.players.size) {
      endQuestion(session);
    }
  });

  socket.on('disconnect', () => {
    const code = socket.data.code;
    if (!code) return;
    const session = sessions.get(code);
    if (!session) return;
    if (socket.data.role === 'host') {
      io.to(code).emit('session:end', {
        leaderboard: leaderboard(session),
        reason: "L'hôte s'est déconnecté",
      });
      if (session.timer) clearTimeout(session.timer);
      sessions.delete(code);
    } else if (socket.data.role === 'player') {
      session.players.delete(socket.id);
      io.to(session.hostId).emit('lobby:update', {
        players: [...session.players.values()].map(p => ({ name: p.name })),
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`🎯 Quiz PM en ligne sur le port ${PORT}`);
});
