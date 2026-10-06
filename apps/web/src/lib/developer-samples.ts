/**
 * Code samples of the Developers page, filled in with this Stele app's address. Dependency-free on
 * purpose: the documentation checks import this module and run every server sample.
 */

export interface Sample {
  label: string;
  language: string;
  code: string;
}

/** Step: put the widget on the page. */
export function widgetSamples(origin: string): Sample[] {
  return [
    {
      label: "HTML",
      language: "html",
      code: `<div
  data-stele-organization="acme.com"
  data-stele-document="terms-of-service"
></div>

<script src="${origin}/sdk/v1/stele.js" defer></script>`,
    },
    {
      label: "React",
      language: "tsx",
      code: `import { TermsAcceptance } from "@stele/sdk/react";

<TermsAcceptance
  apiBaseUrl="${origin}/api"
  appUrl="${origin}"
  organization="acme.com"
  document="terms-of-service"
/>`,
    },
    {
      label: "JavaScript",
      language: "js",
      code: `import { mount } from "@stele/sdk";

mount(document.querySelector("#terms"), {
  apiBaseUrl: "${origin}/api",
  appUrl: "${origin}",
  organization: "acme.com",
  document: "terms-of-service",
});`,
    },
  ];
}

/** Step: react to the acceptance in the browser. */
export function browserEventSamples(): Sample[] {
  return [
    {
      label: "HTML",
      language: "js",
      code: `document.addEventListener("stele:accepted", (event) => {
  const { acceptanceId, transactionSignature } = event.detail;
  console.log("Accepted:", acceptanceId);
});`,
    },
    {
      label: "React",
      language: "tsx",
      code: `<TermsAcceptance
  /* … */
  onAccepted={(result) => console.log("Accepted:", result.acceptanceId)}
/>`,
    },
    {
      label: "JavaScript",
      language: "js",
      code: `mount(document.querySelector("#terms"), {
  /* … */
  onAccepted: (result) => console.log("Accepted:", result.acceptanceId),
});`,
    },
  ];
}

/**
 * Step: link the acceptance to your user, then check it before it matters. Except for cURL and
 * Node.js, the samples use the small per-language client of the guide (base URL + API key).
 */
export function serverSamples(origin: string): Sample[] {
  const base = `${origin}/api/v1`;
  return [
    {
      label: "cURL",
      language: "bash",
      code: `# Rendering the page for your logged-in user: link the acceptance to them
curl ${base}/acceptance-sessions \\
  -H "Authorization: Bearer $STELE_API_KEY" -H "Content-Type: application/json" \\
  -d '{ "document": "terms-of-service", "externalUserRef": "user_12345" }'

# Before checkout: has the user accepted the current version? (an empty list: no)
VERSION=$(curl -s ${base}/documents/by-slug/terms-of-service/latest \\
  -H "Authorization: Bearer $STELE_API_KEY" | jq -r .version.address)
curl "${base}/acceptances?externalUserRef=user_12345&version=$VERSION&limit=1" \\
  -H "Authorization: Bearer $STELE_API_KEY"`,
    },
    {
      label: "Node.js",
      language: "ts",
      code: `import { SteleServerClient } from "@stele/sdk/server";

const stele = new SteleServerClient({
  apiBaseUrl: "${origin}/api",
  apiKey: process.env.STELE_API_KEY!,
});

// Rendering the page for your logged-in user: link the acceptance to them
const { sessionToken } = await stele.createAcceptanceSession({
  document: "terms-of-service",
  externalUserRef: "user_12345",
});

// Before checkout. Returns null again after you publish new Terms:
const accepted = await stele.hasAcceptedLatest("user_12345", "terms-of-service");`,
    },
    {
      label: "Python",
      language: "python",
      code: `# stele(): the client from the guide, BASE_URL = "${base}"

# Rendering the page for your logged-in user: link the acceptance to them
session = stele("POST", "/acceptance-sessions", json={
    "document": "terms-of-service", "externalUserRef": "user_12345"})

# Before checkout: has the user accepted the current version?
latest = stele("GET", "/documents/by-slug/terms-of-service/latest")
found = stele("GET", "/acceptances", params={
    "externalUserRef": "user_12345", "version": latest["version"]["address"], "limit": 1})
accepted = len(found["acceptances"]) > 0`,
    },
    {
      label: "Java",
      language: "java",
      code: `// Stele: the client from the guide, BASE_URL = "${base}"

// Rendering the page for your logged-in user: link the acceptance to them
JsonNode session = Stele.post("/acceptance-sessions", Map.of(
    "document", "terms-of-service", "externalUserRef", "user_12345"));

// Before checkout: has the user accepted the current version?
JsonNode latest = Stele.get("/documents/by-slug/terms-of-service/latest");
boolean accepted = Stele.get("/acceptances", Map.of(
    "externalUserRef", "user_12345",
    "version", latest.at("/version/address").asText(),
    "limit", 1)).get("acceptances").size() > 0;`,
    },
    {
      label: "Go",
      language: "go",
      code: `// stele(): the client from the guide, baseURL = "${base}"

// Rendering the page for your logged-in user: link the acceptance to them
var session struct{ SessionToken string \`json:"sessionToken"\` }
if err := stele("POST", "/acceptance-sessions", map[string]any{
	"document": "terms-of-service", "externalUserRef": "user_12345",
}, &session); err != nil {
	return err
}

// Before checkout: has the user accepted the current version?
var latest struct {
	Version struct{ Address string \`json:"address"\` } \`json:"version"\`
}
if err := stele("GET", "/documents/by-slug/terms-of-service/latest", nil, &latest); err != nil {
	return err
}
query := url.Values{"externalUserRef": {"user_12345"}, "version": {latest.Version.Address}, "limit": {"1"}}
var found struct{ Acceptances []json.RawMessage \`json:"acceptances"\` }
if err := stele("GET", "/acceptances?"+query.Encode(), nil, &found); err != nil {
	return err
}
if len(found.Acceptances) == 0 {
	// Not accepted yet: show the Terms again
}`,
    },
    {
      label: "PHP",
      language: "php",
      code: `// stele(): the client from the guide, BASE_URL = '${base}'

// Rendering the page for your logged-in user: link the acceptance to them
$session = stele('POST', '/acceptance-sessions', [
    'document' => 'terms-of-service', 'externalUserRef' => 'user_12345',
]);

// Before checkout: has the user accepted the current version?
$latest = stele('GET', '/documents/by-slug/terms-of-service/latest');
$found = stele('GET', '/acceptances?' . http_build_query([
    'externalUserRef' => 'user_12345', 'version' => $latest['version']['address'], 'limit' => 1,
]));
$accepted = count($found['acceptances']) > 0;`,
    },
    {
      label: "Ruby",
      language: "ruby",
      code: `# stele(): the client from the guide, BASE_URL = "${base}"

# Rendering the page for your logged-in user: link the acceptance to them
session = stele("POST", "/acceptance-sessions",
                { document: "terms-of-service", externalUserRef: "user_12345" })

# Before checkout: has the user accepted the current version?
latest = stele("GET", "/documents/by-slug/terms-of-service/latest")
query = URI.encode_www_form(externalUserRef: "user_12345",
                            version: latest["version"]["address"], limit: 1)
accepted = stele("GET", "/acceptances?#{query}")["acceptances"].any?`,
    },
    {
      label: "C#",
      language: "csharp",
      code: `// Stele(): the client from the guide, BaseUrl = "${base}"

// Rendering the page for your logged-in user: link the acceptance to them
var session = await Stele(HttpMethod.Post, "/acceptance-sessions",
    new { document = "terms-of-service", externalUserRef = "user_12345" });

// Before checkout: has the user accepted the current version?
var latest = await Stele(HttpMethod.Get, "/documents/by-slug/terms-of-service/latest");
var version = latest.GetProperty("version").GetProperty("address").GetString();
var found = await Stele(HttpMethod.Get,
    $"/acceptances?externalUserRef=user_12345&version={version}&limit=1");
var accepted = found.GetProperty("acceptances").GetArrayLength() > 0;`,
    },
  ];
}

export const WEBHOOK_SAMPLE: Sample = {
  label: "Node.js",
  language: "ts",
  code: `import { verifyWebhook } from "@stele/sdk/server";

app.post("/webhooks/stele", express.raw({ type: "application/json" }), (req, res) => {
  let event;
  try {
    event = verifyWebhook(process.env.STELE_WEBHOOK_SECRET!, req.header("stele-signature"), req.body);
  } catch {
    return res.sendStatus(400);
  }
  if (event.type === "agreement.accepted") {
    // event.data.acceptanceId, event.data.externalUserRef, event.data.versionNumber
  }
  res.sendStatus(204);
});`,
};

export const VERIFY_SAMPLE: Sample = {
  label: "Shell",
  language: "shell",
  code: `stele-verify \\
  --rpc https://rpc-provider-one.example \\
  --rpc https://rpc-provider-two.example \\
  --tx <transaction signature>

# exit code: 0 VALID · 1 VALID_WITH_WARNINGS · 2 INVALID · 3 INCONCLUSIVE`,
};
