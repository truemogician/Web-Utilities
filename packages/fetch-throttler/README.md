# Fetch Throttler 🚀

A utility package providing fine-grained throttling control for `fetch` requests in both Node.js (v18+) and browser environments.

## Features ✨

*   **Concurrency Limiting** 🚦: Control the maximum number of simultaneous requests.
*   **Request Interval** ⏱️: Enforce a minimum time interval between requests.
*   **Automatic Retries** 🔄: Automatically retry failed requests (e.g., network errors, 5xx status codes).
*   **Request Queue Capacity** 📥: Limit the number of pending requests.
*   **Flexible Configuration** ⚙️: Apply throttling rules globally, per domain, per path, using regular expressions, or custom matching functions.
*   **Custom Fetch Adapter** 🔌: Use a custom `fetch`-compatible function if needed.

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

```typescript
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

*   `maxConcurrency` (number): Maximum number of concurrent requests within the pool. Defaults to `0` (unlimited), but becomes `1` if `interval` is set and `maxConcurrency` is not explicitly provided.
*   `interval` (number): Minimum milliseconds between the start of consecutive requests within the same pool. Defaults to `0` (no interval).
*   `maxRetry` (number): Maximum number of retries for failed requests (network errors or non-ok responses). Defaults to `1`.
*   `capacity` (number): Maximum number of requests allowed in the queue for this pool. If the queue is full, new requests targeting this pool will throw an error. Defaults to `0` (unlimited).

### Configuration Scopes 🎯

You can apply throttling rules based on different criteria:

#### 1. URL-based (Domain or Path) 🔗

Apply rules to specific domains or URL paths using `UrlComponentThrottleConfig`.

```typescript
import { createThrottledFetch } from "fetch-throttler";

const throttledFetch = createThrottledFetch(); // Start with default global settings

// Limit requests to 'api.example.com' domain to 2 concurrent requests
throttledFetch.configure({
    scope: "domain",
    url: "https://api.example.com",
    maxConcurrency: 2,
    interval: 500 // Add a 500ms interval between requests to this domain
});

// Apply different limits to specific paths on 'example.com'
throttledFetch.configure({
    scope: "path",
    url: ["https://example.com/users", "https://example.com/posts"],
    maxConcurrency: 10
});

// Requests matching these rules will use the specific pool; others use the default pool.
throttledFetch("https://api.example.com/endpoint1"); // Uses the domain-specific pool
throttledFetch("https://example.com/users/123");     // Uses the path-specific pool
throttledFetch("https://another-domain.com/data");   // Uses the default global pool (or a pool based on default scope)
```

*   `scope`: Must be `"domain"` or `"path"`.
*   `url`: A single URL string, a `URL` object, or an array of them. The domain or origin+pathname part is extracted based on the `scope`.

#### 2. Regex-based 🧩

Apply rules to URLs matching a regular expression using `RegexThrottleConfig`.

```typescript
throttledFetch.configure({
    regex: /^https:\/\/images\.example\.com\//,
    maxConcurrency: 20 // Allow higher concurrency for image assets
});

throttledFetch("https://images.example.com/logo.png"); // Uses the regex-based pool
```

*   `regex`: A `RegExp` object to test against the full URL string.

#### 3. Custom Matcher Function 🧑‍💻

Apply rules based on a custom function using `CustomThrottleConfig`.

```typescript
throttledFetch.configure({
    match: (url: URL) => url.pathname.startsWith("/admin"),
    maxConcurrency: 1, // Very strict limit for admin endpoints
    maxRetry: 0
});

throttledFetch("https://example.com/admin/config"); // Uses the custom matcher pool
```

*   `match`: A function `(url: URL) => boolean` that returns `true` if the configuration should apply to the given `URL`.

**ℹ️ Notes:**
*   **Matching Precedence:** When multiple configurations match a URL, the *first* matching rule found is used. The order of precedence is generally: Custom Matcher > Regex > Path > Domain > Default Pool.
*   **Regex/Custom Order:** Since it's impossible to determine if two Regex or Custom matchers are logically exclusive, the matching process for these types checks configurations in *reverse order* (last added takes precedence). If you add two overlapping Regex rules, the one added later via `configure` will be matched first.
*   **Performance:** URL-based configurations (`domain`, `path`) offer the best performance as they use an internal Map for O(1) lookups. Regex and Custom configurations require iterating through the defined rules for each request, which might introduce overhead, especially with many rules. Use URL-based rules when possible for optimal performance.
*   **Duplicate URL Scopes:** An error is thrown if you try to configure the exact same URL scope (e.g., the same domain or path string) multiple times via `configure`.