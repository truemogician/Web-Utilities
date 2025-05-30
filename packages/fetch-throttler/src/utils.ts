import type { SetOptional } from "type-fest";
import type { ThrottleConfig } from "./types";

export function fillDefaults(config: ThrottleConfig): SetOptional<Required<ThrottleConfig>, "shouldRetry"> {
	const result = {
		maxConcurrency: 0,
		interval: 0,
		maxRetry: 1,
		capacity: 0,
		...config,
	};
	if (config.maxConcurrency === undefined && config.interval !== undefined)
		result.maxConcurrency = 1;
	return result;
}