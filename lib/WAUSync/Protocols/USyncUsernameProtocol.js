"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.USyncUsernameProtocol = void 0;
const WABinary_1 = require("../../WABinary");

class USyncUsernameProtocol {
    constructor() {
        this.name = "username";
    }

    getQueryElement() {
        return {
            tag: "username",
            attrs: {},
        };
    }

    getUserElement() {
        return null;
    }

    parser(node) {
        if (node.tag !== "username") {
            return null;
        }
        (0, WABinary_1.assertNodeErrorFree)(node);
        if (typeof node.content === "string") {
            return node.content;
        }
        if (node.content instanceof Uint8Array) {
            return Buffer.from(node.content).toString("utf-8");
        }
        return null;
    }
}
exports.USyncUsernameProtocol = USyncUsernameProtocol;
