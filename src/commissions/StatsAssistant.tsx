/**
 * Internal AI assistant for the Stats page.
 *
 * Renders as a floating chat launcher + slide-up panel anchored to the
 * bottom-right of the viewport, mirroring the dock placement of
 * `.floating-compare-btn` so the page itself stays focused on the
 * dashboard. The panel is a small, modern chat surface inspired by
 * agent-style assistants (Cursor / Claude / ChatGPT) but built entirely
 * out of the project's existing glass + gold tokens — no new palette.
 *
 * Hands the live `StatsBundle` (summary + per-job rows) to Gemini as
 * grounding context, then asks the model to answer the rep / admin's
 * question in plain English. Calls go through the same
 * `VITE_GEMINI_API_KEY` the catalog search uses today; the same
 * deprecation warning applies (see `geminiCatalogSearch.ts`).
 *
 * The component is read-only — the model never gets tool access; it
 * just sees the rolled-up numbers and the truncated job array. This
 * keeps the surface area tight and lets us ship the assistant before
 * the planned Cloud Function migration lands.
 */
import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { StatsBundle } from "./statsCompute";
import { formatMoney } from "../utils/priceHelpers";
import {
  formatPercent,
  formatRate,
  MATERIAL_CATEGORY_LABELS,
} from "./statsCompute";

interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

const PROMPT_SUGGESTIONS: string[] = [
  "Quotes older than 30 days still in quote status?",
  "Approved jobs above 75% margin not closed in 90 days?",
  "Top earning rep this period and their pipeline?",
  "Total outstanding deposits + final payments?",
  "Average days from quote to install on completed jobs?",
];

export function StatsAssistant({
  bundle,
  memberName,
  customerName,
  isAdmin,
}: {
  bundle: StatsBundle;
  memberName: Record<string, string>;
  customerName: Record<string, string>;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const apiKey = (import.meta.env.VITE_GEMINI_API_KEY ?? "").trim();
  const model = (import.meta.env.VITE_GEMINI_MODEL ?? "gemini-2.5-flash").trim();
  const configured = Boolean(apiKey);

  const contextText = useMemo(
    () => buildContextText(bundle, memberName, customerName, isAdmin),
    [bundle, memberName, customerName, isAdmin]
  );

  /**
   * Auto-scroll the message list to the latest turn whenever the chat
   * grows or the busy indicator toggles. Modern chat panels feel broken
   * when the user has to manually scroll after every send.
   */
  useEffect(() => {
    if (!open) return;
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [open, turns, busy]);

  /**
   * When the panel opens, drop the cursor straight into the composer
   * so the user can start typing without an extra click.
   */
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => textareaRef.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, [open]);

  /**
   * Allow ESC to dismiss the open panel — standard expectation for any
   * floating overlay UI in the app.
   */
  useEffect(() => {
    if (!open) return;
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function ask(prompt: string) {
    const q = prompt.trim();
    if (!q) return;
    if (!configured) {
      setError(
        "AI assistant requires VITE_GEMINI_API_KEY. Add it to your .env to enable."
      );
      return;
    }
    setError(null);
    setBusy(true);
    const nextTurns: ChatTurn[] = [...turns, { role: "user", text: q }];
    setTurns(nextTurns);
    setQuestion("");
    try {
      const answer = await runAssistant({
        apiKey,
        model,
        question: q,
        contextText,
        history: nextTurns,
      });
      setTurns([...nextTurns, { role: "assistant", text: answer }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI request failed.");
      setTurns(nextTurns);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void ask(question);
  }

  function onComposerKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    /**
     * Enter sends, Shift+Enter inserts a newline. Matches Cursor /
     * ChatGPT-style chat composers so the muscle memory carries over.
     */
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void ask(question);
    }
  }

  return (
    <>
      <button
        type="button"
        className={`ai-fab${open ? " ai-fab--open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="stats-ai-panel"
        aria-label={open ? "Close AI assistant" : "Open AI assistant"}
      >
        <span className="ai-fab__glyph" aria-hidden="true">
          {open ? <CloseIcon /> : <SparkleIcon />}
        </span>
        {!open ? <span className="ai-fab__label">Ask AI</span> : null}
        {!open && turns.length > 0 ? (
          <span className="ai-fab__badge" aria-hidden="true">
            {Math.min(turns.length, 99)}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          id="stats-ai-panel"
          className="ai-chat-panel"
          role="dialog"
          aria-modal="false"
          aria-label="Stats AI assistant"
        >
          <header className="ai-chat-panel__head">
            <div className="ai-chat-panel__title-block">
              <span className="ai-chat-panel__avatar" aria-hidden="true">
                <SparkleIcon />
              </span>
              <div className="ai-chat-panel__titles">
                <span className="ai-chat-panel__title">Stats Assistant</span>
                <span className="ai-chat-panel__subtitle">
                  Grounded on your live company data
                </span>
              </div>
            </div>
            <div className="ai-chat-panel__head-actions">
              <button
                type="button"
                className="ai-chat-icon-btn"
                onClick={() => {
                  setTurns([]);
                  setError(null);
                }}
                disabled={busy || turns.length === 0}
                title="Clear chat"
                aria-label="Clear chat"
              >
                <ResetIcon />
              </button>
              <button
                type="button"
                className="ai-chat-icon-btn"
                onClick={() => setOpen(false)}
                title="Minimize"
                aria-label="Minimize"
              >
                <MinimizeIcon />
              </button>
            </div>
          </header>

          {!configured ? (
            <div className="ai-chat-panel__notice ai-chat-panel__notice--warn">
              Set <code>VITE_GEMINI_API_KEY</code> in <code>.env</code> to
              enable the assistant.
            </div>
          ) : null}

          <div className="ai-chat-panel__body" ref={scrollerRef}>
            {turns.length === 0 ? (
              <div className="ai-chat-empty">
                <div className="ai-chat-empty__title">
                  Ask anything about your pipeline
                </div>
                <p className="ai-chat-empty__hint">
                  I can see {bundle.summary.totalJobs.toLocaleString()} jobs,
                  pipeline value, payments, margins, and rep activity for
                  the current period. Ask in plain English.
                </p>
                <div className="ai-chat-suggestions">
                  {PROMPT_SUGGESTIONS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      className="ai-chat-suggestion"
                      onClick={() => void ask(p)}
                      disabled={busy || !configured}
                      title={p}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {turns.map((t, i) => (
              <div
                key={i}
                className={`ai-chat-msg ai-chat-msg--${t.role}`}
              >
                <span className="ai-chat-msg__avatar" aria-hidden="true">
                  {t.role === "assistant" ? <SparkleIcon /> : <YouIcon />}
                </span>
                <div className="ai-chat-msg__bubble">{t.text}</div>
              </div>
            ))}

            {busy ? (
              <div className="ai-chat-msg ai-chat-msg--assistant">
                <span className="ai-chat-msg__avatar" aria-hidden="true">
                  <SparkleIcon />
                </span>
                <div className="ai-chat-msg__bubble ai-chat-msg__bubble--typing">
                  <span className="ai-chat-typing">
                    <span />
                    <span />
                    <span />
                  </span>
                </div>
              </div>
            ) : null}
          </div>

          {error ? (
            <div className="ai-chat-panel__notice ai-chat-panel__notice--bad">
              {error}
            </div>
          ) : null}

          <form onSubmit={onSubmit} className="ai-chat-composer">
            <textarea
              ref={textareaRef}
              className="ai-chat-composer__input"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Message the assistant…"
              rows={1}
              disabled={busy}
              onKeyDown={onComposerKeyDown}
            />
            <button
              type="submit"
              className="ai-chat-composer__send"
              disabled={busy || !question.trim() || !configured}
              aria-label="Send"
              title="Send (Enter)"
            >
              <SendIcon />
            </button>
          </form>
        </div>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Inline icons
// ---------------------------------------------------------------------------

function SparkleIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3l1.8 4.6L18 9.4l-4.2 1.8L12 16l-1.8-4.8L6 9.4l4.2-1.8L12 3z" />
      <path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function MinimizeIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 12l16-8-6 16-2.5-6.5L4 12z" />
    </svg>
  );
}

function YouIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Prompt builder + Gemini call
// ---------------------------------------------------------------------------

function buildContextText(
  bundle: StatsBundle,
  memberName: Record<string, string>,
  customerName: Record<string, string>,
  isAdmin: boolean
): string {
  const s = bundle.summary;
  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push(`Today (UTC): ${today}`);
  lines.push(`Period (commission window): ${bundle.range.fromPeriod} to ${bundle.range.toPeriod}`);
  lines.push(
    `Viewer role: ${isAdmin ? "owner/admin (sees all jobs)" : "rep (sees only their own jobs)"}`
  );
  lines.push("");
  lines.push("=== Company-wide totals ===");
  lines.push(`Jobs in scope: ${s.totalJobs}`);
  lines.push(`Pipeline value (non-cancelled): ${formatMoney(s.totalQuotedValue)}`);
  lines.push(`Revenue collected (lifetime): ${formatMoney(s.totalRevenueCollected)}`);
  lines.push(`Deposits collected (lifetime): ${formatMoney(s.totalDepositsCollected)}`);
  lines.push(`Outstanding required deposits: ${formatMoney(s.unpaidDepositsTotal)}`);
  lines.push(`Outstanding final balances: ${formatMoney(s.outstandingFinalsTotal)}`);
  lines.push(
    `Outstanding quotes: ${s.outstandingQuotesCount} jobs · ${formatMoney(s.outstandingQuotesValue)}`
  );
  lines.push(`Sq ft quoted (lifetime): ${Math.round(s.totalSqFtQuoted)}`);
  lines.push(`Sq ft installed (lifetime): ${Math.round(s.totalSqFtInstalled)}`);
  lines.push(`Profile LF installed: ${Math.round(s.totalProfileLfInstalled)}`);
  lines.push(`Miter LF installed: ${Math.round(s.totalMiterLfInstalled)}`);
  lines.push(`Splash LF installed: ${Math.round(s.totalSplashLfInstalled)}`);
  lines.push(`Slabs installed: ${Math.round(s.totalSlabsInstalled)}`);
  lines.push(`Sinks installed: ${Math.round(s.totalSinksInstalled)}`);
  lines.push(`Average job value: ${formatMoney(s.averageJobValue)}`);
  lines.push(`Average gross margin: ${formatPercent(s.averageMarginPct, 1)}`);
  lines.push(`Jobs with margin >= 50%: ${s.marginAbove50Count}`);
  lines.push(`Jobs with margin >= 75%: ${s.marginAbove75Count}`);
  lines.push(`Stale quotes (>30d, still in quote): ${s.staleQuotesCount} · ${formatMoney(s.staleQuotesValue)}`);
  lines.push(`Stale approved jobs (>90d, not yet complete): ${s.staleApprovedCount} · ${formatMoney(s.staleApprovedValue)}`);
  lines.push(`Quote→Active conversion: ${formatRate(s.quoteToActiveRate, 1)}`);
  lines.push(`Active→Complete conversion: ${formatRate(s.activeToCompleteRate, 1)}`);
  lines.push(`Win rate (vs cancelled): ${formatRate(s.winRate, 1)}`);
  lines.push(`Commission earned (in period): ${formatMoney(s.totalCommissionEarned)}`);
  lines.push("");
  lines.push("=== Pipeline by status ===");
  for (const row of bundle.pipeline) {
    lines.push(`${row.status}: ${row.count} jobs · ${formatMoney(row.value)}`);
  }
  lines.push("");
  lines.push("=== By material category (granite vs quartz vs …) ===");
  if (s.byMaterialCategory.length === 0) {
    lines.push("(no material data)");
  } else {
    for (const m of s.byMaterialCategory) {
      const label = MATERIAL_CATEGORY_LABELS[m.category] ?? m.category;
      const top =
        m.topProducts.length > 0
          ? ` · top: ${m.topProducts.map((p) => `${p.productName} (×${p.jobs})`).join(", ")}`
          : "";
      lines.push(
        `${label}: ${m.jobs} jobs · quoted ${formatMoney(m.quotedValue)} · paid ${formatMoney(m.paidValue)} · ${Math.round(m.sqFt)} sqft · material cost ${formatMoney(m.materialCost)} · avg margin ${formatPercent(m.averageMarginPct, 1)} · margin>=50% ${m.marginAbove50Count} · margin>=75% ${m.marginAbove75Count} · installed ${Math.round(m.installedSqFt)} sqft / ${Math.round(m.installedSlabs)} slabs${top}`
      );
    }
  }
  lines.push("");
  lines.push("=== Per-rep snapshot ===");
  for (const r of bundle.perRep) {
    const name =
      r.userId === "_unassigned" ? "Unassigned" : memberName[r.userId] ?? r.userId;
    lines.push(
      `${name}: ${r.jobs} jobs (${r.activeJobs} active, ${r.completedJobs} won, ${r.cancelledJobs} cancelled) · quoted ${formatMoney(r.quotedValue)} · commission ${formatMoney(r.commissionEarned)}`
    );
  }
  lines.push("");
  lines.push("=== Top customers ===");
  for (const c of bundle.topCustomers) {
    lines.push(
      `${customerName[c.customerId] ?? c.customerId}: ${c.jobs} jobs · ${formatMoney(c.quotedValue)}`
    );
  }
  lines.push("");
  lines.push("=== Per-job rows (most recent first, capped at 250) ===");
  lines.push(
    "Schema: id | name | status | rep | category | material | vendor | product | thickness | quoted | paid | depositReceived | requiredDeposit | balanceDue | sqFt | profileLf | materialCost | marginPct | createdAt | approvedQuoteAt | installedAt | completedAt | daysSinceCreated | daysSinceApproved"
  );
  for (const j of bundle.jobRows) {
    const rep = j.assignedUserId
      ? memberName[j.assignedUserId] ?? j.assignedUserId
      : "Unassigned";
    lines.push(
      [
        j.id,
        j.name,
        j.status,
        rep,
        j.materialCategory,
        j.material ?? "—",
        j.vendor ?? "—",
        j.productName ?? "—",
        j.thickness ?? "—",
        round(j.quotedTotal),
        round(j.paidTotal),
        round(j.depositReceived),
        round(j.requiredDeposit),
        round(j.balanceDue),
        round(j.sqFt),
        round(j.profileLf),
        round(j.materialCost),
        j.marginPct == null ? "—" : `${j.marginPct.toFixed(1)}%`,
        j.createdAt?.slice(0, 10) ?? "—",
        j.approvedQuoteAt?.slice(0, 10) ?? "—",
        j.installedAt?.slice(0, 10) ?? "—",
        j.completedAt?.slice(0, 10) ?? "—",
        j.daysSinceCreated == null ? "—" : Math.round(j.daysSinceCreated),
        j.daysSinceApproved == null ? "—" : Math.round(j.daysSinceApproved),
      ].join(" | ")
    );
  }
  return lines.join("\n");
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

async function runAssistant(input: {
  apiKey: string;
  model: string;
  question: string;
  contextText: string;
  history: ChatTurn[];
}): Promise<string> {
  const { apiKey, model, question, contextText, history } = input;

  /**
   * We send the rolled-up context as a system instruction so the
   * model treats it as authoritative ground truth, and let the chat
   * `contents` carry the user/assistant turns. Temperature is low
   * because business questions want deterministic counts, not creative
   * embellishment.
   */
  const systemInstruction = [
    "You are an internal business analyst for a stone fabrication company.",
    "Answer concisely and accurately using the data provided in the context block.",
    "Always quote dollar amounts with a $ and use thousands separators.",
    "When the user asks about subsets of jobs (e.g. 'jobs with margin > 75%'), filter the per-job rows yourself before answering.",
    "When asked about material types (granite, quartz, quartzite, marble, etc.) prefer the pre-aggregated 'By material category' block. Only fall back to filtering per-job rows by `category` / `material` / `product` if the user asks something the aggregate block doesn't cover.",
    "If the data does not answer the question, say so plainly rather than inventing numbers.",
    "Prefer bullet points for lists of jobs and keep individual answers under ~200 words unless the user asks for more detail.",
    "",
    "=== CONTEXT BLOCK ===",
    contextText,
    "=== END CONTEXT ===",
  ].join("\n");

  const contents = history.map((t) => ({
    role: t.role === "user" ? "user" : "model",
    parts: [{ text: t.text }],
  }));
  // The history already includes the latest user turn (we appended it
  // before calling), so don't push the question again.
  if (contents.length === 0) {
    contents.push({ role: "user", parts: [{ text: question }] });
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { role: "system", parts: [{ text: systemInstruction }] },
        contents,
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1024,
        },
      }),
    }
  );

  if (!res.ok) {
    let body = "";
    try {
      body = await res.text();
    } catch {
      // ignore
    }
    throw new Error(
      `Gemini request failed (${res.status}). ${body.slice(0, 200)}`
    );
  }

  const json = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };
  const text = json.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();
  if (!text) throw new Error("Assistant returned an empty response.");
  return text;
}
