"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Defaults_1 = require("../Defaults");
const registration_1 = require("./registration");
const dread_features_1 = require("../dread-features");
// export the last socket layer
const makeWASocket = (config) => (0, dread_features_1.attachDreadFeatures)((0, registration_1.makeRegistrationSocket)({
    ...Defaults_1.DEFAULT_CONNECTION_CONFIG,
    ...(0, dread_features_1.patchConnectionConfig)(config || {})
}));
exports.default = makeWASocket;
exports.makeWASocket = makeWASocket;
