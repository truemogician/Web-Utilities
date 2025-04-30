import type { ThrottleConfig } from "./types";

export function fillDefaults(config: ThrottleConfig): Required<ThrottleConfig> {
	return {
		maxConcurrency: 0,
		interval: 0,
		maxRetry: 1,
		capacity: 0,
		...config,
	};
}