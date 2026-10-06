# SDK & API

Everything you need to integrate Stele: the widget for your pages, the REST API for your server,
webhooks and the verifier. Server samples are in **cURL, Node.js, Python, Java, Go, PHP, Ruby and
C#**: pick a language on any sample and every sample switches to it. New to Stele? Start with
[Get started](get-started.md).

## Integration paths

| Where | Use | For |
|---|---|---|
| Your pages | [`stele.js`](#browser-script-stelejs) (script tag), or [`@stele/sdk` / `@stele/sdk/react`](#bundled-javascript-and-react) in bundled apps | Showing your Terms and collecting signed acceptances |
| Your server | The [REST API](#rest-api) from any language; on Node.js, [`@stele/sdk/server`](#server-sdk-nodejs) | Linking acceptances to your users, checking them, proofs |
| Your server | [Webhooks](#webhooks) | Being notified when something is recorded |
| Anyone | [`@stele/verifier`](#verifier), `stele-verify`, the **Verify** page | Checking evidence against Solana, without Stele |

Most integrations combine the widget with two or three server calls.

| Package | Use it for |
|---|---|
| `stele.js` (script tag) | The embeddable widget, with no installation |
| `@stele/sdk` | The widget for bundled apps (`mount`), plus lower-level building blocks |
| `@stele/sdk/react` | The widget as a React component |
| `@stele/sdk/server` | Node.js server client: sessions, acceptances, proofs, signers, webhook verification |
| `@stele/verifier` | Independent verification of acceptances and documents, as a library or a command |

```bash
npm install @stele/sdk          # widget, React component and Node.js server client
npm install @stele/verifier     # only if you verify evidence yourself
```

## Browser script (stele.js)

Load the script once. Every element with `data-stele-document` becomes a widget, including elements
added later by single-page apps.

```html
<div data-stele-organization="acme.com" data-stele-document="terms-of-service"></div>
<script src="https://app.stele.example/sdk/v1/stele.js" defer></script>
```

| Attribute | |
|---|---|
| `data-stele-organization` | **Required.** Your verified domain or your organization's address |
| `data-stele-document` | **Required.** The document's slug |
| `data-stele-theme` | `auto` (default), `dark` or `light` |
| `data-stele-session` | An [acceptance session](#acceptance-sessions) token from your server |

The API and receipt addresses default to the origin the script was loaded from.

**Events.** Both bubble up to `document`.

| Event | `event.detail` |
|---|---|
| `stele:accepted` | `{ acceptanceId, transactionSignature, slot, message, receiptPath, signerType, fee }` |
| `stele:error` | An `Error`; read `event.detail.message` |

A user who cancels in their wallet or passkey prompt sees a message in the widget; no event is sent
and nothing is recorded.

**JavaScript API.** `window.Stele` provides:

| | |
|---|---|
| `Stele.mount(target, options)` | Renders a widget into an element or CSS selector. Returns `{ destroy() }` |
| `Stele.mountProof(target, { requestId, token })` | Renders a [proof](#proofs-purchases-refunds-consents) confirmation |
| `Stele.scan()` | Mounts any new `data-stele-document` elements immediately |

Call `Stele.mount` after the script has loaded (for example on `DOMContentLoaded`), on an element
without `data-stele-*` attributes:

```js
window.addEventListener("DOMContentLoaded", () => {
  const widget = Stele.mount("#terms", {
    organization: "acme.com",
    document: "terms-of-service",
    onAccepted: (result) => console.log(result.acceptanceId),
  });
  // widget.destroy() removes it
});
```

**Options** (`Stele.mount`, `mount` from `@stele/sdk` and the React props):

| Option | Type | |
|---|---|---|
| `organization` | `string` | **Required.** Verified domain or organization address |
| `document` | `string` | **Required.** Document slug |
| `apiBaseUrl` | `string` | Stele API: `https://app.stele.example/api`. Set automatically by `stele.js`; required otherwise |
| `appUrl` | `string` | Where receipts open: `https://app.stele.example`. Set automatically by `stele.js` |
| `theme` | `"auto" \| "dark" \| "light"` | Default `"auto"` |
| `sessionToken` | `string \| () => Promise<string \| undefined>` | Acceptance session; a function is called when the user clicks **Accept & sign** |
| `onAccepted` | `(result) => void` | Same data as `stele:accepted` |
| `onError` | `(error: Error) => void` | Same as `stele:error` |
| `rpcUrls` | `string[]` | Solana RPC endpoints to verify against (default: those your Stele app advertises) |
| `expected` | `{ programId?, chainId? }` | Values to pin; loading stops if your Stele app advertises anything else |
| `signer` | `{ address, signMessage(bytes), walletName? }` | Your own wallet integration instead of the built-in wallet list |

**Styling.** The widget renders in a shadow root: your CSS cannot break it and its CSS stays inside.
Customize it with CSS custom properties on the host element: `--stele-accent`, `--stele-on-accent`,
`--stele-bg`, `--stele-fg`, `--stele-muted`, `--stele-border`, `--stele-surface`, `--stele-radius`,
`--stele-font`, `--stele-text-height` (height of the scrollable text), `--stele-verified`,
`--stele-warning`, `--stele-danger`.

```css
[data-stele-document] {
  --stele-accent: #6d28d9;
  --stele-radius: 8px;
}
```

### Content Security Policy

If your site sends a Content Security Policy, allow your Stele app and the Solana RPC endpoints the
widget reads from (`publicRpcUrls` in [`GET /v1/network`](#network), or your own `rpcUrls`):

```text
script-src  https://app.stele.example
connect-src https://app.stele.example <Solana RPC endpoints>
img-src     data:
```

`img-src data:` shows wallet icons. The widget's styles need no `'unsafe-inline'`.

## Bundled JavaScript and React

The same widget for apps that bundle their own JavaScript. Bundling pins the widget's code to the
version you reviewed.

```js tab=JavaScript
import { mount } from "@stele/sdk";

const widget = mount(document.querySelector("#terms"), {
  apiBaseUrl: "https://app.stele.example/api",
  appUrl: "https://app.stele.example",
  organization: "acme.com",
  document: "terms-of-service",
  onAccepted: (result) => console.log(result.acceptanceId),
});
```

```tsx tab=React
"use client"; // Next.js App Router only

import { TermsAcceptance } from "@stele/sdk/react";

export function Terms({ sessionToken }: { sessionToken?: string }) {
  return (
    <TermsAcceptance
      apiBaseUrl="https://app.stele.example/api"
      appUrl="https://app.stele.example"
      organization="acme.com"
      document="terms-of-service"
      sessionToken={sessionToken}
      onAccepted={(result) => console.log(result.acceptanceId)}
    />
  );
}
```

Both take the [options](#browser-script-stelejs) above; the component also takes `className` and
`style` for its host element. The lower-level pieces the widget is built from are exported for
building your own interface:

| Export | |
|---|---|
| `loadVerifiedDocument({ client, organization, document, rpcUrls?, expected? })` | Loads the current version and verifies it against Solana: content hash, fingerprint, chain. Throws `IntegrityError` on any mismatch |
| `acceptDocument({ client, verified, signer, requestDomain, sessionToken?, onStatus? })` | Requests a challenge, rebuilds the message from verified chain data, blocks signing on any difference, asks the signer, checks the signature and submits it |
| `watchWallets(chain, onChange)`, `connectWallet(wallet, chain)` | Find the visitor's Wallet Standard wallets for a network (`walletChain` from `/v1/network`) and turn one into a signer |
| `PasskeySigner`, `passkeySigningSupport()` | Walletless signing ([passkeys](#signing-without-a-wallet-passkeys)) |
| `SteleClient` | Minimal client for the public endpoints (`new SteleClient({ apiBaseUrl })`) |

The SDK never sends cookies to Stele, so it behaves the same on every site.

## REST API

### Base URL

Your Stele app serves the API under `/api/v1`:
`https://app.stele.example/api/v1`.

<!-- stele:networks -->

Every Solana network has its own Stele app, with its own organizations, API keys, acceptances and
webhooks. Build against a test network, then set the same things up on the Mainnet app; keep the
base URL and API key in your configuration so each environment uses its own.

Requests and responses are JSON (UTF-8); timestamps are ISO 8601 in UTC unless a field says Unix
seconds. Fields may be added to responses at any time, so ignore fields you don't know; breaking
changes ship under a new version prefix. The OpenAPI 3 document,
`https://app.stele.example/api/v1/openapi.json`, imports into Postman or Insomnia and generates a
client for any language with OpenAPI Generator.

### Authentication

| Caller | How | For |
|---|---|---|
| Anyone | No authentication | Public endpoints: documents, content, receipts, acceptance signing. Callable from any website |
| Your server | `Authorization: Bearer stl_live_…` | Acceptance sessions, acceptance queries, proofs, signers |
| The dashboard | Wallet sign-in session cookie | Managing your organization |

**API keys.** Create one under **API keys → Create key**: give it a name, pick its scopes and
optionally an expiry. The key is shown **once** and Stele stores only a hash; revoke it any time. Keys
start with `stl_live_` on Mainnet and `stl_test_` on test networks.

| Scope | Allows |
|---|---|
| `acceptances:write` | Creating acceptance sessions |
| `acceptances:read` | Listing and reading acceptances |
| `documents:read` | Reading the latest version of a document |
| `proofs:write` | Creating proof requests (purchases, refunds, consents…) |
| `proofs:read` | Listing proofs and reading their receipts (which include the statements) |
| `signers:read` | Listing your passkey signers |
| `signers:write` | Retiring a signer after account recovery |

> [!WARNING]
> API keys are for servers only. Never put them in browser code, mobile apps or public
> repositories. A key cannot sign or publish anything on Solana, which always requires your
> organization's wallet, but it can read your acceptances and proofs and create sessions and proof
> requests.

### Client setup

Every server sample on this page uses the client below: the base URL plus your API key, read from
the `STELE_API_KEY` environment variable. Node.js uses the server SDK; the other languages need at
most one common library. Each helper returns the parsed JSON and raises an error with the HTTP
status and [error body](#errors) on failure.

```bash tab=cURL
# Every cURL sample reads your key from this variable
export STELE_API_KEY="stl_live_…"
```

```ts tab=Node.js
// npm install @stele/sdk
import { SteleServerClient } from "@stele/sdk/server";

export const stele = new SteleServerClient({
  apiBaseUrl: "https://app.stele.example/api",
  apiKey: process.env.STELE_API_KEY!,
});
```

```python tab=Python
# pip install requests
import os

import requests

BASE_URL = "https://app.stele.example/api/v1"
http = requests.Session()
http.headers["Authorization"] = f"Bearer {os.environ['STELE_API_KEY']}"


def stele(method, path, **kwargs):
    """Calls the Stele API and returns the JSON body; raises on an error status."""
    response = http.request(method, BASE_URL + path, timeout=10, **kwargs)
    if not response.ok:
        raise RuntimeError(f"Stele {response.status_code}: {response.text}")
    return response.json()
```

```java tab=Java
// Stele.java: Java 17+ and Jackson (com.fasterxml.jackson.core:jackson-databind).
// Samples also import com.fasterxml.jackson.databind.JsonNode and java.util.Map.
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.stream.Collectors;

public final class Stele {
  public static final String BASE_URL = "https://app.stele.example/api/v1";
  private static final String API_KEY = System.getenv("STELE_API_KEY");
  // HTTP/1.1: no h2c upgrade attempt, which plain-HTTP test servers and proxies may reject.
  private static final HttpClient HTTP =
      HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build();
  private static final ObjectMapper JSON = new ObjectMapper();

  public static JsonNode get(String path) throws IOException, InterruptedException {
    return send(HttpRequest.newBuilder(URI.create(BASE_URL + path)).GET());
  }

  public static JsonNode get(String path, Map<String, ?> query)
      throws IOException, InterruptedException {
    return get(path + "?" + query.entrySet().stream()
        .map(e -> e.getKey() + "="
            + URLEncoder.encode(String.valueOf(e.getValue()), StandardCharsets.UTF_8))
        .collect(Collectors.joining("&")));
  }

  public static JsonNode post(String path, Object body) throws IOException, InterruptedException {
    return send(HttpRequest.newBuilder(URI.create(BASE_URL + path))
        .header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body))));
  }

  private static JsonNode send(HttpRequest.Builder request)
      throws IOException, InterruptedException {
    HttpResponse<String> response = HTTP.send(
        request.header("Authorization", "Bearer " + API_KEY)
            .timeout(Duration.ofSeconds(10))
            .build(),
        HttpResponse.BodyHandlers.ofString());
    if (response.statusCode() >= 300) {
      throw new IOException("Stele " + response.statusCode() + ": " + response.body());
    }
    return JSON.readTree(response.body());
  }
}
```

```go tab=Go
// stele.go: standard library only. Samples run inside a function that returns an error.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

const baseURL = "https://app.stele.example/api/v1"

var httpClient = &http.Client{Timeout: 10 * time.Second}

// stele calls the Stele API and decodes the JSON response into out.
func stele(method, path string, body, out any) error {
	var payload io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return err
		}
		payload = bytes.NewReader(encoded)
	}
	req, err := http.NewRequest(method, baseURL+path, payload)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+os.Getenv("STELE_API_KEY"))
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		msg, _ := io.ReadAll(res.Body)
		return fmt.Errorf("stele %d: %s", res.StatusCode, msg)
	}
	return json.NewDecoder(res.Body).Decode(out)
}
```

```php tab=PHP
<?php
// stele.php: PHP 8.1+ with the curl extension
const BASE_URL = 'https://app.stele.example/api/v1';

function stele(string $method, string $path, ?array $body = null): array
{
    $curl = curl_init(BASE_URL . $path);
    $headers = ['Authorization: Bearer ' . getenv('STELE_API_KEY')];
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
        curl_setopt($curl, CURLOPT_POSTFIELDS, json_encode($body, JSON_THROW_ON_ERROR));
    }
    curl_setopt_array($curl, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 10,
    ]);
    $response = curl_exec($curl);
    $status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    if ($response === false || $status >= 300) {
        throw new RuntimeException("Stele $status: " . ($response ?: curl_error($curl)));
    }
    return json_decode($response, true, 512, JSON_THROW_ON_ERROR);
}
```

```ruby tab=Ruby
# stele.rb: standard library only
require "json"
require "net/http"

BASE_URL = "https://app.stele.example/api/v1"

def stele(method, path, body = nil)
  uri = URI(BASE_URL + path)
  request = Net::HTTPGenericRequest.new(method, !body.nil?, true, uri)
  request["Authorization"] = "Bearer #{ENV.fetch("STELE_API_KEY")}"
  if body
    request["Content-Type"] = "application/json"
    request.body = JSON.generate(body)
  end
  response = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https",
                                                 open_timeout: 10, read_timeout: 10) do |http|
    http.request(request)
  end
  raise "Stele #{response.code}: #{response.body}" unless response.is_a?(Net::HTTPSuccess)

  JSON.parse(response.body)
end
```

```csharp tab=C#
// Program.cs: .NET 8 or later, no packages
using System.Net.Http.Json;
using System.Text.Json;

const string BaseUrl = "https://app.stele.example/api/v1";
var http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
http.DefaultRequestHeaders.Authorization =
    new("Bearer", Environment.GetEnvironmentVariable("STELE_API_KEY"));

async Task<JsonElement> Stele(HttpMethod method, string path, object? body = null)
{
    using var request = new HttpRequestMessage(method, BaseUrl + path)
    {
        Content = body is null ? null : JsonContent.Create(body),
    };
    using var response = await http.SendAsync(request);
    var text = await response.Content.ReadAsStringAsync();
    if (!response.IsSuccessStatusCode)
        throw new HttpRequestException($"Stele {(int)response.StatusCode}: {text}");
    return JsonSerializer.Deserialize<JsonElement>(text);
}
```

### Server SDK (Node.js)

`SteleServerClient` wraps the endpoints below (Node.js 18 or later):

| Method | Scope | Returns |
|---|---|---|
| `createAcceptanceSession({ document?, externalUserRef?, ttlSeconds? })` | `acceptances:write` | `{ sessionToken, expiresAt }` |
| `hasAcceptedLatest(externalUserRef, slug)` | `documents:read`, `acceptances:read` | The user's acceptance of the **current** version, or `null` |
| `latestVersion(slug)` | `documents:read` | `{ organization, document, version }` |
| `listAcceptances({ externalUserRef?, document?, version?, signer?, from?, to?, limit?, cursor? })` | `acceptances:read` | `{ acceptances, nextCursor }`, newest first |
| `getAcceptance(acceptanceId)` | `acceptances:read` | `{ acceptance, receiptUrl }` |
| `createProofRequest({ type, reference, summary, details, policies?, relatesTo?, externalUserRef?, ttlSeconds? })` | `proofs:write` | `{ requestId, clientToken, statement, statementHash, expiresAt, confirmUrl }` |
| `listProofs({ type?, reference?, externalUserRef?, limit?, cursor? })` | `proofs:read` | `{ proofs, nextCursor }` |
| `getProofReceipt(proofId)` | `proofs:read` | `{ receipt, report }`, verified against Solana |
| `listSigners(externalUserRef?)` | `signers:read` | `{ signers }` |
| `revokeSigner(publicKey, reason)` | `signers:write` | Retires a signer (account recovery) |

`verifyWebhook(secret, signatureHeader, rawBody, toleranceSeconds = 300)` checks a webhook's
signature and age and returns the parsed event, or throws `WebhookVerificationError`. See
[Webhooks](#webhooks).

## Network

Which network and program your Stele app uses. Public; the widget reads it automatically.

```bash
curl https://app.stele.example/api/v1/network
```

```json
{
  "cluster": "mainnet",
  "chainId": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  "label": "Solana Mainnet",
  "walletChain": "solana:mainnet",
  "programId": "6sTKscWmUtBQRMpNCiEpurCJxpjx7GK5rzk7e265kpwV",
  "relayer": "BLECAww6xiFLr89hgXg3eJwiN1VitX4ML8Z6yE8yPgMS",
  "attestor": "BMswzSJscjY62DAyYazdFf6uNeYd6QmQv7pa2figpCqB",
  "hostedAcceptDomain": "app.stele.example",
  "publicRpcUrls": ["https://api.mainnet-beta.solana.com"],
  "contentMirror": "https://app.stele.example/api/v1/public/content"
}
```

`label` is the network your users' wallets must use. `programId` and `chainId` are the values to pin
with `expected`.

## Documents

Public, read-only information about published documents. The responses are **claims**: the SDK and the
verifier check them against Solana before relying on them.

| Method | Path | |
|---|---|---|
| GET | `/v1/public/organizations/{domain or address}` | An organization and its published documents |
| GET | `/v1/public/organizations/{ref}/documents/{slug}` | A document with its full version history |
| GET | `/v1/public/versions/{address}` | One version with its document and organization |
| GET | `/v1/public/content/{sha256}` | The exact text of a version (canonical bytes, served only if they hash correctly) |
| GET | `/v1/public/content/{sha256}/parsed` | The same content as parsed JSON |
| GET | `/v1/documents/by-slug/{slug}/latest` | The current version of one of **your** documents (`documents:read`) |

**The current version of your document:**

```bash tab=cURL
curl https://app.stele.example/api/v1/documents/by-slug/terms-of-service/latest \
  -H "Authorization: Bearer $STELE_API_KEY"
```

```ts tab=Node.js
const latest = await stele.latestVersion("terms-of-service");
console.log(latest.version.number, latest.version.address);
```

```python tab=Python
latest = stele("GET", "/documents/by-slug/terms-of-service/latest")
print(latest["version"]["number"], latest["version"]["address"])
```

```java tab=Java
JsonNode latest = Stele.get("/documents/by-slug/terms-of-service/latest");
System.out.println(latest.at("/version/number") + " " + latest.at("/version/address").asText());
```

```go tab=Go
var latest struct {
	Version struct {
		Address string `json:"address"`
		Number  int    `json:"number"`
	} `json:"version"`
}
if err := stele("GET", "/documents/by-slug/terms-of-service/latest", nil, &latest); err != nil {
	return err
}
fmt.Println(latest.Version.Number, latest.Version.Address)
```

```php tab=PHP
$latest = stele('GET', '/documents/by-slug/terms-of-service/latest');
echo $latest['version']['number'], ' ', $latest['version']['address'], PHP_EOL;
```

```ruby tab=Ruby
latest = stele("GET", "/documents/by-slug/terms-of-service/latest")
puts "#{latest["version"]["number"]} #{latest["version"]["address"]}"
```

```csharp tab=C#
var latest = await Stele(HttpMethod.Get, "/documents/by-slug/terms-of-service/latest");
var version = latest.GetProperty("version");
Console.WriteLine($"{version.GetProperty("number")} {version.GetProperty("address")}");
```

```json
{
  "organization": "A1M7r3AyuQ91QNg1GBjs8zffXtV795BXmzm7HEH8V2f6",
  "document": "Hm77xC4schJ1o4eeZhniXBqKRaGfVhU25DYRiF9VX7YT",
  "version": {
    "address": "S7b7qpR354RyU3jFFi32PC7BMyUREdB6jviKdef2SJf",
    "number": 3,
    "label": "3.0",
    "title": "Terms of Service",
    "fingerprint": "db8942fcc55ab23410cfd5805c5719b37ec885df549629cd0fcb2c856555cf69",
    "effectiveAt": null
  }
}
```

`version.address` identifies the version on Solana; acceptances refer to it as `versionAddress`.
`effectiveAt` is a Unix timestamp in seconds, or `null` when the version takes effect on
publication.

## Acceptance sessions

Link an acceptance to a user of **your** app. Your server creates a session; the widget sends its
token with the signing request; Stele stores your user ID with the acceptance, off-chain.

| Method | Path | Auth | |
|---|---|---|---|
| POST | `/v1/acceptance-sessions` | `acceptances:write` | `{ document?, externalUserRef?, ttlSeconds? }` → `{ sessionToken, expiresAt }` |

```bash tab=cURL
curl https://app.stele.example/api/v1/acceptance-sessions \
  -H "Authorization: Bearer $STELE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "document": "terms-of-service", "externalUserRef": "user_12345" }'
```

```ts tab=Node.js
const { sessionToken } = await stele.createAcceptanceSession({
  document: "terms-of-service",
  externalUserRef: "user_12345",
});
```

```python tab=Python
session = stele("POST", "/acceptance-sessions", json={
    "document": "terms-of-service",
    "externalUserRef": "user_12345",
})
session_token = session["sessionToken"]
```

```java tab=Java
JsonNode session = Stele.post("/acceptance-sessions", Map.of(
    "document", "terms-of-service",
    "externalUserRef", "user_12345"));
String sessionToken = session.get("sessionToken").asText();
```

```go tab=Go
var session struct {
	SessionToken string `json:"sessionToken"`
}
err := stele("POST", "/acceptance-sessions", map[string]any{
	"document":        "terms-of-service",
	"externalUserRef": "user_12345",
}, &session)
if err != nil {
	return err
}
fmt.Println(session.SessionToken)
```

```php tab=PHP
$session = stele('POST', '/acceptance-sessions', [
    'document' => 'terms-of-service',
    'externalUserRef' => 'user_12345',
]);
$sessionToken = $session['sessionToken'];
```

```ruby tab=Ruby
session = stele("POST", "/acceptance-sessions", {
  document: "terms-of-service",
  externalUserRef: "user_12345",
})
session_token = session["sessionToken"]
```

```csharp tab=C#
var session = await Stele(HttpMethod.Post, "/acceptance-sessions",
    new { document = "terms-of-service", externalUserRef = "user_12345" });
var sessionToken = session.GetProperty("sessionToken").GetString();
```

```json
{
  "sessionToken": "stls_8Myx1ippBc0WT-0hENTtRAhd8RyqETa6m-rM5sepApY",
  "expiresAt": "2026-10-03T10:35:58.355Z"
}
```

- `document`: a slug or document address. If set, the session works only for that document.
- `externalUserRef`: your user ID; up to 128 printable characters, no spaces. Not an email address:
  Stele doesn't need it.
- `ttlSeconds`: 60–3600, default 900 (15 minutes).
- A session is used up by one successful acceptance. Create one per page view and pass the token to
  the widget (`data-stele-session`, or the `sessionToken` option).

With **Require acceptance sessions** enabled (Organization → Acceptance policy), signing requests
without a valid session are refused.

## Acceptances

| Method | Path | Auth | |
|---|---|---|---|
| GET | `/v1/acceptances` | `acceptances:read` | Your acceptances, newest first ([below](#list-acceptances)) |
| GET | `/v1/acceptances/{acceptanceId}` | `acceptances:read` | One of your acceptances, with its receipt URL |
| GET | `/v1/public/acceptances/{acceptanceId}` | public | Public summary of an acceptance |
| GET | `/v1/public/acceptances/{acceptanceId}/receipt` | public | The receipt, verified against Solana |
| GET | `/v1/public/transactions/{signature}/acceptance` | public | The acceptance ID recorded by a transaction |
| POST | `/v1/acceptance/challenges` | public | Start signing (used by the SDK) |
| POST | `/v1/acceptance/challenges/{id}/submit` | public | Record a signed acceptance (used by the SDK) |
| GET | `/v1/acceptance/challenges/{id}` | `x-client-binding` | Status of a challenge |

### List acceptances

Filters, all optional: `externalUserRef`, `document` (document address), `version` (version address),
`signer`, `from` and `to` (ISO 8601, inclusive), `limit` (1–200, default 50). The response carries
`nextCursor`: pass it as `cursor` for the next page; it is `null` on the last one.

```bash tab=cURL
curl "https://app.stele.example/api/v1/acceptances?externalUserRef=user_12345&limit=50" \
  -H "Authorization: Bearer $STELE_API_KEY"

# Next page: add the nextCursor value from the previous response
curl "https://app.stele.example/api/v1/acceptances?externalUserRef=user_12345&limit=50&cursor=$CURSOR" \
  -H "Authorization: Bearer $STELE_API_KEY"
```

```ts tab=Node.js
let cursor: string | undefined;
do {
  const page = await stele.listAcceptances({ externalUserRef: "user_12345", limit: 50, cursor });
  for (const acceptance of page.acceptances) {
    console.log(acceptance.acceptanceId, acceptance.versionNumber);
  }
  cursor = page.nextCursor ?? undefined;
} while (cursor);
```

```python tab=Python
cursor = None
while True:
    page = stele("GET", "/acceptances", params={
        "externalUserRef": "user_12345",
        "limit": 50,
        "cursor": cursor,  # None is left out
    })
    for acceptance in page["acceptances"]:
        print(acceptance["acceptanceId"], acceptance["versionNumber"])
    cursor = page["nextCursor"]
    if cursor is None:
        break
```

```java tab=Java
String cursor = null;
do {
  Map<String, Object> query = new java.util.HashMap<>(
      Map.of("externalUserRef", "user_12345", "limit", 50));
  if (cursor != null) query.put("cursor", cursor);
  JsonNode page = Stele.get("/acceptances", query);
  for (JsonNode acceptance : page.get("acceptances")) {
    System.out.println(acceptance.get("acceptanceId").asText());
  }
  cursor = page.get("nextCursor").isNull() ? null : page.get("nextCursor").asText();
} while (cursor != null);
```

```go tab=Go
cursor := ""
for {
	query := url.Values{"externalUserRef": {"user_12345"}, "limit": {"50"}}
	if cursor != "" {
		query.Set("cursor", cursor)
	}
	var page struct {
		Acceptances []struct {
			AcceptanceID  string `json:"acceptanceId"`
			VersionNumber int    `json:"versionNumber"`
		} `json:"acceptances"`
		NextCursor *string `json:"nextCursor"`
	}
	if err := stele("GET", "/acceptances?"+query.Encode(), nil, &page); err != nil {
		return err
	}
	for _, acceptance := range page.Acceptances {
		fmt.Println(acceptance.AcceptanceID, acceptance.VersionNumber)
	}
	if page.NextCursor == nil {
		break
	}
	cursor = *page.NextCursor
}
```

```php tab=PHP
$cursor = null;
do {
    $page = stele('GET', '/acceptances?' . http_build_query([
        'externalUserRef' => 'user_12345',
        'limit' => 50,
        'cursor' => $cursor, // null is left out
    ]));
    foreach ($page['acceptances'] as $acceptance) {
        echo $acceptance['acceptanceId'], ' ', $acceptance['versionNumber'], PHP_EOL;
    }
    $cursor = $page['nextCursor'];
} while ($cursor !== null);
```

```ruby tab=Ruby
cursor = nil
loop do
  query = { externalUserRef: "user_12345", limit: 50, cursor: cursor }.compact
  page = stele("GET", "/acceptances?#{URI.encode_www_form(query)}")
  page["acceptances"].each do |acceptance|
    puts "#{acceptance["acceptanceId"]} #{acceptance["versionNumber"]}"
  end
  cursor = page["nextCursor"]
  break if cursor.nil?
end
```

```csharp tab=C#
string? cursor = null;
do
{
    var query = $"externalUserRef={Uri.EscapeDataString("user_12345")}&limit=50";
    if (cursor is not null) query += $"&cursor={cursor}";
    var page = await Stele(HttpMethod.Get, $"/acceptances?{query}");
    foreach (var acceptance in page.GetProperty("acceptances").EnumerateArray())
        Console.WriteLine(acceptance.GetProperty("acceptanceId").GetString());
    cursor = page.GetProperty("nextCursor").GetString();
} while (cursor is not null);
```

```json
{
  "acceptances": [
    {
      "acceptanceId": "4ba3b02722d744452be1a9837020dba10691cded7df67c332a3aa4c1527ccf05",
      "transactionSignature": "4Gv4TkZKnWS7gsSDpo9Uv9kWgCp1oo2A3kfk67mZW8KTgB8gMkHNyZfJjQQLNUoKBeE97S77EpjUeqNrUJBo5mi9",
      "slot": 11989,
      "blockTime": "2026-10-03T10:24:21.000Z",
      "signer": "ALrq9rvr887kHwCZET78P5HeGzwAxj52DgdzRZdiqAxV",
      "signerType": "wallet",
      "versionAddress": "S7b7qpR354RyU3jFFi32PC7BMyUREdB6jviKdef2SJf",
      "versionNumber": 3,
      "requestDomain": "shop.acme.com",
      "externalUserRef": "user_12345",
      "commitment": "finalized",
      "documentSlug": "terms-of-service",
      "feePayer": "BLECAww6xiFLr89hgXg3eJwiN1VitX4ML8Z6yE8yPgMS",
      "feeLamports": 10000,
      "reimbursedLamports": null
    }
  ],
  "nextCursor": null
}
```

| Field | |
|---|---|
| `signer`, `signerType` | The key that signed: a `wallet`, or a `passkey`-protected signer |
| `versionAddress`, `versionNumber` | Exactly which version was accepted |
| `requestDomain` | The site that asked for the signature |
| `externalUserRef` | Your user ID, if a session was used; otherwise `null` |
| `commitment` | `confirmed`, then `finalized` once Solana finalizes the transaction |
| `feePayer`, `feeLamports`, `reimbursedLamports` | Who paid the network fee and how much; `reimbursedLamports` is what your [sponsorship](#fees-the-user-never-pays) paid back (`null`: Stele paid) |

To check whether a user accepted the **current** version, filter by the `version` address from
[the latest version](#documents) with `limit=1`: that is what `hasAcceptedLatest()` does, and
[Get started](get-started.md#7-verify-acceptance-on-your-server) shows it in every language.

### Get one acceptance

For example to check an `acceptanceId` your page sent to your server. Stele answers only for your
organization's acceptances (`404` otherwise). The ID comes from the browser, so check its format
before putting it in a URL:

```bash tab=cURL
curl "https://app.stele.example/api/v1/acceptances/$ACCEPTANCE_ID" \
  -H "Authorization: Bearer $STELE_API_KEY"
```

```ts tab=Node.js
// The SDK encodes the ID; an unknown or foreign ID throws (404).
const { acceptance, receiptUrl } = await stele.getAcceptance(acceptanceId);
```

```python tab=Python
import re

if not re.fullmatch(r"[0-9a-f]{64}", acceptance_id):
    raise ValueError("invalid acceptance ID")
found = stele("GET", f"/acceptances/{acceptance_id}")
acceptance, receipt_url = found["acceptance"], found["receiptUrl"]
```

```java tab=Java
if (!acceptanceId.matches("[0-9a-f]{64}")) {
  throw new IllegalArgumentException("invalid acceptance ID");
}
JsonNode found = Stele.get("/acceptances/" + acceptanceId);
JsonNode acceptance = found.get("acceptance");
```

```go tab=Go
if !regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(acceptanceID) {
	return errors.New("invalid acceptance ID")
}
var found struct {
	Acceptance struct {
		VersionAddress  string  `json:"versionAddress"`
		ExternalUserRef *string `json:"externalUserRef"`
	} `json:"acceptance"`
	ReceiptURL string `json:"receiptUrl"`
}
if err := stele("GET", "/acceptances/"+acceptanceID, nil, &found); err != nil {
	return err
}
```

```php tab=PHP
if (!preg_match('/^[0-9a-f]{64}$/D', $acceptanceId)) {
    throw new InvalidArgumentException('invalid acceptance ID');
}
$found = stele('GET', "/acceptances/$acceptanceId");
$acceptance = $found['acceptance'];
```

```ruby tab=Ruby
raise ArgumentError, "invalid acceptance ID" unless acceptance_id.match?(/\A[0-9a-f]{64}\z/)

found = stele("GET", "/acceptances/#{acceptance_id}")
acceptance = found["acceptance"]
```

```csharp tab=C#
if (!System.Text.RegularExpressions.Regex.IsMatch(acceptanceId, @"^[0-9a-f]{64}\z"))
    throw new ArgumentException("invalid acceptance ID");
var found = await Stele(HttpMethod.Get, $"/acceptances/{acceptanceId}");
var acceptance = found.GetProperty("acceptance");
```

The response is `{ "acceptance": { … }, "receiptUrl": "https://app.stele.example/receipt/<acceptanceId>" }`,
with `acceptance` exactly like a [list item](#list-acceptances). Without a
[session](#acceptance-sessions), an acceptance proves that *a* key accepted, not which of your users
holds it: compare `externalUserRef` with the logged-in user.

### Receipts

A receipt is a self-contained file anyone can verify later, without Stele. Public: no key needed.
Keep one with your records:

```bash tab=cURL
curl "https://app.stele.example/api/v1/public/acceptances/$ACCEPTANCE_ID/receipt" \
  | jq .receipt > receipt.json
```

```ts tab=Node.js
import { writeFile } from "node:fs/promises";

const res = await fetch(
  `https://app.stele.example/api/v1/public/acceptances/${acceptanceId}/receipt`,
);
const { receipt, report } = await res.json();
await writeFile(`${acceptanceId}.json`, JSON.stringify(receipt, null, 2));
```

```python tab=Python
import json

result = requests.get(f"{BASE_URL}/public/acceptances/{acceptance_id}/receipt", timeout=10)
result.raise_for_status()
with open(f"{acceptance_id}.json", "w", encoding="utf-8") as file:
    json.dump(result.json()["receipt"], file, indent=2)
```

```java tab=Java
JsonNode result = Stele.get("/public/acceptances/" + acceptanceId + "/receipt");
java.nio.file.Files.writeString(
    java.nio.file.Path.of(acceptanceId + ".json"), result.get("receipt").toPrettyString());
```

```go tab=Go
var result struct {
	Receipt json.RawMessage `json:"receipt"`
}
if err := stele("GET", "/public/acceptances/"+acceptanceID+"/receipt", nil, &result); err != nil {
	return err
}
if err := os.WriteFile(acceptanceID+".json", result.Receipt, 0o600); err != nil {
	return err
}
```

```php tab=PHP
$result = stele('GET', "/public/acceptances/$acceptanceId/receipt");
file_put_contents("$acceptanceId.json", json_encode($result['receipt'], JSON_PRETTY_PRINT));
```

```ruby tab=Ruby
result = stele("GET", "/public/acceptances/#{acceptance_id}/receipt")
File.write("#{acceptance_id}.json", JSON.pretty_generate(result["receipt"]))
```

```csharp tab=C#
var result = await Stele(HttpMethod.Get, $"/public/acceptances/{acceptanceId}/receipt");
await File.WriteAllTextAsync($"{acceptanceId}.json", result.GetProperty("receipt").GetRawText());
```

The response holds two objects:

- `receipt`: the `stele-receipt-v1` file: network, transaction, signer, signed message and signature,
  nonce, organization, document, version, the full document text, and — when available — `signer`
  (for passkey signers: the passkey's evidence, re-verified by every verifier) and `fees` (fee payer,
  fee, and who sponsored it).
- `report`: the result of verifying it against Solana just now. `report.verdict` is `VALID`,
  `VALID_WITH_WARNINGS`, `INVALID` or `INCONCLUSIVE`, and `report.checks` lists every check.

```json
{
  "receipt": {
    "format": "stele-receipt-v1",
    "acceptanceId": "4ba3b02722d744452be1a9837020dba10691cded7df67c332a3aa4c1527ccf05",
    "network": { "chainId": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", "label": "Solana Mainnet", "programId": "6sTKscWmUtBQRMpNCiEpurCJxpjx7GK5rzk7e265kpwV" },
    "transaction": { "signature": "4Gv4TkZKnWS7gsSDpo9Uv9kWgCp1oo2A3kfk67mZW8KTgB8gMkHNyZfJjQQLNUoKBeE97S77EpjUeqNrUJBo5mi9", "slot": 11989, "blockTime": 1791023061 },
    "acceptance": { "signer": "ALrq9rvr887kHwCZET78P5HeGzwAxj52DgdzRZdiqAxV", "message": "Stele Protocol v1 - Accept Agreement\n…", "requestDomain": "shop.acme.com" },
    "version": { "number": 3, "label": "3.0", "title": "Terms of Service" }
  },
  "report": {
    "verdict": "VALID_WITH_WARNINGS",
    "summary": "All critical checks passed; review the warnings.",
    "checks": [
      { "id": "tx.status", "label": "Transaction", "status": "warn", "detail": "Confirmed in slot 11989 but not yet finalized.", "critical": false }
    ]
  }
}
```

(Shortened: the real objects contain more fields and checks.) The `report` is Stele's own check; for
evidence that does not depend on Stele, verify the receipt yourself with the [verifier](#verifier).

### Signing (used by the SDK)

Signing and recording go through two public endpoints. **Let the SDK call them**: it rebuilds the
message from Solana data and refuses to sign if the server's message differs.

| Endpoint | Body → response |
|---|---|
| `POST /v1/acceptance/challenges` | `{ organization, document, signer, sessionToken?, signerType? }` → the message to sign, nonce, validity window, a `clientBinding` secret, `feeSponsor`, `protocol` (`stele/1` or `stele/2`), and for passkey signers the `passkey` challenge. `signerType`: `wallet` (default; `signer` is a base58 address), `passkey_p256` (native passkey; `signer` is `p256:<66 hex>`), or `passkey` (PRF-protected key). The requesting site is taken from the `Origin` header |
| `POST /v1/acceptance/challenges/{id}/submit` | `{ clientBinding, signature?, passkeyAssertion? }` (native passkeys send only the assertion) → `{ acceptanceId, transactionSignature, slot, status, evidenceMode, signerType, fee }`. `status` is `confirmed`, or `pending_batch` when your organization anchors acceptances in Merkle batches: `transactionSignature` is then `null` until the batch is anchored (seconds) |

## Signing without a wallet (passkeys)

If your signing policy allows it (**Dashboard → Signing & fees**), visitors can sign with a
**passkey** — Face ID, Touch ID, Windows Hello, a phone or a security key — instead of a wallet. The
widget and the hosted page do everything below for you; these endpoints are documented for custom
integrations.

**Native passkeys (`stele/2`, the default for new signers).** The passkey's own P-256 key signs. Its
private key never leaves the authenticator — nothing is generated, wrapped, stored or unlocked in
JavaScript. Each acceptance is one passkey prompt with user verification; Solana's secp256r1
precompile verifies the signature and the Stele program checks that it covers exactly this message,
from a top-level page of the requesting site, for the right relying party. Signers registered before
native passkeys keep working as **PRF-protected keys** ([below](#prf-protected-stele-keys-stele1)).

| Signing policy | Who can sign |
|---|---|
| `WALLET_ONLY` (default) | Solana wallets |
| `PASSKEY_ONLY` | Passkey signers |
| `WALLET_OR_PASSKEY` | Either; the visitor chooses |
| `ACCOUNT_AND_PASSKEY` | Passkey signers bound to **your** user account: every request needs an acceptance session created for that `externalUserRef`; one active signer per account |

With `ACCOUNT_AND_PASSKEY`, a native passkey is **enrolled on-chain** for the account (a
`PasskeySigner` account holding a salted commitment to your `externalUserRef` — no personal data).
Only the current passkey can hand the account to a new one (rotation); if the user lost every passkey,
your admin wallet authorizes a replacement, which every verifier shows as an organization recovery,
never as the user's own act.

Public browser endpoints for native passkeys (CORS without cookies; the relying party is the calling
site):

| Method | Path | |
|---|---|---|
| POST | `/v1/passkeys/native/options` | `{ organization, purpose: "register" \| "rotate" \| "recover", sessionToken?, identity? }` → `navigator.credentials.create()` options (`challenge`, `rpId`, `user`, `algorithms: [-7]`, `excludeCredentials`, `accountBound`) |
| POST | `/v1/passkeys/native/register` | `{ challengeId, credential, label? }` (the WebAuthn registration) → `{ identity: "p256:…", status: "pending", confirm }`: the statement the passkey must sign next (`enroll` / `recover`: the new passkey; `rotate`: the current one), with its challenge and `allowCredentials` |
| POST | `/v1/passkeys/native/confirm` | `{ challengeId, assertion }` → `{ identity, status: "active" \| "awaiting_organization", enrollment, transactionSignature, recovery }`. Proves possession; in account mode records the enrollment or rotation on-chain (Stele pays) |
| POST | `/v1/passkeys/native/identify` | `{ challengeId, assertion }` (a discoverable assertion for an `identify` ceremony from `/v1/passkeys/options`) → `{ identity, credentialId, rpId, algorithm }` |

Signing with a native passkey uses the [signing endpoints](#signing-used-by-the-sdk) with
`signerType: "passkey_p256"` and `signer: "p256:<key>"`; the challenge response adds
`passkey: { kind: "native", challenge, rpId, allowCredentials }` where
`challenge = SHA-256("stele:v2:passkey-acceptance\0" ‖ message)`. Submit the WebAuthn assertion as
`passkeyAssertion` (`credentialId`, `authenticatorData`, `clientDataJSON`, `signature` — the
DER signature as returned by the browser, base64url). The API checks it exactly as the program will
and returns `400 invalid_passkey_assertion` (with the reason) before anything is relayed.

In the browser, with the bundled SDK:

```ts
import { NativePasskeySigner, SteleClient, acceptDocument } from "@stele/sdk";

const client = new SteleClient({ apiBaseUrl: "https://app.stele.example/api" });
const signer =
  NativePasskeySigner.remembered(client, organizationAddress) ??
  (await NativePasskeySigner.register({ client, organization: organizationAddress }));
await acceptDocument({ client, verified, signer, requestDomain: location.hostname });
```

The SDK rebuilds the message from Solana data, computes the WebAuthn challenge itself and checks the
assertion locally before submitting. `signer.rotate({ sessionToken })` and
`NativePasskeySigner.requestRecovery({ … })` cover account-bound signers.

### PRF-protected Stele keys (`stele/1`)

Signers registered before native passkeys: the browser created an Ed25519 signing key, encrypted it
with a key derived from the passkey's **WebAuthn PRF** output, and sent Stele only the ciphertext. To
sign, one passkey prompt (with user verification) approves the exact message and unlocks the key for
that one signature. Stele never sees the private key, cannot decrypt it, and refuses to record such
an acceptance unless the passkey approved that exact message.

Public browser endpoints (CORS without cookies; the passkey's relying party is the calling site):

| Method | Path | |
|---|---|---|
| POST | `/v1/passkeys/options` | `{ organization, purpose: "register" \| "add_passkey" \| "identify", sessionToken?, identity? }` → WebAuthn options (`challenge`, `rpId`, `user`, `excludeCredentials`) and the network's `chainId` |
| POST | `/v1/passkeys/register` | Registration: the WebAuthn credential, the new signer's public key, a key statement signed by that key and endorsed by the passkey, the PRF salt, the wrapped key, optionally a recovery kit's wrapped key. `add_passkey` uses the same body with an `ADD_PASSKEY` statement |
| POST | `/v1/passkeys/key-material` | `{ organization, credentialId }` → the wrapped (encrypted) key and PRF salt |
| POST | `/v1/passkeys/identify` | A discoverable passkey assertion → the signer and its wrapped key (returning visitor on a new device) |
| POST | `/v1/passkeys/recovery-kits` | Add a recovery kit (statement signed by the key) |
| POST | `/v1/passkeys/recovery-kits/lookup` | `{ organization, kitId }` → the kit's wrapped key (the kit ID is derived from the kit's secret, which never leaves the user) |
| POST | `/v1/passkeys/revoke` | Revoke a passkey (statement signed by the key) |
| GET | `/v1/public/signers/{publicKey}` | Public evidence about a signer key: its key statements, passkey endorsements and rotation |

Signing with a passkey uses the normal [signing endpoints](#signing-used-by-the-sdk) with two
additions:

- `POST /v1/acceptance/challenges` takes `signerType: "passkey"`; the response adds
  `passkey: { challenge, rpId, allowCredentials }` (the challenge is `SHA-256("stele:v1:passkey-signature\0" ‖ message)`).
- `POST /v1/acceptance/challenges/{id}/submit` takes `passkeyAssertion`
  (`credentialId`, `authenticatorData`, `clientDataJSON`, `signature`, base64url). Without a valid,
  user-verified assertion over that exact message from an active passkey of the signer, the request
  fails with `400 passkey_assertion_required` / `invalid_passkey_assertion`.

In the browser, with the bundled SDK:

```ts
import { PasskeySigner, SteleClient, acceptDocument } from "@stele/sdk";

const client = new SteleClient({ apiBaseUrl: "https://app.stele.example/api" });
const signer =
  PasskeySigner.remembered(client, organizationAddress) ??
  (await PasskeySigner.register({ client, organization: organizationAddress, recoveryKit: true })).signer;
await acceptDocument({ client, verified, signer, requestDomain: location.hostname });
```

### Managing signers from your server

| Method | Path | Scope | |
|---|---|---|---|
| GET | `/v1/signer-identities?externalUserRef=` | `signers:read` | Signers, their passkeys, recovery kits and rotation history |
| POST | `/v1/signer-identities/{publicKey}/revoke` | `signers:write` | `{ reason }` — retire a signer after the user lost every passkey **and** recovery kit, once you verified them. Their next signer is a **new** key, recorded as authorized by your account system (never control of the old key) |

```bash tab=cURL
curl "https://app.stele.example/api/v1/signer-identities?externalUserRef=user_12345" \
  -H "Authorization: Bearer $STELE_API_KEY"

curl "https://app.stele.example/api/v1/signer-identities/$PUBLIC_KEY/revoke" \
  -H "Authorization: Bearer $STELE_API_KEY" -H "Content-Type: application/json" \
  -d '{ "reason": "lost all devices; identity re-verified by support" }'
```

```ts tab=Node.js
const { signers } = await stele.listSigners("user_12345");
await stele.revokeSigner(signers[0].publicKey, "lost all devices; identity re-verified by support");
```

```python tab=Python
signers = stele("GET", "/signer-identities", params={"externalUserRef": "user_12345"})["signers"]
stele("POST", f"/signer-identities/{signers[0]['publicKey']}/revoke",
      json={"reason": "lost all devices; identity re-verified by support"})
```

```java tab=Java
JsonNode signers = Stele.get("/signer-identities", Map.of("externalUserRef", "user_12345"))
    .get("signers");
Stele.post("/signer-identities/" + signers.get(0).get("publicKey").asText() + "/revoke",
    Map.of("reason", "lost all devices; identity re-verified by support"));
```

```go tab=Go
var found struct {
	Signers []struct {
		PublicKey string `json:"publicKey"`
		Status    string `json:"status"`
	} `json:"signers"`
}
if err := stele("GET", "/signer-identities?externalUserRef=user_12345", nil, &found); err != nil {
	return err
}
var revoked map[string]any
err := stele("POST", "/signer-identities/"+found.Signers[0].PublicKey+"/revoke",
	map[string]string{"reason": "lost all devices; identity re-verified by support"}, &revoked)
if err != nil {
	return err
}
```

```php tab=PHP
$signers = stele('GET', '/signer-identities?externalUserRef=user_12345')['signers'];
stele('POST', "/signer-identities/{$signers[0]['publicKey']}/revoke", [
    'reason' => 'lost all devices; identity re-verified by support',
]);
```

```ruby tab=Ruby
signers = stele("GET", "/signer-identities?externalUserRef=user_12345")["signers"]
stele("POST", "/signer-identities/#{signers[0]["publicKey"]}/revoke",
      { reason: "lost all devices; identity re-verified by support" })
```

```csharp tab=C#
var signers = (await Stele(HttpMethod.Get, "/signer-identities?externalUserRef=user_12345"))
    .GetProperty("signers");
var publicKey = signers[0].GetProperty("publicKey").GetString();
await Stele(HttpMethod.Post, $"/signer-identities/{publicKey}/revoke",
    new { reason = "lost all devices; identity re-verified by support" });
```

## Proofs (purchases, refunds, consents…)

A **proof** records that a customer confirmed a statement: a purchase, a refund, a cancellation, a
consent, a quote acceptance… Types: `PURCHASE`, `SALE`, `ORDER`, `PAYMENT`, `RECEIPT`, `INVOICE`,
`REFUND`, `CANCELLATION`, `DELIVERY`, `RETURN`, `WARRANTY`, `SUBSCRIPTION_START`,
`SUBSCRIPTION_CANCEL`, `QUOTE_ACCEPTANCE`, `CONTRACT`, `CONSENT`, `POLICY_ACCEPTANCE`.

Only the statement's **salted SHA-256** goes on-chain. The statement itself (items, amounts, your
order reference) stays private to you and the customer, in the proof receipt.

```flow
Your server creates a proof request for the order
The customer sees the statement and confirms it with their wallet or passkey
The signed proof is recorded on Solana
Your server checks the proof before fulfilling
```

**1. Your server creates a request** (`proofs:write`):

```bash tab=cURL
curl https://app.stele.example/api/v1/proof-requests \
  -H "Authorization: Bearer $STELE_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "type": "PURCHASE",
    "reference": "order-1042",
    "summary": "Purchase of 2 items from Acme",
    "details": {
      "currency": "EUR",
      "items": [{ "sku": "MUG-1", "name": "Mug", "quantity": 2, "unitPrice": "9.00", "total": "18.00" }],
      "subtotal": "18.00", "shipping": "3.90", "total": "21.90"
    },
    "externalUserRef": "user_12345"
  }'
```

```ts tab=Node.js
const request = await stele.createProofRequest({
  type: "PURCHASE",
  reference: "order-1042",
  summary: "Purchase of 2 items from Acme",
  details: {
    currency: "EUR",
    items: [{ sku: "MUG-1", name: "Mug", quantity: 2, unitPrice: "9.00", total: "18.00" }],
    subtotal: "18.00",
    shipping: "3.90",
    total: "21.90",
  },
  externalUserRef: "user_12345",
});
// Send request.requestId and request.clientToken to the customer's browser
```

```python tab=Python
request = stele("POST", "/proof-requests", json={
    "type": "PURCHASE",
    "reference": "order-1042",
    "summary": "Purchase of 2 items from Acme",
    "details": {
        "currency": "EUR",
        "items": [{"sku": "MUG-1", "name": "Mug", "quantity": 2,
                   "unitPrice": "9.00", "total": "18.00"}],
        "subtotal": "18.00",
        "shipping": "3.90",
        "total": "21.90",
    },
    "externalUserRef": "user_12345",
})
# Send request["requestId"] and request["clientToken"] to the customer's browser
```

```java tab=Java
JsonNode request = Stele.post("/proof-requests", Map.of(
    "type", "PURCHASE",
    "reference", "order-1042",
    "summary", "Purchase of 2 items from Acme",
    "details", Map.of(
        "currency", "EUR",
        "items", java.util.List.of(Map.of("sku", "MUG-1", "name", "Mug", "quantity", 2,
            "unitPrice", "9.00", "total", "18.00")),
        "subtotal", "18.00",
        "shipping", "3.90",
        "total", "21.90"),
    "externalUserRef", "user_12345"));
// Send requestId and clientToken to the customer's browser
String requestId = request.get("requestId").asText();
```

```go tab=Go
var request struct {
	RequestID   string `json:"requestId"`
	ClientToken string `json:"clientToken"`
	ConfirmURL  string `json:"confirmUrl"`
}
err := stele("POST", "/proof-requests", map[string]any{
	"type":      "PURCHASE",
	"reference": "order-1042",
	"summary":   "Purchase of 2 items from Acme",
	"details": map[string]any{
		"currency": "EUR",
		"items": []map[string]any{{"sku": "MUG-1", "name": "Mug", "quantity": 2,
			"unitPrice": "9.00", "total": "18.00"}},
		"subtotal": "18.00",
		"shipping": "3.90",
		"total":    "21.90",
	},
	"externalUserRef": "user_12345",
}, &request)
if err != nil {
	return err
}
// Send request.RequestID and request.ClientToken to the customer's browser
```

```php tab=PHP
$request = stele('POST', '/proof-requests', [
    'type' => 'PURCHASE',
    'reference' => 'order-1042',
    'summary' => 'Purchase of 2 items from Acme',
    'details' => [
        'currency' => 'EUR',
        'items' => [['sku' => 'MUG-1', 'name' => 'Mug', 'quantity' => 2,
                     'unitPrice' => '9.00', 'total' => '18.00']],
        'subtotal' => '18.00',
        'shipping' => '3.90',
        'total' => '21.90',
    ],
    'externalUserRef' => 'user_12345',
]);
// Send $request['requestId'] and $request['clientToken'] to the customer's browser
```

```ruby tab=Ruby
request = stele("POST", "/proof-requests", {
  type: "PURCHASE",
  reference: "order-1042",
  summary: "Purchase of 2 items from Acme",
  details: {
    currency: "EUR",
    items: [{ sku: "MUG-1", name: "Mug", quantity: 2, unitPrice: "9.00", total: "18.00" }],
    subtotal: "18.00",
    shipping: "3.90",
    total: "21.90",
  },
  externalUserRef: "user_12345",
})
# Send request["requestId"] and request["clientToken"] to the customer's browser
```

```csharp tab=C#
var request = await Stele(HttpMethod.Post, "/proof-requests", new
{
    type = "PURCHASE",
    reference = "order-1042",
    summary = "Purchase of 2 items from Acme",
    details = new
    {
        currency = "EUR",
        items = new[] { new { sku = "MUG-1", name = "Mug", quantity = 2, unitPrice = "9.00", total = "18.00" } },
        subtotal = "18.00",
        shipping = "3.90",
        total = "21.90",
    },
    externalUserRef = "user_12345",
});
// Send requestId and clientToken to the customer's browser
var requestId = request.GetProperty("requestId").GetString();
```

```json
{
  "requestId": "1d4c…",
  "clientToken": "stlp_…",
  "statementHash": "6760…",
  "statement": { "format": "stele-statement-v1", "type": "PURCHASE", "...": "…", "salt": "…" },
  "expiresAt": "2026-10-04T11:00:00.000Z",
  "confirmUrl": "https://app.stele.example/confirm/1d4c…#token=stlp_…"
}
```

Amounts are decimal strings; totals must add up (`400 invalid_totals` otherwise). Put personal data
only as commitments (`{ "commitment": "sha256:…" }`, see `commit()` in `@stele/protocol`). The
`clientToken` lets one browser see and confirm this statement: give it only to that customer.

**2. The customer confirms.** Send them to `confirmUrl`, or embed the confirmation on your page:

```html
<div data-stele-proof-request="1d4c…" data-stele-proof-token="stlp_…"></div>
<script src="https://app.stele.example/sdk/v1/stele.js" defer></script>
<script>
  document.addEventListener("stele:confirmed", (event) => {
    // event.detail.proofId: tell your server, which checks it (step 3)
  });
</script>
```

The widget shows the statement only after checking, in the browser, that it hashes to the value the
customer will sign.

**3. Your server checks** before fulfilling (never trust the browser event alone):

```bash tab=cURL
curl "https://app.stele.example/api/v1/proofs?type=PURCHASE&reference=order-1042" \
  -H "Authorization: Bearer $STELE_API_KEY"

# The receipt, verified against Solana (contains the statement: keep it private)
curl "https://app.stele.example/api/v1/proofs/$PROOF_ID/receipt" \
  -H "Authorization: Bearer $STELE_API_KEY"
```

```ts tab=Node.js
const { proofs } = await stele.listProofs({ type: "PURCHASE", reference: "order-1042" });
const proof = proofs.find((p) => p.externalUserRef === "user_12345");
if (!proof) throw new Error("Not confirmed yet");
const { receipt, report } = await stele.getProofReceipt(proof.proofId); // verified against Solana
```

```python tab=Python
proofs = stele("GET", "/proofs", params={"type": "PURCHASE", "reference": "order-1042"})["proofs"]
proof = next((p for p in proofs if p["externalUserRef"] == "user_12345"), None)
if proof is None:
    raise RuntimeError("not confirmed yet")
receipt = stele("GET", f"/proofs/{proof['proofId']}/receipt")  # {receipt, report}
```

```java tab=Java
JsonNode proofs = Stele.get("/proofs", Map.of("type", "PURCHASE", "reference", "order-1042"))
    .get("proofs");
JsonNode proof = null;
for (JsonNode p : proofs) {
  if ("user_12345".equals(p.get("externalUserRef").asText())) proof = p;
}
if (proof == null) throw new IllegalStateException("not confirmed yet");
JsonNode receipt = Stele.get("/proofs/" + proof.get("proofId").asText() + "/receipt");
```

```go tab=Go
var found struct {
	Proofs []struct {
		ProofID         string  `json:"proofId"`
		ExternalUserRef *string `json:"externalUserRef"`
	} `json:"proofs"`
}
if err := stele("GET", "/proofs?type=PURCHASE&reference=order-1042", nil, &found); err != nil {
	return err
}
proofID := ""
for _, p := range found.Proofs {
	if p.ExternalUserRef != nil && *p.ExternalUserRef == "user_12345" {
		proofID = p.ProofID
	}
}
if proofID == "" {
	return errors.New("not confirmed yet")
}
var receipt map[string]any // {receipt, report}
if err := stele("GET", "/proofs/"+proofID+"/receipt", nil, &receipt); err != nil {
	return err
}
```

```php tab=PHP
$proofs = stele('GET', '/proofs?type=PURCHASE&reference=order-1042')['proofs'];
$matches = array_filter($proofs, fn ($p) => $p['externalUserRef'] === 'user_12345');
if (!$matches) {
    throw new RuntimeException('not confirmed yet');
}
$receipt = stele('GET', '/proofs/' . reset($matches)['proofId'] . '/receipt');
```

```ruby tab=Ruby
proofs = stele("GET", "/proofs?type=PURCHASE&reference=order-1042")["proofs"]
proof = proofs.find { |p| p["externalUserRef"] == "user_12345" } or raise "not confirmed yet"
receipt = stele("GET", "/proofs/#{proof["proofId"]}/receipt") # {receipt, report}
```

```csharp tab=C#
var proofs = (await Stele(HttpMethod.Get, "/proofs?type=PURCHASE&reference=order-1042"))
    .GetProperty("proofs").EnumerateArray();
var proof = proofs.FirstOrDefault(p => p.GetProperty("externalUserRef").GetString() == "user_12345");
if (proof.ValueKind == JsonValueKind.Undefined) throw new InvalidOperationException("not confirmed yet");
var receipt = await Stele(HttpMethod.Get, $"/proofs/{proof.GetProperty("proofId").GetString()}/receipt");
```

| Method | Path | Auth | |
|---|---|---|---|
| POST | `/v1/proof-requests` | `proofs:write` | Create a statement to confirm |
| GET | `/v1/proof-requests/{id}` | `x-proof-token` | The statement and its human-readable lines |
| POST | `/v1/proof-requests/{id}/challenge` | client token | `{ token, signer, signerType }` → the anchor message to sign |
| POST | `/v1/proof-requests/{id}/submit` | client token | `{ token, clientBinding, signature, passkeyAssertion? }` → `{ proofId, transactionSignature }` |
| GET | `/v1/proof-requests/{id}/receipt` | `x-proof-token` | The `stele-proof-v1` receipt, verified against Solana |
| GET | `/v1/proofs` | `proofs:read` | Your proofs, newest first: `type`, `reference`, `externalUserRef`, `limit`, `cursor` |
| GET | `/v1/proofs/{proofId}` | `proofs:read` | One proof with its statement and signer evidence |
| GET | `/v1/proofs/{proofId}/receipt` | `proofs:read` | The receipt |

Proof receipts contain the statement, so Stele serves them only with your API key or the customer's
client token — proof IDs alone are public on-chain and are not enough.

## Fees (the user never pays)

Every recording is relayed and paid by Stele's relayer; users never need SOL.

**Credits.** Each organization records a number of acceptances and proofs free every month (shown
on **Pricing** and **Dashboard → Billing**). Beyond that, each recording uses one prepaid credit,
whoever pays the network fee. Owners and admins buy credits under **Billing**: their wallet pays SOL
straight to Stele's treasury address, with the invoice's reference in the transfer, and Stele adds
the credits once it finds that payment on Solana. Credits never expire. When neither free recordings
nor credits are left, signing requests are refused **before** anyone signs (`402
credits_exhausted`).

| Method | Path | Auth | |
|---|---|---|---|
| GET | `/v1/billing` | public | Free recordings per month, credit packs (`credits`, `lamports`), treasury address and network |
| GET | `/v1/organizations/{orgId}/billing` | dashboard session | This month's usage, credit balance and purchases |

**Who absorbs the network fee** is chosen under **Dashboard → Signing & fees**:

- **Stele sponsors** (default) — the relayer pays and absorbs it;
- **Your organization sponsors** — fund your nonce shard (its address is the deposit address; no
  private key exists for it). The program reimburses the relayer the exact network fee of each valid
  recording from it, capped per record and per day, on-chain. Admins can pause and lower limits; only
  the owner raises limits, resumes or withdraws. With **Fall back to Stele** off, requests are refused
  (`402 sponsorship_unavailable`) while your shard cannot pay.

| Method | Path | Auth | |
|---|---|---|---|
| GET | `/v1/organizations/{orgId}/sponsorship` | dashboard session | Mode, sponsored shards (balance, limits, estimated recordings), fee history |

Measured on a local validator: a recording costs **10,000 lamports (0.00001 SOL)** without a priority
fee — about 100,000 recordings per SOL, the same for wallet and passkey signers, acceptances and proofs.
`submit` responses and webhooks report `fee: { payer, lamports, sponsor, reimbursedLamports }`.

## Evidence modes (direct or Merkle-batched)

| Mode | How each acceptance is anchored | Cost per acceptance (measured) | Use when |
|---|---|---|---|
| `DIRECT_ONCHAIN` (default) | Its own transaction; the program verifies the signature, consumes the nonce and emits an event | 10,000 lamports | Other Solana programs must read acceptances; you want per-acceptance on-chain verification |
| `MERKLE_BATCHED` | Stele verifies the signature off-chain, then anchors the Merkle root of many acceptances in one transaction (every 10 s, up to 1,024) | 5,000 lamports ÷ batch size | High volume |

Set it with `PATCH /v1/organizations/{orgId}/settings` `{ "evidenceMode": "MERKLE_BATCHED" }`
(dashboard session, admin). In batched mode the submit response is `status: "pending_batch"`; the
`agreement.accepted` webhook follows when the batch is anchored and carries the acceptance's full
`evidence` (keep it: with the anchor transaction it proves the acceptance without Stele). Receipts are
`stele-receipt/2` with `evidenceMode: "MERKLE_BATCHED"` and the inclusion proof. Every anchored
batch's manifest — each leaf's evidence — is public:

| Method | Path | |
|---|---|---|
| GET | `/v1/public/batches/{root}` | The `stele-batch-manifest/1` of an anchored batch (hash-addressed in the content store; header `x-batch-transaction`) |

What changes in batched mode: the chain proves that the root existed at its slot; each signature is
verified by every verifier rather than by the program; nonces are not consumed on-chain (re-recording
the same signed acceptance yields the same ID). See PROTOCOL_SPEC.md §17.9.

## Webhooks

Stele can notify your server when something happens. Set up an endpoint under **Integrations → Add
endpoint** (HTTPS, public address) and choose its events; the signing secret is shown once.
[Get started → Webhooks](get-started.md#9-webhooks) has ready-to-use handlers in every language.

**Every delivery** is a `POST` with these headers: `stele-event`, `stele-event-id`,
`stele-delivery-id`, `stele-signature`, `user-agent: Stele-Webhooks/1.0`. The body:

```json
{
  "id": "evt_…",
  "type": "agreement.accepted",
  "createdAt": "2026-10-03T10:24:23.500Z",
  "organizationId": "e0b1e582-0f5e-460d-905a-d407bbbc0fb6",
  "data": {
    "acceptanceId": "4ba3b02722d744452be1a9837020dba10691cded7df67c332a3aa4c1527ccf05",
    "transactionSignature": "4Gv4TkZKnWS7gsSDpo9Uv9kWgCp1oo2A3kfk67mZW8KTgB8gMkHNyZfJjQQLNUoKBeE97S77EpjUeqNrUJBo5mi9",
    "slot": 11989,
    "commitment": "confirmed",
    "signer": "ALrq9rvr887kHwCZET78P5HeGzwAxj52DgdzRZdiqAxV",
    "signerType": "wallet",
    "document": "Hm77xC4schJ1o4eeZhniXBqKRaGfVhU25DYRiF9VX7YT",
    "documentSlug": "terms-of-service",
    "version": "S7b7qpR354RyU3jFFi32PC7BMyUREdB6jviKdef2SJf",
    "versionNumber": 3,
    "externalUserRef": "user_12345",
    "receiptUrl": "https://app.stele.example/receipt/4ba3b02722d744452be1a9837020dba10691cded7df67c332a3aa4c1527ccf05",
    "verify": "Verify independently: the transaction signature and acceptance ID are sufficient. Do not treat this webhook as proof."
  }
}
```

| Event | `data` |
|---|---|
| `agreement.accepted` | `acceptanceId`, `transactionSignature`, `slot`, `commitment`, `signer` (base58 or `p256:…`), `signerType` (`wallet` / `passkey_p256` / `passkey`), `protocol`, `fee`, `document`, `documentSlug`, `version`, `versionNumber`, `externalUserRef`, `receiptUrl`; batched mode adds `evidenceMode` and the leaf's `evidence` |
| `agreement.finalized` | `acceptanceId`, `transactionSignature`, `slot`, `commitment` (`finalized`) |
| `document.version_published` | `document`, `version`, `versionNumber`, `versionLabel`, `fingerprint`, `contentHash`, `transactionSignature`, `publisher` |
| `organization.domain_verified` | `domain`, `attestationTransaction`, `expiresAt` |
| `organization.member_changed` | `member`, `memberAccount`, `roles` (`admin`, `publisher`), `active`, `compromisedSince`, `change` (`added`, `updated`, `revoked`, `compromise_reported`) |
| `proof.recorded` | `proofId`, `type`, `reference`, `statementHash`, `transactionSignature`, `slot`, `signer`, `signerType`, `externalUserRef`, `fee` |
| `signer.registered` / `signer.changed` | `signer` (public key or `p256:…`), `change` (`registered`, `passkey_added`, `recovery_kit_added`, `passkey_revoked`, `revoked`, `rotated`, `recovery_requested`, and for on-chain enrollments `enroll`, `rotate`, `recover`, `revoke`), `externalUserRef`, `enrollment`, `rotation`, `transactionSignature` |
| `sponsorship.low_balance` | `nonceShard`, `depositAddress`, `spendableLamports`, `thresholdLamports`, `estimatedRecordsLeft` |
| `webhook.test` | `message`: sent by the **Test** button in the dashboard |

`agreement.accepted` arrives as soon as the transaction is confirmed; act on it. `agreement.finalized`
follows when Solana finalizes it, typically within seconds.

**Verifying signatures.** `stele-signature: t=<unix seconds>,v1=<hex>`, where `v1` is
`HMAC-SHA256(secret, "<t>.<raw body>")` keyed with the whole secret (`whsec_…`, as UTF-8 bytes):

1. Read the **raw** request body: the signature covers the exact bytes, not re-serialized JSON.
2. Compute the HMAC and compare it with `v1` in constant time.
3. Reject `t` more than 5 minutes from your clock (replays).
4. Reply with any `2xx` within 10 seconds, and de-duplicate on the event `id`: deliveries can repeat.

**Retries.** A delivery that fails (no `2xx` within 10 seconds, or a connection error) is retried
after 1 minute, 5 minutes, 15 minutes, then 1, 2, 4, 8, 12 and 24 hours: up to 10 attempts over about
two days. Redirects are not followed. The dashboard shows each endpoint's delivery log and lets you
test, disable or re-enable it, and rotate its secret.

> [!IMPORTANT]
> A webhook is a notification, not the cryptographic evidence itself. The evidence is the Solana
> transaction it names: verify it (for example with `@stele/verifier`) before relying on it in a
> dispute.

## Errors

Every error has the same shape:

```json
{
  "error": {
    "code": "not_found",
    "message": "Document not found"
  }
}
```

Branch on `code`, never on `message` (its wording may change). The most common:

| Status | Meaning | What to do |
|---|---|---|
| 400 | Invalid request: `message` names the field | Fix the request; don't retry it unchanged |
| 401 | API key missing or invalid | Send `Authorization: Bearer <key>`; check that the key was not revoked or expired |
| 402 | No free recordings or credits left (`credits_exhausted`), or your sponsorship cannot pay (`sponsorship_unavailable`) | Buy credits under **Billing**, or adjust your [sponsorship](#fees-the-user-never-pays) |
| 403 | Not allowed: missing scope, site not on **Allowed requesting sites**, a session is required, or a fresh signature is required (`reauthentication_required`) | Read `message`; adjust the key, policy or session |
| 404 | Not found, including resources of other organizations | Check the slug, address or ID |
| 409 | Conflicting state, for example `no_published_version` or `challenge_expired` | Publish a version, or start the signing again |
| 422 | `idempotency_key_reused`, or `verification_failed` for a receipt that did not verify | Use a new idempotency key; check the evidence |
| 429 | Rate limited | Wait for the `retry-after` header (seconds), then retry |
| 5xx | Temporary failure | Retry with backoff; use an [idempotency key](#idempotency) on `POST` |

All codes:

| Status | Codes |
|---|---|
| 400 | `invalid_request` (schema validation), `invalid_address`, `invalid_signer`, `invalid_content`, `invalid_domain`, `invalid_signature`, `invalid_origin`, `invalid_url`, `invalid_effective_date`, `invalid_idempotency_key`, `invalid_cursor`, `missing_binding`, `not_a_publication`, `passkey_required`, `passkey_assertion_required`, `invalid_passkey_assertion`, `invalid_registration`, `invalid_endorsement`, `invalid_statement`, `invalid_ceremony`, `invalid_wrapped_key`, `invalid_rotation`, `invalid_totals`, `invalid_pack`, `missing_token`, `unsupported_algorithm`, `unsupported_signer`, `not_account_bound`, `native_passkey`, `missing_identity` |
| 401 | `unauthorized` |
| 402 | `credits_exhausted`, `sponsorship_unavailable` — returned before the user signs |
| 403 | `forbidden`, `reauthentication_required` |
| 404 | `not_found` |
| 409 | `no_published_version`, `chain_state`, `challenge_expired`, `challenge_not_open`, `domain_expiring`, `domain_already_verified`, `draft_published`, `draft_closed`, `transaction_failed`, `identity_exists`, `passkey_exists`, `kit_exists`, `proof_request_closed`, `proof_request_expired`, `not_recorded`, `billing_unavailable`, `payment_not_found`, `version_superseded`, `pending_batch`, `enrollment_mismatch` |
| 422 | `idempotency_key_reused`, `verification_failed` |
| 429 | `rate_limited`, `too_many_open_challenges`, `enrollment_limit` |
| 500 | `internal_error`: details are logged by Stele, never returned |
| 502 | `relay_failed` (Solana rejected the acceptance; the message says why), `relay_inconsistent` |
| 503 | `no_acceptance_capacity` (no active acceptance shard), `nonce_unavailable` |

## Pagination

List endpoints (`/v1/acceptances`, `/v1/proofs`) return the newest records first, `limit` per page
(1–200, default 50), and `nextCursor`. Pass it unchanged as `cursor` to get the next page; it is
`null` on the last page. Cursors are opaque: records that share a slot are never skipped or repeated,
and records added while you page do not shift the pages you have not read yet. The
[list sample](#list-acceptances) shows the loop in every language.

## Rate limits

300 requests per minute per IP address. Stricter limits apply to sign-in (20 per minute), acceptance
challenges and submissions (30 per minute) and DNS checks (10 per minute). Every response carries
`x-ratelimit-limit`, `x-ratelimit-remaining` and `x-ratelimit-reset` (seconds); a limited request
returns `429 rate_limited` with a `retry-after` header.

## Idempotency

Send `Idempotency-Key: <1–255 printable ASCII characters>` on any authenticated `POST`, `PATCH`,
`PUT` or `DELETE` to make retries safe. The first response is stored for 24 hours, encrypted, and
scoped to the caller; a retry with the same key and the same request receives the same response, with
the header `idempotent-replayed: true`. Reusing a key for a different request returns `422
idempotency_key_reused`. Server errors (5xx) are not stored, so a retry is processed again.

```bash
curl https://app.stele.example/api/v1/proof-requests \
  -H "Authorization: Bearer $STELE_API_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-1042-purchase" \
  -d @proof-request.json
```

Use an ID from your own system (such as the order number) as the key.

## Organization management

The dashboard uses these endpoints with the signed-in wallet's session. They are documented for
completeness; integrations normally use the endpoints above.

| Area | Endpoints |
|---|---|
| Session | `POST /v1/auth/challenge`, `POST /v1/auth/verify`, `POST /v1/auth/logout`, `GET /v1/auth/me` |
| Organizations | `GET /v1/organizations`, `POST /v1/organizations/sync`, `GET /v1/organizations/{orgId}`, `POST /v1/organizations/{orgId}/refresh`, `PATCH /v1/organizations/{orgId}/settings`, `PATCH /v1/organizations/{orgId}/members/{address}` (label only) |
| Capacity | `POST /v1/organizations/{orgId}/shards/sync` |
| Domains | `POST /v1/organizations/{orgId}/domains`, `POST …/domains/{id}/check`, `POST …/domains/{id}/revoke` |
| Documents | `GET /v1/organizations/{orgId}/documents`, `POST /v1/organizations/{orgId}/documents/sync`, `GET /v1/documents/{documentId}` |
| Drafts & publishing | `POST /v1/documents/{documentId}/drafts`, `GET`, `PATCH /v1/drafts/{draftId}`, `POST /v1/drafts/{draftId}/abandon`, `POST /v1/drafts/{draftId}/prepare`, `POST /v1/publications/confirm` |
| Acceptances | `GET /v1/organizations/{orgId}/acceptances`, `GET /v1/organizations/{orgId}/stats` |
| Signing & fees | `GET /v1/organizations/{orgId}/sponsorship` |
| Billing | `GET /v1/organizations/{orgId}/billing`, `POST …/billing/invoices` (`{ pack }` → amount, treasury, reference), `POST …/billing/invoices/{id}/confirm` (`{ signature? }`; credits once the payment is found on-chain) |
| API keys | `GET`, `POST /v1/organizations/{orgId}/api-keys`, `DELETE …/api-keys/{keyId}` |
| Webhooks | `GET`, `POST /v1/organizations/{orgId}/webhooks`, `PATCH`, `DELETE …/webhooks/{id}`, `POST …/{id}/rotate-secret`, `POST …/{id}/test`, `GET …/{id}/deliveries` |
| Audit log | `GET /v1/organizations/{orgId}/audit-log`, `GET …/audit-log/verify` |

- **Sign-in** uses a Sign-In With Solana message naming the app, its URI and network, with a single-use
  nonce valid for 10 minutes. It authorizes nothing on-chain.
- **CSRF:** cookie-authenticated `POST`, `PATCH`, `PUT` and `DELETE` requests must come from the app's
  origin and carry the `x-csrf-token` header (the `stele_csrf` cookie's value).
- **Fresh signature:** creating API keys, adding webhooks, rotating webhook secrets, changing the
  acceptance policy and revoking a domain require a wallet signature within the last 10 minutes;
  otherwise `403 reauthentication_required`.
- The API never writes to Solana for you. Organizations, documents, versions and shards are created
  by your wallet; `sync`, `refresh` and `confirm` make the API read the result from Solana.

## Verifier

`@stele/verifier` checks evidence directly against Solana, with no Stele server involved:

```ts
import { chainFromUrls, verifyAcceptance } from "@stele/verifier";

const report = await verifyAcceptance(
  { transactionSignature: "4Gv4TkZK…" },
  { chain: chainFromUrls(["https://rpc-one.example", "https://rpc-two.example"]) },
);
console.log(report.verdict); // "VALID" | "VALID_WITH_WARNINGS" | "INVALID" | "INCONCLUSIVE"
```

From any language, run its command and read the exit code (`0` valid, `1` valid with warnings, `2`
invalid, `3` inconclusive) or its JSON report (`--json`). See [Verification](verification.md).
