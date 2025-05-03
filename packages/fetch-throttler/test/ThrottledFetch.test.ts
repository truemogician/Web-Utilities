import { createThrottledFetch } from "../src/ThrottledFetch";
import type { DefaultThrottleConfig, Fetch } from "../src/types";
import { TestAdapter } from "./TestAdapter";

interface TestResp {
	id: number;
	start: number;
	end: number;
}

describe("Fetch Throttler", () => {
	const testUrl = "https://example.com";
	const latency = 100;
	const timeMargin = 20;

	function fixture(config?: DefaultThrottleConfig, response?: ResponseInit, delay?: number) {
		delay ??= latency;
		const adapter = new TestAdapter(delay, response);
		return createThrottledFetch(config, adapter.fetch);
	}

	test("Config: maxConcurrency", async () => {
		const fetch = fixture({ maxConcurrency: 2 });
		const promises = new Array<Promise<TestResp>>();
		for (let i = 0; i < 3; ++i)
			promises.push(fetch(testUrl).then(resp => resp.json()));
		const resps = await Promise.all(promises);
		expect(resps.length).toBe(3);
		expect(resps[1].start - resps[0].start).toBeLessThan(timeMargin);
		expect(resps[2].start - resps[0].start).toBeGreaterThanOrEqual(latency);
	});

	test("Config: maxRetry", async () => {
		const maxRetry = 2;
		const fetch = fixture({ maxRetry }, { status: 500 });
		const start = performance.now();
		const resp = await fetch(testUrl).catch(err => err);
		const end = performance.now();
		expect(resp.status).toBe(500);
		expect(end - start).toBeGreaterThanOrEqual(latency * (maxRetry + 1) - timeMargin);
		const json = await resp.json();
		expect(json.id).toBe(2);
	});

	test("Config: capacity", async () => {
		const fetch = fixture({ maxConcurrency: 1, capacity: 1 });
		const promise = fetch(testUrl).then(resp => resp.json());
		fetch(testUrl);
		expect(() => fetch(testUrl)).rejects.toThrow();
		await promise;
		expect(() => fetch(testUrl)).not.toThrow();
	});

	test("Config: interval", async () => {
		const interval = 500;
		const fetch = fixture({ maxConcurrency: 2, interval });
		const promises = new Array<Promise<TestResp>>();
		for (let i = 0; i < 3; ++i)
			promises.push(fetch(testUrl).then(resp => resp.json()));
		const resps = await Promise.all(promises);
		expect(resps[1].start - resps[0].start).toBeLessThan(timeMargin);
		expect(resps[2].start - resps[0].start).toBeGreaterThanOrEqual(interval);
	});

	describe("Config: shouldRetry", () => {
		// Test 1: shouldRetry returns true - should retry regardless of response status
		test("Returns true", async () => {
			const retryAllFetch = fixture({
				maxRetry: 2,
				shouldRetry: () => true
			});
			const start = performance.now();
			const resp = await retryAllFetch(testUrl).catch(r => r as Response);
			const end = performance.now();
			expect(end - start).toBeGreaterThanOrEqual(latency * 3 - timeMargin); // Initial + 2 retries
			const json = await resp.json();
			expect(json.id).toBe(2); // Should be the last retry (original + 2 retries = id 2)
		});

		// Test 2: shouldRetry returns false for errors - should not retry
		test("Returns false for errors", async () => {
			const adapter = new TestAdapter(latency);
			let errorCount = 0;
			const errorFetch = createThrottledFetch({
				maxRetry: 2,
				shouldRetry(errOrRes) {
					if (errOrRes instanceof Error) {
						errorCount++;
						return false; // Don't retry errors
					}
				}
			}, () => {
				// First call throws error, subsequent calls use the normal adapter
				if (errorCount === 0) {
					return Promise.reject(new Error("Test error"));
				}
				return adapter.fetch(testUrl);
			});
			await expect(errorFetch(testUrl)).rejects.toThrow("Test error");
			expect(errorCount).toBe(1); // Error handler called once, no retries
		})

		// Test 3: shouldRetry returns false for non-ok responses - should succeed without retry
		test("Returns false for non-ok responses", async () => {
			const nonOkFetch = fixture({
				maxRetry: 2,
				shouldRetry(errOrRes) {
					if (errOrRes instanceof Response)
						return false;
				}
			}, { status: 404 });
			const resp = await nonOkFetch(testUrl);
			expect(resp.status).toBe(404);
			const json = await resp.json();
			expect(json.id).toBe(0); // No retries, just the initial request
		});

		// Test 4: shouldRetry returns undefined - should use default behavior
		test("Returns undefined", async () => {
			const defaultFetch = fixture({
				maxRetry: 1,
				shouldRetry: () => undefined
			}, { status: 500 });
			const start = performance.now();
			const resp = await defaultFetch(testUrl).catch(r => r as Response);
			const end = performance.now();
			expect(resp.status).toBe(500);
			expect(end - start).toBeGreaterThanOrEqual(latency * 2 - timeMargin); // Initial + 1 retry
			const json = await resp.json();
			expect(json.id).toBe(1);
		});

		// Test 5: Verify response body can't be consumed if not cloned in shouldRetry
		test("Response body can't be consumed if not cloned", async () => {
			const cloneFetch = fixture({
				shouldRetry(errOrRes) {
					if (errOrRes instanceof Response)
						return errOrRes.json().then(() => undefined);
				}
			});
			const resp = await cloneFetch(testUrl);
			expect(() => resp.json()).rejects.toThrow("Body is unusable: Body has already been read");
		});
	});

	describe("Configure", () => {
		const apiDomain = "https://api.example.com";
		const imgDomain = "https://images.example.com";
		const cdnDomain = "https://cdn.example.com";

		const apiPath = "/api";
		const dataPath = "/data";

		test("Domain config", async () => {
			const fetch = fixture();
			fetch.configure({
				scope: "domain",
				url: apiDomain,
				maxConcurrency: 1
			});
			const apiUrl = `${apiDomain}${dataPath}`;
			const apiPromises = [
				fetch(apiUrl).then(resp => resp.json()),
				fetch(apiUrl).then(resp => resp.json())
			];
			const apiResps = await Promise.all(apiPromises);
			expect(apiResps[1].start - apiResps[0].start).toBeGreaterThanOrEqual(latency);
		});

		test("Path config", async () => {
			const fetch = fixture();
			fetch.configure({
				scope: "path",
				url: [testUrl + apiPath, testUrl + dataPath],
				maxConcurrency: 2
			});
			const pathPromises = [
				fetch(testUrl + apiPath).then(resp => resp.json()),
				fetch(testUrl + apiPath).then(resp => resp.json()),
				fetch(testUrl + dataPath).then(resp => resp.json())
			];
			const pathResps = await Promise.all(pathPromises);
			expect(pathResps[1].start - pathResps[0].start).toBeLessThan(timeMargin);
			expect(pathResps[2].start - pathResps[0].start).toBeGreaterThanOrEqual(latency);
		});

		test("Regex config", async () => {
			const fetch = fixture();
			fetch.configure({
				regex: new RegExp(`^${imgDomain}`),
				maxConcurrency: 2
			});
			const imgPromises = [
				fetch(`${imgDomain}/a`).then(resp => resp.json()),
				fetch(`${imgDomain}:8443/b`).then(resp => resp.json()),
				fetch(`${imgDomain}.uk/c`).then(resp => resp.json())
			];
			const imgResps = await Promise.all(imgPromises);
			expect(imgResps[1].start - imgResps[0].start).toBeLessThan(timeMargin);
			expect(imgResps[2].start - imgResps[0].start).toBeGreaterThanOrEqual(latency);
		});

		test("Custom config", async () => {
			const fetch = fixture();
			fetch.configure({
				match: url => url.hostname.includes("cdn"),
				interval: 1000
			});
			const cdnUrl = `${cdnDomain}/assets/img.jpg`;
			const cdnPromises = [
				fetch(cdnUrl).then(resp => resp.json()),
				fetch(cdnUrl).then(resp => resp.json())
			];
			const cdnResps = await Promise.all(cdnPromises);
			expect(cdnResps[1].start - cdnResps[0].start).toBeGreaterThanOrEqual(1000);
		});

		test("Error handling", async () => {
			const fetch = fixture();
			fetch.configure({
				scope: "domain",
				url: apiDomain,
				maxConcurrency: 1
			});
			// Test configuration conflict
			expect(() => fetch.configure({
				scope: "domain",
				url: apiDomain,
				maxConcurrency: 2
			})).toThrow(Error);
			// Test invalid config object
			expect(() => fetch.configure({
				// @ts-expect-error Testing missing required properties
				unknownProp: true
			})).toThrow(TypeError);
		})
	});

	test("URL parsing", async () => {
		const fetch = fixture();
		// Test with URL object
		const url = new URL(`${testUrl}/test`);
		const resp1 = await fetch(url).then(resp => resp.json());
		expect(resp1.id).toBe(0);
		// Test with Request object
		const req = new Request(`${testUrl}/request`);
		const resp2 = await fetch(req).then(resp => resp.json());
		expect(resp2.id).toBe(1);
		// Test invalid URL handling
		expect(() => fetch("invalid-url")).toThrow(TypeError);
	});

	test("Error handling", async () => {
		const fetch = fixture();
		// Test configuration error handling
		expect(() => fetch.configure({
			// @ts-expect-error - Testing runtime validation
			scope: "invalid-scope",
			url: testUrl
		})).toThrow(TypeError);
		expect(() => fetch.configure({
			scope: "domain",
			url: "not-a-valid-url"
		})).toThrow(TypeError);
		// Test network error handling
		const errorFetch = createThrottledFetch({
			maxRetry: 1
		}, (() => Promise.reject(new Error("Network failure"))) as unknown as Fetch);
		await expect(errorFetch(testUrl)).rejects.toThrow("Network failure");
	});
});