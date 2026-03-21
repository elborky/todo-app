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

async function fetchTodos() {
  const res = await fetch('/api/todos');
  todos = await res.json();
  render();
}

async function addTodo(text) {
  const res = await fetch('/api/todos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  if (res.ok) {
    const todo = await res.json();
    todos.unshift(todo);
    render();
  }
}

async function toggleTodo(id) {
  const res = await fetch(`/api/todos/${id}`, { method: 'PATCH' });
  if (res.ok) {
    const updated = await res.json();
    todos = todos.map(t => t.id === id ? updated : t);
    render();
  }
}

async function editTodo(id, text) {
  const res = await fetch(`/api/todos/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  if (res.ok) {
    const updated = await res.json();
    todos = todos.map(t => t.id === id ? updated : t);
    render();
  }
}

async function deleteTodo(id) {
  const res = await fetch(`/api/todos/${id}`, { method: 'DELETE' });
  if (res.ok) {
    todos = todos.filter(t => t.id !== id);
    render();
  }
}

async function getAiSuggestion() {
  aiModal.classList.remove('hidden');
  aiModalBody.innerHTML = '<div class="ai-loading">Analyzing your todos...</div>';

  try {
    const res = await fetch('/api/ai-suggest', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unknown error');
    aiModalBody.innerHTML = `<div class="ai-result">${formatMarkdown(data.suggestion)}</div>`;
  } catch (e) {
    aiModalBody.innerHTML = `<div class="ai-error">Error: ${escapeHtml(e.message)}</div>`;
  }
}

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
  if (todos.length > 0) {
    aiBtn.classList.remove('hidden');
  } else {
    aiBtn.classList.add('hidden');
  }
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

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

fetchTodos();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
