/** Plugin-owned route, separate from any host provider named Jev. */
export declare const JEV_PROVIDER = "gomoku-jev";
export declare const JEV_MODEL = "jev-latest";
/** Reject empty keys and characters that cannot be sent in an HTTP header. */
export declare function isValidJevApiKey(value: unknown): value is string;
