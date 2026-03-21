require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');

function fileHash(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('md5').update(content).digest('hex').slice(0, 8);
}

const app = express();
const db = new sqlite3.Database(process.env.DB_PATH || 'todos.db');

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

app.use(express.json());

// Service worker must not be cached — browser checks for updates
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

const toTodo = row => row ? { ...row, completed: Boolean(row.completed) } : null;

// Get all todos
app.get('/api/todos', (req, res) => {
  db.all('SELECT * FROM todos ORDER BY created_at DESC', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows.map(toTodo));
  });
});

// Create todo
app.post('/api/todos', (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Text is required' });
  db.run('INSERT INTO todos (text) VALUES (?)', [text.trim()], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    db.get('SELECT * FROM todos WHERE id = ?', [this.lastID], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json(toTodo(row));
    });
  });
});

// Toggle complete
app.patch('/api/todos/:id', (req, res) => {
  const { id } = req.params;
  db.get('SELECT * FROM todos WHERE id = ?', [id], (err, row) => {
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

// Edit todo text
app.put('/api/todos/:id', (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Text is required' });
  const { id } = req.params;
  db.run('UPDATE todos SET text = ? WHERE id = ?', [text.trim(), id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Not found' });
    db.get('SELECT * FROM todos WHERE id = ?', [id], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(toTodo(row));
    });
  });
});

// Delete todo
app.delete('/api/todos/:id', (req, res) => {
  db.run('DELETE FROM todos WHERE id = ?', [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  });
});

// AI suggest priorities
app.post('/api/ai-suggest', (req, res) => {
  db.all('SELECT * FROM todos ORDER BY created_at DESC', async (err, rows) => {
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
