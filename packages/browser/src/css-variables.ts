export namespace CssVariables {
	export function get(name: string): string;
	export function get(element: HTMLElement, name: string): string;
	export function get(param1: HTMLElement | string, name?: string): string {
		const element = typeof param1 === "string" ? document.documentElement : param1;
		name = typeof param1 === "string" ? param1 : name!;
		return element.style.getPropertyValue(`--${name}`);
	}

	export function set(name: string, value: string): void;
	export function set(element: HTMLElement, name: string, value: string): void;
	export function set(param1: HTMLElement | string, param2: string, param3?: string): void {
		const [element, name, value] = typeof param1 === "string"
			? [document.documentElement, param1, param2!]
			: [param1, param2, param3!];
		element.style.setProperty(`--${name}`, value);
	}

	export function remove(name: string): void;
	export function remove(element: HTMLElement, name: string): void;
	export function remove(param1: HTMLElement | string, name?: string): void {
		const element = typeof param1 === "string" ? document.documentElement : param1;
		name = typeof param1 === "string" ? param1 : name!;
		element.style.removeProperty(`--${name}`);
	}

	export function getNumber(name: string): number | undefined;
	export function getNumber(element: HTMLElement, name: string): number | undefined;
	export function getNumber(param1: HTMLElement | string, param2?: string): number | undefined {
		// @ts-expect-error
		const value = get(param1, param2);
		if (value.length == 0)
			return undefined;
		return Number(value);
	}

	export function setNumber(name: string, value: number): void;
	export function setNumber(element: HTMLElement, name: string, value: number): void;
	export function setNumber(param1: HTMLElement | string, param2: string | number, param3?: number): void {
		const [element, name, value] = typeof param1 === "string"
			? [document.documentElement, param1, param2! as number]
			: [param1, param2 as string, param3!];
		element.style.setProperty(`--${name}`, value.toString());
	}
}