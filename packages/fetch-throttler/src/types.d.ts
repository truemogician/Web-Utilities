import type { Arrayable, Promisable } from "type-fest";

export type Fetch = typeof fetch;

export interface ExtendedFetch<TReq extends Request = Request, TRes extends Response = Response, TExtra extends [] = []> {
	(input: TReq): Promise<TRes>;
	(input: string | URL, init?: RequestInit): Promise<TRes>;
	(input: string | URL | TReq, init?: RequestInit, ...extra: TExtra): Promise<TRes>;
}

export type OnlyFetch<T> =
	T extends ExtendedFetch<infer TReq, infer TRes, infer TExtra>
	? ExtendedFetch<TReq, TRes, TExtra> : never;

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

	/**
	 * A function that determines whether a request should be retried based on the error or response object.
	 * @param errOrRes The error or response object from the request.
	 * @returns Whether the request should be retried.
	 * - `true`: The request will be retried (up to `maxRetry` times).
	 * - `false`: If `errOrRes` is a `Response`, the request will succeed (even if the response is not ok);
	 *  if `errOrRes` is an `Error`, the request will fail without retrying.
	 * - `void`: The default behavior will be applied (retry on errors and non-ok responses).
	 * @note If `errOrRes` is a `Response`, make sure to `clone()` it if the response body is needed.
	 * Otherwise, the caller of `ThrottledFetch` will not be able to consume the response body.
	 */
	shouldRetry?: (errOrRes: Error | Response) => Promisable<boolean | void>;
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

export interface DomainThrottleConfig extends ThrottleConfig {
	/**
	 * The scope for this specific rule. Must be `domain`.
	 */
	scope: "domain";

	/**
	 * The URL(s) to match for applying this configuration.
	 */
	url?: Arrayable<string | URL>;

	/**
	 * The domain(s) to match for applying this configuration.
	 * If `url` is not provided, this field is required.
	 */
	domains?: Arrayable<string>;
}

export interface PathThrottleConfig extends ThrottleConfig {
	/**
	 * The scope for this specific rule. Must be `path`.
	 */
	scope: "path";

	/**
	 * The URL(s) to match for applying this configuration.
	 */
	url: Arrayable<string | URL>;

	/**
	 * If `true`, this configuration will apply to the specified path(s) and any subpaths.
	 * For example, if `url` is `https://example.com/api` and `matchSubpath` is `true`,
	 * requests to `https://example.com/api/users` will also match.
	 * If `false` or omitted, only exact path matches will apply.
	 * @default false
	 */
	matchSubpath?: boolean;
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

export type SpecifiedThrottleConfig = DomainThrottleConfig | PathThrottleConfig | RegexThrottleConfig | CustomThrottleConfig;