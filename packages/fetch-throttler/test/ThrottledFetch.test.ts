import { createThrottledFetch } from "../src/ThrottledFetch";
import type { Fetch } from "../src/types";
import { TestAdaptor } from "./TestAdaptor";

interface TestResp {
	id: number;
	start: number;
	end: number;
}

describe("Throttled Fetch", () => {
	const testUrl = "https://example.com";
	const latency = 100;
	const timeMargin = 20;

	test("Max Concurrency", async () => {
		const adaptor = new TestAdaptor(latency);
		const fetch = createThrottledFetch({ maxConcurrency: 2 }, adaptor.fetch);
		const promises = new Array<Promise<TestResp>>();
		for (let i = 0; i < 3; ++i)
			promises.push(fetch(testUrl).then(resp => resp.json()));
		const resps = await Promise.all(promises);
		expect(resps.length).toBe(3);
		expect(resps[1].start - resps[0].start).toBeLessThan(timeMargin);
		expect(resps[2].start - resps[0].start).toBeGreaterThanOrEqual(latency);
	});

	test("Max Retry", async () => {
		const adaptor = new TestAdaptor(latency, { status: 500 });
		const maxRetry = 2;
		const fetch = createThrottledFetch({ maxRetry }, adaptor.fetch);
		const start = performance.now();
		const resp = await fetch(testUrl).catch(err => err);
		const end = performance.now();
		expect(resp.status).toBe(500);
		expect(end - start).toBeGreaterThanOrEqual(latency * (maxRetry + 1) - timeMargin);
		const json = await resp.json();
		expect(json.id).toBe(2);
	});

	test("Capacity", async () => {
		const adaptor = new TestAdaptor(latency);
		const fetch = createThrottledFetch({ maxConcurrency: 1, capacity: 1 }, adaptor.fetch);
		const promise = fetch(testUrl).then(resp => resp.json());
		fetch(testUrl);
		expect(() => fetch(testUrl)).rejects.toThrow();
		await promise;
		expect(() => fetch(testUrl)).not.toThrow();
	});

	test("Interval", async () => {
		const adaptor = new TestAdaptor(latency);
		const interval = 500;
		const fetch = createThrottledFetch({ maxConcurrency: 2, interval }, adaptor.fetch);
		const promises = new Array<Promise<TestResp>>();
		for (let i = 0; i < 3; ++i)
			promises.push(fetch(testUrl).then(resp => resp.json()));
		const resps = await Promise.all(promises);
		expect(resps[1].start - resps[0].start).toBeLessThan(timeMargin);
		expect(resps[2].start - resps[0].start).toBeGreaterThanOrEqual(interval);
	});

	describe("Should Retry", () => {
		// Test 1: shouldRetry returns true - should retry regardless of response status
		test("Returns true", async () => {
			const adaptor = new TestAdaptor(latency, { status: 200 });
			const retryAllFetch = createThrottledFetch({
				maxRetry: 2,
				shouldRetry: () => true
			}, adaptor.fetch);
			const start = performance.now();
			const resp = await retryAllFetch(testUrl).catch(r => r as Response);
			const end = performance.now();
			expect(end - start).toBeGreaterThanOrEqual(latency * 3 - timeMargin); // Initial + 2 retries
			const json = await resp.json();
			expect(json.id).toBe(2); // Should be the last retry (original + 2 retries = id 2)
		});

		// Test 2: shouldRetry returns false for errors - should not retry
		test("Returns false for errors", async () => {
			const adaptor = new TestAdaptor(latency);
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
				return adaptor.fetch(testUrl);
			});
			await expect(errorFetch(testUrl)).rejects.toThrow("Test error");
			expect(errorCount).toBe(1); // Error handler called once, no retries
		})

		// Test 3: shouldRetry returns false for non-ok responses - should succeed without retry
		test("Returns false for non-ok responses", async () => {
			const adaptor = new TestAdaptor(latency, { status: 404 });
			const nonOkFetch = createThrottledFetch({
				maxRetry: 2,
				shouldRetry(errOrRes) {
					if (errOrRes instanceof Response)
						return false;
				}
			}, adaptor.fetch);
			const resp = await nonOkFetch(testUrl);
			expect(resp.status).toBe(404);
			const json = await resp.json();
			expect(json.id).toBe(0); // No retries, just the initial request
		});

		// Test 4: shouldRetry returns undefined - should use default behavior
		test("Returns undefined", async () => {
			const adaptor = new TestAdaptor(latency, { status: 500 });
			const defaultFetch = createThrottledFetch({
				maxRetry: 1,
				shouldRetry: () => undefined
			}, adaptor.fetch);
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
			const adaptor = new TestAdaptor(latency);
			const cloneFetch = createThrottledFetch({
				shouldRetry(errOrRes) {
					if (errOrRes instanceof Response)
						return errOrRes.json().then(() => undefined);
				}
			}, adaptor.fetch);
			const resp = await cloneFetch(testUrl);
			expect(() => resp.json()).rejects.toThrow("Body is unusable: Body has already been read");
		});
	});

	const apiDomain = "https://api.example.com";
	const imgDomain = "https://images.example.com";
	const cdnDomain = "https://cdn.example.com";

	test("Configure", async () => {
		const adaptor = new TestAdaptor(latency);
		const fetch = createThrottledFetch(adaptor.fetch);

		// API paths
		const apiPath = "/api";
		const dataPath = "/data";

		// Test URL scope configuration - domain scope
		fetch.configure({
			scope: "domain",
			url: apiDomain,
			maxConcurrency: 1
		});
		// Test URL scope configuration - path scope
		fetch.configure({
			scope: "path",
			url: [testUrl + apiPath, testUrl + dataPath],
			maxConcurrency: 2
		});
		// Test Regex configuration
		fetch.configure({
			regex: new RegExp(`^${imgDomain}`),
			maxConcurrency: 2
		});
		// Test Custom match configuration
		fetch.configure({
			match: url => url.hostname.includes("cdn"),
			interval: 1000
		});

		// Test the domain-specific throttling works
		const apiUrl = `${apiDomain}${dataPath}`;
		const apiPromises = [
			fetch(apiUrl).then(resp => resp.json()),
			fetch(apiUrl).then(resp => resp.json())
		];
		const apiResps = await Promise.all(apiPromises);
		expect(apiResps[1].start - apiResps[0].start).toBeGreaterThanOrEqual(latency);
		// Test the path-specific throttling
		const pathPromises = [
			fetch(testUrl + apiPath).then(resp => resp.json()),
			fetch(testUrl + apiPath).then(resp => resp.json()),
			fetch(testUrl + dataPath).then(resp => resp.json())
		];
		const pathResps = await Promise.all(pathPromises);
		expect(pathResps[1].start - pathResps[0].start).toBeLessThan(timeMargin);
		expect(pathResps[2].start - pathResps[0].start).toBeGreaterThanOrEqual(latency);
		// Test regex configuration works
		const imgPromises = [
			fetch(`${imgDomain}/a`).then(resp => resp.json()),
			fetch(`${imgDomain}:8443/b`).then(resp => resp.json()),
			fetch(`${imgDomain}.uk/c`).then(resp => resp.json())
		];
		const imgResps = await Promise.all(imgPromises);
		expect(imgResps[1].start - imgResps[0].start).toBeLessThan(timeMargin);
		expect(imgResps[2].start - imgResps[0].start).toBeGreaterThanOrEqual(latency);
		// Test custom matcher works
		const cdnUrl = `${cdnDomain}/assets/img.jpg`;
		const cdnPromises = [
			fetch(cdnUrl).then(resp => resp.json()),
			fetch(cdnUrl).then(resp => resp.json())
		];
		const cdnResps = await Promise.all(cdnPromises);
		expect(cdnResps[1].start - cdnResps[0].start).toBeGreaterThanOrEqual(1000);
	});

	test("URL Parsing", async () => {
		const adaptor = new TestAdaptor(latency);
		const fetch = createThrottledFetch(adaptor.fetch);

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
		const adaptor = new TestAdaptor(latency);
		const fetch = createThrottledFetch(adaptor.fetch);

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

		// Test configuration conflict
		fetch.configure({
			scope: "domain",
			url: apiDomain,
			maxConcurrency: 1
		});

		expect(() => fetch.configure({
			scope: "domain",
			url: apiDomain,
			maxConcurrency: 2
		})).toThrow(Error);

		// Test invalid config object
		expect(() => fetch.configure({
			// @ts-expect-error - Testing missing required properties
			unknownProp: true
		})).toThrow(TypeError);

		// Test network error handling
		const errorFetch = createThrottledFetch({
			maxRetry: 1
		}, (() => Promise.reject(new Error("Network failure"))) as unknown as Fetch);

		await expect(errorFetch(testUrl)).rejects.toThrow("Network failure");
	});
});