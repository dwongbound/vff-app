"use client";
// Org settings › New account codes.
//
// The club's two front doors, side by side, because the whole point is that
// they are DIFFERENT doors: the member list creates people who book the
// airplane and get a statement, the instructor list creates CFIs who don't.
// Showing them as one list with a "kind" column would bury the only fact about
// a code that matters when you're reading one out to somebody.
//
// Admin-only. Every route behind this re-checks that (app/api/signup-codes).
import { useCallback, useEffect, useState } from "react";
import Badge from "./common/Badge";
import Button from "./common/Button";
import Card from "./common/Card";
import Input from "./common/Input";
import LoadingDots from "./common/LoadingDots";
import { fetchJsonArray, sendJson } from "@/lib/api";
import { formatFullDate } from "@/lib/dates";
import {
  SIGNUP_CODE_KINDS,
  SIGNUP_CODE_KIND_BLURBS,
  SIGNUP_CODE_KIND_LABELS,
  normalizeCode,
  signupCodeError,
  type SignupCodeKind,
} from "@/lib/signupCodes";
import type { ApiSignupCode } from "@/lib/types";

/**
 * A readable code to start from.
 *
 * Ambiguous glyphs are left out of the alphabet on purpose — no O/0, no I/1/L.
 * A code's whole job is to survive being read down a phone and typed by
 * somebody who has never seen it, and "was that an oh or a zero" is the way
 * that fails.
 */
function suggestCode(kind: SignupCodeKind): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let tail = "";
  for (let i = 0; i < 6; i++) {
    tail += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `${kind === "INSTRUCTOR" ? "CFI" : "VFF"}-${tail}`;
}

export default function SignupCodesPanel() {
  const [codes, setCodes] = useState<ApiSignupCode[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setCodes(await fetchJsonArray<ApiSignupCode>("/api/signup-codes"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">New account codes</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Nobody can create an account without one of these. Hand a member code
          to someone joining the club and an instructor code to a CFI who
          teaches here — the code decides which kind of account they get, so
          they never choose for themselves.
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </p>
      )}

      {codes === null ? (
        <Card>
          <LoadingDots size="sm" />
        </Card>
      ) : (
        <>
          {/* A club with members and no live codes is CLOSED — nobody can join
              until someone adds one. That's a legitimate state and not an
              error, but it's not usually what an admin meant to leave behind,
              so it says so rather than looking like an empty list. */}
          {codes.every((c) => !c.active) && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
              No live codes, so nobody can create an account right now. Add one
              below to reopen sign-ups.
            </p>
          )}

          {SIGNUP_CODE_KINDS.map((kind) => (
            <CodeList
              key={kind}
              kind={kind}
              codes={codes.filter((c) => c.kind === kind)}
              onError={setError}
              onChanged={load}
            />
          ))}
        </>
      )}
    </div>
  );
}

function CodeList({
  kind,
  codes,
  onError,
  onChanged,
}: {
  kind: SignupCodeKind;
  codes: ApiSignupCode[];
  onError: (message: string | null) => void;
  onChanged: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  // Id of the row mid-change, so only that row spins.
  const [busyId, setBusyId] = useState<string | null>(null);

  function startAdding() {
    setCode(suggestCode(kind));
    setLabel("");
    setAdding(true);
    onError(null);
  }

  async function add() {
    onError(null);
    const problem = signupCodeError(code);
    if (problem) {
      onError(problem);
      return;
    }
    setBusy(true);
    const result = await sendJson<ApiSignupCode>("/api/signup-codes", "POST", {
      code,
      kind,
      label: label.trim() || null,
    });
    setBusy(false);
    if (!result.ok) {
      onError(result.error ?? "Could not add that code.");
      return;
    }
    setAdding(false);
    await onChanged();
  }

  async function setActive(row: ApiSignupCode, active: boolean) {
    onError(null);
    setBusyId(row.id);
    const result = await sendJson(`/api/signup-codes/${row.id}`, "PATCH", { active });
    setBusyId(null);
    if (!result.ok) {
      onError(result.error ?? "Could not change that code.");
      return;
    }
    await onChanged();
  }

  async function remove(row: ApiSignupCode) {
    onError(null);
    setBusyId(row.id);
    const result = await sendJson(`/api/signup-codes/${row.id}`, "DELETE");
    setBusyId(null);
    if (!result.ok) {
      onError(result.error ?? "Could not delete that code.");
      return;
    }
    await onChanged();
  }

  const live = codes.filter((c) => c.active).length;

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">
            {SIGNUP_CODE_KIND_LABELS[kind]} codes
            <span className="ml-2 font-normal text-gray-500 dark:text-gray-400">
              {live} live
            </span>
          </h3>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {SIGNUP_CODE_KIND_BLURBS[kind]}
          </p>
        </div>
        {!adding && (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`Add a ${SIGNUP_CODE_KIND_LABELS[kind].toLowerCase()} code`}
            onClick={startAdding}
          >
            Add code
          </Button>
        )}
      </div>

      {adding && (
        <div className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Code"
              value={code}
              onChange={(e) => setCode(normalizeCode(e.target.value))}
              className="font-mono"
              hint="Letters, numbers, dashes. Case doesn't matter when it's typed."
            />
            <Input
              label="What it's for (optional)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={
                kind === "INSTRUCTOR" ? "Cascade Flight Training" : "2026 intake"
              }
              hint="Only you see this."
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {/* "Create", not "Add": the button that OPENS this form is already
                called "Add code", and so is the Fleet section's above it. Two
                controls called "Add" on one screen is ambiguous read aloud and
                unaddressable in a test. */}
            <Button size="sm" onClick={add} disabled={busy}>
              {busy ? <LoadingDots size="sm" /> : "Create code"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setCode(suggestCode(kind))}
              disabled={busy}
            >
              Suggest another
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setAdding(false)}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {codes.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No {SIGNUP_CODE_KIND_LABELS[kind].toLowerCase()} codes yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {codes.map((row) => (
            <li
              key={row.id}
              className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 ${
                row.active
                  ? "border-gray-200 dark:border-gray-700"
                  : "border-dashed border-gray-300 opacity-70 dark:border-gray-600"
              }`}
            >
              <code className="font-mono text-sm font-semibold">{row.code}</code>
              {row.active ? (
                <Badge tone="green">Live</Badge>
              ) : (
                <Badge tone="gray">Retired</Badge>
              )}
              <span className="min-w-0 flex-1 truncate text-xs text-gray-500 dark:text-gray-400">
                {row.label && <>{row.label} · </>}
                {row.uses === 0
                  ? "never used"
                  : `${row.uses} account${row.uses === 1 ? "" : "s"}`}
                {row.lastUsedAt && (
                  <> · last {formatFullDate(new Date(row.lastUsedAt))}</>
                )}
              </span>

              {busyId === row.id ? (
                <LoadingDots size="sm" />
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={`${row.active ? "Retire" : "Reopen"} code ${row.code}`}
                    onClick={() => setActive(row, !row.active)}
                  >
                    {row.active ? "Retire" : "Reopen"}
                  </Button>
                  {/* Only ever offered for a code nobody has used. Once it has
                      let somebody in it is the only record of how they joined,
                      and the API refuses too. */}
                  {row.uses === 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Delete code ${row.code}`}
                      onClick={() => remove(row)}
                    >
                      Delete
                    </Button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
