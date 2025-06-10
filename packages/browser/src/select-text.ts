export interface TextWithOffset {
	text: Text;
	offset: number;
}

function normalizeIndex(index: number, length: number): number {
	return index < 0 ? length + index : Math.min(index, length);
}

export function selectText(node: Node): void;
export function selectText(node: Text, start: number, end?: number): void;
export function selectText(start: Text | TextWithOffset, end: Text | TextWithOffset): void;
export function selectText(param1: Text | Node | TextWithOffset, param2?: number | Text | TextWithOffset, param3?: number): void {
	const range = document.createRange();
	if (arguments.length == 1 && param1 instanceof Node)
		range.selectNodeContents(param1);
	else if (param1 instanceof Text && typeof param2 == "number") {
		const end = typeof param3 == "number" ? param3 : param1.length;
		range.setStart(param1, normalizeIndex(param2, param1.length));
		range.setEnd(param1, normalizeIndex(end, param1.length));
	}
	else if (param2 && typeof param2 != "number") {
		const start = param1 instanceof Text ? { text: param1, offset: 0 } : param1 as TextWithOffset;
		const end = param2 instanceof Text ? { text: param2, offset: param2.length } : param2;
		range.setStart(start.text, start.offset);
		range.setEnd(end.text, end.offset);
	}
	else
		throw new Error("Invalid arguments");
	const selection = window.getSelection()!;
	selection.removeAllRanges();
	selection.addRange(range);
}