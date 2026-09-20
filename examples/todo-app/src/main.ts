import { createDabClient, type DabFailure } from "@azure/data-api-builder-js";

type Todo = {
  id: string;
  title: string;
  completed: boolean;
  createdAt: string;
};

const dab = createDabClient(import.meta.env.VITE_DAB_URL ?? "/api");
const todos = dab.entity<Todo>("todos");

const form = getElement<HTMLFormElement>("todo-form");
const titleInput = getElement<HTMLInputElement>("todo-title");
const list = getElement<HTMLUListElement>("todo-list");
const emptyState = getElement<HTMLDivElement>("empty-state");
const count = getElement<HTMLSpanElement>("task-count");
const errorMessage = getElement<HTMLDivElement>("error-message");
const status = getElement<HTMLDivElement>("connection-status");
const template = getElement<HTMLTemplateElement>("todo-template");

let items: Todo[] = [];

form.addEventListener("submit", async event => {
  event.preventDefault();
  const title = titleInput.value.trim();
  if (!title) return;

  setBusy(form, true);
  const result = await todos.create({ title, completed: false });
  setBusy(form, false);

  if (!result.ok) {
    showError(result);
    return;
  }

  titleInput.value = "";
  await loadTodos();
  titleInput.focus();
});

async function loadTodos(): Promise<void> {
  const result = await dab
    .entity<Todo>("todos")
    .orderBy("createdAt", "asc")
    .get();

  if (!result.ok) {
    status.className = "status failed";
    status.lastElementChild!.textContent = "DAB unavailable";
    showError(result);
    return;
  }

  status.className = "status connected";
  status.lastElementChild!.textContent = "Connected to DAB";
  hideError();
  items = result.value;
  render();
}

function render(): void {
  list.replaceChildren(...items.map(renderTodo));
  emptyState.hidden = items.length > 0;
  count.textContent = `${items.length} ${items.length === 1 ? "task" : "tasks"}`;
}

function renderTodo(todo: Todo): HTMLLIElement {
  const fragment = template.content.cloneNode(true) as DocumentFragment;
  const item = fragment.querySelector<HTMLLIElement>(".todo-item")!;
  const toggle = fragment.querySelector<HTMLInputElement>(".todo-toggle")!;
  const title = fragment.querySelector<HTMLSpanElement>(".todo-title")!;
  const deleteButton = fragment.querySelector<HTMLButtonElement>(".delete-button")!;

  toggle.checked = todo.completed;
  toggle.setAttribute("aria-label", `Mark ${todo.title} ${todo.completed ? "incomplete" : "complete"}`);
  title.textContent = todo.title;
  deleteButton.setAttribute("aria-label", `Delete ${todo.title}`);

  toggle.addEventListener("change", async () => {
    const result = await dab
      .entity<Todo>("todos")
      .key("id", todo.id)
      .update({ completed: toggle.checked });

    if (!result.ok) {
      toggle.checked = !toggle.checked;
      showError(result);
      return;
    }

    todo.completed = toggle.checked;
    render();
  });

  deleteButton.addEventListener("click", async () => {
    const result = await dab.entity<Todo>("todos").key("id", todo.id).delete();
    if (!result.ok) {
      showError(result);
      return;
    }

    items = items.filter(item => item.id !== todo.id);
    render();
  });

  return item;
}

function showError(result: DabFailure): void {
  errorMessage.textContent = `${result.error.message} (${result.error.status})`;
  errorMessage.hidden = false;
}

function hideError(): void {
  errorMessage.hidden = true;
  errorMessage.textContent = "";
}

function setBusy(element: HTMLFormElement, busy: boolean): void {
  for (const control of element.elements) {
    if (control instanceof HTMLInputElement || control instanceof HTMLButtonElement) {
      control.disabled = busy;
    }
  }
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element as T;
}

void loadTodos();
