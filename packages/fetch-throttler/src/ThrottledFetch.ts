import type { SetOptional } from "type-fest";
import { RequestPool } from "./RequestPool";
import type {
	Fetch, ExtendedFetch, FetchParams, FetchReturn, OnlyFetch,
	ThrottleConfig, DefaultThrottleConfig, ThrottleScope, CustomThrottleConfig, SpecifiedThrottleConfig
} from "./types";
import { fillDefaults } from "./utils";

/**
 * Manages throttled fetch requests based on configured rules.
 * It allows setting global, domain-specific, path-specific, regex-based, or custom throttling configurations.
 * @template T The type of the underlying fetch function. Defaults to the type of global `fetch`.
 */
export class ThrottledFetch<T extends ExtendedFetch<any, any, any> = Fetch> {
	private readonly _defaultPools = new Map<string, RequestPool<T>>();

	private readonly _urlPools = new Map<string, RequestPool<T>>();

	private readonly _regexPools = new Array<[regex: RegExp, pool: RequestPool<T>]>();

	private readonly _customPools = new Array<[match: CustomThrottleConfig["match"], pool: RequestPool<T>]>();

	private _hasSubpathConfigs = false;

	/**
	 * The underlying fetch function used to make requests.
	 */
	readonly adapter: T;

	/**
	 * The default scope applied when creating new request pools if no specific configuration matches.
	 */
	readonly scope: ThrottleScope;

	/**
	 * The default throttling configuration applied to new request pools.
	 */
	readonly config: Readonly<SetOptional<Required<ThrottleConfig>, "shouldRetry">>;

	constructor(config?: DefaultThrottleConfig, adapter?: T) {
		if (typeof adapter !== "function") {
			if (adapter !== undefined)
				throw new TypeError(`Invalid adapter: ${adapter}`);
			if (typeof globalThis.fetch === "undefined") {
				let message = "`fetch` not available in current environment.";
				if (typeof process === "object" && typeof process.version === "string")
					message += ` Please upgrade node runtime to version 18+. The current version is ${process.version}.`;
				throw new Error(message);
			}
		}
		const { scope = "global", ...rest } = config ?? {};
		this.adapter = adapter ?? globalThis.fetch.bind(globalThis) as T;
		this.scope = scope;
		this.config = Object.freeze(fillDefaults(rest));
	}

	private getKey(url: URL, scope?: ThrottleScope): string {
		scope ??= this.scope;
		if (scope === "global")
			return "";
		if (scope === "domain")
			return url.host;
		if (scope === "path") {
			const key = url.origin + url.pathname;
			return key.endsWith("/") ? key.slice(0, -1) : key;
		}
		throw new TypeError(`Invalid scope: ${scope}`);
	}

	private getSubpathKeys(url: URL): string[] {
		let pathname = url.pathname.substring(1);
		if (pathname.endsWith("/"))
			pathname = pathname.slice(0, -1);
		const parts = pathname.split("/");
		const keys = new Array<string>(parts.length);
		keys[0] = url.origin + "/";
		for (let i = 0; i < parts.length - 1; ++i)
			keys[i + 1] = keys[i] + parts[i] + "/";
		return keys.reverse();
	}

	private getPool(url: URL, create: true): RequestPool<T>;
	private getPool(url: URL, create?: false): RequestPool<T> | undefined;
	private getPool(url: URL, create: boolean = false) {
		for (let i = this._customPools.length - 1; i >= 0; i--) {
			const item = this._customPools[i];
			if (item[0](url))
				return item[1];
		}
		for (let i = this._regexPools.length - 1; i >= 0; i--) {
			const item = this._regexPools[i];
			if (item[0].test(url.href))
				return item[1];
		}
		let pool = this._urlPools.get(this.getKey(url, "path"));
		if (this._hasSubpathConfigs && pool === undefined) {
			for (const key of this.getSubpathKeys(url)) {
				pool = this._urlPools.get(key);
				if (pool !== undefined)
					break;
			}
		}
		pool ??= this._urlPools.get(this.getKey(url, "domain"));
		if (pool === undefined) {
			const key = this.getKey(url);
			pool = this._defaultPools.get(key);
			if (create === true && pool === undefined) {
				pool = new RequestPool(this.config, this.adapter);
				this._defaultPools.set(key, pool);
			}
		}
		return pool;
	}

	private parseUrl(args: FetchParams<T>): URL {
		const input = args[0];
		let url: URL | string;
		if (typeof input == "string" || input instanceof URL)
			url = input;
		else if (typeof input == "object" && typeof input.url == "string")
			url = input.url;
		else
			throw new TypeError(`Invalid input: ${input}`);
		if (typeof url == "string") {
			if (url.startsWith("/"))
				url = location.origin + url;
			try {
				url = new URL(url);
			}
			catch {
				throw new TypeError(`Invalid URL: ${url}`);
			}
		}
		return url;
	}

	/**
	 * Invokes the throttled fetch request.
	 * This method queues the request and executes it according to the matching throttling rules.
	 * @param args The parameters for the fetch call (URL or Request object, and optional options).
	 * @returns A promise that resolves with the fetch response or rejects on error.
	 * @throws {TypeError} If the input URL is invalid.
	 */
	invoke(...args: FetchParams<T>): Promise<FetchReturn<T>> {
		const pool = this.getPool(this.parseUrl(args), true);
		return new Promise((resolve, reject) => pool.add(args, resolve, reject));
	}

	/**
	 * Gets the current statistics of requests for the specified URL.
	 * @param args The parameters for the fetch call (URL or Request object, and optional options).
	 * @returns An object containing the counts of completed, active, and waiting requests.
	 * @throws {TypeError} If the input URL is invalid.
	 */
	stats(...args: FetchParams<T>): Record<"completed" | "active" | "waiting", number> {
		const pool = this.getPool(this.parseUrl(args));
		return {
			completed: pool?.completed ?? 0,
			active: pool?.active ?? 0,
			waiting: pool?.waiting ?? 0
		};
	}

	/**
	 * Configures specific throttling rules for different scopes (Domain, Path, Regex, Custom).
	 * New requests matching these rules will use a dedicated RequestPool with the specified configuration.
	 * @param config The specific throttling configuration to apply.
	 * @throws {TypeError} If the configuration object is invalid or contains an invalid scope or URL.
	 * @throws {Error} If a pool for the specified URL scope already exists.
	 */
	configure(config: SpecifiedThrottleConfig): void {
		if ("scope" in config) {
			const { url, scope, ...conf } = config;
			if (scope !== "domain" && scope !== "path")
				throw new TypeError(`Invalid scope: ${scope}`);
			const urls = (Array.isArray(url) ? url : url ? [url] : []).map(u => {
				if (typeof location !== "undefined" && typeof u == "string" && u.startsWith("/"))
					u = location.origin + u;
				const url = u instanceof URL ? u : URL.parse(u);
				if (url === null)
					throw new TypeError(`Invalid URL: ${u}`);
				return url;
			});
			let keys: string[];
			if (scope === "domain") {
				const domains = Array.isArray(config.domains) ? config.domains : config.domains ? [config.domains] : [];
				if (!urls.length && !domains.length)
					throw new TypeError("Domain scope requires either url or domains");
				// Note: embedded `getKey` logic, needs to be updated if `getKey` changes
				const set = new Set(domains.concat(urls.map(u => u.host)));
				keys = Array.from(set);
			}
			else {
				if (!urls.length)
					throw new TypeError("Path scope requires url");
				const set = new Set(urls.map(u => this.getKey(u, "path")));
				keys = Array.from(set);
				if (config.matchSubpath === true) {
					this._hasSubpathConfigs = true;
					keys.push(...keys.map(k => k + "/"));
				}
			}
			const pool = new RequestPool(conf, this.adapter);
			for (const key of keys) {
				if (this._urlPools.has(key))
					throw new Error(`Pool for ${key} already exists`);
				this._urlPools.set(key, pool);
			}
		}
		else if ("regex" in config) {
			const pool = new RequestPool(config, this.adapter);
			this._regexPools.push([config.regex, pool]);
		}
		else if ("match" in config) {
			const pool = new RequestPool(config, this.adapter);
			this._customPools.push([config.match, pool]);
		}
		else
			throw new TypeError(`Invalid config: ${config}`);
	}
}

export type ThrottledFetchInst<T extends ExtendedFetch<any, any, any> = Fetch> = OnlyFetch<T> & ThrottledFetch<T>;

/**
 * Creates a throttled fetch function with custom default configuration.
 * This function acts like the standard `fetch` but applies throttling rules defined
 * by the `ThrottledFetch` instance it wraps.
 * @template T The type of the underlying fetch function. Defaults to the type of global `fetch`.
 * @param config The default throttling configuration and scope.
 * @param adapter An optional custom fetch-compatible function. Defaults to global `fetch`.
 * @returns A function that behaves like `fetch` but is throttled, and also exposes the `ThrottledFetch` instance methods.
 */
export function createThrottledFetch<T extends ExtendedFetch<any, any, any> = Fetch>(config?: DefaultThrottleConfig, adapter?: T): ThrottledFetchInst<T>;
/**
 * Creates a throttled fetch function.
 * This function acts like the standard `fetch` but applies throttling rules defined
 * by the `ThrottledFetch` instance it wraps.
 * @template T The type of the underlying fetch function. Defaults to the type of global `fetch`.
 * @param adapter An optional custom fetch-compatible function.
 * @returns A function that behaves like `fetch` but is throttled, and also exposes the `ThrottledFetch` instance methods.
 */
export function createThrottledFetch<T extends ExtendedFetch<any, any, any> = Fetch>(adapter?: T): ThrottledFetchInst<T>;
export function createThrottledFetch<T extends ExtendedFetch<any, any, any> = Fetch>(param1?: T | DefaultThrottleConfig, param2?: T): ThrottledFetchInst<T> {
	const [config, adaptor] = typeof param1 == "function" ? [undefined, param1] : [param1, param2];
	const inst = new ThrottledFetch<T>(config, adaptor);
	const func = () => { };
	const proxy = new Proxy(func, {
		apply(_, __, args) {
			// @ts-ignore
			return inst.invoke(...args);
		},
		get: (_, prop) => Reflect.get(inst, prop),
		set: (_, prop, value) => Reflect.set(inst, prop, value),
		has: (_, prop) => Reflect.has(inst, prop),
		getOwnPropertyDescriptor: (_, prop) => Reflect.getOwnPropertyDescriptor(inst, prop),
		getPrototypeOf: () => Reflect.getPrototypeOf(inst),
		isExtensible: () => Reflect.isExtensible(inst),
		preventExtensions: () => Reflect.preventExtensions(inst),
		ownKeys: () => Reflect.ownKeys(inst)
	});
	return proxy as unknown as ThrottledFetchInst<T>;
}