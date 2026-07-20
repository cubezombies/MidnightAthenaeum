'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

/**
 * Tiny JSON-file store. Writes go through a temp file + rename so a crash
 * mid-write can't leave a truncated file behind (listening progress is the
 * one thing users would actually miss).
 */
class JsonStore {
  #file;
  #data;
  #writeTimer = null;
  #writing = Promise.resolve();

  constructor(file, fallback) {
    this.#file = file;
    this.#data = fallback;
  }

  async load() {
    try {
      const raw = await fsp.readFile(this.#file, 'utf8');
      this.#data = JSON.parse(raw);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error(`[store] could not read ${this.#file}, starting fresh:`, err.message);
      }
    }
    return this.#data;
  }

  get() {
    return this.#data;
  }

  set(data) {
    this.#data = data;
    this.#schedule();
  }

  /** Coalesce bursts of writes (progress ticks fire every few seconds). */
  #schedule() {
    if (this.#writeTimer) clearTimeout(this.#writeTimer);
    this.#writeTimer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    if (this.#writeTimer) {
      clearTimeout(this.#writeTimer);
      this.#writeTimer = null;
    }
    const snapshot = JSON.stringify(this.#data, null, 2);
    this.#writing = this.#writing.then(async () => {
      const tmp = `${this.#file}.tmp`;
      await fsp.mkdir(path.dirname(this.#file), { recursive: true });
      await fsp.writeFile(tmp, snapshot, 'utf8');
      await fsp.rename(tmp, this.#file);
    }).catch((err) => {
      console.error(`[store] write failed for ${this.#file}:`, err.message);
    });
    return this.#writing;
  }

  /** Synchronous last-ditch save for app teardown. */
  flushSync() {
    if (this.#writeTimer) {
      clearTimeout(this.#writeTimer);
      this.#writeTimer = null;
    }
    try {
      fs.mkdirSync(path.dirname(this.#file), { recursive: true });
      const tmp = `${this.#file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.#data, null, 2), 'utf8');
      fs.renameSync(tmp, this.#file);
    } catch (err) {
      console.error(`[store] sync write failed for ${this.#file}:`, err.message);
    }
  }
}

module.exports = { JsonStore };
