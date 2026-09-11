export declare const isValidUsernameKey: (key: string, options?: { length?: number }) => boolean;
export declare const isRepeatedDigitUsernameKey: (key: string, options?: { length?: number }) => boolean;
export declare const makeRepeatedDigitUsernameKey: (options: { digit: string | number; length?: number }) => string;
export declare const makeRandomUsernameKey: (options?: { length?: number }) => string;
