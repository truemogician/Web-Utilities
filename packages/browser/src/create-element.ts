import type { WritableKeysOf } from "type-fest";

interface NewAttributes {
	children?: HTMLElement | HTMLElement[];
	childNodes?: Node | Node[];
	classList?: string[];
	style?: Partial<CSSStyleDeclaration>;
}

type ModifiedAttributes<T extends HTMLElement> = {
	[K in WritableKeysOf<T> | keyof NewAttributes]?: K extends keyof NewAttributes ? NewAttributes[K] : T[K];
};

const overrideProperties: string[] =
	["children", "childNodes", "classList", "style"] satisfies (keyof NewAttributes)[];

export function createElement<
	TTag extends keyof HTMLElementTagNameMap,
	T extends HTMLElementTagNameMap[TTag] = HTMLElementTagNameMap[TTag]
>(tagName: TTag, attributes?: ModifiedAttributes<T>): T {
	const el = document.createElement(tagName) as T;
	if (attributes) {
		if (attributes.children || attributes.childNodes) {
			const nodes = new Array<Node>();
			if (attributes.children) {
				if (Array.isArray(attributes.children))
					nodes.push(...attributes.children);
				else
					nodes.push(attributes.children);
			}
			if (attributes.childNodes) {
				if (Array.isArray(attributes.childNodes))
					nodes.push(...attributes.childNodes);
				else
					nodes.push(attributes.childNodes);
			}
			el.append(...nodes);
		}
		if (attributes.classList)
			el.classList.add(...attributes.classList);
		if (attributes.style) {
			for (const styleKey in attributes.style)
				el.style[styleKey] = attributes.style[styleKey]!;
		}
		let key: keyof T & string;
		for (key in attributes) {
			if (overrideProperties.includes(key))
				continue;
			const descriptor = Object.getOwnPropertyDescriptor(attributes, key)!;
			if ("value" in descriptor)
				el[key] = descriptor.value;
			else if (key in el)
				throw new Error(`Cannot redefine existing property '${key}' on ${tagName} element`);
			else
				Object.defineProperty(el, key, descriptor);
		}
	}
	return el as T;
}

export function createTextElement(text: string): HTMLSpanElement;
export function createTextElement<Tag extends keyof HTMLElementTagNameMap>(tagName: Tag, text: string): HTMLElementTagNameMap[Tag]
export function createTextElement<Tag extends keyof HTMLElementTagNameMap = "span">(param1: string | Tag, param2?: string): HTMLElementTagNameMap[Tag] {
	const tagName = (param2 ? param1 : "span") as Tag;
	const el = document.createElement(tagName);
	el.textContent = param2 ?? param1 as string;
	return el;
}