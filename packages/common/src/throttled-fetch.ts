export interface ThrottleConfig {
	/**
	 * The scope of applied for concurrency limit. Default is `domain`.
	 */
	scope: "global" | "domain" | "path" | "full-url";

	/**
	 * The maximum number of requests that can be sent at the same time.
	 * If equal to or less than 0, no limit will be applied. Default is 0.
	 */
	maxConcurrency: number;

	/**
	 * The interval in milliseconds for rate limiting.
	 * If equal to or less than 0, no rate limiting will be applied. Default is 0.
	 */
	interval: number;

	/**
	 * The maximum number of retries when failed.
	 * If equal to or less than 0, no retry will be performed. Default is 1.
	 */
	maxRetry: number;

	/**
	 * The capacity of the request queue.
	 * If equal to or less than 0, the queue will be dynamic. Default is 0.
	 */
	capacity: number;
}

type Fetch = typeof fetch;

type FetchParams = Parameters<Fetch>;

interface QueueItem {
	params: FetchParams;

	retried: number;

	onSuccess?(response: Response): void;

	onFailure?(error: Error): void;
}

class RequestPool {
	private readonly _queue: QueueItem[];

	private readonly _timestamps?: number[];

	private readonly _adapter: Fetch;

	private _index = 0;

	private _end = 0;

	private _concurrency = 0;

	public readonly maxConcurrency: number;

	public readonly interval: number;

	public readonly maxRetry: number;

	public readonly capacity: number;

	public constructor(init: Omit<ThrottleConfig, "scope"> & { adapter: Fetch }) {
		this.maxConcurrency = init.maxConcurrency > 0 ? init.maxConcurrency : Infinity;
		this.interval = Math.max(0, init.interval);
		this.maxRetry = Math.max(0, init.maxRetry);
		this.capacity = Math.max(0, init.capacity);
		this._adapter = init.adapter;
		this._queue = this.capacity > 0
			? new Array<QueueItem>(this.capacity)
			: new Array<QueueItem>();
		if (init.maxConcurrency > 0 && init.interval > 0)
			this._timestamps = new Array<number>(init.maxConcurrency);
	}

	private get nextTimestamp(): number | undefined {
		if (!this._timestamps)
			return undefined;
		if (this._index < this.maxConcurrency)
			return 0;
		const idx = this._index % this.maxConcurrency;
		return this._timestamps[idx] + this.interval;
	}

	private pop(): QueueItem | undefined {
		if (this._index >= this._end)
			return undefined;
		const item = this._queue[this.capacity ? this._index % this.capacity : this._index];
		if (this._timestamps)
			this._timestamps[this._index % this.maxConcurrency] = Date.now();
		++this._index;
		return item;
	}

	private push(item: QueueItem) {
		if (this.capacity)
			this._queue[this._end % this.capacity] = item;
		else
			this._queue.push(item);
		++this._end;
	}

	private handleError(item: QueueItem, error: any) {
		if (item.retried >= this.maxRetry)
			item.onFailure?.(error);
		else {
			++item.retried;
			this.push(item);
		}
	}

	private process() {
		if (this._concurrency >= this.maxConcurrency)
			return;
		const nextTime = this.nextTimestamp;
		if (nextTime != undefined) {
			const now = Date.now();
			if (now < nextTime) {
				setTimeout(() => this.process(), nextTime - now);
				return;
			}
		}
		const item = this.pop();
		if (item == undefined)
			return;
		++this._concurrency;
		this._adapter(...item.params)
			.finally(() => --this._concurrency)
			.then(
				resp => {
					if (resp.ok)
						item.onSuccess?.(resp);
					else
						this.handleError(item, resp);
				},
				error => this.handleError(item, error)
			)
			.finally(() => this.process());
	}

	public add(request: FetchParams, onSuccess?: (response: Response) => void, onFailure?: (error: any) => void) {
		if (this.capacity > 0 && this._end - this._index >= this.capacity)
			throw new Error("Request pool is full");
		this.push({
			params: request,
			retried: 0,
			onSuccess,
			onFailure
		});
		this.process();
	}
}

export type ThrottledFetch<T extends Fetch = Fetch> = Fetch & {
	original: T;
	throttleConfig: Readonly<ThrottleConfig>;
}

export function createThrottledFetch(config?: Partial<ThrottleConfig>): ThrottledFetch;
export function createThrottledFetch<T extends Fetch = Fetch>(fetch: T, config?: Partial<ThrottleConfig>): ThrottledFetch<T>;
export function createThrottledFetch(param1?: Fetch | Partial<ThrottleConfig>, param2?: Partial<ThrottleConfig>): ThrottledFetch {
	if (typeof param1 != "function" && typeof fetch == "undefined") {
		let message = "`fetch` not available in current environment."
		if (typeof process != "undefined" && process.version)
			message += ` Please upgrade node runtime to version 18+. The current version is ${process.version}.`;
		throw new Error(message);
	}
	const [original, conf] = typeof param1 == "function" ? [param1, param2] : [globalThis.fetch.bind(globalThis), param1];
	const config: ThrottleConfig = {
		scope: "domain",
		maxConcurrency: 0,
		interval: 0,
		maxRetry: 1,
		capacity: 0,
		...conf,
	};
	const pools = new Map<string, RequestPool>();
	return Object.assign(
		(input: FetchParams[0], init?: FetchParams[1]): Promise<Response> => {
			let url = input instanceof URL ? input : typeof input == "string" ? input : input.url;
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
			const scope = config.scope;
			const key = scope == "global" ? "global"
				: scope == "domain" ? url.host
					: scope == "path" ? url.origin + url.pathname
						: url.toString();
			if (!pools.has(key))
				pools.set(key, new RequestPool({ ...config, adapter: original }));
			const pool = pools.get(key)!;
			return new Promise((resolve, reject) => pool.add([input, init], resolve, reject));
		},
		{
			original,
			throttleConfig: config
		}
	);
}