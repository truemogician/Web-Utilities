interface NewAttributes {
	children?: HTMLElement | HTMLElement[];
	classList?: string[];
	style?: Partial<CSSStyleDeclaration>;
}

type ModifiedAttributes<T extends keyof HTMLElementTagNameMap> = Omit<Partial<HTMLElementTagNameMap[T]>, keyof NewAttributes> & NewAttributes & Record<string, any>;

export function createElement<TTag extends keyof HTMLElementTagNameMap>(tagName: TTag, attributes?: ModifiedAttributes<TTag>): HTMLElementTagNameMap[TTag] {
	const el = document.createElement(tagName);
	if (attributes) {
		if (attributes.children) {
			if (Array.isArray(attributes.children))
				el.append(...attributes.children);
			else
				el.append(attributes.children);
		}
		if (attributes.classList)
			el.classList.add(...attributes.classList);
		if (attributes.style) {
			for (const styleKey in attributes.style)
				el.style[styleKey] = attributes.style[styleKey]!;
		}
		for (let key in attributes) {
			if (["children", "classList", "style"].includes(key))
				continue;
			(el as any)[key] = attributes[key];
		}
	}
	return el;
}

export function createTextElement(text: string): HTMLSpanElement;
export function createTextElement<Tag extends keyof HTMLElementTagNameMap>(tagName: Tag, text: string): HTMLElementTagNameMap[Tag]
export function createTextElement<Tag extends keyof HTMLElementTagNameMap = "span">(param1: string | Tag, param2?: string): HTMLElementTagNameMap[Tag] {
	const tagName = (param2 ? param1 : "span") as Tag;
	const el = document.createElement(tagName);
	el.textContent = param2 ?? param1 as string;
	return el;
}