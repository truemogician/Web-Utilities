export interface RequestThrottlerConfig {
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

type RequestTuple = [Parameters<Fetch>[0], Parameters<Fetch>[1]];

interface QueueItem {
	params: RequestTuple;

	retried: number;

	onSuccess?(response: Response): void;

	onFailure?(error: Error): void;
}

class RequestPool {
	private readonly _queue!: QueueItem[];

	private _index = 0;

	private _end = 0;

	private _concurrency = 0;

	public readonly capacity;

	public constructor(
		public readonly maxConcurrency: number,
		public readonly maxRetry: number,
		capacity?: number
	) {
		this.capacity = Math.max(0, capacity ?? 0);
		this._queue = this.capacity > 0
			? new Array<QueueItem>(this.capacity)
			: new Array<QueueItem>();
	}

	private pop(): QueueItem {
		const item = this._queue[this.capacity ? this._index % this.capacity : this._index];
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

	private process() {
		const item = this.pop();
		++this._concurrency;
		const handleError = (error: any) => {
			if (item.retried < this.maxRetry) {
				++item.retried;
				this.push(item);
			}
			else
				item.onFailure?.(error);
		}
		fetch(...item.params).then(
			response => {
				if (response.ok)
					item.onSuccess?.(response);
				else
					handleError(response);
			},
			handleError
		).finally(() => {
			--this._concurrency;
			if (this._index < this._end && this._concurrency < this.maxConcurrency)
				this.process();
		});
	}

	public add(request: RequestTuple, onSuccess?: (response: Response) => void, onFailure?: (error: any) => void) {
		if (this.capacity > 0 && this._end - this._index >= this.capacity)
			throw new Error("Request pool is full");
		this.push({
			params: request,
			retried: 0,
			onSuccess,
			onFailure
		});
		if (this._concurrency < this.maxConcurrency)
			this.process();
	}
}

export class RequestThrottler {
	private _pools = new Map<string, RequestPool>();

	readonly config: Readonly<RequestThrottlerConfig>;

	constructor(config?: Partial<RequestThrottlerConfig>) {
		this.config = {
			scope: "domain",
			maxConcurrency: 0,
			maxRetry: 1,
			capacity: 0,
			...config,
		}
	}

	fetch(input: Parameters<Fetch>[0], init?: Parameters<Fetch>[1]): Promise<Response> {
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
		const scope = this.config.scope;
		const key = scope == "global" ? "global"
			: scope == "domain" ? url.host
				: scope == "path" ? url.origin + url.pathname
					: url.toString();
		if (!this._pools.has(key))
			this._pools.set(key, new RequestPool(
				this.config.maxConcurrency,
				this.config.maxRetry,
				this.config.capacity
			));
		const pool = this._pools.get(key)!;
		return new Promise((resolve, reject) => pool.add([input, init], resolve, reject));
	}
}