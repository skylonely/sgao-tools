import { CATEGORIES, toolByKey, matchesTool } from './lib/pages.js';

export function initDirectory() {
  const $ = id => document.getElementById(id);
  const search = $('tool-search');
  let category = 'all';
  function filter() {
    let count = 0;
    document.querySelectorAll('[data-card]').forEach(card => {
      const visible = matchesTool(toolByKey(card.dataset.card), search.value, category);
      card.hidden = !visible;
      count += Number(visible);
    });
    const active = category !== 'all' || !!search.value.trim();
    $('directory-status').hidden = !active;
    $('directory-status').textContent = `找到 ${count} 个工具`;
    $('directory-empty').hidden = count > 0;
    $('search-clear').hidden = !search.value;
    document.querySelectorAll('[data-category]').forEach(button => {
      const selected = button.dataset.category === category;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }
  search.addEventListener('input', filter);
  search.addEventListener('keydown', event => { if (event.key === 'Escape') { search.value = ''; filter(); } });
  for (const button of document.querySelectorAll('[data-category]')) button.addEventListener('click', () => {
    if (CATEGORIES.some(item => item.key === button.dataset.category)) { category = button.dataset.category; filter(); }
  });
  $('search-clear').addEventListener('click', () => { search.value = ''; filter(); search.focus(); });
  $('directory-reset').addEventListener('click', () => { category = 'all'; search.value = ''; filter(); search.focus(); });
  // Form values can be restored by the browser when returning from a tool.
  window.addEventListener('pageshow', filter);
  $('directory-controls').hidden = false;
  filter();
}
