type Override<T extends object, U extends Partial<Record<keyof T, any>>> = Omit<T, keyof U> & U;

async function incrementVersion<T = any>(
	context: IndexedContext,
	action: (db: IDBDatabase, oldDb: IDBDatabase) => T
): Promise<T> {
	const version = context.database.version;
	context.database.close();
	const request = context.factory.open(context.database.name, version + 1);
	return new Promise((resolve, reject) => {
		request.onupgradeneeded = async e => {
			const newDb = (e.target as typeof request).result;
			const result = await action(newDb, context.database);
			context.database = newDb;
			resolve(result);
		};
		request.onerror = e => reject((e.target as IDBRequest).error);
	});
}

async function wait<T = any>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = e => resolve((e.target as IDBRequest<T>).result);
		request.onerror = e => reject((e.target as IDBRequest).error);
	});
}

export class IndexedDatabaseFactory {
	private readonly _databases = new Map<string, IndexedDatabase>();

	public constructor(public readonly factory: IDBFactory) { }

	public static readonly default = new IndexedDatabaseFactory(window.indexedDB);

	public get databaseInfos() {
		return this.factory.databases();
	}

	private async open(name: string): Promise<IndexedDatabase> {
		const request = indexedDB.open(name);
		return new Promise((resolve, reject) => {
			request.onsuccess = e => {
				const db = (e.target as IDBRequest<IDBDatabase>).result;
				const database = new IndexedDatabase(db, this.factory);
				this._databases.set(name, database);
				resolve(database);
			};
			request.onerror = e => reject((e.target as IDBRequest).error);
		});
	}

	public async has(name: string): Promise<boolean> {
		if (this._databases.has(name))
			return true;
		const infos = await this.databaseInfos;
		return infos.find(db => db.name == name) != null;
	}

	public async get(name: string): Promise<IndexedDatabase | null> {
		if (this._databases.has(name))
			return this._databases.get(name)!;
		if (!await this.has(name))
			return null;
		return await this.open(name);
	}

	public async getOrCreate(name: string): Promise<IndexedDatabase> {
		if (this._databases.has(name))
			return this._databases.get(name)!;
		return await this.open(name);
	}

	public async delete(name: string): Promise<boolean> {
		const db = this._databases.get(name);
		if (db != null) {
			db.close();
			this._databases.delete(name);
		}
		if (!await this.has(name))
			return false;
		return new Promise((resolve, reject) => {
			const request = indexedDB.deleteDatabase(name);
			request.onsuccess = () => resolve(true);
			request.onerror = e => reject((e.target as IDBRequest).error);
		});
	}
}

interface IndexedContext {
	database: IDBDatabase;

	readonly factory: IDBFactory;
}

export class IndexedDatabase {
	private readonly _context!: IndexedContext;

	public readonly stores!: ObjectStoreCollection;

	public constructor(public raw: IDBDatabase, factory: IDBFactory) {
		const self = this;
		this._context = {
			get database() { return self.raw; },
			set database(value) { self.raw = value },
			factory
		};
		this.stores = new ObjectStoreCollection(this._context);
	}

	public get name() {
		return this.raw.name;
	}

	public get version() {
		return this.raw.version;
	}

	public addEventListener<K extends keyof IDBDatabaseEventMap>(
		type: K,
		listener: (this: IDBDatabase, ev: IDBDatabaseEventMap[K]) => any,
		options?: boolean | AddEventListenerOptions
	): void {
		this.raw.addEventListener(type, listener, options);
	}

	public close() {
		this.raw.close();
	}
}

interface ObjectStoreScheme<T = any> {
	autoIncrement?: boolean;

	keyPath: keyof T & string | (keyof T & string)[] | null;
}

export class ObjectStoreCollection {
	private readonly _ctx!: IndexedContext;

	private readonly _stores = new Map<string, ObjectStore>();

	public constructor(context: IndexedContext) {
		this._ctx = context;
	}

	public get names() {
		return Array.from(this._ctx.database.objectStoreNames);
	}

	public has(name: string): boolean {
		return this.names.includes(name);
	}

	public get<T = any, K extends IDBValidKey = IDBValidKey>(name: string, mode?: "readonly"): ReadonlyObjectStore<T, K> | null;
	public get<T = any, K extends IDBValidKey = IDBValidKey>(name: string, mode: "readwrite"): ObjectStore<T, K> | null;
	public get<T = any, K extends IDBValidKey = IDBValidKey>(name: string, mode: "readonly" | "readwrite" = "readonly"): ObjectStore<T, K> | null {
		if (this._stores.has(name)) {
			const result = this._stores.get(name)!;
			result.mode = mode;
			return result as unknown as ObjectStore<T, K>;
		}
		if (!this.has(name))
			return null;
		const objectStore = new ObjectStore<T, K>(this._ctx, name, mode);
		this._stores.set(name, objectStore as any);
		return objectStore;
	}

	public async create<T = any, K extends IDBValidKey = IDBValidKey>(name: string, options?: ObjectStoreScheme<T>): Promise<ObjectStore<T, K>> {
		if (this.has(name))
			throw new Error(`Object store '${name}' already exists.`);
		await incrementVersion(this._ctx, db => db.createObjectStore(name, options));
		const objectStore = new ObjectStore<T, K>(this._ctx, name, "readwrite");
		this._stores.set(name, objectStore as any);
		return objectStore;
	}

	public async getOrCreate<T = any, K extends IDBValidKey = IDBValidKey>(name: string, options?: ObjectStoreScheme<T>): Promise<ObjectStore<T, K>>;
	public async getOrCreate<T = any, K extends IDBValidKey = IDBValidKey>(name: string, options?: ObjectStoreScheme<T>): Promise<ObjectStore<T, K>>;
	public async getOrCreate<T = any, K extends IDBValidKey = IDBValidKey>(name: string, options?: ObjectStoreScheme<T>): Promise<ObjectStore<T, K>> {
		if (this.has(name))
			return this.get<T, K>(name, "readwrite")!;
		return await this.create(name, options);
	}

	public delete(name: string): false | Promise<true> {
		if (!this.has(name))
			return false;
		return incrementVersion(this._ctx, db => db.deleteObjectStore(name))
			.then(() => {
				this._stores.delete(name);
				return true;
			});
	}
}

export class ObjectStore<T = any, K extends IDBValidKey = IDBValidKey> {
	public readonly indices = new ObjectStoreIndexCollection(
		() => this.store,
		async action => incrementVersion(
			this._context,
			db => action(db.transaction(this.name, this.mode).objectStore(this.name))
		)
	);

	public constructor(
		private _context: IndexedContext,
		public name: string,
		public mode: "readonly" | "readwrite" = "readonly"
	) { }

	private get store() {
		return this._context.database.transaction(this.name, this.mode).objectStore(this.name);
	}

	public get keyPath() {
		return this.store.keyPath;
	}

	public get autoIncrement() {
		return this.store.autoIncrement;
	}

	public get<U extends T = T>(key: K): Promise<U | undefined>
	public get<U extends T = T>(range: IDBKeyRange): Promise<U | undefined>
	public get<U extends T = T>(query: K | IDBKeyRange): Promise<U | undefined> {
		return wait(this.store.get(query));
	}

	public getAll<U extends T = T>(key?: K, count?: number): Promise<U[]>
	public getAll<U extends T = T>(range?: IDBKeyRange, count?: number): Promise<U[]>
	public getAll<U extends T = T>(query?: K | IDBKeyRange, count?: number): Promise<U[]> {
		return wait(this.store.getAll(query, count));
	}

	public async getAllKeys(key?: K, count?: number): Promise<K[]>
	public async getAllKeys(range?: IDBKeyRange, count?: number): Promise<K[]>
	public async getAllKeys(query?: K | IDBKeyRange, count?: number): Promise<K[]> {
		const result = await wait(this.store.getAllKeys(query, count));
		return result as K[];
	}

	public async count(key?: K): Promise<number>
	public async count(range?: IDBKeyRange): Promise<number>
	public async count(query?: K | IDBKeyRange): Promise<number> {
		return wait(this.store.count(query));
	}

	public async add<U extends T = T>(value: U, key?: K): Promise<K> {
		const result = await wait(this.store.add(value, key));
		return result as K;
	}

	public async put<U extends T = T>(value: U, key?: K): Promise<K> {
		const result = await wait(this.store.put(value, key));
		return result as K;
	}

	public delete(key: K): Promise<void>
	public delete(range: IDBKeyRange): Promise<void>
	public delete(query: K | IDBKeyRange): Promise<void> {
		return wait(this.store.delete(query));
	}

	public clear(): Promise<void> {
		return wait(this.store.clear());
	}

	public async iterate<U extends T = T>(action: IterationAction<U, K>): Promise<void>
	public async iterate<U extends T = T>(action: IterationAction<U, K>, key: IDBValidKey, direction?: IDBCursorDirection): Promise<void>
	public async iterate<U extends T = T>(action: IterationAction<U, K>, range: IDBKeyRange, direction?: IDBCursorDirection): Promise<void>
	public async iterate<U extends T = T>(action: IterationAction<U, K>, query?: IDBValidKey | IDBKeyRange, direction?: IDBCursorDirection): Promise<void> {
		const request = this.store.openCursor(query, direction);
		return new Promise((resolve, reject) => {
			request.onsuccess = () => {
				const cursor = request.result as IDBObjectStoreCursorWithValue<U, K> | null;
				if (!cursor)
					return resolve();
				const result = action(new ObjectStoreIteratorWithValue(cursor));
				if (result == undefined || result === true || result == "continue")
					cursor.continue();
				else if (result === false || result == "break")
					resolve();
				else if ("step" in result && typeof result.step == "number")
					cursor.advance(result.step);
				else if ("key" in result)
					cursor.continue(result.key);
				else
					reject(new Error("Invalid iteration result"));
			};
			request.onerror = () => reject(request.error);
		});
	}
}

export type ReadonlyObjectStore<T = any, K extends IDBValidKey = T extends object ? IDBValidKey : number>
	= Omit<ObjectStore<T, K>, "add" | "put" | "delete" | "clear">;

export class ObjectStoreIndexCollection {
	public constructor(
		private _getStore: () => IDBObjectStore,
		private _runInVersionChangeTransaction: <T>(action: (store: IDBObjectStore) => T | Promise<T>) => Promise<T>
	) { }

	private get store() {
		return this._getStore();
	}

	public get names() {
		return Array.from(this.store.indexNames);
	}

	public has(name: string): boolean {
		return this.names.includes(name);
	}

	public get(name: string): IDBIndex | null {
		return this.store.index(name);
	}

	public create(name: string, keyPath: string | string[], options?: IDBIndexParameters): Promise<IDBIndex> {
		return this._runInVersionChangeTransaction(store => store.createIndex(name, keyPath, options));
	}

	public delete(name: string): false | Promise<true> {
		if (!this.has(name))
			return false;
		return this._runInVersionChangeTransaction(store => store.deleteIndex(name)).then(() => true);
	}
}

export type IDBObjectStoreCursor<T = any, K extends IDBValidKey = IDBValidKey> = Override<IDBCursor, {
	readonly key: K;

	readonly primaryKey: K;

	readonly source: IDBObjectStore;

	continue(key?: K): void;

	continuePrimaryKey(key: K, primaryKey: K): void;

	update(value: T): IDBRequest<K>;
}>;

export type IDBObjectStoreCursorWithValue<T = any, K extends IDBValidKey = IDBValidKey> = IDBObjectStoreCursor<T, K> & { value: T };

export type IterationAction<T = any, K extends IDBValidKey = IDBValidKey> =
	(iterator: ObjectStoreIteratorWithValue<T, K>) => void | boolean | "continue" | "break" | { step: number } | { key: K };

interface IteratorContext<T extends IDBObjectStore | IDBIndex> {
	readonly direction: IDBCursorDirection;

	readonly request: IDBRequest;

	readonly source: T;
}

export class ObjectStoreIterator<T = any, K extends IDBValidKey = IDBValidKey> {
	public readonly context!: IteratorContext<IDBObjectStore>;

	public constructor(protected readonly _cursor: IDBObjectStoreCursor<T, K>) {
		this.context = {
			direction: _cursor.direction,
			request: _cursor.request,
			source: _cursor.source
		};
	}

	public get key() {
		return this._cursor.key;
	}

	public get primaryKey() {
		return this._cursor.primaryKey;
	}

	public update(value: T) {
		return wait(this._cursor.update(value));
	}

	public async delete() {
		return wait(this._cursor.delete());
	}
}

export class ObjectStoreIteratorWithValue<T = any, K extends IDBValidKey = IDBValidKey> extends ObjectStoreIterator<T, K> {
	public constructor(cursor: IDBObjectStoreCursorWithValue<T, K>) {
		super(cursor);
	}

	public get value() {
		return (this._cursor as IDBObjectStoreCursorWithValue<T, K>).value;
	}
}