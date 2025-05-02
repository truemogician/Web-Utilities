import type { Arrayable } from "type-fest";

export type Fetch = typeof fetch;

export type FetchParams<T extends Fetch = Fetch> = Parameters<T>;

export type FetchReturn<T extends Fetch = Fetch> = Awaited<ReturnType<T>>;

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

export type ThrottleScope = "global" | "domain" | "path";

export interface DefaultThrottleConfig extends ThrottleConfig {
	/**
	 * The scope of applied for concurrency limit. Default is `global`.
	 */
	scope?: ThrottleScope;
}

export interface UrlComponentThrottleConfig extends ThrottleConfig {
	/**
	 * The scope of applied for concurrency limit.
	 */
	scope: Exclude<ThrottleScope, "global">;

	/**
	 * The URL(s) to be matched for the scope.
	 */
	url: Arrayable<string | URL>;
}

export interface RegexThrottleConfig extends ThrottleConfig {
	/**
	 * The regex pattern to be matched for the scope.
	 */
	regex: RegExp;
}

export interface CustomThrottleConfig extends ThrottleConfig {
	/**
	 * The custom function to be called for the scope.
	 */
	match: (url: URL) => boolean;
}

export type SpecifiedThrottleConfig = UrlComponentThrottleConfig | RegexThrottleConfig | CustomThrottleConfig;