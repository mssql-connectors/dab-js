export type Primitive = string | number | boolean | Date | null;
export type KeyValues = Record<string, Primitive>;
export type RequestInitWithBody = RequestInit & { body?: BodyInit | null };

export type DabError = {
  code: string;
  message: string;
  status: number;
};

export type DabPage<T> = {
  ok: true;
  value: T[];
  nextLink?: string;
  hasNextPage: boolean;
  next(): Promise<DabPage<T> | DabFailure>;
};

export type DabSingle<T> = {
  ok: true;
  value: T | null;
} | DabFailure;

export type DabMutation<T> = {
  ok: true;
  value: T | null;
} | DabFailure;

export type DabFailure = {
  ok: false;
  value: null;
  error: DabError;
};

export type ClientOptions = {
  headers?: HeadersInit;
  fetch?: typeof fetch;
  throwOnError?: boolean;
};

type FilterBuilder = {
  where(field: string): FilterField;
  and(callback: (query: FilterBuilder) => void): FilterBuilder;
  or(callback: (query: FilterBuilder) => void): FilterBuilder;
  not(callback: (query: FilterBuilder) => void): FilterBuilder;
};

export type FilterField = {
  eq(value: Primitive): FilterBuilder;
  ne(value: Primitive): FilterBuilder;
  gt(value: Primitive): FilterBuilder;
  gte(value: Primitive): FilterBuilder;
  lt(value: Primitive): FilterBuilder;
  lte(value: Primitive): FilterBuilder;
  isNull(): FilterBuilder;
  isNotNull(): FilterBuilder;
};

const operators = {
  eq: "eq",
  ne: "ne",
  gt: "gt",
  gte: "ge",
  lt: "lt",
  lte: "le"
} as const;

function formatValue(value: Primitive): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return `'${value.replaceAll("'", "''")}'`;
  }
  if (value instanceof Date) {
    return `'${value.toISOString()}'`;
  }
  return String(value);
}

function appendFilter(parts: string[], expression: string, joiner: string): void {
  parts.push(parts.length === 0 ? expression : `${joiner} ${expression}`);
}

class QueryFilters implements FilterBuilder {
  private readonly parts: string[] = [];
  private nextJoiner = "and";

  where(field: string): FilterField {
    if (!field) {
      throw new Error("DAB filter fields cannot be empty.");
    }
    return Object.fromEntries(
      Object.entries(operators).map(([method, operator]) => [
        method,
        (value: Primitive) => {
          appendFilter(this.parts, `${field} ${operator} ${formatValue(value)}`, this.nextJoiner);
          this.nextJoiner = "and";
          return this;
        }
      ]).concat([
        ["isNull", () => {
          appendFilter(this.parts, `${field} eq null`, this.nextJoiner);
          this.nextJoiner = "and";
          return this;
        }],
        ["isNotNull", () => {
          appendFilter(this.parts, `${field} ne null`, this.nextJoiner);
          this.nextJoiner = "and";
          return this;
        }]
      ])
    ) as FilterField;
  }

  and(callback: (query: FilterBuilder) => void): FilterBuilder {
    return this.group(callback, "and");
  }

  or(callback: (query: FilterBuilder) => void): FilterBuilder {
    this.nextJoiner = "or";
    return this.group(callback, "and");
  }

  not(callback: (query: FilterBuilder) => void): FilterBuilder {
    const nested = new QueryFilters();
    callback(nested);
    const value = nested.toString();
    if (!value) {
      throw new Error("DAB filter groups cannot be empty.");
    }
    appendFilter(this.parts, `not (${value})`, this.nextJoiner);
    this.nextJoiner = "and";
    return this;
  }

  toString(): string {
    return this.parts.join(" ");
  }

  private group(callback: (query: FilterBuilder) => void, joiner: string): FilterBuilder {
    const nested = new QueryFilters();
    callback(nested);
    const value = nested.toString();
    if (!value) {
      throw new Error("DAB filter groups cannot be empty.");
    }
    appendFilter(this.parts, `(${value})`, this.nextJoiner);
    this.nextJoiner = joiner;
    return this;
  }
}

class EntityQuery<T> extends QueryFilters {
  private fields: string[] | undefined;
  private orderings: string[] = [];
  private limit: number | undefined;
  private continuation: string | undefined;
  private keyValues: KeyValues | undefined;
  private keylessMode = false;
  private shouldThrow = false;

  constructor(private readonly client: DabClient, private readonly name: string) {
    super();
  }

  select(...fields: string[]): this {
    this.fields = fields;
    return this;
  }

  orderBy(field: string, direction: "asc" | "desc" = "asc"): this {
    if (!field) {
      throw new Error("DAB order fields cannot be empty.");
    }
    this.orderings.push(`${field} ${direction}`);
    return this;
  }

  first(count: number): this {
    if (!Number.isInteger(count) || count < 1) {
      throw new Error("DAB page size must be a positive integer.");
    }
    this.limit = count;
    return this;
  }

  after(token: string): this {
    this.continuation = token;
    return this;
  }

  key(field: string, value: Primitive): this;
  key(values: KeyValues): this;
  key(fieldOrValues: string | KeyValues, value?: Primitive): this {
    this.keyValues = typeof fieldOrValues === "string"
      ? { [fieldOrValues]: value ?? null }
      : fieldOrValues;
    this.keylessMode = false;
    return this;
  }

  keyless(): this {
    this.keyValues = undefined;
    this.keylessMode = true;
    return this;
  }

  throwOnError(): this {
    this.shouldThrow = true;
    return this;
  }

  get(): Promise<DabPage<T> | DabFailure> {
    return this.requestPage();
  }

  getOne(): Promise<DabSingle<T>> {
    return this.requestSingle();
  }

  create(body: unknown): Promise<DabMutation<T>> {
    return this.mutate("POST", body, false);
  }

  update(body: unknown): Promise<DabMutation<T>> {
    return this.mutate("PATCH", body, !this.keyValues && !this.keylessMode);
  }

  replace(body: unknown): Promise<DabMutation<T>> {
    return this.mutate("PUT", body, !this.keyValues && !this.keylessMode);
  }

  delete(): Promise<DabMutation<T>> {
    return this.mutate("DELETE", undefined, !this.keyValues);
  }

  private async requestPage(nextUrl?: string): Promise<DabPage<T> | DabFailure> {
    const url = nextUrl ?? this.buildUrl();
    const result = await this.client.request<T[]>(url, { method: "GET" }, this.shouldThrow);
    if (!result.ok) {
      return result;
    }
    const nextLink = typeof result.raw === "object" && result.raw !== null
      ? (result.raw as { nextLink?: string }).nextLink
      : undefined;
    const page: DabPage<T> = {
      ok: true,
      value: Array.isArray(result.value) ? result.value : [],
      nextLink,
      hasNextPage: Boolean(nextLink),
      next: () => nextLink ? this.requestPage(nextLink) : Promise.resolve(page)
    };
    return page;
  }

  private async requestSingle(): Promise<DabSingle<T>> {
    const result = await this.client.request<T>(this.buildUrl(true), { method: "GET" }, this.shouldThrow);
    if (!result.ok) {
      return result;
    }
    const value = Array.isArray(result.value) ? result.value[0] : result.value;
    return { ok: true, value: value ?? null };
  }

  private async mutate(method: string, body: unknown, requiresKey: boolean): Promise<DabMutation<T>> {
    if (requiresKey) {
      throw new Error("This DAB operation requires a key or keyless() mode.");
    }
    return this.client.request<T>(
      this.buildUrl(false),
      { method, body: body === undefined ? undefined : JSON.stringify(body) },
      this.shouldThrow
    );
  }

  private buildUrl(single = false): string {
    if (this.keyValues) {
      const path = Object.entries(this.keyValues)
        .map(([field, value]) => `${encodeURIComponent(field)}/${encodeURIComponent(String(value))}`)
        .join("/");
      return this.client.url(this.name, `/${path}`);
    }
    const query = new URLSearchParams();
    if (this.fields) query.set("$select", this.fields.join(","));
    if (this.toString()) query.set("$filter", this.toString());
    if (this.orderings.length) query.set("$orderby", this.orderings.join(", "));
    if (this.limit !== undefined) query.set("$first", String(this.limit));
    if (this.continuation !== undefined) query.set("$after", this.continuation);
    if (single) throw new Error("getOne() requires key().");
    const suffix = query.toString();
    return this.client.url(this.name, suffix ? `?${suffix}` : "");
  }
}

class ProcedureQuery<T> {
  private readonly params = new URLSearchParams();

  constructor(private readonly client: DabClient, private readonly name: string) {}

  param(name: string, value: Primitive): this {
    this.params.set(name, String(value));
    return this;
  }

  execute(): Promise<DabPage<T> | DabFailure> {
    const query = this.params.toString();
    return this.client.request<T[]>(
      this.client.url(this.name, query ? `?${query}` : ""),
      { method: "GET" },
      false
    ).then(result => {
      if (!result.ok) {
        return result;
      }
      const page: DabPage<T> = {
        ok: true,
        value: Array.isArray(result.value) ? result.value : [],
        hasNextPage: false,
        next: async () => page
      };
      return page;
    });
  }
}

export class DabClient {
  private readonly fetcher: typeof fetch;
  private readonly headers: HeadersInit;
  private readonly defaultThrow: boolean;

  constructor(private readonly baseUrl: string, options: ClientOptions = {}) {
    this.fetcher = options.fetch ?? fetch;
    this.headers = options.headers ?? {};
    this.defaultThrow = options.throwOnError ?? false;
  }

  entity<T = Record<string, unknown>>(name: string): EntityQuery<T> {
    if (!name) throw new Error("DAB entity names cannot be empty.");
    return new EntityQuery<T>(this, name);
  }

  procedure<T = Record<string, unknown>>(name: string): ProcedureQuery<T> {
    if (!name) throw new Error("DAB procedure names cannot be empty.");
    return new ProcedureQuery<T>(this, name);
  }

  url(entity: string, suffix = ""): string {
    return `${this.baseUrl.replace(/\/+$/, "")}/${entity.replace(/^\/+/, "")}${suffix}`;
  }

  async request<T>(url: string, init: RequestInitWithBody, throwOnError = this.defaultThrow): Promise<(DabMutation<T> & { raw?: unknown }) | (DabFailure & { raw?: unknown })> {
    const response = await this.fetcher(url, {
      ...init,
      headers: { ...this.headers, ...(init.headers ?? {}), ...(init.body === undefined ? {} : { "Content-Type": "application/json" }) }
    });
    const raw = await response.json().catch(() => undefined);
    if (!response.ok) {
      const error: DabError = {
        code: raw?.error?.code ?? raw?.code ?? `HTTP_${response.status}`,
        message: raw?.error?.message ?? raw?.message ?? response.statusText,
        status: response.status
      };
      if (throwOnError) throw Object.assign(new Error(error.message), { ...error });
      return { ok: false, value: null, error, raw };
    }
    return { ok: true, value: raw?.value ?? raw ?? null, raw };
  }
}

export function createDabClient(baseUrl: string, options?: ClientOptions): DabClient {
  return new DabClient(baseUrl, options);
}

export const createDabNativeClient = createDabClient;
