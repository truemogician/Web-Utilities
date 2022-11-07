/*
 * Date Format 1.2.3
 * (c) 2007-2009 Steven Levithan <stevenlevithan.com>
 * MIT license
 *
 * Includes enhancements by Scott Trenda <scott.trenda.net>
 * and Kris Kowal <cixar.com/~kris.kowal/>
 *
 * Accepts a date, a mask, or a date and a mask.
 * Returns a formatted version of the given date.
 * The date defaults to the current date/time.
 * The mask defaults to masks.default.
 */

// Regexes and supporting functions are cached through closure
const token = /d{1,4}|D{3,4}|m{1,4}|yy(?:yy)?|([HhMsTt])\1?|W{1,2}|[LlopSZN]|"[^"]*"|'[^']*'/g;
const timezone = /\b(?:[A-Z]{1,3}[A-Z][TC])(?:[-+]\d{4})?|((?:Australian )?(?:Pacific|Mountain|Central|Eastern|Atlantic) (?:Standard|Daylight|Prevailing) Time)\b/g;
const timezoneClip = /[^-+\dA-Z]/g;

export function formatDate(date: string | number | Date): string;
export function formatDate(date: string | number | Date, pattern: string): string;
export function formatDate(date: string | number | Date, pattern: string, utc?: boolean, gmt?: boolean): string;
export function formatDate(dateParam: string | number | Date, pattern?: string, utc?: boolean, gmt?: boolean) {
	if (typeof dateParam == "number" && Number.isNaN(dateParam))
		throw TypeError("Invalid date");

	const date = dateParam instanceof Date ? dateParam : new Date(dateParam);
	pattern = pattern == null ? patterns.default : pattern in patterns ? patterns[pattern as keyof typeof patterns] : pattern;

	// Allow setting the utc/gmt argument via the mask
	const maskSlice = pattern.slice(0, 4);
	if (maskSlice === "UTC:" || maskSlice === "GMT:") {
		pattern = pattern.slice(4);
		utc = true;
		if (maskSlice === "GMT:")
			gmt = true;
	}

	const prefix = utc ? "getUTC" : "get";
	const d = () => date[`${prefix}Date`]();
	const D = () => date[`${prefix}Day`]();
	const M = () => date[`${prefix}Month`]();
	const y = () => date[`${prefix}FullYear`]();
	const H = () => date[`${prefix}Hours`]();
	const m = () => date[`${prefix}Minutes`]();
	const s = () => date[`${prefix}Seconds`]();
	const L = () => date[`${prefix}Milliseconds`]();
	const o = () => (utc ? 0 : (date as Date).getTimezoneOffset());
	const W = () => getWeek(date as Date);
	const N = () => getDayOfWeek(date as Date);

	const flags = {
		d: () => d(),
		dd: () => pad(d()),
		ddd: () => i18n.dayNames[D()],
		DDD: () => getDayName({
			y: y(),
			m: m(),
			d: d(),
			_: prefix,
			dayName: i18n.dayNames[D()],
			short: true
		}),
		dddd: () => i18n.dayNames[D() + 7],
		DDDD: () => getDayName({
			y: y(),
			m: m(),
			d: d(),
			_: prefix,
			dayName: i18n.dayNames[D() + 7]
		}),
		M: () => M() + 1,
		MM: () => pad(M() + 1),
		MMM: () => i18n.monthNames[M()],
		MMMM: () => i18n.monthNames[M() + 12],
		yy: () => String(y()).slice(2),
		yyyy: () => pad(y(), 4),
		h: () => H() % 12 || 12,
		hh: () => pad(H() % 12 || 12),
		H: () => H(),
		HH: () => pad(H()),
		m: () => m(),
		mm: () => pad(m()),
		s: () => s(),
		ss: () => pad(s()),
		l: () => pad(L(), 3),
		L: () => pad(Math.floor(L() / 10)),
		t: () => H() < 12 ? i18n.timeNames[0] : i18n.timeNames[1],
		tt: () => H() < 12 ? i18n.timeNames[2] : i18n.timeNames[3],
		T: () => H() < 12 ? i18n.timeNames[4] : i18n.timeNames[5],
		TT: () => H() < 12 ? i18n.timeNames[6] : i18n.timeNames[7],
		Z: () => gmt ? "GMT" : utc ? "UTC" : formatTimezone(date as Date),
		o: () => (o() > 0 ? "-" : "+") + pad(Math.floor(Math.abs(o()) / 60) * 100 + (Math.abs(o()) % 60), 4),
		p: () =>
			(o() > 0 ? "-" : "+") +
			pad(Math.floor(Math.abs(o()) / 60), 2) +
			":" +
			pad(Math.floor(Math.abs(o()) % 60), 2),
		S: () => ["th", "st", "nd", "rd"][d() % 10 > 3 ? 0 : (((d() % 100) - (d() % 10) != 10) ? d() : 0) % 10],
		W: () => W(),
		WW: () => pad(W()),
		N: () => N(),
	};

	return pattern.replace(token, match => {
		if (match in flags) {
			const r = flags[match as keyof typeof flags]();
			return typeof r === "string" ? r : String(r);
		}
		return match.slice(1, match.length - 1);
	});
}

export const patterns = Object.freeze({
	default: "ddd MMM dd yyyy HH:mm:ss",
	shortDate: "M/d/yy",
	paddedShortDate: "MM/dd/yyyy",
	mediumDate: "MMM d, yyyy",
	longDate: "MMMM d, yyyy",
	fullDate: "dddd, MMMM d, yyyy",
	shortTime: "h:mm TT",
	mediumTime: "h:mm:ss TT",
	longTime: "h:mm:ss TT Z",
	isoDate: "yyyy-MM-dd",
	isoTime: "HH:mm:ss",
	isoDateTime: "yyyy-MM-dd'T'HH:mm:sso",
	isoUtcDateTime: "UTC:yyyy-MM-dd'T'HH:mm:ss'Z'",
	expiresHeaderFormat: "ddd, dd MMM yyyy HH:mm:ss Z",
});

// Internationalization strings
export const i18n = Object.freeze({
	dayNames: [
		"Sun",
		"Mon",
		"Tue",
		"Wed",
		"Thu",
		"Fri",
		"Sat",
		"Sunday",
		"Monday",
		"Tuesday",
		"Wednesday",
		"Thursday",
		"Friday",
		"Saturday",
	],
	monthNames: [
		"Jan",
		"Feb",
		"Mar",
		"Apr",
		"May",
		"Jun",
		"Jul",
		"Aug",
		"Sep",
		"Oct",
		"Nov",
		"Dec",
		"January",
		"February",
		"March",
		"April",
		"May",
		"June",
		"July",
		"August",
		"September",
		"October",
		"November",
		"December",
	],
	timeNames: ["a", "p", "am", "pm", "A", "P", "AM", "PM"],
});

const pad = (val: any, len = 2) => (typeof val == "string" ? val : String(val)).padStart(len, '0');

/**
 * Get day name
 * Yesterday, Today, Tomorrow if the date lies within, else fallback to Monday - Sunday
 * @param  {Object}
 * @return {String}
 */
function getDayName({ y, m, d, _, dayName, short = false }: Record<"y" | "m" | "d", number> & {
	dayName: string;
	_: "get" | "getUTC",
	short?: boolean
}): string {
	const today = new Date();
	const yesterday = new Date();
	yesterday.setDate(yesterday[`${_}Date`]() - 1);
	const tomorrow = new Date();
	tomorrow.setDate(tomorrow[`${_}Date`]() + 1);
	const today_d = () => today[`${_}Date`]();
	const today_m = () => today[`${_}Month`]();
	const today_y = () => today[`${_}FullYear`]();
	const yesterday_d = () => yesterday[`${_}Date`]();
	const yesterday_m = () => yesterday[`${_}Month`]();
	const yesterday_y = () => yesterday[`${_}FullYear`]();
	const tomorrow_d = () => tomorrow[`${_}Date`]();
	const tomorrow_m = () => tomorrow[`${_}Month`]();
	const tomorrow_y = () => tomorrow[`${_}FullYear`]();

	if (today_y() === y && today_m() === m && today_d() === d)
		return short ? 'Tdy' : 'Today';
	else if (yesterday_y() === y && yesterday_m() === m && yesterday_d() === d)
		return short ? 'Ysd' : 'Yesterday';
	else if (tomorrow_y() === y && tomorrow_m() === m && tomorrow_d() === d)
		return short ? 'Tmw' : 'Tomorrow';
	return dayName;
};

/**
 * Get the ISO 8601 week number
 * Based on comments from
 * http://techblog.procurios.nl/k/n618/news/view/33796/14863/Calculate-ISO-8601-week-and-year-in-javascript.html
 */
function getWeek(date: Date): number {
	// Remove time components of date
	const targetThursday = new Date(
		date.getFullYear(),
		date.getMonth(),
		date.getDate()
	);

	// Change date to Thursday same week
	targetThursday.setDate(
		targetThursday.getDate() - ((targetThursday.getDay() + 6) % 7) + 3
	);

	// Take January 4th as it is always in week 1 (see ISO 8601)
	const firstThursday = new Date(targetThursday.getFullYear(), 0, 4);

	// Change date to Thursday same week
	firstThursday.setDate(
		firstThursday.getDate() - ((firstThursday.getDay() + 6) % 7) + 3
	);

	// Check if daylight-saving-time-switch occurred and correct for it
	const ds = targetThursday.getTimezoneOffset() - firstThursday.getTimezoneOffset();
	targetThursday.setHours(targetThursday.getHours() - ds);

	// Number of weeks between target Thursday and first Thursday
	const weekDiff = (+targetThursday - +firstThursday) / (86400000 * 7);
	return 1 + Math.floor(weekDiff);
};

/**
 * Get ISO-8601 numeric representation of the day of the week
 * 1 (for Monday) through 7 (for Sunday)
 */
function getDayOfWeek(date: Date): number {
	let dow = date.getDay();
	if (dow === 0)
		dow = 7;
	return dow;
};

/**
 * Get proper timezone abbreviation or timezone offset.
 * 
 * This will fall back to `GMT+xxxx` if it does not recognize the
 * timezone within the `timezone` RegEx above. Currently only common
 * American and Australian timezone abbreviations are supported.
 */
export function formatTimezone(date: string | Date): string | null {
	const str = typeof date == 'string' ? date : String(date);
	const match = str.match(timezone);
	if (!match)
		return null;
	return match.pop()!
		.replace(timezoneClip, "")
		.replace(/GMT\+0000/g, "UTC");
};