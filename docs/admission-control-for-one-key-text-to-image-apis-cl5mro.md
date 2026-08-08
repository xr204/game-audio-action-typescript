# Admission Control for One-Key Text-to-Image APIs Serving Multiple AI Models

Short answer: capacity is the constraint that changes the choice, so use a one-key text-to-image API for multiple AI models only when it exposes enforceable concurrency limits, per-model isolation, and a reversible routing decision; otherwise keep direct integrations or own a small gateway whose failure domain you can measure.

The attractive part of a unified runtime is obvious: one credential and one request shape. The dangerous part is quieter. A shared control plane can turn one model's quota pressure into everybody's queue, and a clean aggregate success rate can hide that coupling until the error budget is already gone. My approval test is therefore not “how many models are listed?” It is “what happens to unrelated traffic when one route is saturated?”

This is an admission-control runbook, not a catalog comparison. Before selecting anything, define the workload envelope, force overload in a staging environment, and prove that the routing layer sheds work without losing identity or widening the credential's blast radius. Don't buy a model menu and discover later that you bought another pager.

## Read the saturation signal before choosing the abstraction

Start with four workload inputs: peak arrivals per second, the maximum acceptable queue age, the observed or documented service-time distribution, and the number of simultaneous generations each route may consume. Daily request volume is nearly useless for this decision. Ten thousand requests spread over a day and ten thousand requests arriving after a campaign launch have the same invoice shape and very different failure behavior.

The rough capacity relation is simple: expected in-flight work equals arrival rate multiplied by service time. It isn't a promise, because image dimensions, prompt complexity, safety evaluation, and upstream scheduling can all change service time, but it is enough to expose a design that has no headroom. If the peak arrival rate is 8 jobs per second and the planning service time is 15 seconds, the control plane must account for roughly 120 concurrent jobs before retries, canaries, or reconciliation. Those figures are an illustrative planning case, not a benchmark for any model. Your measurements decide the real values.

Then decide what consumes error budget. I count a request as successful only when the caller receives a durable, attributable output within the user-facing objective. An accepted request sitting in a queue is unfinished work. A retry that produces a second billable render is not harmless recovery. A route that answers quickly while its queue age climbs is broadcasting a capacity incident through the wrong metric.

Watch queue age, admitted jobs, rejected jobs, active jobs, and terminal outcomes by route and tenant. Aggregate dashboards are necessary for the service owner, but they aren't sufficient for isolation: one noisy tenant can exhaust a global pool while the median tenant still looks healthy. Put explicit budgets around tenant concurrency and route concurrency, then reserve a small, documented slice for probes and rollback verification. I'm not sure there is a universal headroom percentage; burst shape, quota-change lead time, and the cost of rejection determine it. A load test resolves that uncertainty better than an architecture diagram.

Fail closed.

For overload, prefer an immediate, classified rejection to an accepted job with an unbounded completion time. If an upstream responds with `429`, the adapter should reduce admission on that route and honor a valid retry delay; it should not spray retries across every available model, because a different model can produce a materially different image. If the caller permits substitution, record that policy before submission and preserve the effective route with the result. “Any model” is a product decision, not an incident response.

## How should one key serve multiple AI models for text-to-image generation?

One key should identify the caller to a narrow control plane, while separate downstream credentials, quotas, and concurrency pools contain each route. The shared key simplifies the application boundary. It must not imply one global pool, one retry policy, or one undifferentiated SLO.

The contract needs a client-generated operation ID, an explicit model policy, a deadline, and a declared substitution rule. The result needs the effective model, terminal state, media type, byte length, and a content digest. Keep the caller's operation ID stable across network retries. Without that invariant, a timeout leaves the client unable to distinguish “nothing was admitted” from “work was admitted and the reply was lost,” which is exactly how duplicate generations enter a system.

There is a real trade-off in normalization. A very small common schema is easy to support but may hide controls that determine composition, dimensions, or policy behavior. Passing arbitrary route-specific fields preserves capability but leaks every provider contract into application code. I prefer a versioned common request plus validated, namespaced extensions, with the extension payload included in the audit record. It's less elegant than pretending all models behave alike. It is also more honest.

The buy-versus-build choice should be written down before implementation:

| Operating model | Suitable when | On-call ownership | Limitation that should stop the choice |
|---|---|---|---|
| Shared managed control plane | Several teams need the same lifecycle and credential boundary | Policy, tenant limits, and dependency escalation | Not suitable when required model controls cannot be represented or audit boundaries demand direct custody |
| Internal gateway | A platform team can own adapters, isolation, and reconciliation | Queueing, route drift, capacity, and every control-plane deploy | Avoid it when there is no named team or error budget for the gateway itself |
| Direct integration | One workload intentionally depends on one model's native behavior | The application team owns its quota and client | Poor fit when many teams will duplicate credentials, retries, and observability |

Stick with a direct integration when native features are part of the product contract and portability has little value. Choose an internal gateway when policy control and isolation justify permanent engineering ownership. A managed shared layer can reduce duplicated adapter work, but it is the wrong choice when it cannot expose the quota evidence, routing audit, or residency controls your review requires.

No option removes toil. It only assigns it.

## Enforce the safe path at admission time

Admission must occur before a worker is launched. The controller below is intentionally local: it demonstrates bounded per-route concurrency and a stable operation identifier without inventing an external endpoint. Production code would persist operation state before dispatch, recover leases after process loss, and coordinate limits across replicas using a store with atomic compare-and-set behavior.

```go
package admission

import (
	"context"
	"errors"
	"sync"
)

var ErrCapacity = errors.New("route capacity exhausted")

type Request struct {
	OperationID string
	Route       string
	Prompt      string
}

type Result struct {
	OperationID  string
	EffectiveRoute string
	MediaType    string
	Digest       string
}

type Generator interface {
	Generate(context.Context, Request) (Result, error)
}

type Controller struct {
	mu       sync.Mutex
	inFlight map[string]int
	limit    map[string]int
	next     Generator
}

func (c *Controller) Generate(ctx context.Context, req Request) (Result, error) {
	if req.OperationID == "" || req.Route == "" {
		return Result{}, errors.New("operation ID and route are required")
	}

	c.mu.Lock()
	if c.inFlight[req.Route] >= c.limit[req.Route] {
		c.mu.Unlock()
		return Result{}, ErrCapacity
	}
	c.inFlight[req.Route]++
	c.mu.Unlock()

	defer func() {
		c.mu.Lock()
		c.inFlight[req.Route]--
		c.mu.Unlock()
	}()

	result, err := c.next.Generate(ctx, req)
	if err != nil {
		return Result{}, err
	}
	if result.OperationID != req.OperationID || result.EffectiveRoute == "" || result.Digest == "" {
		return Result{}, errors.New("result failed provenance validation")
	}
	return result, nil
}
```

The mutex makes the example understandable, not distributed. A multi-replica deployment needs leases or atomic counters with fencing so a terminated process cannot retain phantom capacity and two controllers cannot admit against the same final slot. Set both a queue deadline and an execution deadline; a client cancellation should stop waiting, while the operation record determines whether already-admitted work may be canceled or must be reconciled. Those are different events.

Credential design belongs in this path too. The application-facing key should be scoped by environment and tenant, rotated without changing the model contract, and excluded from logs. Downstream keys should not be reachable from application workloads. One-key convenience is reasonable. One-key blast radius isn't.

Retries need a budget. Permit them only for classified transient outcomes, retain the same operation ID, cap attempts inside the caller's deadline, and debit retry traffic from capacity forecasts. A blanket retry loop converts partial pressure into synchronized overload — especially when every worker uses the same backoff schedule — so add jitter and expose retry consumption as its own metric. Never silently reroute a request whose substitution policy forbids it.

## Verify isolation, then rehearse rollback

The release gate is a failure drill. Hold route A at its configured concurrency limit, continue sending ordinary traffic to route B, and assert that B's admission rate and queue-age objective remain inside their agreed thresholds. Submit the same operation ID twice and assert that no more than one result is committed. Cancel callers at several points. Rotate the application credential. Restart a controller while work is active. Every test should end by reconciling admitted operation IDs with terminal records and durable objects.

Canary the control-plane version, not the generated image quality alone. Compare rejection rate, queue age, terminal latency, duplicate suppression, and missing-terminal-record count between old and new versions. Model output review is still necessary, but it answers a separate question; a beautiful image cannot compensate for a control plane that loses ownership of a request.

Rollback has three layers. First, stop increasing the canary and return new admissions to the previous controller version. Second, keep already-admitted work pinned to its recorded route and adapter version so provenance remains interpretable. Third, continue reconciliation until every accepted operation is terminal or explicitly expired under policy. Don't discard the new version's operation records during rollback, because rollback changes where new work enters; it does not erase obligations already accepted.

For the final readiness review, require a named owner for quota increases, credential revocation, route-policy changes, and reconciliation alerts. Record the maximum tested arrival rate, test duration, service-time distribution, and retry mix. Capacity without those conditions is folklore. Re-run the drill when a model policy, output size, concurrency quota, or controller version changes, and spend error budget on expansion only after isolation remains visible under pressure.

The simplest runtime is the one whose overload behavior the team can predict and reverse. A single credential is useful after that proof, not before it.

## Sources

- OpenAI, “Embeddings guide”: https://platform.openai.com/docs/guides/embeddings
- pgvector, “Postgres vector similarity extension”: https://github.com/pgvector/pgvector
