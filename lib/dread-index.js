"use strict";

const baileys = require("./index");
const dreadFeatures = require("./dread-features");

for (const [key, value] of Object.entries(dreadFeatures)) {
  if (Object.prototype.hasOwnProperty.call(baileys, key)) continue;

  Object.defineProperty(baileys, key, {
    enumerable: true,
    value,
  });
}

if (baileys.default && !baileys.makeWASocket) {
  baileys.makeWASocket = baileys.default;
}

module.exports = baileys;
