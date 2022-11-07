export class BrowserStorage {
	private static _local?: BrowserStorage;

	private static _session?: BrowserStorage;

	constructor(private readonly _storage: Storage) { }

	public static get local(): BrowserStorage {
		return this._local ?? (this._local = new BrowserStorage(localStorage));
	}

	public static get session(): BrowserStorage {
		return this._session ?? (this._session = new BrowserStorage(sessionStorage));
	}

	public getRaw(key: string): string | null {
		return this._storage.getItem(key);
	}

	public get<T>(key: string): T | null {
		const raw = this._storage.getItem(key);
		if (raw === null)
			return null;
		return JSON.parse(raw);
	}

	public setRaw(key: string, value: string): void {
		this._storage.setItem(key, value);
	}

	public set<T>(key: string, value: T): void {
		this._storage.setItem(key, JSON.stringify(value));
	}

	public remove(...keys: string[]): void {
		for (const key of keys)
			this._storage.removeItem(key);
	}

	public clear(): void {
		this._storage.clear();
	}
}