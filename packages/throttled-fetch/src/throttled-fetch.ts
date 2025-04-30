import { RequestPool } from "./RequestPool";
import type { Fetch, FetchParams, ThrottleConfig, DefaultThrottleConfig } from "./types";
import { fillDefaults } from "./utils";

export type ThrottledFetch<T extends Fetch = Fetch> = Fetch & {
	original: T;
	throttleConfig: Readonly<ThrottleConfig>;
}

export function createThrottledFetch(config?: DefaultThrottleConfig): ThrottledFetch;
export function createThrottledFetch<T extends Fetch = Fetch>(fetch: T, config?: DefaultThrottleConfig): ThrottledFetch<T>;
export function createThrottledFetch(param1?: Fetch | DefaultThrottleConfig, param2?: DefaultThrottleConfig): ThrottledFetch {
	if (typeof param1 != "function" && typeof fetch == "undefined") {
		let message = "`fetch` not available in current environment."
		if (typeof process != "undefined" && process.version)
			message += ` Please upgrade node runtime to version 18+. The current version is ${process.version}.`;
		throw new Error(message);
	}
	const [original, conf] = typeof param1 == "function" ? [param1, param2] : [globalThis.fetch.bind(globalThis), param1];
	const { scope = "global", ...rest } = conf ?? {};
	const config = fillDefaults(rest);
	const pools = new Map<string, RequestPool>();
	return Object.assign(
		(input: FetchParams[0], init?: FetchParams[1], ...args: any[]): Promise<Response> => {
			let url = input instanceof URL ? input : typeof input == "string" ? input : input.url;
			if (typeof url == "string") {
				if (url.startsWith("/"))
					url = location.origin + url;
				try {
					url = new URL(url);
				}
				catch {
					throw new TypeError(`Invalid URL: ${url}`);
				}
			}
			const key = scope == "global" ? "global"
				: scope == "domain" ? url.host
					: scope == "path" ? url.origin + url.pathname
						: url.toString();
			if (!pools.has(key))
				pools.set(key, new RequestPool(config, original));
			const pool = pools.get(key)!;
			return new Promise((resolve, reject) => pool.add([input, init, ...args] as any, resolve, reject));
		},
		{
			original,
			throttleConfig: config
		}
	);
}