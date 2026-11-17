/**
 * Suggestions de saisie (motif ARIA 1.2 « combobox + listbox » en saisie libre) : contrairement à
 * `combobox()` de app.js, qui impose un choix dans une liste fermée, ici le texte tapé reste toujours
 * valable et les suggestions ne sont qu'une aide.
 *
 * `fetchItems(query, signal)` renvoie (ou promet) un tableau d'éléments `{ label, ...autres }`.
 * `onPick(item)` est appelé quand l'utilisateur en choisit un (souris, ou flèches + Entrée).
 */
export function attachSuggest(input, { fetchItems, onPick, minChars = 2, delay = 0, unavailable = 'Suggestions indisponibles : saisie libre.' }) {
  const listId = `${input.id}-suggest`;
  const wrap = document.createElement('div');
  wrap.className = 'combo';
  input.parentNode.insertBefore(wrap, input);
  const list = document.createElement('ul');
  list.className = 'combo-list';
  list.id = listId;
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  const status = document.createElement('p');
  status.className = 'fr-sr-only';
  status.setAttribute('role', 'status');
  wrap.append(input, list, status);

  input.setAttribute('role', 'combobox');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', listId);
  list.setAttribute('aria-label', input.labels?.[0]?.firstChild?.textContent?.trim() || 'Suggestions');

  let items = [];
  let active = -1;
  let timer = null;
  let controller = null;
  let ticket = 0; // ignore les réponses arrivées après une saisie plus récente

  const close = () => {
    list.hidden = true;
    active = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };
  const setActive = (i) => {
    active = i;
    list.querySelectorAll('[role="option"]').forEach((li, k) => li.setAttribute('aria-selected', String(k === i)));
    if (i >= 0) {
      input.setAttribute('aria-activedescendant', `${listId}-${i}`);
      list.querySelector(`#${listId}-${i}`)?.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  };
  const choose = (item) => {
    close();
    onPick(item);
  };
  const show = (found) => {
    items = found;
    if (items.length === 0) {
      close();
      status.textContent = '';
      return;
    }
    list.replaceChildren(
      ...items.map((item, i) => {
        const li = document.createElement('li');
        li.id = `${listId}-${i}`;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');
        li.textContent = item.label;
        // mousedown (et non click) : le champ ne perd pas le focus avant le choix
        li.addEventListener('mousedown', (e) => {
          e.preventDefault();
          choose(item);
        });
        return li;
      }),
    );
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    setActive(-1);
    status.textContent = `${items.length} suggestion${items.length > 1 ? 's' : ''}`;
  };

  const run = async () => {
    const query = input.value.replace(/\s+/g, ' ').trim();
    const mine = ++ticket;
    controller?.abort();
    if (query.length < minChars) {
      show([]);
      return;
    }
    controller = new AbortController();
    try {
      const found = await fetchItems(query, controller.signal);
      if (mine === ticket) show(found);
    } catch (err) {
      if (err?.name === 'AbortError' || mine !== ticket) return;
      show([]);
      status.textContent = unavailable; // l'aide est facultative : la saisie libre continue de fonctionner
    }
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(run, delay);
  });
  input.addEventListener('blur', () => {
    clearTimeout(timer);
    ticket++; // une réponse tardive ne doit pas rouvrir la liste
    controller?.abort();
    close();
  });
  input.addEventListener('keydown', (e) => {
    const open = !list.hidden;
    if (e.key === 'ArrowDown' && open) {
      e.preventDefault();
      setActive(Math.min(active + 1, items.length - 1));
    } else if (e.key === 'ArrowUp' && open) {
      e.preventDefault();
      setActive(Math.max(active - 1, 0));
    } else if (e.key === 'Enter' && open && active >= 0) {
      e.preventDefault(); // choisir la suggestion, sans valider le formulaire ni ajouter une ligne
      choose(items[active]);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      close();
    }
  });
}
