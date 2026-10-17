// SDD guard for OpenCode (v1 stable, named export).
// Thin wrapper around hooks/guard.mjs: adapts OpenCode tool events to the
// Claude PreToolUse shape, then reuses evaluate() as the single source of truth.
// Fails open on anything unexpected. Only Node built-ins plus the local guard module.
import { evaluate } from "../../hooks/guard.mjs";

const mapTool = (name) => {
  const lower = String(name ?? "").toLowerCase();
  if (lower === "edit") return "Edit";
  if (lower === "write") return "Write";
  return null;
};

const pickFilePath = (input) => {
  const bags = [
    input?.input,
    input?.tool_input,
    input?.args,
    input?.params,
  ];
  for (const bag of bags) {
    const v = bag?.file_path ?? bag?.path ?? bag?.filename;
    if (typeof v === "string" && v.length > 0) return v;
  }
  if (typeof input?.file_path === "string" && input.file_path.length > 0) return input.file_path;
  return null;
};

const pickToolName = (input) =>
  input?.tool ?? input?.toolName ?? input?.tool_name ?? input?.name ?? "";

export const SddGuard = async (ctx) => {
  const directory =
    (typeof ctx?.directory === "string" && ctx.directory) ||
    (typeof ctx?.project === "string" && ctx.project) ||
    process.cwd();

  return {
    "tool.execute.before": async (input) => {
      try {
        const mapped = mapTool(pickToolName(input));
        if (!mapped) return;
        const filePath = pickFilePath(input);
        if (!filePath) return;
        const env = {
          ...process.env,
          CLAUDE_PROJECT_DIR:
            process.env.CLAUDE_PROJECT_DIR || directory,
        };
        const result = evaluate(
          {
            tool_name: mapped,
            tool_input: { file_path: filePath },
            cwd: directory,
          },
          Date.now(),
          env,
        );
        if (result && result.deny) {
          throw new Error(result.message);
        }
      } catch (err) {
        if (err && typeof err.message === "string" && err.message.startsWith("SDD guard:")) {
          throw err;
        }
        // Fail open on anything unexpected.
      }
    },
  };
};
