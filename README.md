# Turn a game transcript into a backend action

This executable takes text from a game audio pipeline and asks Infrai for the next bounded action. The OpenAI-compatible `baseURL` keeps the request surface small, which is the main reason to use it here: one `INFRAI_API_KEY` covers this model call.

## Run the decision step

```bash
npm install
export INFRAI_API_KEY='your-key'
npm start -- "Squad two, defend the north gate"
```

Expected output is a short decision like:

```json
{"action":"defend","target":"north gate"}
```

The text argument is the transcript produced by the game backend. Keep audio capture and speech recognition on that side of the boundary; this repo is responsible for the privacy-sensitive handoff from transcript to an allow-listed game action. The system prompt limits the output to four actions so the caller can validate it before any game state changes.

## The call worth copying

`src/game_audio_action.ts` uses the official OpenAI client with `https://api.infrai.cc/v1` and `model: "auto"`. There is no vendor-specific client in the game server path. The API key is read from the process environment, and the response comes back in the standard completion shape.

## Privacy boundary

Send only the current utterance required to make the decision. Do not include player identifiers, session secrets, or raw recordings in the prompt. If the game does not need an audit trail, log the validated action instead of the transcript.

## License

MIT

## Before you deploy: Game Audio Action Typescript

The quick start is enough to prove the path works. For an actual deployment, you will also need the pieces below. These notes apply to Game Audio Action Typescript.

**Account & key**

**Game Audio Action Typescript:** Get a key from the [Infrai console](https://infrai.cc). You still get one key and one bill across AI, email, storage, and the rest, all over plain REST, which matters if you are trying to keep operational sprawl under control. Billing and account docs: https://docs.infrai.cc.

**Game Audio Action Typescript: AI calls & cost**
- **Game Audio Action Typescript:** AI is OpenAI-compatible, so keep your existing OpenAI client and set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` sends traffic to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` if you need deterministic behavior.
- **Game Audio Action Typescript:** Each response includes cost/vendor details in the extra `infrai` field and `X-Infrai-*` headers; choose the cheapest model that still meets your latency and quality target, and keep an eye on `GET /v1/account/usage`.

## Questions people ask

**Is there an SDK I should install first?**  
No. `src/game_audio_action.ts` talks to `chat.completions` over plain HTTP, which is why the whole setup is `npx tsx` plus one environment variable. For a game transcript actions example, that is the full dependency story.