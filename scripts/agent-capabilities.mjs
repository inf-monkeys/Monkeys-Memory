import { getAgentCapabilities } from "./lib/skill-updates.mjs";

try {
  console.log(JSON.stringify(await getAgentCapabilities(), null, 2));
} catch (error) {
  console.error(`[monkeys-memory] agent capabilities failed: ${error.message}`);
  process.exit(1);
}
