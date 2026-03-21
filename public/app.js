let todos = [];
let filter = 'all';

const list = document.getElementById('todo-list');
const input = document.getElementById('todo-input');
const form = document.getElementById('todo-form');
const countEl = document.getElementById('count');
const emptyState = document.getElementById('empty-state');

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

async function deleteTodo(id) {
  const res = await fetch(`/api/todos/${id}`, { method: 'DELETE' });
  if (res.ok) {
    todos = todos.filter(t => t.id !== id);
    render();
  }
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
      <button class="delete-btn" title="Delete">&#x2715;</button>
    `;
    li.querySelector('.todo-checkbox').addEventListener('click', () => toggleTodo(todo.id));
    li.querySelector('.delete-btn').addEventListener('click', () => deleteTodo(todo.id));
    list.appendChild(li);
  });

  emptyState.classList.toggle('hidden', visible.length > 0);
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

fetchTodos();
