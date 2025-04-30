import { createThrottledFetch } from "../src/throttled-fetch";
import { TestAdaptor } from "./TestAdaptor";

interface TestResp {
	id: number;
	start: number;
	end: number;
}

describe("Throttled Fetch", () => {
	const testUrl = "https://example.com";

	test("Max Concurrency", async () => {
		const adaptor = new TestAdaptor(1000);
		const fetch = createThrottledFetch(adaptor.fetch, { maxConcurrency: 2 });
		const promises = new Array<Promise<TestResp>>();
		for (let i = 0; i < 3; ++i)
			promises.push(fetch(testUrl).then(resp => resp.json()));
		const resps = await Promise.all(promises);
		expect(resps.length).toBe(3);
		expect(resps[1].start - resps[0].start).toBeLessThan(100);
		expect(resps[2].start - resps[0].start).toBeGreaterThanOrEqual(1000);
	});

	test("Max Retry", async () => {
		const adaptor = new TestAdaptor(100, { status: 500 });
		const fetch = createThrottledFetch(adaptor.fetch, { maxRetry: 2 });
		const start = performance.now();
		const resp = await fetch(testUrl).catch(err => err);
		const end = performance.now();
		expect(resp.status).toBe(500);
		expect(end - start).toBeGreaterThanOrEqual(290);
		const json = await resp.json();
		expect(json.id).toBe(2);
	});

	test("Capacity", async () => {
		const adaptor = new TestAdaptor(1000);
		const fetch = createThrottledFetch(adaptor.fetch, { maxConcurrency: 1, capacity: 1 });
		const promise = fetch(testUrl).then(resp => resp.json());
		fetch(testUrl);
		expect(() => fetch(testUrl)).rejects.toThrow();
		await promise;
		expect(() => fetch(testUrl)).not.toThrow();
	});

	test("Interval", async () => {
		const adaptor = new TestAdaptor(500);
		const fetch = createThrottledFetch(adaptor.fetch, { maxConcurrency: 2, interval: 2000 });
		const promises = new Array<Promise<TestResp>>();
		for (let i = 0; i < 3; ++i)
			promises.push(fetch(testUrl).then(resp => resp.json()));
		const resps = await Promise.all(promises);
		expect(resps[1].start - resps[0].start).toBeLessThan(100);
		expect(resps[2].start - resps[0].start).toBeGreaterThanOrEqual(2000);
	});
});