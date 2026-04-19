import { useEffect, useMemo, useRef, useState } from "react";
import {
  JOB_ACTIVE_EDITOR_STALE_MS,
  type JobActiveEditor,
  type JobRecord,
} from "../types/compareQuote";
import {
  claimJobEditor,
  clearJobPresence,
  heartbeatJobEditor,
  heartbeatJobPresence,
  releaseJobEditor,
  subscribeJobPresence,
  type JobPresenceRow,
} from "../services/compareQuoteFirestore";

const HEARTBEAT_INTERVAL_MS = 15_000;
const SESSION_KEY = "compareQuote.presenceSessionId";

function getOrCreateSessionId(): string {
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const created =
      typeof crypto?.randomUUID === "function"
        ? crypto.randomUUID()
        : `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    window.sessionStorage.setItem(SESSION_KEY, created);
    return created;
  } catch {
    return `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export interface UseJobCollaborationOptions {
  job: JobRecord | null;
  userId: string | null;
  displayName: string | null;
  /**
   * `"viewing"` → only presence heartbeats (read-only screen).
   * `"editing"` → claim the soft edit lock and keep it alive.
   */
  mode: "viewing" | "editing";
}

export interface UseJobCollaborationResult {
  /** Other sessions currently watching this job (excluding self). */
  viewers: JobPresenceRow[];
  /** Whoever currently holds the edit lock (may be self). */
  activeEditor: JobActiveEditor | null;
  /** True when someone *other than us* is actively editing. */
  lockedByOther: boolean;
  /** Request the lock for the current session (optionally force takeover). */
  takeover: () => Promise<void>;
  /** This session's stable identifier — useful for diffing. */
  sessionId: string;
}

/**
 * One hook per job view. Handles the full presence/soft-lock lifecycle:
 *   • Always sends a presence heartbeat so other tabs can see who's here.
 *   • In editing mode, tries to claim `activeEditor`; if another session
 *     already holds it, we mark `lockedByOther` and skip claiming.
 *   • `takeover()` forces the claim (user said "yes, kick them out").
 *   • On unmount / tab close, we clear presence and release the lock.
 */
export function useJobCollaboration({
  job,
  userId,
  displayName,
  mode,
}: UseJobCollaborationOptions): UseJobCollaborationResult {
  const [viewers, setViewers] = useState<JobPresenceRow[]>([]);
  const [activeEditor, setActiveEditor] = useState<JobActiveEditor | null>(
    null
  );
  const sessionIdRef = useRef<string>(getOrCreateSessionId());

  const companyId = job?.companyId ?? null;
  const customerId = job?.customerId ?? null;
  const jobId = job?.id ?? null;

  /** Keep local `activeEditor` in sync with the job doc the parent passes. */
  useEffect(() => {
    setActiveEditor(job?.activeEditor ?? null);
  }, [job?.activeEditor]);

  /** Presence subscription + our own heartbeat. */
  useEffect(() => {
    if (!companyId || !customerId || !jobId || !userId) return;
    const identity = {
      userId,
      displayName: displayName ?? null,
      sessionId: sessionIdRef.current,
    };
    const sub = subscribeJobPresence(
      companyId,
      customerId,
      jobId,
      (rows) => setViewers(rows.filter((r) => r.sessionId !== identity.sessionId))
    );
    void heartbeatJobPresence(companyId, customerId, jobId, identity);
    const interval = window.setInterval(() => {
      void heartbeatJobPresence(companyId, customerId, jobId, identity);
    }, HEARTBEAT_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
      sub();
      void clearJobPresence(companyId, customerId, jobId, identity);
    };
  }, [companyId, customerId, jobId, userId, displayName]);

  /** Soft edit lock lifecycle when we're in "editing" mode. */
  useEffect(() => {
    if (mode !== "editing") return;
    if (!companyId || !customerId || !jobId || !userId) return;
    const identity = {
      userId,
      displayName: displayName ?? null,
      sessionId: sessionIdRef.current,
    };
    let cancelled = false;
    let interval: number | null = null;

    (async () => {
      const result = await claimJobEditor(companyId, customerId, jobId, identity);
      if (cancelled) return;
      if (result.ok) {
        setActiveEditor(result.editor);
        interval = window.setInterval(async () => {
          const status = await heartbeatJobEditor(
            companyId,
            customerId,
            jobId,
            identity
          );
          if (status === "lost" && interval) {
            window.clearInterval(interval);
            interval = null;
          }
        }, HEARTBEAT_INTERVAL_MS);
      } else {
        setActiveEditor(result.current);
      }
    })();

    return () => {
      cancelled = true;
      if (interval) window.clearInterval(interval);
      void releaseJobEditor(companyId, customerId, jobId, identity);
    };
  }, [mode, companyId, customerId, jobId, userId, displayName]);

  const lockedByOther = useMemo(() => {
    if (!activeEditor || !userId) return false;
    if (activeEditor.userId === userId && activeEditor.sessionId === sessionIdRef.current) {
      return false;
    }
    const ts = Date.parse(activeEditor.heartbeatAt);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < JOB_ACTIVE_EDITOR_STALE_MS;
  }, [activeEditor, userId]);

  const takeover = async () => {
    if (!companyId || !customerId || !jobId || !userId) return;
    const identity = {
      userId,
      displayName: displayName ?? null,
      sessionId: sessionIdRef.current,
    };
    const result = await claimJobEditor(companyId, customerId, jobId, identity, {
      takeover: true,
    });
    if (result.ok) setActiveEditor(result.editor);
  };

  return {
    viewers,
    activeEditor,
    lockedByOther,
    takeover,
    sessionId: sessionIdRef.current,
  };
}
