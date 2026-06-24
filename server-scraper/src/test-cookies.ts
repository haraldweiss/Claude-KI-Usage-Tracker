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
  
  const domains = [
    "https://claude.ai",
    "https://platform.claude.com",
    "https://opencode.ai",
    "https://z.ai",
    "https://chatgpt.com",
    "https://platform.openai.com",
    "https://claudetracker.wolfinisoftware.de",
  ];
  
  for (const url of domains) {
    const cookies = await context.cookies(url);
    console.log(url + ": " + cookies.length + " cookies");
    for (const c of cookies) {
      console.log("  " + c.name + " (httponly=" + c.httpOnly + ") value_len=" + c.value.length);
    }
  }
  
  await context.close();
}
main().catch(e => console.error("ERROR:", e.message));
