export interface CacheStorage<K, V> {
	has(key: K): boolean;
	get(key: K): V | undefined;
	set(key: K, value: V): void;
	touch(key: K): boolean;
	delete(key: K): boolean;
}

export interface MemoryCacheStorageConfig {
	/**
	 * Expiration time in milliseconds.  
	 * Default: `300000` (5 minutes)
	 */
	ttl?: number;
	/**
	 * Whether to touch the cache when `get` is called.  
	 * Default: `false`
	 */
	autoTouch?: boolean;
	/**
	 * Minimum interval between two maintainence.  
	 * Default: `1000`
	 */
	minMaintainenceInterval?: number;
}

export class BasicMemoryCacheStorage<V> implements CacheStorage<number, V> {
	private _lastMaintained?: number;
	private _schedule?: [timer: number | NodeJS.Timeout, timestamp: number];
	protected readonly map = new Map<number, [value: V, timestamp: number]>();
	readonly ttl: number;
	readonly autoTouch: boolean;
	readonly minMaintainenceInterval: number;

	constructor(config?: Readonly<MemoryCacheStorageConfig>) {
		this.ttl = config?.ttl ?? 300000;
		this.autoTouch = config?.autoTouch ?? false;
		this.minMaintainenceInterval = config?.minMaintainenceInterval ?? 1000;
	}

	protected get top(): [number, [V, number]] | undefined {
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
		if (this._lastMaintained == undefined || now - this._lastMaintained > this.minMaintainenceInterval)
			this.maintain();
		const top = this.top;
		if (top == undefined)
			return;
		const nextTime = Math.max(top[1][1], this._lastMaintained! + this.minMaintainenceInterval);
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
	get(key: number): V | undefined {
		const result = this.map.get(key);
		if (result == undefined)
			return undefined;
		const now = Date.now();
		if (now - result[1] > this.ttl) {
			this.map.delete(key);
			return undefined;
		}
		if (this.autoTouch) {
			this.map.delete(key);
			result[1] = now;
			this.map.set(key, result);
		}
		return result[0];
	}
	set(key: number, value: V): this {
		this.map.delete(key);
		this.map.set(key, [value, Date.now()]);
		this.startMaintainence();
		return this;
	}
	touch(key: number): boolean {
		const result = this.map.get(key);
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

export class MemoryCacheStorage<K, V> extends BasicMemoryCacheStorage<V> implements CacheStorage<K, V> {
	readonly hasher: (value: K) => number;

	constructor(hasher: (value: K) => number, config?: Readonly<MemoryCacheStorageConfig>) {
		super(config);
		this.hasher = hasher;
	}

	// @ts-expect-error
	override has(key: K): boolean {
		return super.has(this.hasher(key));
	}
	// @ts-expect-error
	override get(key: K): V | undefined {
		return super.get(this.hasher(key));
	}
	// @ts-expect-error
	override set(key: K, value: V): this {
		super.set(this.hasher(key), value);
		return this;
	}
	// @ts-expect-error
	override touch(key: K): boolean {
		return super.touch(this.hasher(key));
	}
	// @ts-expect-error
	override delete(key: K): boolean {
		return super.delete(this.hasher(key));
	}
}