import { hashCode } from "./hash-code";

type Promisable<T> = T | Promise<T>;

export interface RequestFilterConfig {
	/**
	 * If `true`, requests with body will not be cached.  
	 * Default is `true`.
	 */
	noBody?: boolean;
}
export type RequestFilter = (request: Request) => Promisable<boolean>;
export const createRequestFilter = (config: Readonly<RequestFilterConfig>): RequestFilter =>
	request => {
		if (config.noBody !== false && request.body != null)
			return false;
		return true;
	};

export interface ResponseFilterConfig {
	/**
	 * If set to `true`, only successful response will be cached.  
	 * Default is `true`
	 */
	successOnly?: boolean;
	/**
	 * The status codes that should be cached.  
	 * Note that if this option is specified, `successOnly` will be ignored.
	 */
	statuses?: number[];
}
export type ResponseFilter = (response: Response) => Promisable<boolean>;
export const createResponseFilter = (config: Readonly<ResponseFilterConfig>): ResponseFilter =>
	response => {
		if (config.statuses != null) {
			if (!config.statuses.includes(response.status))
				return false;
		}
		else if (config.successOnly !== false && !response.ok)
			return false;
		return true;
	};

export interface CacheKeyConfig {
	/**
	 * Whether the hash of the request URL should be included in the cache key.  
	 * Default is `false`.
	 */
	includeHash?: boolean;
	/**
	 * The query parameter names that should be included in the cache key.  
	 * Default is `"all"`.
	 */
	params?: string[] | "all";
	/**
	 * The header names that should be included in the cache key.  
	 */
	headers?: string[];
}
export type KeyGenerator<K extends string | number = number> = (request: Request) => Promisable<K>;
const escape = (str: string) => str.replaceAll("\\", "\\\\").replaceAll("=", "\\=");
export const createKeyGenerator = (config: Readonly<CacheKeyConfig>): KeyGenerator =>
	request => {
		if (request.body != null)
			request = request.clone();
		const url = new URL(request.url);
		let href = url.origin + url.pathname;
		if (config.includeHash === true)
			href += url.hash;
		let key = hashCode(`U${href}`);
		for (const [param, value] of url.searchParams.entries()) {
			if (config.params === "all" || config.params?.includes(param))
				key ^= hashCode(`S${escape(param)}=${escape(value)}`);
		}
		if (config.headers)
			for (const header of config.headers) {
				const value = request.headers.get(header);
				if (value)
					key ^= hashCode(`H${escape(header.toLowerCase())}=${escape(value)}`);
			}
		if (request.body == null)
			return key;
		return request.text().then(text => key ^ hashCode(`B${text}`));
	};

export interface CacheStorageConfig {
	/**
	 * Number of seconds after which the cache entry will be expired.  
	 * If equal to or less than 0, the cache entry will never expire.  
	 * Default is `300` (5 minutes).
	 */
	ttl?: number;
}
export interface CacheStorage<K extends string | number = number> {
	has(key: K): boolean;
	get(key: K): Promisable<Response> | undefined;
	set(key: K, value: Promisable<Response>): void;
	touch(key: K): boolean;
	delete(key: K): boolean;
}
export class MemoryCacheStorage implements CacheStorage<number> {
	static minMaintainenceInterval = 1000;
	private _lastMaintained?: number;
	private _schedule?: [timer: number | NodeJS.Timeout, timestamp: number];
	protected readonly map = new Map<number, [response: Promisable<Response>, timestamp: number]>();
	/**
	 * Expiration time in milliseconds.
	 */
	readonly ttl: number;

	constructor(config: Readonly<CacheStorageConfig>) {
		this.ttl = (config.ttl ?? 300) * 1000;
	}

	protected get top(): [number, [Promisable<Response>, number]] | undefined {
		const result = this.map.entries().next();
		return result.done === true ? undefined : result.value;
	}

	protected maintain(): number {
		const top = this.top;
		const now = Date.now();
		this._lastMaintained = now;
		if (top == undefined || now - top[1][1] <= this.ttl)
			return 0;
		let count = 0;
		for (const [key, [_, timestamp]] of this.map.entries()) {
			if (now - timestamp <= this.ttl)
				break;
			++count;
			this.map.delete(key);
		}
		return count;
	}
	protected startMaintainence(): void {
		const now = Date.now();
		if (this._lastMaintained == undefined || now - this._lastMaintained > MemoryCacheStorage.minMaintainenceInterval)
			this.maintain();
		const top = this.top;
		if (top == undefined)
			return;
		const nextTime = Math.max(top[1][1], this._lastMaintained! + MemoryCacheStorage.minMaintainenceInterval);
		if (this._schedule && this._schedule[1] >= nextTime)
			return;
		if (this._schedule)
			clearTimeout(this._schedule[0]);
		const timer = setTimeout(() => {
			this._schedule = undefined;
			this.startMaintainence();
		}, nextTime - now);
		this._schedule = [timer, nextTime];
	}
	has(key: number): boolean {
		const result = this.map.get(key);
		if (result == undefined)
			return false;
		if (Date.now() - result[1] > this.ttl) {
			this.map.delete(key);
			return false;
		}
		return true;
	}
	get(key: number): Promisable<Response> | undefined {
		const result = this.map.get(key);
		if (result == undefined)
			return undefined;
		if (Date.now() - result[1] > this.ttl) {
			this.map.delete(key);
			return undefined;
		}
		return result[0];
	}
	set(key: number, value: Promisable<Response>): this {
		this.map.delete(key);
		this.map.set(key, [value, Date.now()]);
		this.startMaintainence();
		return this;
	}
	touch(key: number): boolean {
		let result = this.map.get(key);
		if (result == undefined)
			return false;
		this.map.delete(key);
		result[1] = Date.now();
		this.map.set(key, result);
		return true;
	}
	delete(key: number): boolean {
		return this.map.delete(key);
	}
	clear(): void {
		this.map.clear();
	}
}

export type CacheConfig =
	& (RequestFilterConfig | { filterRequest: RequestFilter })
	& (ResponseFilterConfig | { filterResponse: ResponseFilter })
	& (CacheKeyConfig | { generateKey: KeyGenerator })
	& (CacheStorageConfig | { storage: CacheStorage })
	& {
		/**
		 * In some occasions, the same request may be sent multiple times before the first response is received.  
		 * If set to `true`, only the first request will be sent, and the rest will be resolved with the same promise.  
		 * Default is `false`.
		 */
		cachePromise?: boolean;
	};

type Fetch = typeof fetch;
type FetchParams = Parameters<Fetch>;

export type CachedFetch<T extends Fetch = Fetch> = Fetch & {
	original: T;
	cacheConfig: Readonly<CacheConfig>;
}

export function createCachedFetch(config?: CacheConfig): CachedFetch;
export function createCachedFetch<T extends Fetch = Fetch>(fetch: T, config?: CacheConfig): CachedFetch<T>;
export function createCachedFetch(param1?: Fetch | CacheConfig, param2?: CacheConfig): CachedFetch {
	if (typeof param1 != "function" && typeof fetch == "undefined") {
		let message = "`fetch` not available in current environment."
		if (typeof process != "undefined" && process.version)
			message += ` Please upgrade node runtime to version 18+. The current version is ${process.version}.`;
		throw new Error(message);
	}
	const [original, config] = typeof param1 === "function" ? [param1, param2 ?? {}] : [globalThis.fetch.bind(globalThis), param1 ?? {}];
	const filterRequest = "filterRequest" in config ? config.filterRequest : createRequestFilter(config);
	const filterResponse = "filterResponse" in config ? config.filterResponse : createResponseFilter(config);
	const generateKey = "generateKey" in config ? config.generateKey : createKeyGenerator(config);
	const storage = "storage" in config ? config.storage : new MemoryCacheStorage(config);
	return Object.assign(
		async (input: FetchParams[0], init?: FetchParams[1]): Promise<Response> => {
			const request = input instanceof Request ? input : new Request(input, init);
			if (await filterRequest(request) === false)
				return original(request);
			const key = await generateKey(request);
			const cache = storage.get(key);
			if (cache instanceof Response) {
				storage.touch(key);
				return cache;
			}
			else if (cache instanceof Promise && config.cachePromise)
				return await cache;
			const promise = original(request).then(async response => {
				if (await filterResponse(response))
					storage.set(key, response);
				else if (config.cachePromise)
					storage.delete(key);
				return response;
			});
			if (config.cachePromise)
				storage.set(key, promise);
			return await promise;
		},
		{
			original,
			cacheConfig: config
		}
	);
}