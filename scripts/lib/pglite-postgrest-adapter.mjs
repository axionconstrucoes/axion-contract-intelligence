// Adaptador MÍNIMO "estilo supabase-js/PostgREST" sobre PGlite — só para testes locais.
// Permite executar o store REAL (apps/web/lib/risk-alerts/supabase-store.ts) contra um banco PostgreSQL
// descartável (com as migrations reais), sem rede e sem Supabase.
//
// Suporta o subconjunto que o store usa: from().select/insert/upsert/update com
// eq/neq/in/is/not/lt/order/limit, maybeSingle()/single() e rpc() com argumentos nomeados.
// NÃO suporta embeds (relações aninhadas), RLS por papel nem paginação por range.
// Executa como superusuário do PGlite e marca app.role = service_role (o stub de auth.role()).

const IDENT = /^[a-z_][a-z0-9_]*$/;
const COLS = /^[a-z0-9_,\s*]+$/i;

const ident = (name) => {
  if (!IDENT.test(name)) throw new Error(`identificador não suportado: ${name}`);
  return `"${name}"`;
};

/** Mensagem do erro do Postgres + contexto (função/linha) e detalhe, para diagnóstico nos testes. */
function describe(error) {
  const where = error.where ? ` | ${String(error.where).split("\n")[0]}` : "";
  const detail = error.detail ? ` | ${String(error.detail).slice(0, 200)}` : "";
  return `${error.message}${where}${detail}`;
}

const pgArray = (arr) => `{${arr.map((x) => (x === null ? "NULL" : `"${String(x).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)).join(",")}}`;

// PostgREST devolve JSON: timestamptz em ISO-8601, date como YYYY-MM-DD e numeric como número.
// O PGlite devolve Date/strings — normalizamos para o que o supabase-js entregaria ao código de produção.
function normalizeRows(result) {
  const kind = new Map(result.fields.map((f) => [f.name, f.dataTypeID]));
  return result.rows.map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      const t = kind.get(k);
      if (v instanceof Date) out[k] = t === 1082 ? v.toISOString().slice(0, 10) : v.toISOString();
      else if (t === 1700 && v !== null) out[k] = Number(v);
      else out[k] = v;
    }
    return out;
  });
}

export function createPostgrestAdapter(db, { role = "service_role" } = {}) {
  let typesPromise = null;
  let roleSet = false;

  const columnTypes = () => {
    typesPromise ??= db
      .query("select table_name, column_name, data_type, udt_name from information_schema.columns where table_schema = 'public'")
      .then((r) => {
        const map = new Map();
        for (const row of r.rows) map.set(`${row.table_name}.${row.column_name}`, { data: row.data_type, udt: row.udt_name });
        return map;
      });
    return typesPromise;
  };

  async function exec(sql, params = []) {
    if (!roleSet) {
      roleSet = true;
      // app.role = stub de auth.role(); request.jwt.claims.role = o que as RPCs reais leem para reconhecer o worker (service_role).
      await db.query("select set_config('app.role', $1, false), set_config('request.jwt.claims', $2, false)", [role, JSON.stringify({ role })]);
    }
    return db.query(sql, params);
  }

  /** Converte um valor JS para (texto, cast) conforme o tipo da coluna. */
  async function bind(table, column, value) {
    const t = (await columnTypes()).get(`${table}.${column}`);
    if (value === null || value === undefined) return { value: null, cast: "" };
    if (t?.data === "jsonb" || t?.data === "json") return { value: JSON.stringify(value), cast: `::${t.data}` };
    if (t?.data === "ARRAY") return { value: Array.isArray(value) ? pgArray(value) : value, cast: `::${t.udt.replace(/^_/, "")}[]` };
    return { value, cast: "" };
  }

  class Query {
    constructor(table) {
      this.table = table;
      this.op = "select";
      this.cols = "*";
      this.filters = [];
      this.orders = [];
      this.limitN = null;
      this.rows = null;
      this.patch = null;
      this.upsertOpts = null;
      this.returning = false;
      this.single_ = null;
    }
    select(cols = "*") {
      if (!COLS.test(cols)) throw new Error(`select não suportado: ${cols}`);
      this.cols = cols;
      if (this.op !== "select") this.returning = true;
      return this;
    }
    insert(rows) {
      this.op = "insert";
      this.rows = Array.isArray(rows) ? rows : [rows];
      return this;
    }
    upsert(rows, opts = {}) {
      this.op = "upsert";
      this.rows = Array.isArray(rows) ? rows : [rows];
      this.upsertOpts = opts;
      return this;
    }
    update(patch) {
      this.op = "update";
      this.patch = patch;
      return this;
    }
    eq(c, v) {
      this.filters.push({ c, op: "eq", v });
      return this;
    }
    neq(c, v) {
      this.filters.push({ c, op: "neq", v });
      return this;
    }
    in(c, v) {
      this.filters.push({ c, op: "in", v });
      return this;
    }
    is(c, v) {
      this.filters.push({ c, op: "is", v });
      return this;
    }
    or(expr) {
      this.filters.push({ op: "or", expr });
      return this;
    }
    not(c, op, v) {
      this.filters.push({ c, op: "not", inner: op, v });
      return this;
    }
    lt(c, v) {
      this.filters.push({ c, op: "lt", v });
      return this;
    }
    order(c, { ascending = true } = {}) {
      this.orders.push(`${ident(c)} ${ascending ? "asc" : "desc"}`);
      return this;
    }
    limit(n) {
      this.limitN = n;
      return this;
    }
    maybeSingle() {
      this.single_ = "maybe";
      return this;
    }
    single() {
      this.single_ = "one";
      return this;
    }

    async where(params) {
      const parts = [];
      for (const f of this.filters) {
        if (f.op === "or") {
          // formato supabase-js: "col.is.null,col.lt.<valor>" (somente is.null, lt e eq)
          const alts = f.expr.split(",").map((part) => {
            const [c, o, ...rest] = part.split(".");
            const v = rest.join(".");
            if (o === "is" && v === "null") return `${ident(c)} is null`;
            const sym = { lt: "<", eq: "=" }[o];
            if (!sym) throw new Error(`or() não suportado: ${part}`);
            params.push(v);
            return `${ident(c)} ${sym} $${params.length}`;
          });
          parts.push(`(${alts.join(" or ")})`);
          continue;
        }
        const col = ident(f.c);
        if (f.op === "in") {
          const { value, cast } = await bind(this.table, f.c, f.v);
          params.push(Array.isArray(f.v) ? pgArray(f.v) : value);
          const t = (await columnTypes()).get(`${this.table}.${f.c}`);
          parts.push(`${col} = any($${params.length}::${t?.udt ?? "text"}[])`);
          void cast;
        } else if (f.op === "is" || (f.op === "not" && f.inner === "is")) {
          const neg = f.op === "not" ? "not " : "";
          parts.push(`${col} is ${neg}${f.v === null ? "null" : f.v}`);
        } else if (f.v === null && (f.op === "eq" || f.op === "neq")) {
          parts.push(`${col} is ${f.op === "neq" ? "not " : ""}null`);
        } else {
          params.push(f.v);
          const sym = { eq: "=", neq: "<>", lt: "<" }[f.op];
          if (!sym) throw new Error(`filtro não suportado: ${f.op}`);
          parts.push(`${col} ${sym} $${params.length}`);
        }
      }
      return parts.length ? ` where ${parts.join(" and ")}` : "";
    }

    async build() {
      const params = [];
      const table = ident(this.table);
      const ret = this.returning ? ` returning ${this.cols === "*" ? "*" : this.cols.split(",").map((c) => ident(c.trim())).join(", ")}` : "";
      if (this.op === "select") {
        const cols = this.cols === "*" ? "*" : this.cols.split(",").map((c) => ident(c.trim())).join(", ");
        let sql = `select ${cols} from ${table}${await this.where(params)}`;
        if (this.orders.length) sql += ` order by ${this.orders.join(", ")}`;
        if (this.limitN !== null) sql += ` limit ${Number(this.limitN)}`;
        return { sql, params };
      }
      if (this.op === "insert" || this.op === "upsert") {
        const columns = [...new Set(this.rows.flatMap((r) => Object.keys(r)))];
        const values = [];
        for (const row of this.rows) {
          const placeholders = [];
          for (const c of columns) {
            const { value, cast } = await bind(this.table, c, row[c] ?? null);
            params.push(value);
            placeholders.push(`$${params.length}${cast}`);
          }
          values.push(`(${placeholders.join(", ")})`);
        }
        let sql = `insert into ${table} (${columns.map(ident).join(", ")}) values ${values.join(", ")}`;
        if (this.op === "upsert") {
          const target = this.upsertOpts.onConflict ? `(${this.upsertOpts.onConflict.split(",").map((c) => ident(c.trim())).join(", ")})` : "";
          sql += this.upsertOpts.ignoreDuplicates ? ` on conflict ${target} do nothing` : ` on conflict ${target} do update set ${columns.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(", ")}`;
        }
        return { sql: sql + ret, params };
      }
      // update
      const sets = [];
      for (const [c, v] of Object.entries(this.patch)) {
        const { value, cast } = await bind(this.table, c, v);
        params.push(value);
        sets.push(`${ident(c)} = $${params.length}${cast}`);
      }
      return { sql: `update ${table} set ${sets.join(", ")}${await this.where(params)}${ret}`, params };
    }

    async run() {
      try {
        const { sql, params } = await this.build();
        const result = await exec(sql, params);
        const isRead = this.op === "select" || this.returning;
        let data = isRead ? normalizeRows(result) : null;
        if (this.single_ && data) {
          if (data.length > 1) return { data: null, error: { code: "PGRST116", message: "mais de uma linha" } };
          if (data.length === 0) return this.single_ === "one" ? { data: null, error: { code: "PGRST116", message: "nenhuma linha" } } : { data: null, error: null };
          data = data[0];
        }
        return { data, error: null };
      } catch (error) {
        return { data: null, error: { code: error.code ?? "SQL", message: describe(error) } };
      }
    }
    then(resolve, reject) {
      return this.run().then(resolve, reject);
    }
  }

  return {
    from: (table) => new Query(table),
    async rpc(fn, args = {}) {
      try {
        const keys = Object.keys(args);
        const params = keys.map((k) => (args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k]));
        const sql = `select public.${ident(fn)}(${keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(", ")}) as r`;
        const result = await exec(sql, params);
        return { data: result.rows[0]?.r ?? null, error: null };
      } catch (error) {
        return { data: null, error: { code: error.code ?? "SQL", message: describe(error) } };
      }
    },
  };
}
