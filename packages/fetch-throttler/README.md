# Fetch Throttler 🚀

A lightweight utility package providing fine-grained throttling control for `fetch` requests in both Node.js (v18+) and browser environments.

## Features ✨

*   **Concurrency Limiting** 🚦: Control the maximum number of simultaneous requests.
*   **Request Interval** ⏱️: Enforce a minimum time interval between requests.
*   **Automatic Retries** 🔄: Automatically retry failed requests (e.g., network errors, 5xx status codes).
*   **Flexible Configuration** ⚙️: Apply throttling rules globally, per domain, per path, using regular expressions, or custom matching functions.
*   **Custom Fetch Adapter** 🔌: Use a custom `fetch`-compatible function if needed.
*   **Request Queue Capacity** 📥: Limit the number of pending requests.
*   **Dependency-Free** 🍃: No runtime dependencies, keeping your bundle size small.
*   **Event-Based Performance** ⚡: Uses an efficient event-based approach (no `setInterval`) for managing concurrency and intervals, minimizing overhead.

## Installation 📦

```bash
npm install fetch-throttler
# or
yarn add fetch-throttler
# or
pnpm add fetch-throttler
```

## Basic Usage ▶️

Import `createThrottledFetch` and use it as a replacement for the standard `fetch`.

```ts
import { createThrottledFetch } from "fetch-throttler";

// Create a throttled fetch instance limiting concurrency to 5 requests globally
const throttledFetch = createThrottledFetch({ maxConcurrency: 5 });

// These requests will be executed with a maximum of 5 running concurrently
throttledFetch("https://api.example.com/data/1");
throttledFetch("https://api.example.com/data/2");
// ... many more requests
```

## Advanced Configuration 🛠️

The `ThrottledFetch` instance provides a `configure` method for setting up more specific throttling rules.

### Configuration Options ⚙️

All configuration methods accept an object with throttling parameters defined in `ThrottleConfig`:

*   `maxConcurrency` (number): Maximum number of concurrent requests allowed by this configuration. Defaults to `0` (unlimited), but becomes `1` if `interval` is set and `maxConcurrency` is not explicitly provided.
*   `interval` (number): Minimum milliseconds between the start of consecutive requests governed by the same configuration. Defaults to `0` (no interval).
*   `maxRetry` (number): Maximum number of retries for failed requests (network errors or non-ok responses). Defaults to `1`.
*   `capacity` (number): Maximum number of requests allowed in the queue for this configuration. If the queue is full, new requests targeting this configuration will throw an error. Defaults to `0` (unlimited).
*   `shouldRetry` (function): An optional function `(errOrRes: Error | Response) => Promisable<boolean | void>` that determines if a request should be retried.
    *   Receives the `Error` object (for network/adapter errors) or the `Response` object.
    *   Return `true` to force a retry (respecting `maxRetry`).
    *   Return `false` to prevent a retry. If `errOrRes` is a `Response`, the promise resolves with that response (even if not ok); if it's an `Error`, the promise rejects with that error.
    *   Return `undefined` or `void` to use the default behavior (retry on network errors and non-ok responses).
    *   **⚠️ Important:** If you need to inspect the `Response` body within this function, you *must* `clone()` the response first. Otherwise, the body will be consumed and unavailable to the original caller.

### Configuration Scopes 🎯

You can apply throttling rules based on different criteria:

#### 1. Domain-based 🏠

Apply rules to specific domains using `DomainThrottleConfig`. This is useful for limiting requests to a particular API host.

```ts
import { createThrottledFetch } from "fetch-throttler";

const throttledFetch = createThrottledFetch();

throttledFetch.configure({
    scope: "domain",
    domains: "api.example.com",
    // or use url: "https://api.example.com",
    maxConcurrency: 2
});

throttledFetch("https://api.example.com/endpoint"); // Uses the domain-specific config
throttledFetch("https://another-domain.com/data");   // Uses the default global config
```

*   `scope`: Must be `"domain"`.
*   `url`: (Optional) A single URL string, a `URL` object, or an array of them. The `host` is extracted.
*   `domains`: (Optional) A single domain string or an array of them. Required if `url` is not provided.

#### 2. Path-based 🛣️

Apply rules to specific URL paths using `PathThrottleConfig`. This allows fine-grained control over different parts of an API or website.

```ts
import { createThrottledFetch } from "fetch-throttler";

const throttledFetch = createThrottledFetch();

// Exact path match
throttledFetch.configure({
    scope: "path",
    url: ["https://example.com/users", "https://example.com/posts"],
    maxConcurrency: 10
});

// Subpath match
throttledFetch.configure({
    scope: "path",
    url: "https://example.com/api",
    maxConcurrency: 5,
    matchSubpath: true
});

throttledFetch("https://example.com/posts");  // Matches exact path for /posts
throttledFetch("https://example.com/users/123");  // Uses the global config, because path /users doesn't allow subpath matching
throttledFetch("https://example.com/api/v1/data");  // Matches subpath for /api
```

*   `scope`: Must be `"path"`.
*   `url`: A single URL string, a `URL` object, or an array of them. The `origin`+`pathname` is extracted.
*   `matchSubpath`: (Optional, defaults to `false`) If `true`, the rule applies to the specified path and all its subpaths.

#### 3. Regex-based 🧩

Apply rules to URLs matching a regular expression using `RegexThrottleConfig`.

```ts
throttledFetch.configure({
    regex: /^https:\/\/images\.example\.com\//,
    maxConcurrency: 20
});

throttledFetch("https://images.example.com/logo.png");
```

*   `regex`: A `RegExp` object to test against the full URL string.

#### 4. Custom Matcher Function 🧑‍💻

Apply rules based on a custom function using `CustomThrottleConfig`.

```ts
throttledFetch.configure({
    match: (url: URL) => url.pathname.startsWith("/admin"),
    maxConcurrency: 1,
    maxRetry: 0
});

throttledFetch("https://example.com/admin/config");
```

*   `match`: A function `(url: URL) => boolean` that returns `true` if the configuration should apply to the given `URL`.

### Custom Retry Logic 🔄

You can provide a `shouldRetry` function in any configuration (default or specific) to customize when requests are retried.

```ts
import { createThrottledFetch } from "fetch-throttler";

const throttledFetch = createThrottledFetch({
    maxRetry: 3, // Allow up to 3 retries
    shouldRetry(errOrRes) {
        // Don't retry client errors (4xx)
        if (errOrRes instanceof Response && errOrRes.status >= 400 && errOrRes.status < 500)
            return false;
        // For network errors or server errors (5xx), use default behavior (retry)
        return undefined;
    }
});

// This request might be retried if it fails with a network error or 5xx status
const result1 = await throttledFetch("/some-data");
// This request will not be retried if it results in a 404 Not Found
const result2 = await throttledFetch("/non-existent-resource");
```

**ℹ️ Notes:**
*   **Matching Precedence:** When multiple configurations match a URL, the *first* matching rule found is used. The order of precedence is: Custom Matcher > Regex > Exact Path > Subpath > Domain > Default Configuration.
*   **Regex/Custom Order:** Since it's impossible to determine if two Regex or Custom matchers are logically exclusive, the matching process for these types checks configurations in *reverse order* (last added takes precedence). If you add two overlapping Regex rules, the one added later via `configure` will be matched first.
*   **Performance:** URL-based configurations (`domain`, `path`) offer the best performance as they use an internal `Map` for $\mathcal{O}(1)$ lookups. Regex and Custom configurations require iterating through the defined rules for each request, which might introduce overhead, especially with many rules. Use URL-based rules when possible for optimal performance.
*   **Duplicate URL Scopes:** An error is thrown if you try to configure the exact same URL scope (e.g., the same domain or path string) multiple times via `configure`.
*   **Custom Adapter Properties:** While you can provide a custom fetch adapter, if your adapter function has additional properties attached to it, these properties will *not* be accessible on the returned `ThrottledFetchInst`. The instance only proxies the function call itself and the methods/properties of the `ThrottledFetch` class.