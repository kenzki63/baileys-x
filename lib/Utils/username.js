"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeRandomUsernameKey = exports.makeRepeatedDigitUsernameKey = exports.isRepeatedDigitUsernameKey = exports.isValidUsernameKey = void 0;
const crypto_1 = require("crypto");
const DEFAULT_USERNAME_KEY_LENGTH = 4;
const assertLength = (length) => {
    if (!Number.isInteger(length) || length <= 0) {
        throw new Error("Username key length must be a positive integer");
    }
};
const isValidUsernameKey = (key, { length = DEFAULT_USERNAME_KEY_LENGTH } = {}) => {
    assertLength(length);
    return typeof key === "string" && key.length === length && /^\d+$/.test(key);
};
exports.isValidUsernameKey = isValidUsernameKey;
const isRepeatedDigitUsernameKey = (key, options = {}) => {
    if (!(0, exports.isValidUsernameKey)(key, options)) return false;
    return key.split("").every(digit => digit === key[0]);
};
exports.isRepeatedDigitUsernameKey = isRepeatedDigitUsernameKey;
const makeRepeatedDigitUsernameKey = ({ digit, length = DEFAULT_USERNAME_KEY_LENGTH }) => {
    const value = String(digit);
    assertLength(length);
    if (!/^\d$/.test(value)) throw new Error("Username key digit must be a single numeric digit");
    return value.repeat(length);
};
exports.makeRepeatedDigitUsernameKey = makeRepeatedDigitUsernameKey;
const makeRandomUsernameKey = ({ length = DEFAULT_USERNAME_KEY_LENGTH } = {}) => {
    assertLength(length);
    return Array.from({ length }, () => (0, crypto_1.randomInt)(10).toString()).join("");
};
exports.makeRandomUsernameKey = makeRandomUsernameKey;
