import { Promisable } from "type-fest";
import type { Fetch, ExtendedFetch, FetchParams, FetchReturn, ThrottleConfig } from "./types";
import { fillDefaults } from "./utils";

interface QueueItem<T extends ExtendedFetch<any, any, any>> {
	params: FetchParams<T>;

	retried: number;

	onSuccess?(response: FetchReturn<T>): void;

	onFailure?(error: Error): void;
}

export class RequestPool<T extends ExtendedFetch<any, any, any> = Fetch> {
	readonly #queue: QueueItem<T>[];

	readonly #timestamps?: number[];

	readonly #adapter: T;

	#index = 0;

	#end = 0;

	#concurrency = 0;

	readonly #shouldRetry: ThrottleConfig["shouldRetry"];

	readonly maxConcurrency: number;

	readonly interval: number;

	readonly maxRetry: number;

	readonly capacity: number;

	constructor(init: ThrottleConfig, adapter: T) {
		const config = fillDefaults(init);
		this.maxConcurrency = config.maxConcurrency > 0 ? config.maxConcurrency : Infinity;
		this.interval = Math.max(0, config.interval);
		this.maxRetry = Math.max(0, config.maxRetry);
		this.capacity = Math.max(0, config.capacity);
		this.#shouldRetry = config.shouldRetry;
		this.#adapter = adapter;
		this.#queue = this.capacity > 0
			? new Array<QueueItem<T>>(this.capacity)
			: new Array<QueueItem<T>>();
		if (config.maxConcurrency > 0 && config.interval > 0)
			this.#timestamps = new Array<number>(config.maxConcurrency);
	}

	get #nextTimestamp(): number | undefined {
		if (!this.#timestamps)
			return undefined;
		if (this.#index < this.maxConcurrency)
			return 0;
		const idx = this.#index % this.maxConcurrency;
		return this.#timestamps[idx] + this.interval;
	}

	#pop(): QueueItem<T> | undefined {
		if (this.#index >= this.#end)
			return undefined;
		const item = this.#queue[this.capacity ? this.#index % this.capacity : this.#index];
		if (this.#timestamps)
			this.#timestamps[this.#index % this.maxConcurrency] = Date.now();
		++this.#index;
		return item;
	}

	#push(item: QueueItem<T>) {
		if (this.capacity)
			this.#queue[this.#end % this.capacity] = item;
		else
			this.#queue.push(item);
		++this.#end;
	}

	#handleResult_(item: QueueItem<T>, result: any, success: boolean, shouldRetry: boolean | undefined | void): Promisable<void> {
		shouldRetry ??= success ? !(result as Response).ok : true;
		if (!shouldRetry && success)
			item.onSuccess?.(result as FetchReturn<T>);
		else if (!shouldRetry && !success || shouldRetry && item.retried >= this.maxRetry)
			item.onFailure?.(result);
		else {
			++item.retried;
			this.#push(item);
		}
	}

	#handleResult(item: QueueItem<T>, result: any, success: boolean): Promisable<void> {
		const shouldRetry = this.#shouldRetry?.(result);
		return typeof shouldRetry === "object"
			? shouldRetry.then(retry => this.#handleResult_(item, result, success, retry))
			: this.#handleResult_(item, result, success, shouldRetry);
	}

	#process() {
		if (this.#concurrency >= this.maxConcurrency)
			return;
		const nextTime = this.#nextTimestamp;
		if (nextTime != undefined) {
			const now = Date.now();
			if (now < nextTime) {
				setTimeout(() => this.#process(), nextTime - now);
				return;
			}
		}
		const item = this.#pop();
		if (item == undefined)
			return;
		++this.#concurrency;
		this.#adapter(...item.params as unknown as FetchParams)
			.finally(() => --this.#concurrency)
			.then(resp => this.#handleResult(item, resp, true))
			.catch(error => this.#handleResult(item, error, false))
			.finally(() => this.#process());
	}

	add(request: FetchParams<T>, onSuccess?: (response: FetchReturn<T>) => void, onFailure?: (error: any) => void) {
		if (this.capacity > 0 && this.#end - this.#index >= this.capacity)
			throw new Error("Request pool is full");
		this.#push({
			params: request,
			retried: 0,
			onSuccess,
			onFailure
		});
		this.#process();
	}
}