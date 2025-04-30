export class TestAdaptor {
	private requestId = 0;

	public responseInit: ResponseInit = { status: 200 };

	public responseDelay = 1000;

	public constructor(delay: number, init?: ResponseInit) {
		this.responseDelay = delay;
		if (init)
			this.responseInit = init;
	}

	private _fetch(): Promise<Response> {
		const id = this.requestId++;
		const init = { ...this.responseInit };
		const start = performance.now();
		return new Promise(resolve => setTimeout(() => {
			const end = performance.now();
			const json = JSON.stringify({ id, start, end });
			const resp = new Response(json, init);
			resolve(resp);
		}, this.responseDelay));
	}

	public get fetch(): typeof globalThis.fetch {
		return this._fetch.bind(this);
	}
}