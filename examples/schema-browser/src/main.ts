import { createDabClient, type DabFailure } from "@mssql-connectors/dab-js";

type DatabaseObject = {
  objectId: number;
  schemaName: string;
  objectName: string;
  objectType: "TABLE" | "VIEW";
  columnCount: number;
  createDate: string;
  modifyDate: string;
};

type Column = {
  objectId: number;
  columnId: number;
  columnName: string;
  dataType: string;
  maxLength: number;
  precisionValue: number;
  scaleValue: number;
  isNullable: boolean;
  isIdentity: boolean;
  isComputed: boolean;
  isPrimaryKey: boolean;
  defaultDefinition: string | null;
};

type Index = {
  objectId: number;
  indexId: number;
  indexName: string;
  indexType: string;
  isUnique: boolean;
  isPrimaryKey: boolean;
  isDisabled: boolean;
  columns: string;
};

type Relationship = {
  foreignKeyId: number;
  columnOrdinal: number;
  foreignKeyName: string;
  parentObjectId: number;
  parentSchema: string;
  parentTable: string;
  parentColumn: string;
  referencedObjectId: number;
  referencedSchema: string;
  referencedTable: string;
  referencedColumn: string;
  deleteAction: string;
  updateAction: string;
};

const dab = createDabClient(import.meta.env.VITE_DAB_URL ?? "/api");
const status = getElement<HTMLDivElement>("connection-status");
const search = getElement<HTMLInputElement>("search");
const schemaList = getElement<HTMLElement>("schema-list");
const welcome = getElement<HTMLDivElement>("welcome");
const detail = getElement<HTMLElement>("object-detail");
const errorMessage = getElement<HTMLDivElement>("error-message");
const schemaTemplate = getElement<HTMLTemplateElement>("schema-template");
const objectTemplate = getElement<HTMLTemplateElement>("object-template");

let objects: DatabaseObject[] = [];
let columns: Column[] = [];
let indexes: Index[] = [];
let relationships: Relationship[] = [];
let selectedObjectId: number | undefined;

search.addEventListener("input", renderNavigation);

document.querySelectorAll<HTMLButtonElement>("[role=tab]").forEach(button => {
  button.addEventListener("click", () => selectTab(button.dataset.tab!));
});

async function loadCatalog(): Promise<void> {
  const results = await Promise.all([
    getAll<DatabaseObject>("databaseObjects"),
    getAll<Column>("databaseColumns"),
    getAll<Index>("databaseIndexes"),
    getAll<Relationship>("databaseRelationships")
  ]);
  const failure = results.find(result => !result.ok);

  if (failure && !failure.ok) {
    status.className = "status failed";
    status.lastElementChild!.textContent = "DAB unavailable";
    showError(failure);
    return;
  }

  [objects, columns, indexes, relationships] = results.map(result =>
    result.ok ? result.value : []
  ) as [DatabaseObject[], Column[], Index[], Relationship[]];

  status.className = "status connected";
  status.lastElementChild!.textContent = `${objects.length} objects`;
  renderNavigation();
}

async function getAll<T>(entity: string): Promise<{ ok: true; value: T[] } | DabFailure> {
  let result = await dab.entity<T>(entity).first(1000).get();
  if (!result.ok) return result;

  const values = [...result.value];
  while (result.hasNextPage) {
    result = await result.next();
    if (!result.ok) return result;
    values.push(...result.value);
  }
  return { ok: true, value: values };
}

function renderNavigation(): void {
  const term = search.value.trim().toLocaleLowerCase();
  const filtered = objects.filter(object =>
    `${object.schemaName}.${object.objectName}`.toLocaleLowerCase().includes(term)
  );
  const schemas = new Map<string, DatabaseObject[]>();
  for (const object of filtered) {
    const schemaObjects = schemas.get(object.schemaName) ?? [];
    schemaObjects.push(object);
    schemas.set(object.schemaName, schemaObjects);
  }

  schemaList.replaceChildren(
    ...[...schemas.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([schemaName, schemaObjects]) => renderSchema(schemaName, schemaObjects))
  );
}

function renderSchema(schemaName: string, schemaObjects: DatabaseObject[]): HTMLElement {
  const fragment = schemaTemplate.content.cloneNode(true) as DocumentFragment;
  const section = fragment.querySelector<HTMLElement>(".schema-group")!;
  const toggle = fragment.querySelector<HTMLButtonElement>(".schema-toggle")!;
  const list = fragment.querySelector<HTMLDivElement>(".object-list")!;

  fragment.querySelector<HTMLElement>(".schema-name")!.textContent = schemaName;
  fragment.querySelector<HTMLElement>(".schema-count")!.textContent = String(schemaObjects.length);
  list.replaceChildren(
    ...schemaObjects
      .sort((left, right) => left.objectName.localeCompare(right.objectName))
      .map(renderObjectButton)
  );

  toggle.addEventListener("click", () => {
    toggle.setAttribute("aria-expanded", String(toggle.getAttribute("aria-expanded") !== "true"));
  });
  return section;
}

function renderObjectButton(object: DatabaseObject): HTMLButtonElement {
  const fragment = objectTemplate.content.cloneNode(true) as DocumentFragment;
  const button = fragment.querySelector<HTMLButtonElement>(".object-button")!;
  button.classList.toggle("selected", object.objectId === selectedObjectId);
  button.querySelector<HTMLElement>(".object-icon")!.textContent =
    object.objectType === "TABLE" ? "▦" : "◇";
  button.querySelector<HTMLElement>(".object-label")!.textContent = object.objectName;
  button.addEventListener("click", () => selectObject(object));
  return button;
}

function selectObject(object: DatabaseObject): void {
  selectedObjectId = object.objectId;
  renderNavigation();
  welcome.hidden = true;
  detail.hidden = false;

  getElement<HTMLElement>("object-type").textContent = object.objectType;
  getElement<HTMLElement>("object-name").textContent = `${object.schemaName}.${object.objectName}`;
  getElement<HTMLElement>("object-meta").textContent =
    `${object.columnCount} columns · modified ${new Date(object.modifyDate).toLocaleDateString()}`;

  renderColumns(object.objectId);
  renderIndexes(object.objectId);
  renderRelationships(object.objectId);
  selectTab("columns");
}

function renderColumns(objectId: number): void {
  const rows = columns
    .filter(column => column.objectId === objectId)
    .sort((left, right) => left.columnId - right.columnId);
  getElement<HTMLElement>("columns-panel").innerHTML = rows.length
    ? `<table class="data-table">
        <thead><tr><th>Name</th><th>Type</th><th>Nullable</th><th>Properties</th><th>Default</th></tr></thead>
        <tbody>${rows.map(column => `
          <tr>
            <td class="code">${escapeHtml(column.columnName)}</td>
            <td><span class="type-badge code">${escapeHtml(formatType(column))}</span></td>
            <td>${column.isNullable ? "Yes" : "No"}</td>
            <td>${[
              column.isPrimaryKey ? "Primary key" : "",
              column.isIdentity ? "Identity" : "",
              column.isComputed ? "Computed" : ""
            ].filter(Boolean).map(value => `<span class="yes">${value}</span>`).join(" · ") || "—"}</td>
            <td class="code">${escapeHtml(column.defaultDefinition ?? "—")}</td>
          </tr>`).join("")}</tbody>
      </table>`
    : emptyPanel("No columns found.");
}

function renderIndexes(objectId: number): void {
  const rows = indexes.filter(index => index.objectId === objectId);
  getElement<HTMLElement>("indexes-panel").innerHTML = rows.length
    ? `<table class="data-table">
        <thead><tr><th>Name</th><th>Type</th><th>Columns</th><th>Properties</th></tr></thead>
        <tbody>${rows.map(index => `
          <tr>
            <td class="code">${escapeHtml(index.indexName)}</td>
            <td>${escapeHtml(index.indexType)}</td>
            <td class="code">${escapeHtml(index.columns)}</td>
            <td>${[
              index.isPrimaryKey ? "Primary key" : "",
              index.isUnique ? "Unique" : "",
              index.isDisabled ? "Disabled" : ""
            ].filter(Boolean).join(" · ") || "—"}</td>
          </tr>`).join("")}</tbody>
      </table>`
    : emptyPanel("No indexes found.");
}

function renderRelationships(objectId: number): void {
  const rows = relationships.filter(
    relationship =>
      relationship.parentObjectId === objectId || relationship.referencedObjectId === objectId
  );
  getElement<HTMLElement>("relationships-panel").innerHTML = rows.length
    ? rows.map(relationship => `
        <article class="relationship-card">
          <p><strong>${escapeHtml(relationship.foreignKeyName)}</strong></p>
          <p class="code">${escapeHtml(`${relationship.parentSchema}.${relationship.parentTable}.${relationship.parentColumn}`)}
            → ${escapeHtml(`${relationship.referencedSchema}.${relationship.referencedTable}.${relationship.referencedColumn}`)}</p>
          <p class="muted">On delete: ${escapeHtml(relationship.deleteAction)} · On update: ${escapeHtml(relationship.updateAction)}</p>
        </article>`).join("")
    : emptyPanel("No foreign-key relationships found.");
}

function selectTab(name: string): void {
  document.querySelectorAll<HTMLButtonElement>("[role=tab]").forEach(button => {
    button.setAttribute("aria-selected", String(button.dataset.tab === name));
  });
  document.querySelectorAll<HTMLElement>(".tab-panel").forEach(panel => {
    panel.hidden = panel.id !== `${name}-panel`;
  });
}

function formatType(column: Column): string {
  if (["nvarchar", "varchar", "nchar", "char", "binary", "varbinary"].includes(column.dataType)) {
    const length = column.maxLength === -1 ? "max" :
      String(column.dataType.startsWith("n") ? column.maxLength / 2 : column.maxLength);
    return `${column.dataType}(${length})`;
  }
  if (["decimal", "numeric"].includes(column.dataType)) {
    return `${column.dataType}(${column.precisionValue},${column.scaleValue})`;
  }
  return column.dataType;
}

function emptyPanel(message: string): string {
  return `<div class="empty-panel muted">${escapeHtml(message)}</div>`;
}

function showError(result: DabFailure): void {
  errorMessage.textContent = `${result.error.message} (${result.error.status})`;
  errorMessage.hidden = false;
}

function escapeHtml(value: string): string {
  const element = document.createElement("span");
  element.textContent = value;
  return element.innerHTML;
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element as T;
}

void loadCatalog();
