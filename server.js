require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('Error: JWT_SECRET environment variable is required');
  process.exit(1);
}

function fileHash(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('md5').update(content).digest('hex').slice(0, 8);
}

const app = express();
const db = new sqlite3.Database(process.env.DB_PATH || 'todos.db');

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      user_id INTEGER REFERENCES users(id)
    )
  `);

  // Migrate existing DB: add user_id if not present (ignore error if already exists)
  db.run(`ALTER TABLE todos ADD COLUMN user_id INTEGER REFERENCES users(id)`, () => {});
});

app.use(express.json());

function authenticateToken(req, res, next) {
  const token = (req.headers['authorization'] || '').split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(401).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
}

// Service worker must not be cached
app.get('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

app.get('/', (req, res) => {
  const cssHash = fileHash(path.join(__dirname, 'public', 'style.css'));
  const jsHash = fileHash(path.join(__dirname, 'public', 'app.js'));
  let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  html = html
    .replace('href="style.css"', `href="style.css?v=${cssHash}"`)
    .replace('src="app.js"', `src="app.js?v=${jsHash}"`);
  res.send(html);
});

app.use(express.static(path.join(__dirname, 'public')));

// ── Auth routes ────────────────────────────────────────────────────────────────

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !username.trim()) return res.status(400).json({ error: 'Username is required' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    db.run(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)',
      [username.trim(), passwordHash],
      function (err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(409).json({ error: 'Username already taken' });
          }
          return res.status(500).json({ error: err.message });
        }
        const token = jwt.sign({ id: this.lastID, username: username.trim() }, JWT_SECRET, { expiresIn: '7d' });
        res.status(201).json({ token, username: username.trim() });
      }
    );
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

  db.get('SELECT * FROM users WHERE username = ?', [username.trim()], async (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });

    try {
      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) return res.status(401).json({ error: 'Invalid username or password' });
      const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
      res.json({ token, username: user.username });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});

// ── Todo routes (all protected) ────────────────────────────────────────────────

const toTodo = row => row ? { ...row, completed: Boolean(row.completed) } : null;

app.get('/api/todos', authenticateToken, (req, res) => {
  db.all('SELECT * FROM todos WHERE user_id = ? ORDER BY created_at DESC', [req.user.id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows.map(toTodo));
  });
});

app.post('/api/todos', authenticateToken, (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Text is required' });
  db.run('INSERT INTO todos (text, user_id) VALUES (?, ?)', [text.trim(), req.user.id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    db.get('SELECT * FROM todos WHERE id = ?', [this.lastID], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json(toTodo(row));
    });
  });
});

app.patch('/api/todos/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  db.get('SELECT * FROM todos WHERE id = ? AND user_id = ?', [id, req.user.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Not found' });
    db.run('UPDATE todos SET completed = ? WHERE id = ?', [row.completed ? 0 : 1, id], err => {
      if (err) return res.status(500).json({ error: err.message });
      db.get('SELECT * FROM todos WHERE id = ?', [id], (err, updated) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(toTodo(updated));
      });
    });
  });
});

app.put('/api/todos/:id', authenticateToken, (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Text is required' });
  const { id } = req.params;
  db.run('UPDATE todos SET text = ? WHERE id = ? AND user_id = ?', [text.trim(), id, req.user.id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Not found' });
    db.get('SELECT * FROM todos WHERE id = ?', [id], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(toTodo(row));
    });
  });
});

app.delete('/api/todos/:id', authenticateToken, (req, res) => {
  db.run('DELETE FROM todos WHERE id = ? AND user_id = ?', [req.params.id, req.user.id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  });
});

app.post('/api/ai-suggest', authenticateToken, (req, res) => {
  db.all('SELECT * FROM todos WHERE user_id = ? ORDER BY created_at DESC', [req.user.id], async (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    if (rows.length === 0) return res.status(400).json({ error: 'No todos to analyze' });

    const todoList = rows.map((t, i) =>
      `${i + 1}. [${t.completed ? 'DONE' : 'TODO'}] ${t.text}`
    ).join('\n');

    const prompt = `Berikut adalah daftar todo saya:\n\n${todoList}\n\nAnalisa todo list ini dan berikan rekomendasi prioritas mana yang harus dikerjakan duluan. Pertimbangkan todo yang belum selesai (TODO). Berikan output dalam format:\n\n**Rekomendasi Prioritas:**\n1. (todo paling penting) - alasan singkat\n2. ...\n\n**Saran Tambahan:** (opsional, jika ada pola atau insight menarik dari todo list ini)`;

    try {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const message = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }]
      });
      res.json({ suggestion: message.content[0].text });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));
