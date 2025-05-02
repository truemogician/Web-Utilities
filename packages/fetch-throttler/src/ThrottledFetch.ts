import { RequestPool } from "./RequestPool";
import type { Fetch, FetchParams, FetchReturn, ThrottleConfig, DefaultThrottleConfig, ThrottleScope, CustomThrottleConfig, SpecifiedThrottleConfig } from "./types";
import { fillDefaults } from "./utils";

export class ThrottledFetch<T extends Fetch = Fetch> {
	private readonly _defaultPools = new Map<string, RequestPool<T>>();

	private readonly _urlPools = new Map<string, RequestPool<T>>();

	private readonly _regexPools = new Array<[regex: RegExp, pool: RequestPool<T>]>();

	private readonly _customPools = new Array<[match: CustomThrottleConfig["match"], pool: RequestPool<T>]>();

	public readonly adapter: T;

	public readonly scope: ThrottleScope;

	public readonly config: Readonly<Required<ThrottleConfig>>;

	public constructor(config?: DefaultThrottleConfig, adapter?: T) {
		if (typeof adapter !== "function") {
			if (adapter !== undefined)
				throw new TypeError(`Invalid adapter: ${adapter}`);
			if (typeof globalThis.fetch === "undefined") {
				let message = "`fetch` not available in current environment."
				if (typeof process !== "undefined" && process.version)
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
		else if (scope === "domain")
			return url.host;
		else if (scope === "path")
			return url.origin + url.pathname;
		else
			throw new TypeError(`Invalid scope: ${scope}`);
	}

	private getOrCreate(url: URL): RequestPool<T> {
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
		let pool = this._urlPools.get(this.getKey(url, "path"))
			?? this._urlPools.get(this.getKey(url, "domain"));
		if (pool === undefined) {
			const key = this.getKey(url);
			pool = this._defaultPools.get(key);
			if (pool === undefined) {
				pool = new RequestPool(this.config, this.adapter);
				this._defaultPools.set(key, pool);
			}
		}
		return pool;
	}

	public invoke(...args: FetchParams<T>): Promise<FetchReturn<T>> {
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
		const pool = this.getOrCreate(url);
		return new Promise((resolve, reject) => pool.add(args, resolve, reject));
	}

	public configure(config: SpecifiedThrottleConfig): void {
		if ("scope" in config) {
			const { url, scope, ...conf } = config;
			if (scope !== "domain" && scope !== "path")
				throw new TypeError(`Invalid scope: ${scope}`);
			const keys = (Array.isArray(url) ? url : [url]).map(u => {
				if (typeof location !== "undefined" && typeof u == "string" && u.startsWith("/"))
					u = location.origin + u;
				const url = u instanceof URL ? u : URL.parse(u);
				if (url === null)
					throw new TypeError(`Invalid URL: ${u}`);
				return this.getKey(url, scope);
			});
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

export function createThrottledFetch<T extends Fetch = Fetch>(adapter?: T): T & ThrottledFetch<T>;
export function createThrottledFetch<T extends Fetch = Fetch>(config?: DefaultThrottleConfig, adapter?: T): T & ThrottledFetch<T>;
export function createThrottledFetch<T extends Fetch = Fetch>(param1?: T | DefaultThrottleConfig, param2?: T): T & ThrottledFetch<T> {
	const [config, adaptor] = typeof param1 == "function" ? [undefined, param1] : [param1, param2];
	const inst = new ThrottledFetch(config, adaptor);
	const func = () => { };
	const proxy = new Proxy(func, {
		apply(_, __, args) {
			// @ts-ignore
			return inst.invoke(...args);
		},
		get: (_, prop, receiver) => Reflect.get(inst, prop, receiver),
		has: (_, prop) => Reflect.has(inst, prop),
		getOwnPropertyDescriptor: (_, prop) => Reflect.getOwnPropertyDescriptor(inst, prop),
		getPrototypeOf: () => Reflect.getPrototypeOf(inst),
		isExtensible: () => Reflect.isExtensible(inst),
		preventExtensions: () => Reflect.preventExtensions(inst),
		ownKeys: () => Reflect.ownKeys(inst)
	});
	return proxy as unknown as T & ThrottledFetch<T>;
}