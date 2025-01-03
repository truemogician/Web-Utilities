export class ElementError<T extends Element = Element> extends Error {
	element: T;

	constructor(element: T, message?: string);
	constructor(message: string, element: T);
	constructor(param1: string | T, param2?: string | T) {
		const [element, message] = typeof param1 == "string"
			? [param2 as T, param1]
			: [param1, param2 as string | undefined];
		super(message);
		this.name = "ElementError";
		this.element = element;
	}
}

export function assertSelector<K extends keyof HTMLElementTagNameMap>(element: Element, selector: K, message?: string): HTMLElementTagNameMap[K];
export function assertSelector<E extends Element = Element>(element: Element, selector: string, message?: string): E;
export function assertSelector(element: Element, selector: string, message?: string) {
	const el = element.querySelector(selector);
	if (el == null)
		throw new ElementError(element, message ?? `Element not found: ${selector}`);
	return el;
}