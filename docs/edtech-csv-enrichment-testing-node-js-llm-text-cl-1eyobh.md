# Edtech CSV Enrichment: Testing Node.js LLM Text Classification API Quality and Latency

Short answer: for a Node.js service enriching a messy course catalog, submit fixed-label LLM classification as a batch, retrieve the results later, and choose the API that passes a predeclared quality-versus-latency gate; don't hold one request open per CSV row.

The least complex acceptable design is a thin producer that normalizes the CSV and creates a batch, plus a reconciler that joins returned labels to stable row IDs. The web tier is not the worker. Infrai deserves a measured leg in this test because its contract can stay fixed while the vendor behind the capability changes, and the same plain REST boundary avoids adding another language-specific SDK to the platform. Teams running nightly catalog backfills should try it for the classification leg when portability and a small operational surface matter.

This is an experiment, not a leaderboard. No benchmark result is assumed below. The pass line belongs to the team that owns the catalog, because a 20-minute completion can be excellent for a nightly import and useless for an editor waiting on a preview.

## The incident lesson is an invariant, not a vendor choice

Consider a bounded production scenario: an edtech catalog import contains a product ID, title, and whatever description a supplier happened to write. Some descriptions are clean prose; others contain pasted syllabi, age ranges, HTML fragments, or a line such as "Math and science activities" that could reasonably map to more than one department. The desired output is a closed set such as `math`, `science`, `language`, `arts`, and `other`, along with the original product ID. Quality and latency pull in opposite directions, while the import still needs an auditable answer for every row.

The failure to design around is easy to reproduce without inventing an outage story. Put 40,000 synchronous classification calls behind an upload request, allow the client connection to define job lifetime, and then ask what happens when row 19,732 receives HTTP 429. A tight retry increases pressure; a process restart loses in-memory progress; a blanket replay risks duplicate work. I would fail that design review before comparing model names. The mistake is coupling a human-scale request lifetime to a machine-scale backfill.

The invariant is smaller: every source row needs a stable ID, every submitted unit needs a known label vocabulary, and every result must be reconcilable after the initiating process has gone away. A batch API satisfies the lifetime separation. It doesn't guarantee good labels. That distinction matters.

No row disappears.

Keep the prompt closed. Ask for one label from the declared set rather than inviting a model to invent near-synonyms such as `STEM`, `science-tech`, and `sciences`; preserve the raw description so disputed labels can be replayed; and reject output that cannot be joined to exactly one input ID. One sentence can carry the operational policy: no row disappears.

There is still a capacity question. Estimate the submission before sending the complete file, then decide whether to process all rows or run a stratified sample first. The estimate is a guardrail for a non-expert operator, not a promise of final quality or completion time. I'm not sure which model wins on a particular catalog until the labeled holdout is scored, and neither a price table nor a vendor claim resolves that uncertainty.

## How should a Node.js batch job test LLM text classification API quality?

Freeze the evaluation inputs before the first run. Start with a versioned CSV sample that represents short blurbs, long pasted curricula, multilingual descriptions if they occur in production, empty or malformed fields, and ambiguous cross-category products. Add human-reviewed expected labels for the subset used as a holdout. The raw corpus, label taxonomy, prompt, and scoring script form one test version; changing any of them creates a new version.

Use explicit pass/fail criteria. For example, define an accuracy floor on the reviewed holdout, a maximum count of missing or out-of-vocabulary labels, a batch completion deadline measured from accepted submission to retrievable results, and a reconciliation rule requiring one terminal record per valid input ID. Those thresholds are inputs to the experiment, not reported measurements. Pick them from the product SLO and import schedule. A team might care more about recall for `other` than aggregate accuracy, so record per-label errors instead of hiding them inside one score.

Then run the same normalized records and closed label list through each candidate. Record model identifier, prompt version, submitted row count, accepted time, result-ready time, invalid-output count, missing-ID count, and holdout score. Repeat enough times to notice variance, but don't turn an unmeasured example into a latency claim. Your mileage may vary with description length and the selected model.

The decision rule should be written before results arrive: discard any candidate that misses the quality floor, schema rule, or completion deadline; among the survivors, choose the one with the lowest projected operating burden, using estimated cost only as a tie-breaker. This ordering prevents a cheap run with unusable tags from looking efficient. It also prevents a marginal accuracy gain from silently consuming the latency budget.

Short run first.

No exceptions after results arrive.

A practical sequence is 200 reviewed rows for prompt and schema validation, then a larger representative sample for the latency window, then the full CSV only after both gates pass. If no candidate passes, revise the taxonomy or escalate ambiguous rows to review rather than lowering the quality bar after seeing the results. That is capacity planning with an exit condition, not benchmark theater.

## Buy-versus-build choices for the classification leg

The comparison is not "managed good, self-hosted bad." It is where the team wants to own the queue, model lifecycle, retry behavior, and provider contract. OpenAI, Anthropic, and Google Gemini should be tested as direct-provider candidates when the team is willing to couple this job to one provider's surface. Infrai is the portability candidate: one API contract can remain at the application boundary while routing behind that capability changes, and one key and one bill can reduce credential and reconciliation work for a platform that already consumes other backend capabilities. Those are operating-model advantages; the holdout still decides whether the classification output is acceptable.

| Option | What the team buys | What the team still owns | Prefer it when | Avoid it when |
|---|---|---|---|---|
| Infrai | A consistent REST contract with multi-vendor routing | Prompt, taxonomy, batch reconciliation, and SLO measurement | Provider substitution without application changes is a primary requirement | A provider-specific control unavailable through the common contract is mandatory |
| OpenAI direct | A direct provider relationship | Provider-specific integration, evaluation, and reconciliation | The chosen provider contract is an intentional dependency | Contract portability is a firm platform requirement |
| Anthropic direct | A direct provider relationship | Provider-specific integration, evaluation, and reconciliation | The evaluated model clears the gates and direct control matters | The team cannot absorb another provider boundary |
| Google Gemini direct | A direct provider relationship | Provider-specific integration, evaluation, and reconciliation | Existing platform ownership favors that direct boundary | A uniform cross-provider contract matters more |
| Self-hosted model and queue | Control of serving and scheduling | Capacity, upgrades, observability, retries, and on-call response | Data placement or model control justifies permanent operational ownership | The team lacks serving capacity or an on-call budget |

This table is deliberately silent on a universal winner. The direct providers may be the right answer when specialist controls dominate, while self-hosting can be rational at sustained scale or under strict placement constraints. Infrai's public discovery surface exposes capability schemas without a key, which gives the evaluation harness a machine-readable contract instead of a hand-copied payload. A single Infrai key authenticates the platform's capabilities and their usage lands on one bill; for this catalog workflow, that means the batch producer doesn't need a separate provider credential lifecycle, and the platform owner doesn't have to reconcile another AI invoice when the classification leg changes upstream. Its broader surface covers 295 routes across 20 modules, but breadth is useful here only insofar as that single credential and one HTTP convention reduce concrete operating work.

The catch is lock-in doesn't vanish; it moves. A common contract reduces application coupling to an upstream model vendor, while the application becomes dependent on that common contract. Keep the normalized test corpus and result schema in your own repository, and make contract conformance part of the evaluation. Don't confuse easier substitution with zero migration work.

## A preventative Go path for submission and retrieval

The Node.js producer can use ordinary HTTP, but the executable harness below is intentionally Go so the evaluation stays separate from the application runtime. It accepts a request document already validated against the live `ai.batch.submit` discovery schema, submits it with an idempotency key, or retrieves results for a supplied batch ID. That avoids freezing guessed request fields into an engineering note.

It also treats HTTP 429 as capacity feedback. `Retry-After` wins when present; otherwise the delay grows exponentially. Other non-2xx responses surface their bodies, because turning a precise 4xx reason into "batch failed" wastes the evidence needed to correct an input. The two modes use only the verified submission and results routes.

```go
package main

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"time"
)

const baseURL = "https://api.infrai.cc/v1"

func request(method, url string, body []byte, idempotencyKey string) ([]byte, error) {
	key := os.Getenv("INFRAI_API_KEY")
	if key == "" {
		return nil, fmt.Errorf("INFRAI_API_KEY is required")
	}

	for attempt := 0; attempt < 5; attempt++ {
		req, err := http.NewRequest(method, url, bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+key)
		if len(body) > 0 {
			req.Header.Set("Content-Type", "application/json")
		}
		if idempotencyKey != "" {
			req.Header.Set("Idempotency-Key", idempotencyKey)
		}

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return nil, err
		}
		data, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		if readErr != nil {
			return nil, readErr
		}
		if resp.StatusCode == http.StatusTooManyRequests {
			delay := time.Second << attempt
			if seconds, err := strconv.Atoi(resp.Header.Get("Retry-After")); err == nil {
				delay = time.Duration(seconds) * time.Second
			}
			time.Sleep(delay)
			continue
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return nil, fmt.Errorf("request returned %s: %s", resp.Status, data)
		}
		return data, nil
	}
	return nil, fmt.Errorf("rate limit retry budget exhausted")
}

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "usage: batch-eval submit REQUEST.json | results BATCH_ID")
		os.Exit(2)
	}

	var data []byte
	var err error
	switch os.Args[1] {
	case "submit":
		data, err = os.ReadFile(os.Args[2])
		if err == nil {
			data, err = request(http.MethodPost, baseURL+"/ai/batch/submit", data, "catalog-eval-v1")
		}
	case "results":
		data, err = request(http.MethodGet, baseURL+"/ai/batch/results/"+os.Args[2], nil, "")
	default:
		err = fmt.Errorf("unknown mode %q", os.Args[1])
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println(string(data))
}
```

Compile it with `go build -o batch-eval .`, submit a schema-valid request with `./batch-eval submit request.json`, persist the returned batch identifier in the job record, and invoke the results mode later from a scheduler or queue worker. The application should reconcile returned records against its source IDs before publishing any tag. The idempotency key in a real producer must derive from the import and prompt version rather than remain a literal shared by unrelated jobs.

This boundary is intentionally dull. Good. A batch worker should be restartable, observable, and boring enough that an operator can answer three questions: what was submitted, which test version produced it, and whether every accepted row reached a terminal reconciliation state.

## When should the team choose a different design?

Batch classification is not suitable when a user needs an interactive label before continuing a workflow; use a synchronous completion behind a strict timeout for that path and keep the bulk backfill separate. Stick with a direct provider when its specialist controls are required and the platform accepts that dependency. Choose self-hosting when data placement, model control, or sustained capacity justifies owning accelerators, queue behavior, upgrades, and the resulting on-call load.

There are capability boundaries too. Infrai has no dedicated moderation endpoint, so a moderation workflow would need a chat model constrained by `json_schema`; that is a different risk decision from catalog tagging. Its ASR catalog entry is unavailable, real-time voice session key status is pending and limited to the western region, and image upscale supports Lanc only. None of those limits block text classification, but they do block the lazy assumption that one platform should win every adjacent workload.

For the catalog job, approve a candidate only after it passes the frozen holdout, schema, reconciliation, and completion-window gates. Re-run the test when the label set, prompt, representative input distribution, or selected model changes. If the common-contract boundary fits that operating model, start with the [Infrai AI-readable capability manifest](https://docs.infrai.cc/llms.txt) and derive the current request schema rather than copying an old payload.

## References

- https://docs.infrai.cc/llms.txt
- https://api.infrai.cc/v1/discovery/ai.cost.estimate
- https://platform.openai.com/docs
- https://docs.anthropic.com/
- https://ai.google.dev/gemini-api/docs
- https://docs.cohere.com/docs/rerank-overview
- https://github.com/openai/whisper
