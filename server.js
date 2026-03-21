const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const db = new sqlite3.Database('todos.db');

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

// Delete todo
app.delete('/api/todos/:id', (req, res) => {
  db.run('DELETE FROM todos WHERE id = ?', [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  });
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));
