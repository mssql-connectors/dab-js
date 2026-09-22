import { createDabClient, type DabPage } from "@mssql-connectors/dab-js";

type Contribution = {
  id: string;
  repository: string;
  number: number;
  itemType: "issue" | "pull_request";
  isAuthored: boolean;
  isCommented: boolean;
};

type TimelineEvent = {
  eventId: string;
  repository: string;
  number: number;
  itemType: "issue" | "pull_request";
  title: string;
  threadUrl: string;
  participation: string;
  eventType: string;
  actor: string | null;
  summary: string;
  eventUrl: string;
  occurredAt: string;
};

type SyncStatus = {
  id: string;
  lastSuccessAt: string | null;
  lastError: string | null;
  threadCount: number;
};

const dab = createDabClient("/github/api");
const timeline = getElement<HTMLOListElement>("timeline");
const loadMore = getElement<HTMLButtonElement>("load-more");
const error = getElement<HTMLDivElement>("error");
const empty = getElement<HTMLDivElement>("empty");
const resultCount = getElement<HTMLSpanElement>("result-count");
const repositoryFilter = getElement<HTMLSelectElement>("repository-filter");
const typeFilter = getElement<HTMLSelectElement>("type-filter");
const participationFilter = getElement<HTMLSelectElement>("participation-filter");
const dateFilter = getElement<HTMLSelectElement>("date-filter");
let page: DabPage<TimelineEvent> | undefined;
let rendered = 0;

for (const filter of [repositoryFilter, typeFilter, participationFilter, dateFilter]) {
  filter.addEventListener("change", () => refreshTimeline(true));
}
loadMore.addEventListener("click", () => refreshTimeline(false));

function refreshTimeline(reset: boolean): void {
  void loadTimeline(reset).catch(reason => {
    setError(reason instanceof Error ? reason.message : String(reason));
    loadMore.disabled = false;
  });
}

async function loadSummary(): Promise<void> {
  const contributions = await getAll<Contribution>("openContributions");
  const repositories = [...new Set(contributions.map(item => item.repository))].sort();
  getElement("thread-count").textContent = String(contributions.length);
  getElement("pr-count").textContent = String(
    contributions.filter(item => item.itemType === "pull_request").length
  );
  getElement("issue-count").textContent = String(
    contributions.filter(item => item.itemType === "issue").length
  );
  getElement("repository-count").textContent = String(repositories.length);
  repositoryFilter.append(...repositories.map(repository => {
    const option = document.createElement("option");
    option.value = repository;
    option.textContent = repository;
    return option;
  }));

  const status = await dab.entity<SyncStatus>("syncStatus").key("id", "github").getOne();
  const label = getElement("sync-status");
  if (!status.ok || !status.value) {
    label.textContent = "Waiting for first sync";
  } else if (status.value.lastError) {
    label.textContent = `Sync error: ${status.value.lastError}`;
    label.classList.add("failed");
  } else {
    label.textContent = `Synced ${formatRelative(status.value.lastSuccessAt)}`;
  }
}

async function loadTimeline(reset: boolean): Promise<void> {
  setError("");
  loadMore.disabled = true;
  if (reset) {
    timeline.replaceChildren();
    rendered = 0;
    let query = dab.entity<TimelineEvent>("contributionTimeline");
    if (repositoryFilter.value) query.where("repository").eq(repositoryFilter.value);
    if (typeFilter.value) query.where("itemType").eq(typeFilter.value);
    if (participationFilter.value === "authored") query.where("isAuthored").eq(true);
    if (participationFilter.value === "commented") query.where("isCommented").eq(true);
    const cutoff = dateCutoff(dateFilter.value);
    if (cutoff) query.where("occurredAt").gte(cutoff);
    page = await query
      .orderBy("occurredAt", "desc")
      .orderBy("eventId", "desc")
      .first(50)
      .get()
      .then(result => {
        if (!result.ok) throw new Error(result.error.message);
        return result;
      });
  } else if (page?.hasNextPage) {
    const next = await page.next();
    if (!next.ok) throw new Error(next.error.message);
    page = next;
  }

  if (!page) return;
  timeline.append(...page.value.map(renderEvent));
  rendered += page.value.length;
  resultCount.textContent = `${rendered} ${rendered === 1 ? "event" : "events"}`;
  empty.hidden = rendered !== 0;
  loadMore.hidden = !page.hasNextPage;
  loadMore.disabled = false;
}

function dateCutoff(range: string): Date | undefined {
  if (!range) return;
  const cutoff = new Date();
  if (range === "1d") cutoff.setUTCDate(cutoff.getUTCDate() - 1);
  if (range === "1w") cutoff.setUTCDate(cutoff.getUTCDate() - 7);
  if (range === "1m") cutoff.setUTCMonth(cutoff.getUTCMonth() - 1);
  if (range === "3m") cutoff.setUTCMonth(cutoff.getUTCMonth() - 3);
  if (range === "6m") cutoff.setUTCMonth(cutoff.getUTCMonth() - 6);
  return cutoff;
}

function renderEvent(event: TimelineEvent): HTMLLIElement {
  const item = document.createElement("li");
  const marker = document.createElement("span");
  const content = document.createElement("article");
  const meta = document.createElement("div");
  const repository = document.createElement("span");
  const type = document.createElement("span");
  const time = document.createElement("time");
  const title = document.createElement("a");
  const activity = document.createElement("p");
  const summary = document.createElement("blockquote");

  marker.className = `marker ${event.itemType}`;
  marker.textContent = event.itemType === "pull_request" ? "PR" : "I";
  meta.className = "event-meta";
  repository.textContent = event.repository;
  type.textContent = event.eventType.replaceAll("_", " ");
  time.dateTime = event.occurredAt;
  time.textContent = formatRelative(event.occurredAt);
  meta.append(repository, type, time);
  title.href = event.threadUrl;
  title.target = "_blank";
  title.rel = "noreferrer";
  title.textContent = `${event.title} #${event.number}`;
  activity.textContent = `${event.actor ?? "Deleted user"} · ${event.participation.replaceAll(",", " + ")}`;
  summary.textContent = event.summary;
  content.append(meta, title, activity, summary);
  item.append(marker, content);
  return item;
}

async function getAll<T>(entityName: string): Promise<T[]> {
  let result = await dab.entity<T>(entityName).first(1000).get();
  if (!result.ok) throw new Error(result.error.message);
  const values = [...result.value];
  while (result.hasNextPage) {
    result = await result.next();
    if (!result.ok) throw new Error(result.error.message);
    values.push(...result.value);
  }
  return values;
}

function formatRelative(value: string | null): string {
  if (!value) return "never";
  const normalized = /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`;
  const elapsed = Date.now() - new Date(normalized).getTime();
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function setError(message: string): void {
  error.textContent = message;
  error.hidden = !message;
}

function getElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

Promise.all([loadSummary(), loadTimeline(true)]).catch(reason => {
  setError(reason instanceof Error ? reason.message : String(reason));
});
