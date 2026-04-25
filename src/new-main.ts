/**
 * Dawn — REPL 入口
 * 简化版，验证核心架构可运行
 */

async function main() {
  const args = process.argv.slice(2);
  const input = args.join(" ") || "";

  console.log("Dawn REPL ready.");
  console.log(`Input: "${input || "(none)"}"`);
  console.log("Modules loaded OK.");

  // 尝试加载核心模块
  try {
    const engine = await import("./engine/AgentCore");
    console.log(` - AgentCore: ${engine ? "loaded" : "missing"}`);
  } catch {
    console.log(" - AgentCore: not yet compilable (expected in Phase 2)");
  }

  try {
    const capabilities = await import("./engine/IntentEngine");
    console.log(` - IntentEngine: ${capabilities ? "loaded" : "missing"}`);
  } catch {
    console.log(" - IntentEngine: not yet compilable (expected in Phase 2)");
  }

  try {
    const evolution = await import("./evolution/SelfEvolutionEngine");
    console.log(` - SelfEvolution: ${evolution ? "loaded" : "missing"}`);
  } catch {
    console.log(" - SelfEvolution: not yet compilable (expected in Phase 2)");
  }

  try {
    const memory = await import("./memory/ContextManager");
    console.log(` - ContextManager: ${memory ? "loaded" : "missing"}`);
  } catch {
    console.log(" - ContextManager: not yet compilable (expected in Phase 2)");
  }

  try {
    const review = await import("./capabilities/CodeReview");
    console.log(` - CodeReview: ${review ? "loaded" : "missing"}`);
  } catch {
    console.log(" - CodeReview: not yet compilable (expected in Phase 2)");
  }

  console.log("\nDawn REPL — awaiting Phase 2 for full functionality.");
}

main().catch(console.error);
