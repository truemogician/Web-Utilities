import { BasicMemoryCacheStorage, type CacheStorage } from "./cache-storage";
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
export type RequestHasher = (request: Request) => Promisable<number>;
const escape = (str: string) => str.replaceAll("\\", "\\\\").replaceAll("=", "\\=");
export const createRequestHasher = (config: Readonly<CacheKeyConfig>): RequestHasher =>
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

export type CacheConfig =
	& (RequestFilterConfig | { filterRequest: RequestFilter })
	& (ResponseFilterConfig | { filterResponse: ResponseFilter })
	& (CacheKeyConfig | { hashRequest: RequestHasher })
	& (CacheStorageConfig | { storage: CacheStorage<number, Promisable<Response>> })
	& {
		/**
		 * In some occasions, the same request may be sent multiple times before the first response is received.  
		 * If set to `true`, only the first request will be sent, and the rest will be resolved with the same promise.  
		 * Default is `false`.
		 */
		cachePromise?: boolean;
		/**
		 * The body of a `Response` could only be consumed once. If set to `true`, the response will be cloned before being cached to avoid this problem.  
		 * Default is `true`.
		 */
		cloneResponse?: boolean;
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
	const hashRequest = "hashRequest" in config ? config.hashRequest : createRequestHasher(config);
	const storage = "storage" in config
		? config.storage
		: new BasicMemoryCacheStorage<Response>({
			ttl: (config.ttl ?? 300) * 1000,
			autoTouch: true
		});
	const noClone = config.cloneResponse === false;
	return Object.assign(
		async (input: FetchParams[0], init?: FetchParams[1]): Promise<Response> => {
			const request = input instanceof Request ? input : new Request(input, init);
			let shouldCache: boolean;
			try {
				shouldCache = await filterRequest(request);
			}
			catch (error) {
				console.error("Failed to filter request: ", error);
				return original(request);
			}
			if (shouldCache === false)
				return original(request);
			let key: number;
			try {
				key = await hashRequest(request);
			}
			catch (error) {
				console.error("Failed to generate cache key: ", error);
				return original(request);
			}
			const cache = storage.get(key);
			if (cache != undefined) {
				const resp = cache instanceof Promise ? await cache : cache;
				if (noClone)
					return resp;
				// BUG: Weirdly, the body of some responses are used after retrieved from cache, and this behavior is quite random.
				// One possible way to reproduce is to use TezFiles file info query API, and wait for a few seconds before fetching the same URL the third time after the first cache hit.
				if (resp.bodyUsed)
					storage.delete(key);
				else
					return resp.clone();
			}
			const promise = original(request)
				.finally(() => {
					if (config.cachePromise)
						storage.delete(key);
				})
				.then(async response => {
					let shouldCache: boolean;
					try {
						shouldCache = await filterResponse(response);
					}
					catch (error) {
						console.error("Failed to filter response: ", error);
						return response;
					}
					if (shouldCache) {
						storage.set(key, response);
						return noClone ? response : response.clone();
					}
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