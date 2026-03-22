// ── Auth helpers ───────────────────────────────────────────────────────────────

function getToken() { return localStorage.getItem('token'); }
function setToken(t) { localStorage.setItem('token', t); }
function clearToken() { localStorage.removeItem('token'); }

async function authFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}`, ...options.headers }
  });
  if (res.status === 401) { logout(); return res; }
  return res;
}

// ── Auth UI ────────────────────────────────────────────────────────────────────

const authView = document.getElementById('auth-view');
const appView = document.getElementById('app-view');

function showAuthView() {
  authView.classList.remove('hidden');
  appView.classList.add('hidden');
}

function showAppView(username) {
  document.getElementById('username-display').textContent = username;
  authView.classList.add('hidden');
  appView.classList.remove('hidden');
  fetchTodos();
}

function checkAuth() {
  const token = getToken();
  if (!token) return showAuthView();

  try {
    // Decode JWT payload (no verification, server will verify on API calls)
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      clearToken();
      return showAuthView();
    }
    showAppView(payload.username);
  } catch {
    clearToken();
    showAuthView();
  }
}

// Tab switching
document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.dataset.tab;
    document.getElementById('login-form').classList.toggle('hidden', target !== 'login');
    document.getElementById('register-form').classList.toggle('hidden', target !== 'register');
    document.getElementById('login-error').classList.add('hidden');
    document.getElementById('register-error').classList.add('hidden');
  });
});

// Login
document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.classList.add('hidden');

  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if (!res.ok) {
    errEl.textContent = data.error;
    errEl.classList.remove('hidden');
    return;
  }
  setToken(data.token);
  showAppView(data.username);
});

// Register
document.getElementById('register-form').addEventListener('submit', async e => {
  e.preventDefault();
  const username = document.getElementById('reg-username').value.trim();
  const password = document.getElementById('reg-password').value;
  const errEl = document.getElementById('register-error');
  errEl.classList.add('hidden');

  const res = await fetch('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if (!res.ok) {
    errEl.textContent = data.error;
    errEl.classList.remove('hidden');
    return;
  }
  setToken(data.token);
  showAppView(data.username);
});

// Logout
function logout() {
  clearToken();
  todos = [];
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
  document.getElementById('reg-username').value = '';
  document.getElementById('reg-password').value = '';
  showAuthView();
}

document.getElementById('logout-btn').addEventListener('click', logout);

// ── Todo state ─────────────────────────────────────────────────────────────────

let todos = [];
let filter = 'all';

const list = document.getElementById('todo-list');
const input = document.getElementById('todo-input');
const form = document.getElementById('todo-form');
const countEl = document.getElementById('count');
const emptyState = document.getElementById('empty-state');
const aiBtn = document.getElementById('ai-suggest-btn');
const aiModal = document.getElementById('ai-modal');
const aiModalBody = document.getElementById('ai-modal-body');
const aiModalClose = document.getElementById('ai-modal-close');

// ── Todo API ───────────────────────────────────────────────────────────────────

async function fetchTodos() {
  const res = await authFetch('/api/todos');
  if (!res.ok) return;
  todos = await res.json();
  render();
}

async function addTodo(text) {
  const res = await authFetch('/api/todos', {
    method: 'POST',
    body: JSON.stringify({ text })
  });
  if (res.ok) {
    const todo = await res.json();
    todos.unshift(todo);
    render();
  }
}

async function toggleTodo(id) {
  const res = await authFetch(`/api/todos/${id}`, { method: 'PATCH' });
  if (res.ok) {
    const updated = await res.json();
    todos = todos.map(t => t.id === id ? updated : t);
    render();
  }
}

async function editTodo(id, text) {
  const res = await authFetch(`/api/todos/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ text })
  });
  if (res.ok) {
    const updated = await res.json();
    todos = todos.map(t => t.id === id ? updated : t);
    render();
  }
}

async function deleteTodo(id) {
  const res = await authFetch(`/api/todos/${id}`, { method: 'DELETE' });
  if (res.ok) {
    todos = todos.filter(t => t.id !== id);
    render();
  }
}

async function getAiSuggestion() {
  aiModal.classList.remove('hidden');
  aiModalBody.innerHTML = '<div class="ai-loading">Analyzing your todos...</div>';

  try {
    const res = await authFetch('/api/ai-suggest', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unknown error');
    aiModalBody.innerHTML = `<div class="ai-result">${formatMarkdown(data.suggestion)}</div>`;
  } catch (e) {
    aiModalBody.innerHTML = `<div class="ai-error">Error: ${escapeHtml(e.message)}</div>`;
  }
}

// ── Render ─────────────────────────────────────────────────────────────────────

function formatMarkdown(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function render() {
  const visible = todos.filter(t => {
    if (filter === 'active') return !t.completed;
    if (filter === 'completed') return t.completed;
    return true;
  });

  const active = todos.filter(t => !t.completed).length;
  countEl.textContent = `${active} task${active !== 1 ? 's' : ''} remaining`;

  list.innerHTML = '';
  visible.forEach(todo => {
    const li = document.createElement('li');
    li.className = `todo-item${todo.completed ? ' completed' : ''}`;
    li.innerHTML = `
      <div class="todo-checkbox" role="checkbox" aria-checked="${todo.completed}" title="Toggle complete"></div>
      <span class="todo-text">${escapeHtml(todo.text)}</span>
      <input class="edit-input hidden" type="text" maxlength="200" value="${escapeHtml(todo.text)}">
      <button class="edit-btn" title="Edit">&#x270E;</button>
      <button class="delete-btn" title="Delete">&#x2715;</button>
    `;

    li.querySelector('.todo-checkbox').addEventListener('click', () => toggleTodo(todo.id));
    li.querySelector('.delete-btn').addEventListener('click', () => deleteTodo(todo.id));

    const editBtn = li.querySelector('.edit-btn');
    const editInput = li.querySelector('.edit-input');
    const textSpan = li.querySelector('.todo-text');

    editBtn.addEventListener('click', () => {
      const isEditing = !editInput.classList.contains('hidden');
      if (isEditing) {
        const newText = editInput.value.trim();
        if (newText && newText !== todo.text) {
          editTodo(todo.id, newText);
        } else {
          editInput.classList.add('hidden');
          textSpan.classList.remove('hidden');
          editBtn.innerHTML = '&#x270E;';
          editBtn.title = 'Edit';
        }
      } else {
        editInput.classList.remove('hidden');
        textSpan.classList.add('hidden');
        editBtn.innerHTML = '&#x2713;';
        editBtn.title = 'Save';
        editInput.focus();
        editInput.select();
      }
    });

    editInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') editBtn.click();
      if (e.key === 'Escape') {
        editInput.value = todo.text;
        editInput.classList.add('hidden');
        textSpan.classList.remove('hidden');
        editBtn.innerHTML = '&#x270E;';
        editBtn.title = 'Edit';
      }
    });

    list.appendChild(li);
  });

  emptyState.classList.toggle('hidden', visible.length > 0);
  aiBtn.classList.toggle('hidden', todos.length === 0);
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Event listeners ────────────────────────────────────────────────────────────

form.addEventListener('submit', e => {
  e.preventDefault();
  const text = input.value.trim();
  if (text) { addTodo(text); input.value = ''; }
});

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    filter = btn.dataset.filter;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    render();
  });
});

aiBtn.addEventListener('click', getAiSuggestion);
aiModalClose.addEventListener('click', () => aiModal.classList.add('hidden'));
aiModal.addEventListener('click', e => { if (e.target === aiModal) aiModal.classList.add('hidden'); });

// ── Init ───────────────────────────────────────────────────────────────────────

checkAuth();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
