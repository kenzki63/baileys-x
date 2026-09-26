"use strict";

const { mkdir, readdir, readFile } = require("fs/promises");
const { dirname, join } = require("path");
const { proto } = require("../../WAProto");
const { initAuthCreds } = require("./auth-utils");
const { BufferJSON } = require("./generics");

/**
 * Stores Baileys authentication state in one SQLite database.
 * Requires Node 22.5+ for the built-in node:sqlite module.
 */
async function useSqliteAuthState(pathOrFolder, options = {}) {
  const {
    fileName = "auth.db",
    migrateFromFolder,
    logger,
  } = options;
  const dbPath = /\.(db|sqlite|sqlite3)$/i.test(pathOrFolder)
    ? pathOrFolder
    : join(pathOrFolder, fileName);

  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch (error) {
    throw new Error(
      "useSqliteAuthState requires Node 22.5+ with the built-in node:sqlite module. Set WA_AUTH_STORAGE=multi-file or upgrade Node.",
    );
  }

  const encode = (value) => {
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
      return Buffer.concat([Buffer.from([1]), Buffer.from(value)]);
    }
    return Buffer.concat([
      Buffer.from([0]),
      Buffer.from(JSON.stringify(value, BufferJSON.replacer), "utf8"),
    ]);
  };
  const decode = (blob) => {
    if (!blob || blob.length === 0) return null;
    const bytes = Buffer.from(blob);
    if (bytes[0] === 1) return bytes.subarray(1);
    return JSON.parse(bytes.subarray(1).toString("utf8"), BufferJSON.reviver);
  };
  const fixName = (value) => value?.replace(/\//g, "__")?.replace(/:/g, "-");
  const keyOf = (category, id) => fixName(`${category}-${id}`);

  await mkdir(dirname(dbPath), { recursive: true }).catch(() => {});
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = TRUNCATE");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("CREATE TABLE IF NOT EXISTS auth_state (k TEXT PRIMARY KEY, v BLOB NOT NULL) WITHOUT ROWID");

  const qGet = db.prepare("SELECT v FROM auth_state WHERE k = ?");
  const qUpsert = db.prepare("INSERT INTO auth_state(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v");
  const qDelete = db.prepare("DELETE FROM auth_state WHERE k = ?");
  const runTx = (fn) => {
    db.exec("BEGIN");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  const readRaw = (key) => {
    const row = qGet.get(key);
    if (!row) return null;
    try {
      return decode(row.v);
    } catch (error) {
      logger?.warn?.({ key, error: error?.message }, "sqlite-auth: failed to decode row");
      return null;
    }
  };

  const runMigration = async (folder) => {
    let files;
    try {
      files = await readdir(folder);
    } catch {
      return 0;
    }
    const rows = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const value = JSON.parse(await readFile(join(folder, file), "utf8"), BufferJSON.reviver);
        if (value !== null && value !== undefined) {
          rows.push([file.slice(0, -5), encode(value)]);
        }
      } catch {
        // Ignore unrelated or incomplete JSON files during migration.
      }
    }
    runTx(() => {
      for (const [key, value] of rows) qUpsert.run(key, value);
    });
    return rows.length;
  };

  if (migrateFromFolder && !qGet.get("creds")) {
    const count = await runMigration(migrateFromFolder);
    if (count > 0) logger?.info?.({ count, from: migrateFromFolder }, "sqlite-auth: migrated legacy auth state");
  }

  let creds = readRaw("creds");
  if (!creds) {
    creds = initAuthCreds();
    qUpsert.run("creds", encode(creds));
  }

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          for (const id of ids) {
            let value = readRaw(keyOf(type, id));
            if (type === "app-state-sync-key" && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            if (value !== null && value !== undefined) data[id] = value;
          }
          return data;
        },
        set: async (data) => {
          const operations = [];
          for (const category in data) {
            for (const id in data[category]) {
              operations.push([keyOf(category, id), data[category][id]]);
            }
          }
          runTx(() => {
            for (const [key, value] of operations) {
              if (value === null || value === undefined) qDelete.run(key);
              else qUpsert.run(key, encode(value));
            }
          });
        },
        clear: async () => {
          db.prepare("DELETE FROM auth_state WHERE k <> 'creds'").run();
        },
      },
    },
    saveCreds: async () => {
      qUpsert.run("creds", encode(creds));
    },
    db,
    close: () => db.close(),
  };
}

module.exports = { useSqliteAuthState };
