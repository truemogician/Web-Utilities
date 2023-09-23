import { createCachedFetch } from "../src/cached-fetch";

describe("Cached Fetch", () => {
	const testUrl = "https://www.baidu.com";

	test("Basic", async () => {
		const fetch = createCachedFetch();
		const resp = await fetch(testUrl);
		expect(resp.status).toBe(200);
	});

	test("Cache", async () => {
		const fetch = createCachedFetch();
		const resp1 = await fetch(testUrl);
		const resp2 = await fetch(testUrl);
		expect(resp1).not.toBe(resp2);
		expect(await resp1.text()).toBe(await resp2.text());
	});

	test("No Clone", async () => {
		const fetch = createCachedFetch({ cloneResponse: false });
		const resp1 = await fetch(testUrl);
		const resp2 = await fetch(testUrl);
		expect(resp1).toBe(resp2);
		await resp1.text();
		expect(resp2.bodyUsed).toBe(true);
	});

	test("Cache Promise", async () => {
		const f1 = createCachedFetch({ cloneResponse: false });
		const [p1, p2] = [f1(testUrl), f1(testUrl)];
		expect(await p1).not.toBe(await p2);
		const f2 = createCachedFetch({ cloneResponse: false, cachePromise: true });
		const [p3, p4] = [f2(testUrl), f2(testUrl)];
		expect(await p3).toBe(await p4);
	})
});