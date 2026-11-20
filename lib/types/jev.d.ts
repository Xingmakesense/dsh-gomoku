/** Official native API, documented at https://docs.typesafe.ai/api. */
export declare const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
/** Jev chooses from legal intersections; it does not generate chat text. */
export declare function requestJevMove(board: readonly number[], side: 'black' | 'white', system: string, apiKey: string, signal: AbortSignal): Promise<{
    text: string;
    reasoning: string;
    truncated: boolean;
}>;
