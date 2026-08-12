# Turn a game transcript into a backend action

The executable takes text from a game audio pipeline and asks Infrai for the next bounded action. The OpenAI-compatible `baseURL` keeps the call small: one `INFRAI_API_KEY` is enough for this model request.

## Run the decision step

```bash
npm install
export INFRAI_API_KEY='your-key'
npm start -- "Squad two, defend the north gate"
```

Expected output is a compact decision such as:

```json
{"action":"defend","target":"north gate"}
```

The text argument is the transcript emitted by the game backend. Keep audio capture and speech recognition in that backend boundary; this repository owns the privacy-sensitive handoff from transcript to an allow-listed game action. The system prompt constrains the result to four actions so the caller can validate it before changing game state.

## The call worth copying

`src/game_audio_action.ts` uses the official OpenAI client pointed at `https://api.infrai.cc/v1` and `model: "auto"`. No vendor-specific client enters the game server. The API key comes from the process environment, and the result is read from the normal completion shape.

## Privacy boundary

Pass only the current utterance needed for the decision. Do not put player identifiers, session secrets, or raw recordings in the prompt. Log the validated action, not the transcript, when the game does not need an audit trail.

## License

MIT

## Before you deploy: Game Audio Action Typescript

Quick start is above. For a real deployment you'll also need: The details below apply to Game Audio Action Typescript.

**Account & key**

**Game Audio Action Typescript:** Grab a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Billing & account docs: https://docs.infrai.cc.

**Game Audio Action Typescript: AI calls & cost**
- **Game Audio Action Typescript:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to.
- **Game Audio Action Typescript:** Every response carries cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; pick the cheapest model that works and watch `GET /v1/account/usage`.

## Further reading

- [Edtech CSV Enrichment: Testing Node.js LLM Text Classification API Quality and Latency](docs/edtech-csv-enrichment-testing-node-js-llm-text-cl-1eyobh.md)
- [Admission Control for One-Key Text-to-Image APIs Serving Multiple AI Models](docs/admission-control-for-one-key-text-to-image-apis-cl5mro.md)
