require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
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
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS todos (
      id SERIAL PRIMARY KEY,
      text TEXT NOT NULL,
      completed BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      user_id INTEGER REFERENCES users(id)
    )
  `);
}

initDb().catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
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
    const result = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id',
      [username.trim(), passwordHash]
    );
    const token = jwt.sign({ id: result.rows[0].id, username: username.trim() }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, username: username.trim() });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'Username already taken' });
    }
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username.trim()]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid username or password' });

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, username: user.username });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Todo routes (all protected) ────────────────────────────────────────────────

app.get('/api/todos', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM todos WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/todos', authenticateToken, async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Text is required' });
  try {
    const result = await pool.query(
      'INSERT INTO todos (text, user_id) VALUES ($1, $2) RETURNING *',
      [text.trim(), req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/todos/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const select = await pool.query(
      'SELECT * FROM todos WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (select.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const row = select.rows[0];
    const updated = await pool.query(
      'UPDATE todos SET completed = $1 WHERE id = $2 RETURNING *',
      [!row.completed, id]
    );
    res.json(updated.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/todos/:id', authenticateToken, async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Text is required' });
  const { id } = req.params;
  try {
    const result = await pool.query(
      'UPDATE todos SET text = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
      [text.trim(), id, req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/todos/:id', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM todos WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/ai-suggest', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM todos WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    const rows = result.rows;
    if (rows.length === 0) return res.status(400).json({ error: 'No todos to analyze' });

    const todoList = rows.map((t, i) =>
      `${i + 1}. [${t.completed ? 'DONE' : 'TODO'}] ${t.text}`
    ).join('\n');

    const prompt = `Berikut adalah daftar todo saya:\n\n${todoList}\n\nAnalisa todo list ini dan berikan rekomendasi prioritas mana yang harus dikerjakan duluan. Pertimbangkan todo yang belum selesai (TODO). Berikan output dalam format:\n\n**Rekomendasi Prioritas:**\n1. (todo paling penting) - alasan singkat\n2. ...\n\n**Saran Tambahan:** (opsional, jika ada pola atau insight menarik dari todo list ini)`;

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

app.listen(3000, () => console.log('Server running on http://localhost:3000'));
