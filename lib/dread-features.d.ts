import { MiscMessageGenerationOptions, proto } from './Types';

export type RichMenuButton = string | {
    id?: string;
    label?: string;
};

export type RichMenuCard = {
    title?: string;
    toast?: string;
    buttons?: RichMenuButton[];
};

export type RichMenuContent = {
    header?: {
        disclaimer?: boolean;
        disclaimerText?: string;
        image?: {
            inline?: boolean;
            mime_type?: string;
            url?: string;
            width?: number;
            height?: number;
        };
        title?: string;
    };
    body?: {
        cards?: RichMenuCard[];
        buttons?: RichMenuButton[];
        title?: string;
        toast?: string;
        carousel?: boolean;
        row?: boolean;
    };
    footer?: {
        text?: string;
        url?: string;
        image?: {
            mime_type?: string;
            url?: string;
            width?: number;
            height?: number;
        };
    };
    contextInfo?: proto.IContextInfo;
};

export type DreadSocketHelpers = {
    decodeJid(jid?: string): string | undefined;
    sendjson(target: string, json?: proto.IMessage, config?: Record<string, unknown>): Promise<string>;
    richMenu(target: string, content?: RichMenuContent, config?: Record<string, unknown>): Promise<proto.WebMessageInfo>;
    pollMenu(jid: string, name?: string, pollOptions?: { vote: string; [key: string]: unknown }[], context?: Record<string, unknown>, selectableCount?: number): Promise<proto.WebMessageInfo>;
    makeFakeCommand(m: any, text: string, chatUpdate?: any): Promise<boolean>;
    getLidForJid(jid: string): Promise<string>;
    listKnownLids(jid?: string): Promise<string[]>;
    revealViewOnce(target: string, quotedOrMessage: any, options?: Record<string, unknown>): Promise<string>;
    sendDreadText(jid: string, text: string, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo>;
    runCheckDevice(payload: { msg: any; from: string; reply?: (text: string) => unknown | Promise<unknown> }): Promise<unknown>;
};

export declare function attachDreadFeatures<T extends Record<string, any>>(sock: T): T & DreadSocketHelpers;
export declare function buildRichMenuMessage(content?: RichMenuContent): proto.IMessage;
export declare function getDevice(id?: string): 'ios' | 'web' | 'android' | 'desktop' | 'unknown';
export declare function getLidForJid(sock: any, jid: string): Promise<string>;
export declare function jidNumber(jid?: string): string;
export declare function listKnownLids(sock: any, jid?: string): Promise<string[]>;
export declare function makeFakeCommand(sock: any, m: any, text: string, chatUpdate?: any): Promise<boolean>;
export declare function normalizeJid(jid?: string): string | undefined;
export declare function patchConnectionConfig<T extends Record<string, any>>(config?: T): T & { patchMessageBeforeSending: (...args: any[]) => any };
export declare function patchRichResponseMessage(message: proto.IMessage): proto.IMessage;
export declare function pollMenu(sock: any, jid: string, name?: string, pollOptions?: { vote: string; [key: string]: unknown }[], context?: Record<string, unknown>, selectableCount?: number): Promise<proto.WebMessageInfo>;
export declare function revealViewOnce(sock: any, target: string, quotedOrMessage: any, options?: Record<string, unknown>): Promise<string>;
export declare function richMenu(sock: any, target: string, content?: RichMenuContent, config?: Record<string, unknown>): Promise<proto.WebMessageInfo>;
export declare function runCheckDevice(payload: { sock: any; msg: any; from: string; reply?: (text: string) => unknown | Promise<unknown> }): Promise<unknown>;
export declare function sendDreadText(sock: any, jid: string, text: string, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo>;
export declare function sendjson(sock: any, target: string, json?: proto.IMessage, config?: Record<string, unknown>): Promise<string>;
