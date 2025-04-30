type Fetch = typeof fetch;

type FetchParams<T extends Fetch = Fetch> = Parameters<T>;

type FetchReturn<T extends Fetch = Fetch> = Awaited<ReturnType<T>>;

export interface ThrottleConfig {
	/**
	 * The maximum number of requests that can be sent at the same time.
	 * If equal to or less than 0, no limit will be applied. Default is 0.
	 */
	maxConcurrency?: number;

	/**
	 * The interval in milliseconds for rate limiting.
	 * If equal to or less than 0, no rate limiting will be applied. Default is 0.
	 */
	interval?: number;

	/**
	 * The maximum number of retries when failed.
	 * If equal to or less than 0, no retry will be performed. Default is 1.
	 */
	maxRetry?: number;

	/**
	 * The capacity of the request queue.
	 * If equal to or less than 0, the queue will be dynamic. Default is 0.
	 */
	capacity?: number;
}

export type ThrottleScope = "global" | "domain" | "path" | "full-url";

export interface DefaultThrottleConfig extends ThrottleConfig {
	/**
	 * The scope of applied for concurrency limit. Default is `global`.
	 */
	scope?: ThrottleScope;
}