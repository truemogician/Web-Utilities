export interface ScrollThrottlerConfig {
	/**
	 * Minimum time between two scroll events in milliseconds.
	 */
	interval: number;

	/**
	 * Minimum pixels scrolled between two scroll events.
	 */
	distance: number;
}

type TypedEvent<T = EventTarget> = Omit<Event, "currentTarget"> & { readonly currentTarget: T };

interface Entry<T> {
	time: number;

	position: number;

	handler: (event: TypedEvent<T>) => void;
}

export type Listener<T extends HTMLElement | Window> = (ev: TypedEvent<T>, variation: Record<"interval" | "distance", number>) => void;

export class ScrollThrottler<T extends HTMLElement | Window = Window> {
	private _entries = new Map<T, Entry<T>>();

	private readonly _functions = new Array<Listener<T>>();

	public readonly config!: Readonly<ScrollThrottlerConfig>;

	public constructor(config?: Partial<ScrollThrottlerConfig>) {
		this.config = {
			interval: config?.interval ?? 0,
			distance: config?.distance ?? 0
		}
	}

	private createScrollHandler(element: T) {
		return (ev: TypedEvent<T>) => {
			const entry = this._entries.get(element)!;
			const now = Date.now();
			const position = element instanceof Window ? element.scrollY : element.scrollTop;
			if (now - entry.time >= this.config.interval || Math.abs(position - entry.position) >= this.config.distance) {
				const variation = {
					interval: now - entry.time,
					distance: position - entry.position
				};
				entry.time = now;
				entry.position = position;
				this._functions.forEach(fn => fn(ev, variation));
			}
		};
	}

	public add(...listeners: Listener<T>[]): ScrollThrottler<T> {
		this._functions.push(...listeners);
		return this;
	}

	public remove(listener: Listener<T>) {
		const index = this._functions.indexOf(listener);
		if (index > -1)
			this._functions.splice(index, 1);
	}

	public attach(element: T): boolean {
		if (this._entries.has(element))
			return false;
		const handler = this.createScrollHandler(element);
		this._entries.set(element, { time: -1, position: -1, handler });
		element.addEventListener("scroll", handler as any);
		return true;
	}

	public detach(element: T): boolean {
		if (!this._entries.has(element))
			return false;
		const { handler } = this._entries.get(element)!;
		element.removeEventListener("scroll", handler as any);
		return true;
	}
}