import { chromium } from "playwright";
import path from "path";
import os from "os";
import fs from "fs";
import { execSync } from "child_process";

async function main() {
  const origProfile = path.join(os.homedir(), "Library/Application Support/Google/Chrome/Default");
  const tmpProfile = `/tmp/chrome-profile-copy-${Date.now()}`;
  
  console.log("Original profile:", origProfile);
  console.log("Temp copy:", tmpProfile);
  
  // Copy profile (only Cookies file, not the whole 500MB profile)
  const cookieFile = path.join(origProfile, "Cookies");
  const tmpDir = path.join(tmpProfile, "Default");
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.copyFileSync(cookieFile, path.join(tmpDir, "Cookies"));
  console.log("Copied Cookies DB to temp profile");
  
  // Also copy the Local State file (needed for Chrome to find the profile)
  const localState = path.join(os.homedir(), "Library/Application Support/Google/Chrome/Local State");
  if (fs.existsSync(localState)) {
    fs.copyFileSync(localState, path.join(tmpProfile, "Local State"));
    console.log("Copied Local State");
  }
  
  // Launch Playwright with the temp profile
  const context = await chromium.launchPersistentContext(tmpProfile, {
    headless: false,
    viewport: { width: 1280, height: 720 },
    args: ['--no-sandbox'],
  });
  
  const page = await context.newPage();
  const cdpSession = await context.newCDPSession(page);
  
  const { cookies } = await cdpSession.send("Network.getAllCookies");
  console.log("\nCDP total cookies:", cookies.length);
  
  const targets = ["claude.ai", "opencode.ai", "z.ai", "chatgpt.com", "platform.claude.com"];
  for (const t of targets) {
    const match = cookies.filter((c: any) => c.domain.includes(t));
    if (match.length > 0) {
      console.log(t + " (" + match.length + "):");
      for (const c of match.slice(0, 3)) {
        const val = (!c.value || c.value === "") ? "(empty)" : c.value.substring(0, 20) + "...";
        console.log("  " + c.name + " = " + val + " httponly=" + c.httpOnly);
      }
    }
  }
  
  await context.close();
  
  // Cleanup
  fs.rmSync(tmpProfile, { recursive: true, force: true });
  console.log("\nTemp profile cleaned up");
}
main().catch(e => console.error("ERROR:", e.message));
