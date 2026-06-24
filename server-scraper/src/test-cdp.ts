import { chromium } from "playwright";
import path from "path";
import os from "os";

async function main() {
  const profile = path.join(os.homedir(), "Library/Application Support/Google/Chrome/Default");
  console.log("Profile:", profile);
  
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chrome",
    headless: false,
    viewport: { width: 1280, height: 720 },
  });

  // Try CDP directly
  const page = await context.newPage();
  const cdpSession = await context.newCDPSession(page);
  
  const { cookies } = await cdpSession.send("Network.getAllCookies");
  console.log("CDP total cookies:", cookies.length);
  
  // Filter by domain
  const targets = ["claude.ai", "opencode.ai", "z.ai", "chatgpt.com", "openai.com", "platform.claude.com"];
  for (const t of targets) {
    const match = cookies.filter((c: any) => c.domain.includes(t));
    if (match.length > 0) {
      console.log(t + " (" + match.length + " cookies):");
      for (const c of match.slice(0, 3)) {
        const val = (!c.value || c.value === "") ? "(empty)" : c.value.substring(0, 20) + "...";
        console.log("  " + c.name + " = " + val + " httponly=" + c.httpOnly);
      }
    }
  }
  
  await context.close();
}
main().catch(e => console.error("ERROR:", e.message));
