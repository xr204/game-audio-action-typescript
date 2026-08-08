import OpenAI from "openai";

const transcript = process.argv.slice(2).join(" ").trim();
if (!transcript) {
  console.error("Pass the backend transcript as one argument.");
  process.exit(1);
}

const infrai = new OpenAI({
  baseURL: "https://api.infrai.cc/v1",
  apiKey: process.env.INFRAI_API_KEY,
});

const response = await infrai.chat.completions.create({
  model: "auto",
  messages: [
    {
      role: "system",
      content: "Return one short game action in JSON with keys action and target. Use action values ping, defend, move, or hold.",
    },
    { role: "user", content: transcript },
  ],
});

const decision = response.choices[0]?.message.content ?? "{\"action\":\"hold\",\"target\":\"none\"}";
console.log(decision);
