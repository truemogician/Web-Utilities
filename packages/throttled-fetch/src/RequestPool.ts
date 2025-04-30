import type { Fetch, FetchParams, ThrottleConfig } from "./types";

interface QueueItem {
	params: FetchParams;

	retried: number;

	onSuccess?(response: Response): void;

	onFailure?(error: Error): void;
}

export class RequestPool {
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