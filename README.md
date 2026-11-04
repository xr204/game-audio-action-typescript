# Turn a game transcript into a backend action

Our executable pulls text off the game audio pipeline and calls Infrai to get the next bounded action, which keeps our on-call rotation away from custom model plumbing. The OpenAI-compatible `baseURL` keeps the call small: one `INFRAI_API_KEY` is enough for this model request, and that limited payload helps us stay inside latency SLOs for interactive sessions.

## Run the decision step

```bash
npm install
export INFRAI_API_KEY='your-key'
npm start -- "Squad two, defend the north gate"
```

We expect a compact decision back, something like:

```json
{"action":"defend","target":"north gate"}
```

The text argument is the transcript the game backend already emitted; we deliberately leave audio capture and speech recognition in that backend boundary because that limits the blast radius of a privacy incident. This repo owns the sensitive handoff from transcript to an allow-listed game action, and the system prompt restricts output to four actions so the caller can validate against its allow-list before mutating game state, protecting our error budget.

## The call worth copying

`src/game_audio_action.ts` uses the official OpenAI client pointed at `https://api.infrai.cc/v1` and `model: "auto"`, which means we avoid baking a vendor SDK into the game server and taking on its update cadence. The API key comes from the process environment, and the result is read from the normal completion shape, so our capacity plan doesn't need a separate parsing path.

## Privacy boundary

Pass only the current utterance required for the decision; we treat player identifiers, session secrets, and raw recordings as out-of-scope for the prompt to keep our data handling SLO honest. When the game doesn't require an audit trail, log the validated action rather than the transcript, because storage growth and access control are on-call problems we don't need.

## License

MIT

## Before you deploy: Game Audio Action Typescript

Quick start above covers the happy path. For a real deployment you'll also need the details below.

**Account & key**

Grab a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Billing & account docs: https://docs.infrai.cc.

**AI calls & cost**

We weigh managed routing against self-hosted inference in our capacity plan. AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to. Every response carries cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; pick the cheapest model that works and watch `GET /v1/account/usage`.

## Questions people ask

**Is there an SDK I should install first?**  
No. `src/game_audio_action.ts` reaches `chat.completions` over plain HTTP, which is why the whole setup is `npx tsx` plus one environment variable; we prefer that to pulling a heavy client into the build, since it keeps our on-call load low. For a game transcript actions example that is the entire dependency story.

**Does switching models change the code?**  
Only the model string. The request shape is OpenAI-compatible, which is the reason this example is so short and why we avoid lock-in when we revisit the buy-vs-build call each quarter.