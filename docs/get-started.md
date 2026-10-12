# Get started

Add verifiable Terms acceptance to your site in a few minutes.

Your visitors read your Terms on your own page and sign them — with a Solana wallet, or with a
**passkey** (Face ID, fingerprint, device PIN) if they have no wallet. Stele records the acceptance on
Solana, and your app receives a confirmation it can check. Your visitors never pay a network fee.

```flow
You publish your Terms in the Stele dashboard
You add the Stele widget to your page
Your visitor connects a wallet or uses a passkey
Your visitor signs the exact version they read
The acceptance is recorded on Solana
Your server confirms it with Stele
```

> [!NOTE]
> Highlighted values such as `acme.com` are placeholders: replace them with your own. Addresses
> such as `https://app.stele.example` are this Stele app's own: copy them as they are. Server samples
> come in cURL, Node.js, Python, Java, Go, PHP, Ruby and C#; pick yours on any sample.

## 5-minute integration

**1. Publish your Terms.** In the dashboard: **Documents → New document**, then publish the first
version (details in [step 2](#2-publish-your-terms)).

**2. Paste this into your page.**

```html
<div
  data-stele-organization="acme.com"
  data-stele-document="terms-of-service"
></div>

<script src="https://app.stele.example/sdk/v1/stele.js" defer></script>
```

**3. Open your page.** Stele handles the rest:

- loading the document and checking it against Solana
- finding and connecting the visitor's wallet, or creating their passkey signer
- asking for the signature
- recording the acceptance
- showing a receipt

Need to know **which of your users** accepted? Continue with
[step 7](#7-verify-acceptance-on-your-server).

## Before you start

- **A Solana wallet** to sign in to the dashboard, such as Phantom, Solflare or Backpack
- **A Stele organization** (step 1) and **a published document** (step 2)
- Two values from the dashboard: your **organization** (verified domain or organization address)
  and your **document slug**
- For server-side checks (optional): an **API key** and a backend in any language

Your visitors need a Solana wallet **or** a device with passkeys (if you allow them in **Signing &
fees**), and never any SOL.

## 1. Create your organization

1. Open the dashboard and **connect your wallet**. You sign a short message that proves you control
   it; this signs nothing on-chain and moves no funds.
2. Enter your organization name and click **Create organization**. Your wallet signs one
   transaction, which creates your organization on Solana and enables acceptances. On test networks
   the page offers **Request test SOL** to pay for it.
3. **Verify your domain** (recommended): **Organization → Verified domain → Start verification**.
   Add the DNS `TXT` record shown, then click **Check DNS & attest**.

Without a verified domain, visitors see "Unverified organization". With one, they see your domain
with a check mark, both in the widget and in their wallet's signing prompt.

## 2. Publish your Terms

1. Go to **Documents → New document**.
2. Choose the **document type**, a **slug** (for example `terms-of-service`) and the **language**,
   then click **Create on Solana** and confirm in your wallet.
3. The editor for the first version opens. Enter a **title**, a **version label** (for example `1.0`)
   and the **document text**, then click **Create draft**.
4. Check the fingerprint shown, click **Sign & publish** and confirm in your wallet.

After publishing:

- that version is **permanent**: nobody can edit or delete it, including you and Stele
- to change your Terms, click **New version** on the document page and publish it; visitors are
  always shown the latest version

Note the two values you need for the next step:

| | Example | Where to find it |
|---|---|---|
| **Organization** | `acme.com` | Your verified domain, or the organization address (Organization page) |
| **Document slug** | `terms-of-service` | The slug you chose; shown on the document page |

> [!TIP]
> Each document page in the dashboard has an **Embed on your site** panel with the snippet below,
> already filled in with your values.

## 3. Add Stele to your website

Put the widget where the Terms should appear. With a plain page, the script tag is all you need;
apps that bundle their JavaScript install `@stelehq/sdk` (`npm install @stelehq/sdk`).

```html tab=HTML
<div
  data-stele-organization="acme.com"
  data-stele-document="terms-of-service"
></div>

<script src="https://app.stele.example/sdk/v1/stele.js" defer></script>
```

```tsx tab=React
"use client"; // Next.js App Router only

import { TermsAcceptance } from "@stelehq/sdk/react";

export function Terms() {
  return (
    <TermsAcceptance
      apiBaseUrl="https://app.stele.example/api"
      appUrl="https://app.stele.example"
      organization="acme.com"
      document="terms-of-service"
    />
  );
}
```

```js tab=JavaScript
import { mount } from "@stelehq/sdk";

mount(document.querySelector("#terms"), {
  apiBaseUrl: "https://app.stele.example/api",
  appUrl: "https://app.stele.example",
  organization: "acme.com",
  document: "terms-of-service",
});
```

Change only `acme.com` (your organization) and `terms-of-service` (your document slug). Themes,
styling, pinning and every other option: [SDK & API → Browser script](api.md#browser-script-stelejs).

### Complete example

Save this as `index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Terms of Service</title>
  </head>
  <body>
    <h1>Terms of Service</h1>

    <div
      data-stele-organization="acme.com"
      data-stele-document="terms-of-service"
    ></div>

    <button id="continue" disabled>Continue</button>

    <script src="https://app.stele.example/sdk/v1/stele.js" defer></script>
    <script>
      document.addEventListener("stele:accepted", (event) => {
        console.log("Accepted:", event.detail);
        document.querySelector("#continue").disabled = false;
      });

      document.addEventListener("stele:error", (event) => {
        console.warn("Stele:", event.detail.message);
      });
    </script>
  </body>
</html>
```

Serve the folder over HTTP. Wallet extensions do not run on `file://` pages, so double-clicking the
file is not enough:

```bash tab=Node.js
npx serve -l 8080 .
```

```bash tab=Python
python3 -m http.server 8080
```

```bash tab=PHP
php -S localhost:8080
```

Then open `http://localhost:8080`.

## 4. What your user sees

1. The Terms appear, with your organization and the document version.
2. Stele checks that the text is exactly the version published on Solana. If anything was changed,
   the document is not shown at all.
3. The user picks their wallet from the list (Phantom, Solflare, Backpack, or any other Solana wallet
   that supports the Wallet Standard) and connects it — or creates a passkey, if you allow it
   ([step 11](#11-no-wallet-passkeys)).
4. They tick **I have read and agree to the Terms of Service**.
5. They click **Accept & sign**. Their wallet shows the exact text being signed, including your
   organization, the version and your site's domain.
6. The acceptance is recorded on Solana. Stele, or your organization, pays the network fee — never
   the visitor.
7. They see **Accepted and recorded on Solana** with a link to their receipt.

Signing never moves funds and cannot approve a transaction. To learn what is checked and why, see
[How Stele works](how-it-works.md) and [What a signature proves](acceptance-signing.md).

## 5. Handle the acceptance in the browser

When an acceptance has been recorded, the widget tells your page:

```js tab=HTML
document.addEventListener("stele:accepted", (event) => {
  const { acceptanceId, transactionSignature } = event.detail;
  console.log("Accepted:", acceptanceId);
});

document.addEventListener("stele:error", (event) => {
  console.warn("Stele:", event.detail.message);
});
```

```tsx tab=React
<TermsAcceptance
  apiBaseUrl="https://app.stele.example/api"
  appUrl="https://app.stele.example"
  organization="acme.com"
  document="terms-of-service"
  onAccepted={(result) => console.log("Accepted:", result.acceptanceId)}
  onError={(error) => console.warn("Stele:", error.message)}
/>
```

```js tab=JavaScript
mount(document.querySelector("#terms"), {
  apiBaseUrl: "https://app.stele.example/api",
  appUrl: "https://app.stele.example",
  organization: "acme.com",
  document: "terms-of-service",
  onAccepted: (result) => console.log("Accepted:", result.acceptanceId),
  onError: (error) => console.warn("Stele:", error.message),
});
```

| Field | Meaning |
|---|---|
| `acceptanceId` | Stele's identifier for this acceptance (64 hex characters). Use it with the API and in receipt links |
| `transactionSignature` | The Solana transaction that recorded it. Anyone can look it up and verify it |
| `slot` | The Solana slot it was recorded in |
| `message` | The exact text the user signed |
| `receiptPath` | Path of the receipt page on your Stele app, for example `/receipt/<acceptanceId>` |
| `signerType` | `wallet` or `passkey` |

Errors, such as a document that cannot be verified or a failed recording, arrive as `stele:error`
(`onError`). If the user cancels in their wallet, nothing is recorded; the widget tells them and no
event is sent.

## 6. Don't trust the browser alone

The `stele:accepted` event is right for **updating your page**, for example enabling a "Continue"
button. Anyone can fake events in their own browser, though. For anything that matters (checkout,
creating an account, payments, access to a service), **check on your server** before you act:

- **Ask the Stele API** whether this user accepted the current version (steps 7 and 8), or
- **receive a webhook** from Stele when an acceptance is recorded (step 9).

## 7. Verify acceptance on your server

Create an API key under **API keys → Create key** with the scopes `acceptances:read`,
`acceptances:write` and `documents:read`. The key is shown **once**: store it in your server's
environment as `STELE_API_KEY`.

> [!WARNING]
> Never put API keys in browser or frontend code. Anyone who has the key can create sessions and
> read your organization's acceptances. Keep it on your server, in an environment variable or a
> secret manager.

Your base URL is `https://app.stele.example/api/v1`; each Solana network has its own
([SDK & API → Base URL](api.md#base-url)). Set up a small client once:

```bash tab=cURL
# Every cURL sample reads your key from this variable
export STELE_API_KEY="stl_live_…"
```

```ts tab=Node.js
// npm install @stelehq/sdk
import { SteleServerClient } from "@stelehq/sdk/server";

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

Now ask whether a user accepted the **current** version of a document: look up the current version,
then that user's acceptance of it. Step 8 shows how Stele knows who "the user" is.

```bash tab=cURL
# 1. The current version's address (jq extracts it)
VERSION=$(curl -s https://app.stele.example/api/v1/documents/by-slug/terms-of-service/latest \
  -H "Authorization: Bearer $STELE_API_KEY" | jq -r .version.address)

# 2. The user's acceptance of that version: an empty list means "not accepted yet"
curl "https://app.stele.example/api/v1/acceptances?externalUserRef=user_12345&version=$VERSION&limit=1" \
  -H "Authorization: Bearer $STELE_API_KEY"
```

```ts tab=Node.js
const acceptance = await stele.hasAcceptedLatest("user_12345", "terms-of-service");

if (acceptance) {
  // Accepted: acceptance.acceptanceId, acceptance.transactionSignature, acceptance.signer
} else {
  // Not accepted yet, or a newer version was published since
}
```

```python tab=Python
latest = stele("GET", "/documents/by-slug/terms-of-service/latest")
found = stele("GET", "/acceptances", params={
    "externalUserRef": "user_12345",
    "version": latest["version"]["address"],
    "limit": 1,
})

if found["acceptances"]:
    acceptance = found["acceptances"][0]  # acceptanceId, transactionSignature, signer…
else:
    pass  # Not accepted yet, or a newer version was published since
```

```java tab=Java
JsonNode latest = Stele.get("/documents/by-slug/terms-of-service/latest");
JsonNode found = Stele.get("/acceptances", Map.of(
    "externalUserRef", "user_12345",
    "version", latest.at("/version/address").asText(),
    "limit", 1));

if (found.get("acceptances").size() > 0) {
  JsonNode acceptance = found.get("acceptances").get(0); // acceptanceId, transactionSignature…
} else {
  // Not accepted yet, or a newer version was published since
}
```

```go tab=Go
var latest struct {
	Version struct {
		Address string `json:"address"`
	} `json:"version"`
}
if err := stele("GET", "/documents/by-slug/terms-of-service/latest", nil, &latest); err != nil {
	return err
}
query := url.Values{
	"externalUserRef": {"user_12345"},
	"version":         {latest.Version.Address},
	"limit":           {"1"},
}
var found struct {
	Acceptances []struct {
		AcceptanceID         string `json:"acceptanceId"`
		TransactionSignature string `json:"transactionSignature"`
	} `json:"acceptances"`
}
if err := stele("GET", "/acceptances?"+query.Encode(), nil, &found); err != nil {
	return err
}

if len(found.Acceptances) > 0 {
	fmt.Println("Accepted:", found.Acceptances[0].AcceptanceID)
} else {
	// Not accepted yet, or a newer version was published since
}
```

```php tab=PHP
$latest = stele('GET', '/documents/by-slug/terms-of-service/latest');
$found = stele('GET', '/acceptances?' . http_build_query([
    'externalUserRef' => 'user_12345',
    'version' => $latest['version']['address'],
    'limit' => 1,
]));

if ($found['acceptances']) {
    $acceptance = $found['acceptances'][0]; // acceptanceId, transactionSignature, signer…
} else {
    // Not accepted yet, or a newer version was published since
}
```

```ruby tab=Ruby
latest = stele("GET", "/documents/by-slug/terms-of-service/latest")
query = URI.encode_www_form(
  externalUserRef: "user_12345",
  version: latest["version"]["address"],
  limit: 1,
)
acceptance = stele("GET", "/acceptances?#{query}")["acceptances"].first

if acceptance
  # Accepted: acceptance["acceptanceId"], acceptance["transactionSignature"], …
else
  # Not accepted yet, or a newer version was published since
end
```

```csharp tab=C#
var latest = await Stele(HttpMethod.Get, "/documents/by-slug/terms-of-service/latest");
var version = latest.GetProperty("version").GetProperty("address").GetString();
var found = await Stele(HttpMethod.Get,
    $"/acceptances?externalUserRef={Uri.EscapeDataString("user_12345")}&version={version}&limit=1");

if (found.GetProperty("acceptances").GetArrayLength() > 0)
{
    var acceptance = found.GetProperty("acceptances")[0]; // acceptanceId, transactionSignature…
}
else
{
    // Not accepted yet, or a newer version was published since
}
```

> [!TIP]
> Did your page send you an `acceptanceId` from `stele:accepted`? Look it up with
> [`GET /v1/acceptances/{id}`](api.md#get-one-acceptance): Stele answers only for your
> organization's acceptances, and `externalUserRef` tells you whose it is.

## 8. Link acceptances to your users

A wallet address tells you **which wallet** signed. It does not tell Stele which account in **your**
app the wallet belongs to. To record that, your server creates a short-lived **acceptance session**
for the logged-in user and gives its token to the widget.

```flow
Your user is logged in to your app as user_12345
Your server creates an acceptance session for user_12345
Your server passes the session token to the page
The widget sends the token with the signing request
The user signs
Stele stores user_12345 with the acceptance (off-chain, never on Solana)
Your server asks: has user_12345 accepted the latest version?
```

`externalUserRef` is your own user ID, for example `user_12345`: up to 128 printable characters
without spaces. Don't use an email address; Stele doesn't need it.

**Backend:** create a session when you render the page (one per page view):

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

A session is valid for 15 minutes (`ttlSeconds`, up to 3600) and is used up by one acceptance.

**Frontend:** pass the token to the widget. A page rendered by your server writes it into the
element; a single-page app can instead hand the widget a function that fetches a fresh token from
your server when the user clicks **Accept & sign**:

```html tab=HTML
<div
  data-stele-organization="acme.com"
  data-stele-document="terms-of-service"
  data-stele-session="SESSION_TOKEN_FROM_YOUR_SERVER"
></div>
```

```tsx tab=React
<TermsAcceptance
  apiBaseUrl="https://app.stele.example/api"
  appUrl="https://app.stele.example"
  organization="acme.com"
  document="terms-of-service"
  sessionToken={() => fetch("/stele/session").then((r) => r.text())}
/>
```

```js tab=JavaScript
mount(document.querySelector("#terms"), {
  apiBaseUrl: "https://app.stele.example/api",
  appUrl: "https://app.stele.example",
  organization: "acme.com",
  document: "terms-of-service",
  sessionToken: () => fetch("/stele/session").then((r) => r.text()),
});
```

(`/stele/session` stands for a route of yours that requires login and returns a new `sessionToken`.
With the script tag, `Stele.mount("#terms", { … })` takes the same options.)

**Later:** check on your server with the code from [step 7](#7-verify-acceptance-on-your-server),
for the logged-in user's ID.

### When your Terms change

The check in step 7 answers for the **latest published version only**. As soon as you publish a new
version, it finds nothing for every user until they accept that version:

| | Terms v1 | You publish Terms v2 | User accepts v2 |
|---|---|---|---|
| Step 7 check | acceptance of v1 | nothing | acceptance of v2 |
| Your app | allow access | ask the user to accept again | allow access |

The widget always shows the latest version, so showing it again is all it takes to ask for a new
acceptance. Earlier acceptances stay on Solana as evidence of what the user agreed to at the time.

> [!TIP]
> To make sessions mandatory, so nobody can collect acceptances for your organization without your
> server, enable **Organization → Acceptance policy → Require acceptance sessions**.

## 9. Webhooks

Use webhooks if you want Stele to notify your backend automatically.

1. Create an endpoint on your server (below).
2. In the dashboard: **Integrations → Add endpoint**. Enter its HTTPS URL and choose the events.
3. Copy the **signing secret** (shown once) into your server's environment as
   `STELE_WEBHOOK_SECRET`.

| Event | Sent when |
|---|---|
| `agreement.accepted` | An acceptance was recorded and confirmed on Solana. Act on it right away |
| `agreement.finalized` | The same transaction reached *finalized* status, Solana's strongest guarantee, typically seconds later |

Each handler verifies the `Stele-Signature` header over the **raw** body (re-serialized JSON would
not match), rejects deliveries older than 5 minutes, and replies `204` within 10 seconds:

```ts tab=Node.js
import express from "express";
import { verifyWebhook } from "@stelehq/sdk/server";

const app = express();

// Use the raw body: the signature covers the exact bytes Stele sent.
app.post("/webhooks/stele", express.raw({ type: "application/json" }), (req, res) => {
  let event;
  try {
    event = verifyWebhook(process.env.STELE_WEBHOOK_SECRET!, req.header("stele-signature"), req.body);
  } catch {
    return res.sendStatus(400); // not from Stele, or too old (replay)
  }

  if (event.type === "agreement.accepted") {
    const { acceptanceId, externalUserRef, versionNumber } = event.data;
    // Mark externalUserRef as having accepted version versionNumber.
  }

  res.sendStatus(204);
});

app.listen(4242);
```

```python tab=Python
# pip install flask
import hashlib
import hmac
import json
import os
import time

from flask import Flask, abort, request

app = Flask(__name__)
SECRET = os.environ["STELE_WEBHOOK_SECRET"].encode()


def verify_webhook(header, body, tolerance=300):
    """Checks Stele-Signature (t=<unix seconds>,v1=<hex>) and returns the event."""
    parts = dict(p.strip().split("=", 1) for p in (header or "").split(",") if "=" in p)
    t, v1 = parts.get("t", ""), parts.get("v1", "")
    if not t.isdigit() or abs(time.time() - int(t)) > tolerance:
        raise ValueError("missing or stale timestamp")
    expected = hmac.new(SECRET, f"{t}.".encode() + body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, v1):
        raise ValueError("invalid signature")
    return json.loads(body)


@app.post("/webhooks/stele")
def stele_webhook():
    try:
        event = verify_webhook(request.headers.get("Stele-Signature"), request.get_data())
    except ValueError:
        abort(400)  # not from Stele, or too old (replay)

    if event["type"] == "agreement.accepted":
        data = event["data"]
        # Mark data["externalUserRef"] as having accepted version data["versionNumber"].

    return "", 204
```

```java tab=Java
// Spring Boot (spring-boot-starter-web)
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class SteleWebhookController {
  private static final byte[] SECRET =
      System.getenv("STELE_WEBHOOK_SECRET").getBytes(StandardCharsets.UTF_8);
  private static final ObjectMapper JSON = new ObjectMapper();

  @PostMapping("/webhooks/stele")
  public ResponseEntity<Void> receive(
      @RequestHeader(value = "Stele-Signature", required = false) String signature,
      @RequestBody byte[] body) throws Exception {
    if (!verify(signature, body)) {
      return ResponseEntity.badRequest().build(); // not from Stele, or too old (replay)
    }
    JsonNode event = JSON.readTree(body);
    if ("agreement.accepted".equals(event.get("type").asText())) {
      JsonNode data = event.get("data");
      // Mark data.externalUserRef as having accepted version data.versionNumber.
    }
    return ResponseEntity.noContent().build();
  }

  /** Stele-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">, at most 5 minutes old. */
  static boolean verify(String header, byte[] body) throws Exception {
    if (header == null) return false;
    String t = null;
    String v1 = null;
    for (String part : header.split(",")) {
      String[] kv = part.trim().split("=", 2);
      if (kv.length == 2 && kv[0].equals("t")) t = kv[1];
      if (kv.length == 2 && kv[0].equals("v1")) v1 = kv[1];
    }
    if (t == null || v1 == null || !t.matches("\\d{1,12}")) return false;
    if (Math.abs(System.currentTimeMillis() / 1000 - Long.parseLong(t)) > 300) return false;
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(SECRET, "HmacSHA256"));
    mac.update((t + ".").getBytes(StandardCharsets.UTF_8));
    byte[] expected = mac.doFinal(body);
    try {
      return MessageDigest.isEqual(expected, HexFormat.of().parseHex(v1));
    } catch (IllegalArgumentException e) {
      return false;
    }
  }
}
```

```go tab=Go
package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// verifyWebhook checks Stele-Signature (t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">)
// and rejects deliveries older than five minutes.
func verifyWebhook(secret, header string, body []byte) bool {
	var t, v1 string
	for _, part := range strings.Split(header, ",") {
		key, value, _ := strings.Cut(strings.TrimSpace(part), "=")
		switch key {
		case "t":
			t = value
		case "v1":
			v1 = value
		}
	}
	ts, err := strconv.ParseInt(t, 10, 64)
	if age := time.Now().Unix() - ts; err != nil || age > 300 || age < -300 {
		return false
	}
	given, err := hex.DecodeString(v1)
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(t + "."))
	mac.Write(body)
	return hmac.Equal(mac.Sum(nil), given)
}

func steleWebhook(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	secret := os.Getenv("STELE_WEBHOOK_SECRET")
	if err != nil || !verifyWebhook(secret, r.Header.Get("Stele-Signature"), body) {
		http.Error(w, "invalid signature", http.StatusBadRequest) // not from Stele, or a replay
		return
	}
	var event struct {
		ID   string `json:"id"`
		Type string `json:"type"`
		Data struct {
			AcceptanceID    string `json:"acceptanceId"`
			ExternalUserRef string `json:"externalUserRef"`
			VersionNumber   int    `json:"versionNumber"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &event); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if event.Type == "agreement.accepted" {
		// Mark event.Data.ExternalUserRef as having accepted version event.Data.VersionNumber.
	}
	w.WriteHeader(http.StatusNoContent)
}

func main() {
	http.HandleFunc("POST /webhooks/stele", steleWebhook)
	http.ListenAndServe(":4242", nil)
}
```

```php tab=PHP
<?php
// webhook.php: the URL you register in the dashboard
function verify_stele_webhook(string $secret, string $header, string $body): bool
{
    $parts = [];
    foreach (explode(',', $header) as $part) {
        [$key, $value] = array_pad(explode('=', trim($part), 2), 2, '');
        $parts[$key] = $value;
    }
    $t = $parts['t'] ?? '';
    if (!ctype_digit($t) || abs(time() - (int) $t) > 300) {
        return false;
    }
    return hash_equals(hash_hmac('sha256', "$t.$body", $secret), $parts['v1'] ?? '');
}

$body = file_get_contents('php://input');
$header = $_SERVER['HTTP_STELE_SIGNATURE'] ?? '';
if (!verify_stele_webhook(getenv('STELE_WEBHOOK_SECRET'), $header, $body)) {
    http_response_code(400); // not from Stele, or too old (replay)
    exit;
}

$event = json_decode($body, true, 512, JSON_THROW_ON_ERROR);
if ($event['type'] === 'agreement.accepted') {
    $data = $event['data'];
    // Mark $data['externalUserRef'] as having accepted version $data['versionNumber'].
}
http_response_code(204);
```

```ruby tab=Ruby
# gem install sinatra rackup puma
require "json"
require "openssl"
require "sinatra"

def verify_stele_webhook(secret, header, body)
  parts = header.to_s.split(",").filter_map { |p| p.strip.split("=", 2) if p.include?("=") }.to_h
  t = parts["t"].to_s
  return false unless t.match?(/\A\d+\z/) && (Time.now.to_i - t.to_i).abs <= 300

  expected = OpenSSL::HMAC.hexdigest("SHA256", secret, "#{t}.".b + body.b)
  OpenSSL.secure_compare(expected, parts["v1"].to_s)
end

post "/webhooks/stele" do
  body = request.body.read
  signature = request.env["HTTP_STELE_SIGNATURE"]
  halt 400 unless verify_stele_webhook(ENV.fetch("STELE_WEBHOOK_SECRET"), signature, body)

  event = JSON.parse(body)
  if event["type"] == "agreement.accepted"
    data = event["data"]
    # Mark data["externalUserRef"] as having accepted version data["versionNumber"].
  end
  status 204
end
```

```csharp tab=C#
// ASP.NET Core minimal API (dotnet new web)
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

var app = WebApplication.Create(args);
var secret = Encoding.UTF8.GetBytes(Environment.GetEnvironmentVariable("STELE_WEBHOOK_SECRET")!);

app.MapPost("/webhooks/stele", async (HttpRequest request) =>
{
    using var buffer = new MemoryStream();
    await request.Body.CopyToAsync(buffer);
    var body = buffer.ToArray();
    if (!VerifySteleWebhook(secret, request.Headers["Stele-Signature"].ToString(), body))
        return Results.BadRequest(); // not from Stele, or too old (replay)

    using var json = JsonDocument.Parse(body);
    var e = json.RootElement;
    if (e.GetProperty("type").GetString() == "agreement.accepted")
    {
        var data = e.GetProperty("data");
        // Mark data.externalUserRef as having accepted version data.versionNumber.
    }
    return Results.NoContent();
});

app.Run();

// Stele-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">, at most 5 minutes old.
static bool VerifySteleWebhook(byte[] secret, string header, byte[] body)
{
    string? t = null, v1 = null;
    foreach (var part in header.Split(','))
    {
        var kv = part.Trim().Split('=', 2);
        if (kv.Length != 2) continue;
        if (kv[0] == "t") t = kv[1];
        if (kv[0] == "v1") v1 = kv[1];
    }
    if (t is null || v1 is null || !long.TryParse(t, out var ts)) return false;
    if (Math.Abs(DateTimeOffset.UtcNow.ToUnixTimeSeconds() - ts) > 300) return false;
    byte[] given;
    try { given = Convert.FromHexString(v1); } catch (FormatException) { return false; }
    var signed = Encoding.UTF8.GetBytes(t + ".").Concat(body).ToArray();
    var expected = HMACSHA256.HashData(secret, signed);
    return CryptographicOperations.FixedTimeEquals(expected, given);
}
```

Deliveries can repeat: use the event's `id` to ignore duplicates. A webhook is a notification, not
the evidence itself; the evidence is the Solana transaction it points to. Retries, all events and
the payload format are in the [SDK & API reference](api.md#webhooks).

## 10. Test locally

Stele runs a separate app for each Solana network: **Solana Mainnet** for production and test
networks such as **Solana Devnet** for development. Use the **network switcher** in the site header
or at the bottom of the dashboard sidebar to move between them. Test networks show a banner on
every page. Organizations, documents, API keys and acceptances belong to one network, so create
them again on Mainnet when you go live, and use that app's address in your snippets.

The widget shows its network in its **Network** row. Wallets must use the same network.

1. Publish your document in the dashboard.
2. In your wallet, switch to that network. In Phantom: **Settings → Developer Settings → Testnet
   Mode**, then choose the network.
3. Serve your page on `http://localhost` (see [step 3](#complete-example)) and open it.
4. Connect your wallet.
5. Read the document and tick **I have read and agree**.
6. Click **Accept & sign** and approve the message in your wallet.
7. Wait for **Accepted and recorded on Solana**.
8. Open the receipt.
9. Check it on **Verify** (link in the site header) with the transaction signature.

Your test wallet needs no SOL to accept. If your organization has **Allowed requesting sites**, add
`localhost` while you test.

| What you see | Cause and fix |
|---|---|
| The wallet says the chain ID or network does not match | The wallet is on another network. Switch it to the network shown in the widget |
| "No compatible wallet was found in this browser" | No Solana wallet is installed, or it does not support this network. Install one and reload |
| The widget stays empty | The page was opened as `file://`, or your Content Security Policy blocks the script; serve it over HTTP |

## 11. No wallet? Passkeys

Many visitors have no Solana wallet. In **Dashboard → Signing & fees**, choose **Wallet or passkey**
(or **Passkey only**). The same widget then offers **Create a passkey**:

1. The browser creates a signing key and protects it with the visitor's passkey (Face ID, Touch ID,
   Windows Hello, a phone or a security key). Stele receives only the encrypted key — it cannot sign
   for the visitor, and neither can you.
2. The widget offers a **recovery kit** (a code shown once) for the day the device is lost.
3. To sign, one passkey prompt approves the exact text and unlocks the key for that one signature.

Nothing changes for your server: the step 7 check, webhooks and receipts work the same. Receipts
additionally carry the passkey's evidence, which every verifier checks.

| Option | Use it when |
|---|---|
| **Wallet or passkey** | Public sites: visitors choose |
| **Passkey only** | Audiences without crypto wallets |
| **Your account + passkey** | The passkey signer must belong to a user of yours: every request needs an acceptance session for that user (step 8), and each account has one signer |

> [!IMPORTANT]
> Passkey signing uses the passkey's own key (secp256r1), verified on-chain by Solana — any current
> browser, phone or password manager with passkeys works. Where passkeys are unavailable, the widget
> offers a wallet instead — Stele never falls back to a key it would hold itself.

> [!DETAILS] A user lost every device and the recovery kit
> Nobody can recover that key — by design. After verifying the user yourself, retire their signer
> ([`POST /v1/signer-identities/{publicKey}/revoke`](api.md#managing-signers-from-your-server), or
> **Signing & fees → Passkey signers → Retire**). Their next signer is a **new** key, recorded as
> authorized by your account system. Their past acceptances stay valid and still name the old key.

## 12. Confirm purchases and other statements

Acceptances cover documents. For **purchases, refunds, consents, quote acceptances** and similar
statements, your server creates a **proof request** (`POST /v1/proof-requests`), the customer
confirms it in the widget or on the hosted page, and your server checks the proof before fulfilling.
Only the statement's salted hash goes on-chain — the order details stay between you and the
customer, in the proof receipt. Code for every step and language:
[SDK & API → Proofs](api.md#proofs-purchases-refunds-consents).

## 13. Who pays the fees

Your visitors never pay. Each organization records a number of acceptances and proofs free every
month; beyond that, each recording uses one credit, bought under **Dashboard → Billing** with SOL
from your wallet (see [Pricing](/pricing)). Network fees are included: Stele's relayer pays them.

To pay network fees yourself instead, open **Signing & fees → My organization sponsors**, enable
sponsorship on your nonce shard and deposit SOL to its address. The Solana program reimburses each
valid recording's exact fee (about 0.00001 SOL) from it, within the per-record and daily limits you
set; only your owner wallet can withdraw.

## 14. Production checklist

Before going live:

- [ ] Your domain is verified (**Organization → Verified domain**).
- [ ] **Allowed requesting sites** lists your production hostnames, for example `acme.com, app.acme.com`,
      and no longer `localhost`.
- [ ] You use the **Solana Mainnet** app (network switcher): your organization, documents, API keys
      and webhooks are recreated there, and your snippets and base URL use its address. The widget's
      **Network** row says Solana Mainnet.
- [ ] API keys live only on your server, with only the scopes you use.
- [ ] Webhook endpoints use HTTPS, verify signatures and ignore duplicate event IDs.
- [ ] Your site is served over HTTPS.
- [ ] You tested publishing a new version: the step 7 check finds nothing until users accept again.
- [ ] You verified one receipt independently, on **Verify** or with the [command-line
      verifier](verification.md#from-the-command-line).
- [ ] If your site sends a Content Security Policy, it allows the widget (see
      [SDK & API reference](api.md#content-security-policy)).
- [ ] For the strongest guarantees: bundle `@stelehq/sdk` instead of loading the script, and pin
      `expected` (program ID and chain ID) and `rpcUrls`.
- [ ] If you allow passkeys: you chose the signing policy deliberately, and your support process for
      lost devices verifies users before retiring a signer.
- [ ] If your organization sponsors fees: limits fit your volume, a low-balance alert is set, and the
      `sponsorship.low_balance` webhook reaches someone.

## Troubleshooting

| You see | What to do |
|---|---|
| "No compatible wallet was found in this browser" | Install a Solana wallet that supports the network shown, then reload |
| The wallet refuses: chain ID or network does not match | Switch the wallet to the network shown in the widget |
| "This organization does not accept signing requests from …" | Add your site's hostname to **Organization → Acceptance policy → Allowed requesting sites** |
| "This organization requires an acceptance session issued by its own server" | Pass a session token (step 8), or turn off **Require acceptance sessions** |
| "Invalid or expired acceptance session" | Sessions last 15 minutes and are used up by one acceptance: create a new one per page view |
| "This agreement could not be verified, so it is not shown" | The text or its details did not match Solana; the message says which check failed |
| "Acceptances are not enabled yet" (dashboard) | Open **Organization → Acceptance capacity** and add a shard for the Stele relayer |
| Nothing appears | Check the browser console. Common causes: a `file://` page, a Content Security Policy, or a placeholder element other than a `<div>` |
| `401 unauthorized` from the API | The key is missing, revoked or expired, or belongs to another network's Stele app |
| `403 forbidden` from the API | The key lacks the scope the endpoint needs ([scopes](api.md#authentication)) |
| "Passkeys are not available here" | The browser or device has no passkey support: use a wallet, or another browser |
| "This organization accepts passkey signing only" / "wallet signing only" | Change the signing policy in **Signing & fees**, or use the other method |
| `402 credits_exhausted` | This month's free recordings and your credits are used up: buy credits under **Billing** |
| `402 sponsorship_unavailable` | Your sponsorship is paused, empty or at its daily limit: top it up, raise the limit, or enable **Fall back to Stele** |

## Complete example: require Terms before checkout

```flow
The user opens checkout
Your server creates an acceptance session for the user
The widget shows the latest Terms
The user accepts
Stele records the acceptance
Your server checks that the latest version was accepted
Checkout continues
```

A complete server, with the checkout page it renders. `requireLogin` and `req.user` (Express), or
Flask-Login's `login_required` and `current_user`, stand for your existing login:

```ts tab=Node.js
import express from "express";
import { SteleServerClient } from "@stelehq/sdk/server";

const stele = new SteleServerClient({
  apiBaseUrl: "https://app.stele.example/api",
  apiKey: process.env.STELE_API_KEY!,
});
const app = express();

app.get("/checkout", requireLogin, async (req, res) => {
  const { sessionToken } = await stele.createAcceptanceSession({
    document: "terms-of-service",
    externalUserRef: req.user.id,
  });
  res.send(checkoutPage(sessionToken));
});

app.post("/checkout", requireLogin, async (req, res) => {
  const accepted = await stele.hasAcceptedLatest(req.user.id, "terms-of-service");
  if (!accepted) {
    return res.status(403).send("Please accept the current Terms of Service first.");
  }
  // … place the order
  res.redirect("/thank-you");
});

const checkoutPage = (sessionToken: string) => `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Checkout</title></head>
  <body>
    <h1>Checkout</h1>
    <div
      data-stele-organization="acme.com"
      data-stele-document="terms-of-service"
      data-stele-session="${sessionToken}"
    ></div>
    <form method="post" action="/checkout">
      <button id="pay" disabled>Place order</button>
    </form>
    <script src="https://app.stele.example/sdk/v1/stele.js" defer></script>
    <script>
      document.addEventListener("stele:accepted", () => {
        document.querySelector("#pay").disabled = false;
      });
    </script>
  </body>
</html>`;

app.listen(4242);
```

```python tab=Python
# pip install flask flask-login requests
import os

import requests
from flask import Flask, abort, redirect, render_template_string
from flask_login import current_user, login_required

BASE_URL = "https://app.stele.example/api/v1"
http = requests.Session()
http.headers["Authorization"] = f"Bearer {os.environ['STELE_API_KEY']}"
app = Flask(__name__)


def stele(method, path, **kwargs):
    response = http.request(method, BASE_URL + path, timeout=10, **kwargs)
    response.raise_for_status()
    return response.json()


def has_accepted_latest(user_id, slug):
    latest = stele("GET", f"/documents/by-slug/{slug}/latest")
    found = stele("GET", "/acceptances", params={
        "externalUserRef": user_id, "version": latest["version"]["address"], "limit": 1,
    })
    return bool(found["acceptances"])


@app.get("/checkout")
@login_required
def checkout_page():
    session = stele("POST", "/acceptance-sessions", json={
        "document": "terms-of-service", "externalUserRef": str(current_user.id),
    })
    return render_template_string(CHECKOUT_PAGE, session_token=session["sessionToken"])


@app.post("/checkout")
@login_required
def place_order():
    if not has_accepted_latest(str(current_user.id), "terms-of-service"):
        abort(403, "Please accept the current Terms of Service first.")
    # … place the order
    return redirect("/thank-you")


CHECKOUT_PAGE = """<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Checkout</title></head>
  <body>
    <h1>Checkout</h1>
    <div
      data-stele-organization="acme.com"
      data-stele-document="terms-of-service"
      data-stele-session="{{ session_token }}"
    ></div>
    <form method="post" action="/checkout">
      <button id="pay" disabled>Place order</button>
    </form>
    <script src="https://app.stele.example/sdk/v1/stele.js" defer></script>
    <script>
      document.addEventListener("stele:accepted", () => {
        document.querySelector("#pay").disabled = false;
      });
    </script>
  </body>
</html>"""
```

The button is enabled by the browser event, but the order is placed only after **your server**
confirmed the acceptance with Stele.

## Go deeper

- [How Stele works](how-it-works.md): publishing, accepting and verifying, step by step
- [Verification](verification.md): how you, a customer or a court can check an acceptance
- [What a signature proves](acceptance-signing.md), and what it does not
- [SDK & API](api.md): every option, endpoint, event and error

> [!DETAILS] How the document is verified before it is shown
> The widget downloads the document text and computes its SHA-256 hash. It reads the version's
> fingerprint from Solana and recomputes it from the on-chain fields and that hash. The text is shown
> only if everything matches, so an altered copy is never displayed or offered for signing.

> [!DETAILS] Why the signing message is rebuilt from Solana
> Stele's server prepares the message the wallet signs. Before asking the wallet, the widget rebuilds
> the message itself from data it read on Solana and refuses to continue if a single byte differs. A
> compromised server therefore cannot get a user to sign something they were not shown.

> [!DETAILS] Domain binding and Allowed requesting sites
> The signed message ends with `Requested by: <your hostname>`, taken from the browser's `Origin`,
> which page scripts cannot change. A copy of your widget on another site therefore produces
> acceptances naming that site. **Allowed requesting sites** goes further: Stele refuses to issue
> signing requests for any hostname not on your list.

> [!DETAILS] Replay protection
> Every signing request carries a single-use number (a nonce) and a validity window of a few
> minutes. The Solana program records each nonce once, so a signature can never be recorded twice,
> reused for another version, or replayed on another network.

> [!DETAILS] Pinning the program, network and RPC endpoints
> By default the widget learns the program ID, network and Solana RPC endpoints from your Stele app.
> To rely on Stele's servers even less, pass `expected: { programId, chainId }` (the values from
> `GET /api/v1/network`) and your own `rpcUrls`. Loading stops if anything else is advertised.

> [!DETAILS] Script tag or bundled package
> Loading `stele.js` from your Stele app means trusting that server to deliver the widget's code.
> Installing `@stelehq/sdk` and bundling it with your app pins the code to the version you reviewed.

> [!DETAILS] What a signature proves
> Stele proves that a specific key (a wallet, or a passkey-protected signer) signed acceptance of a
> specific, unaltered document version, once, at a recorded time. It does not prove who controls the
> key; link acceptances to your own users (step 8) when that matters. Whether an agreement is
> enforceable depends on the applicable law and circumstances. Stele does not provide legal advice.
