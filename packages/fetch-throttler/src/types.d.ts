import type { Arrayable } from "type-fest";

export type Fetch = typeof fetch;

export type FetchParams<T extends Fetch = Fetch> = Parameters<T>;

export type FetchReturn<T extends Fetch = Fetch> = Awaited<ReturnType<T>>;

/**
 * Defines the core throttling configuration options applicable to a request pool.
 */
export interface ThrottleConfig {
	/**
	 * The maximum number of requests that can be executed concurrently within this pool.
	 * If set to 0 or negative, no concurrency limit is applied.
	 * If `interval` is positive and `maxConcurrency` is not set or is non-positive, it defaults to 1.
	 * @default 0
	 */
	maxConcurrency?: number;

	/**
	 * The minimum interval in milliseconds between the start of consecutive requests
	 * within this pool. If set to 0 or negative, no rate limiting is applied based on time interval.
	 * @default 0
	 */
	interval?: number;

	/**
	 * The maximum number of times a failed request (network error or non-ok response)
	 * should be automatically retried. If set to 0 or negative, no retries will be performed.
	 * @default 1
	 */
	maxRetry?: number;

	/**
	 * The maximum number of requests that can be waiting in the queue for this pool.
	 * If the queue reaches this capacity, subsequent requests targeting this pool will
	 * be rejected immediately. If set to 0 or negative, the queue size is unlimited.
	 * @default 0
	 */
	capacity?: number;
}

/**
 * Defines the scope at which throttling rules are applied.
 * - `global`: A single pool for all requests (unless overridden by more specific rules).
 * - `domain`: Separate pools for each unique domain (host).
 * - `path`: Separate pools for each unique origin + pathname combination.
 */
export type ThrottleScope = "global" | "domain" | "path";

export interface DefaultThrottleConfig extends ThrottleConfig {
	/**
	 * The default scope to apply for creating request pools when no specific config matches.
	 * Determines how the default pools are keyed (globally, by domain, or by path).
	 * @default "global"
	 */
	scope?: ThrottleScope;
}

export interface UrlComponentThrottleConfig extends ThrottleConfig {
	/**
	 * The scope for this specific rule. Must be either `domain` or `path`.
	 */
	scope: Exclude<ThrottleScope, "global">;

	/**
	 * The URL(s) to match for applying this configuration.
	 */
	url: Arrayable<string | URL>;
}

export interface RegexThrottleConfig extends ThrottleConfig {
	/**
	 * The regular expression pattern to test against the full URL string (`url.href`).
	 */
	regex: RegExp;
}

export interface CustomThrottleConfig extends ThrottleConfig {
	/**
	 * A custom function that receives the `URL` object of the request.
	 * If the function returns `true`, this configuration's throttling rules are applied.
	 */
	match: (url: URL) => boolean;
}

export type SpecifiedThrottleConfig = UrlComponentThrottleConfig | RegexThrottleConfig | CustomThrottleConfig;