import type { CheckTransition } from "../cron";

export async function sendSlack(webhook: string | undefined, text: string): Promise<boolean> {
  if (!webhook) return false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (response.ok) return true;
      if (response.status >= 400 && response.status < 500 && response.status !== 429) return false;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, response.status === 429 ? 100 : 1000));
    } catch {
      if (attempt === 2) return false;
    }
  }
  return false;
}

export async function notifyTransitions(webhook: string | undefined, transitions: CheckTransition[]): Promise<void> {
  if (!webhook || transitions.length === 0) return;
  const text = transitions.map(({ check, from, to }) => `CronUp: ${check.name} ${from} -> ${to}`).join("\n");
  await sendSlack(webhook, text);
}
