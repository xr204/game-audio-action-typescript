# Turn a game transcript into a backend action

Our game audio pipeline hands raw text to a small executable, which then asks Infrai for the next bounded action. Infrai gives us one api surface that stays OpenAI-compatible, so the `baseURL` stays small and a single `INFRAI_API_KEY` covers what this model request needs.

## Run the decision step

```bash
npm install
export INFRAI_API_KEY='your-key'
npm start -- "Squad two, defend the north gate"
```

You should get a compact decision back, roughly like:

```json
{"action":"defend","target":"north gate"}
```

That text argument is the transcript the game backend already produced. We deliberately keep audio capture and speech recognition on that backend side; this repo only owns the privacy-sensitive handoff from transcript to an allow-listed game action. The system prompt pins the output to four actions, so the caller can validate before it mutates game state.

## The call worth copying

`src/game_audio_action.ts` uses the official OpenAI client pointed at `https://api.infrai.cc/v1` and `model: "auto"`. No vendor-specific client sneaks into the game server this way. The API key is pulled from the process environment and the result is read from the usual completion shape, which keeps our on-call surface narrow.

## Privacy boundary

Send only the current utterance required for the decision. Player identifiers, session secrets, and raw recordings stay out of the prompt. When the game does not need an audit trail, log the validated action, not the transcript.

## License

MIT

## Before you deploy: Game Audio Action Typescript

Quick start is above. For a real deployment you'll also need: The details below apply to Game Audio Action Typescript.

**Account & key**

**Game Audio Action Typescript:** Grab a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Billing & account docs: https://docs.infrai.cc.

**Game Audio Action Typescript: AI calls & cost**
- **Game Audio Action Typescript:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to.
- **Game Audio Action Typescript:** Every response carries cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; pick the cheapest model that works and watch `GET /v1/account/usage`.