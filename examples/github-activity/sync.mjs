import { createHash } from "node:crypto";
import { createDabClient } from "@mssql-connectors/dab-js";

const apiBase = "https://api.github.com";
const pageSize = 100;
const maxPages = 10;

export function stableId(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

export function summarize(value, limit = 2000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

export function participationFor(login, item, issueComments, reviewComments, reviews) {
  const sameUser = user => user?.login?.toLowerCase() === login.toLowerCase();
  const participation = [];
  if (sameUser(item.user)) participation.push("authored");
  if (issueComments.some(comment => sameUser(comment.user))
    || reviewComments.some(comment => sameUser(comment.user))) {
    participation.push("commented");
  }
  if (reviews.some(review => sameUser(review.user) && summarize(review.body))) {
    participation.push("reviewed");
  }
  return participation;
}

function repositoryName(item) {
  return item.repository_url.split("/repos/")[1];
}

function isPullRequest(item) {
  return Boolean(item.pull_request);
}

function threadRecord(item, participation, syncedAt) {
  const repository = repositoryName(item);
  return {
    id: stableId(`${repository}#${item.number}`),
    repository,
    number: item.number,
    itemType: isPullRequest(item) ? "pull_request" : "issue",
    title: item.title,
    url: item.html_url,
    participation: participation.join(","),
    author: item.user?.login ?? null,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    isOpen: true,
    lastSyncedAt: syncedAt
  };
}

function openingEvent(item, threadId) {
  return {
    id: `opened-${item.id}`,
    threadId,
    eventType: "opened",
    actor: item.user?.login ?? null,
    summary: summarize(item.title),
    url: item.html_url,
    occurredAt: item.created_at
  };
}

function eventRecords(item, threadId, issueComments, reviewComments, reviews) {
  const comments = issueComments.map(comment => ({
    id: `comment-${comment.id}`,
    threadId,
    eventType: "comment",
    actor: comment.user?.login ?? null,
    summary: summarize(comment.body),
    url: comment.html_url,
    occurredAt: comment.created_at
  }));
  const inlineComments = reviewComments.map(comment => ({
    id: `review-comment-${comment.id}`,
    threadId,
    eventType: "review_comment",
    actor: comment.user?.login ?? null,
    summary: summarize(comment.body),
    url: comment.html_url,
    occurredAt: comment.created_at
  }));
  const reviewEvents = reviews.map(review => ({
    id: `review-${review.id}`,
    threadId,
    eventType: `review_${String(review.state).toLowerCase()}`,
    actor: review.user?.login ?? null,
    summary: summarize(review.body) || String(review.state).replaceAll("_", " ").toLowerCase(),
    url: review.html_url,
    occurredAt: review.submitted_at
  })).filter(event => event.occurredAt);
  return [openingEvent(item, threadId), ...comments, ...inlineComments, ...reviewEvents]
    .filter(event => event.summary);
}

function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "dab-github-activity-example",
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

async function githubJson(url, token) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(url, { headers: githubHeaders(token) });
    if (response.ok) return response.json();
    const body = await response.text();
    if (attempt === 3 || ![403, 429, 500, 502, 503, 504].includes(response.status)) {
      throw new Error(`GitHub ${response.status}: ${summarize(body, 500)}`);
    }
    const retryAfter = Number(response.headers.get("retry-after"));
    const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000 - Date.now();
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.min(Math.max(reset, attempt * 2000), 60000);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  throw new Error("GitHub request failed.");
}

async function githubPages(url, token) {
  const values = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const separator = url.includes("?") ? "&" : "?";
    const pageValues = await githubJson(
      `${url}${separator}per_page=${pageSize}&page=${page}`,
      token
    );
    values.push(...pageValues);
    if (pageValues.length < pageSize) return values;
  }
  return values;
}

async function searchOpenThreads(login, token) {
  const queries = [
    `is:open author:${login}`,
    `is:open commenter:${login}`,
    `is:open is:pr reviewed-by:${login}`
  ];
  const candidates = new Map();
  for (const query of queries) {
    for (let page = 1; page <= maxPages; page += 1) {
      const params = new URLSearchParams({
        q: query,
        per_page: String(pageSize),
        page: String(page),
        sort: "updated",
        order: "desc"
      });
      const result = await githubJson(`${apiBase}/search/issues?${params}`, token);
      if (result.total_count > pageSize * maxPages) {
        throw new Error(`GitHub search exceeded ${pageSize * maxPages} results for: ${query}`);
      }
      for (const item of result.items) candidates.set(item.id, item);
      if (result.items.length < pageSize) break;
    }
  }
  return [...candidates.values()];
}

async function listAll(entity, count = 100) {
  let page = await entity.first(count).get();
  if (!page.ok) throw new Error(`DAB ${page.error.status}: ${page.error.message}`);
  const values = [...page.value];
  while (page.hasNextPage) {
    page = await page.next();
    if (!page.ok) throw new Error(`DAB ${page.error.status}: ${page.error.message}`);
    values.push(...page.value);
  }
  return values;
}

async function upsert(dab, entityName, record) {
  const current = await dab.entity(entityName).key("id", record.id).getOne();
  if (current.ok && current.value) {
    const { id: _id, ...changes } = record;
    const updated = await dab.entity(entityName).key("id", record.id).update(changes);
    if (!updated.ok) throw new Error(`DAB ${updated.error.status}: ${updated.error.message}`);
    return;
  }
  if (!current.ok && current.error.status !== 404) {
    throw new Error(`DAB ${current.error.status}: ${current.error.message}`);
  }
  const created = await dab.entity(entityName).create(record);
  if (!created.ok) throw new Error(`DAB ${created.error.status}: ${created.error.message}`);
}

export function sameTimestamp(left, right) {
  const utc = value => /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`;
  return left && right && new Date(utc(left)).getTime() === new Date(utc(right)).getTime();
}

export async function syncGitHub({
  token,
  login,
  dabUrl,
  onProgress = () => {}
}) {
  if (!token || !login || !dabUrl) {
    throw new Error("GITHUB_TOKEN, GITHUB_LOGIN, and SYNC_DAB_URL are required.");
  }

  const dab = createDabClient(dabUrl);
  const attemptAt = new Date().toISOString();
  const existingThreads = await listAll(dab.entity("threads"), 1000);
  const existingById = new Map(existingThreads.map(thread => [thread.id, thread]));
  const existingEvents = await listAll(dab.entity("events"), 1000);
  const existingEventIds = new Set(existingEvents.map(event => event.id));
  const previousState = await dab.entity("syncState").key("id", "github").getOne();
  let eventCount = 0;

  try {
    const candidates = await searchOpenThreads(login, token);
    const trackedIds = new Set();
    let failedThreads = 0;
    let completed = 0;

    for (const item of candidates) {
      const repository = repositoryName(item);
      const id = stableId(`${repository}#${item.number}`);
      const existing = existingById.get(id);
      try {
        if (existing?.isOpen && sameTimestamp(existing.updatedAt, item.updated_at)) {
          const opened = openingEvent(item, id);
          if (!existingEventIds.has(opened.id)) {
            await upsert(dab, "events", opened);
            existingEventIds.add(opened.id);
            eventCount += 1;
          }
          trackedIds.add(id);
          completed += 1;
          onProgress({ completed, total: candidates.length, repository, number: item.number });
          continue;
        }

        const issueComments = await githubPages(item.comments_url, token);
        const reviewComments = isPullRequest(item)
          ? await githubPages(`${item.pull_request.url}/comments`, token)
          : [];
        const reviews = isPullRequest(item)
          ? await githubPages(`${item.pull_request.url}/reviews`, token)
          : [];
        const participation = participationFor(
          login,
          item,
          issueComments,
          reviewComments,
          reviews
        );
        if (participation.length === 0) {
          completed += 1;
          continue;
        }

        const thread = threadRecord(item, participation, attemptAt);
        await upsert(dab, "threads", thread);
        trackedIds.add(thread.id);

        for (const event of eventRecords(
          item,
          thread.id,
          issueComments,
          reviewComments,
          reviews
        )) {
          await upsert(dab, "events", event);
          existingEventIds.add(event.id);
          eventCount += 1;
        }
        completed += 1;
        onProgress({ completed, total: candidates.length, repository, number: item.number });
      } catch (error) {
        failedThreads += 1;
        if (existing?.isOpen) trackedIds.add(id);
        completed += 1;
        console.warn(`Skipped ${repository}#${item.number}: ${error.message}`);
      }
    }

    for (const existing of existingThreads) {
      if (existing.isOpen && !trackedIds.has(existing.id)) {
        await upsert(dab, "threads", {
          ...existing,
          isOpen: false,
          lastSyncedAt: attemptAt
        });
      }
    }

    await upsert(dab, "syncState", {
      id: "github",
      lastAttemptAt: attemptAt,
      lastSuccessAt: new Date().toISOString(),
      lastError: failedThreads ? `${failedThreads} threads failed to refresh.` : null,
      threadCount: trackedIds.size,
      eventCount
    });
    return { threadCount: trackedIds.size, eventCount };
  } catch (error) {
    await upsert(dab, "syncState", {
      id: "github",
      lastAttemptAt: attemptAt,
      lastSuccessAt: previousState.ok ? previousState.value?.lastSuccessAt ?? null : null,
      lastError: summarize(error.message),
      threadCount: 0,
      eventCount: 0
    }).catch(() => {});
    throw error;
  }
}
