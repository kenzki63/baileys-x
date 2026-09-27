"use strict";

const { jidDecode, jidEncode, isLidUser, isJidUser } = require("../WABinary");

const CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

function log(logger, level, value, message) {
  if (typeof logger?.[level] === "function") logger[level](value, message);
}

function deviceJid(user, device, server) {
  return jidEncode(user, server, device || undefined);
}

class LIDMappingStore {
  constructor(keys, logger, pnToLIDFunc) {
    this.keys = keys;
    this.logger = logger;
    this.pnToLIDFunc = pnToLIDFunc;
    this.cache = new Map();
    this.inflight = new Map();
  }

  cacheGet(key) {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  cacheSet(key, value) {
    this.cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  async storeLIDPNMappings(pairs = []) {
    const normalized = [];
    for (const pair of pairs) {
      const lid = String(pair?.lid || "");
      const pn = String(pair?.pn || "");
      if (!isLidUser(lid) || !isJidUser(pn)) {
        log(this.logger, "warn", { lid, pn }, "Ignoring invalid PN/LID mapping");
        continue;
      }
      const lidDecoded = jidDecode(lid);
      const pnDecoded = jidDecode(pn);
      if (!lidDecoded?.user || !pnDecoded?.user) continue;
      normalized.push({ lidUser: lidDecoded.user, pnUser: pnDecoded.user });
    }
    if (!normalized.length) return;

    const updates = {};
    for (const { lidUser, pnUser } of normalized) {
      const current = this.cacheGet(`pn:${pnUser}`);
      if (current === lidUser) continue;
      updates[pnUser] = lidUser;
      updates[`${lidUser}_reverse`] = pnUser;
    }
    if (Object.keys(updates).length) {
      const write = () => this.keys.set({ "lid-mapping": updates });
      if (typeof this.keys.transaction === "function") await this.keys.transaction(write, "lid-mapping");
      else await write();
    }
    for (const { lidUser, pnUser } of normalized) {
      this.cacheSet(`pn:${pnUser}`, lidUser);
      this.cacheSet(`lid:${lidUser}`, pnUser);
    }
  }

  async getLIDForPN(pn) {
    const result = await this.getLIDsForPNs([pn]);
    return result?.[0]?.lid || null;
  }

  async getLIDsForPNs(pns = []) {
    const unique = [...new Set(pns)].filter(Boolean);
    if (!unique.length) return null;
    const key = unique.slice().sort().join(",");
    if (this.inflight.has(key)) return this.inflight.get(key);
    const work = this.resolvePNs(unique);
    this.inflight.set(key, work);
    try {
      return await work;
    } finally {
      this.inflight.delete(key);
    }
  }

  async resolvePNs(pns) {
    const result = [];
    const pending = [];
    for (const pn of pns) {
      const decoded = jidDecode(pn);
      if (!decoded?.user || !isJidUser(pn)) continue;
      const mapped = this.cacheGet(`pn:${decoded.user}`);
      if (mapped) {
        result.push({ pn, lid: deviceJid(mapped, decoded.device, "lid") });
      } else {
        pending.push(pn);
      }
    }

    if (pending.length) {
      const stored = await this.keys.get("lid-mapping", [...new Set(pending.map(pn => jidDecode(pn)?.user).filter(Boolean))]);
      for (const pn of pending) {
        const decoded = jidDecode(pn);
        const mapped = stored?.[decoded?.user];
        if (mapped) {
          this.cacheSet(`pn:${decoded.user}`, mapped);
          this.cacheSet(`lid:${mapped}`, decoded.user);
          result.push({ pn, lid: deviceJid(mapped, decoded.device, "lid") });
        }
      }

      const unresolved = pending.filter(pn => !result.some(item => item.pn === pn));
      if (unresolved.length && typeof this.pnToLIDFunc === "function") {
        try {
          const fetched = await this.pnToLIDFunc(unresolved);
          if (Array.isArray(fetched) && fetched.length) {
            await this.storeLIDPNMappings(fetched);
            for (const pair of fetched) {
              const pnDecoded = jidDecode(pair?.pn);
              const lidDecoded = jidDecode(pair?.lid);
              if (!pnDecoded?.user || !lidDecoded?.user) continue;
              const requested = unresolved.filter(pn => jidDecode(pn)?.user === pnDecoded.user);
              for (const pn of requested) {
                const decoded = jidDecode(pn);
                result.push({ pn, lid: deviceJid(lidDecoded.user, decoded.device, "lid") });
              }
            }
          }
        } catch (error) {
          log(this.logger, "warn", error, "PN to LID lookup failed");
        }
      }
    }
    return result.length ? result : null;
  }

  async getPNForLID(lid) {
    const result = await this.getPNsForLIDs([lid]);
    return result?.[0]?.pn || null;
  }

  async getPNsForLIDs(lids = []) {
    const result = [];
    const pending = [];
    for (const lid of [...new Set(lids)].filter(Boolean)) {
      const decoded = jidDecode(lid);
      if (!decoded?.user || !isLidUser(lid)) continue;
      const mapped = this.cacheGet(`lid:${decoded.user}`);
      if (mapped) result.push({ lid, pn: deviceJid(mapped, decoded.device, "s.whatsapp.net") });
      else pending.push({ lid, decoded });
    }
    if (pending.length) {
      const stored = await this.keys.get("lid-mapping", [...new Set(pending.map(item => `${item.decoded.user}_reverse`))]);
      for (const { lid, decoded } of pending) {
        const mapped = stored?.[`${decoded.user}_reverse`];
        if (mapped) {
          this.cacheSet(`lid:${decoded.user}`, mapped);
          this.cacheSet(`pn:${mapped}`, decoded.user);
          result.push({ lid, pn: deviceJid(mapped, decoded.device, "s.whatsapp.net") });
        }
      }
    }
    return result.length ? result : null;
  }

  close() {
    this.cache.clear();
    this.inflight.clear();
  }
}

module.exports = { LIDMappingStore };
