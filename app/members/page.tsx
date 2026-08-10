"use client";
// The club roster: who else flies here, how to reach them, and who runs the
// place. Admins get the one control that matters — handing the admin flag to
// somebody else — inline on each row.
//
// Pilot paperwork (medical, flight review, total time) is deliberately absent:
// that's the member's own business and lives on /profile.
import { useCallback, useEffect, useState } from "react";
import Badge from "@/components/common/Badge";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import LoadingDots from "@/components/common/LoadingDots";
import Modal from "@/components/common/Modal";
import { usePageLoading } from "@/components/LoadingProvider";
import { useMe } from "@/components/MeProvider";
import { fetchJsonArray, sendJson } from "@/lib/api";
import { formatFullDate } from "@/lib/dates";
import {
  POSITION_BLURBS,
  POSITION_LABELS,
  POSITIONS,
  type Position,
} from "@/lib/positions";
import type { ApiMember } from "@/lib/types";

export default function MembersPage() {
  const { me, refreshMe } = useMe();
  const [members, setMembers] = useState<ApiMember[] | null>(null);
  // Id of the member whose role is mid-flight, so only that row's button
  // shows a spinner.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The member whose offices are open for editing, if any.
  const [editing, setEditing] = useState<ApiMember | null>(null);

  usePageLoading(members === null);

  const load = useCallback(async () => {
    setMembers(await fetchJsonArray<ApiMember>("/api/members"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function saveRoles(
    member: ApiMember,
    roles: { positions: Position[]; clubMember: boolean }
  ) {
    setError(null);
    setBusyId(member.id);
    // Both in one PATCH: they're edited on one screen and saved with one
    // button, so a half-applied save (offices took, membership didn't) is a
    // state the admin has no way to notice.
    const result = await sendJson<ApiMember>(
      `/api/members/${member.id}`,
      "PATCH",
      roles
    );
    setBusyId(null);
    if (!result.ok) {
      setError(result.error ?? "Could not change that member's roles.");
      return;
    }
    setEditing(null);
    // If you just changed your OWN roles, your capabilities changed with
    // them — refresh so the Finances tab appears or disappears immediately.
    if (member.me) await refreshMe();
    await load();
  }

  async function setAdmin(member: ApiMember, isAdmin: boolean) {
    setError(null);
    setBusyId(member.id);
    const result = await sendJson<ApiMember>(
      `/api/members/${member.id}`,
      "PATCH",
      { isAdmin }
    );
    setBusyId(null);
    if (!result.ok) {
      setError(result.error ?? "Could not change that member's role.");
      return;
    }
    // Refetch rather than patching in place: the sort is admins-first, so the
    // row moves.
    await load();
  }

  if (!members) return null;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold">Members</h1>
      </header>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="space-y-2">
        {members.map((member) => (
          <Card key={member.id} className="flex flex-wrap items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-semibold text-white">
              {member.name.charAt(0).toUpperCase()}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{member.name}</span>
                {member.me && <Badge tone="blue">You</Badge>}
                {member.isAdmin && <Badge tone="indigo">Admin</Badge>}
                {/* Offices are on the roster because the point of naming a
                    Safety Officer is that members can see who to call. */}
                {member.positions.map((position) => (
                  <Badge key={position} tone="green">
                    {POSITION_LABELS[position]}
                  </Badge>
                ))}
                {member.certificate && (
                  <Badge tone="gray">{member.certificate}</Badge>
                )}
                {/* Only worth saying when it's the unusual case. Every ordinary
                    member is a flying member, and a badge on all of them would
                    be noise that hides the one row it matters on. */}
                {!member.clubMember && (
                  <Badge tone="amber">Teaches here only</Badge>
                )}
              </div>
              <p className="truncate text-sm text-gray-500 dark:text-gray-400">
                {member.email ?? "no email"}
                {member.phone && ` · ${member.phone}`}
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Joined {formatFullDate(new Date(member.joinedAt))}
              </p>
            </div>

            {/* Only admins can change roles; everyone else just reads the
                roster. The server enforces this too. */}
            {me?.isAdmin && (
              <Button
                variant="secondary"
                size="sm"
                aria-label={`Set roles for ${member.name}`}
                onClick={() => setEditing(member)}
              >
                Roles
              </Button>
            )}
            {me?.isAdmin && (
              <Button
                variant={member.isAdmin ? "secondary" : "primary"}
                size="sm"
                // Every row's button would otherwise be called just "Make
                // admin", which is ambiguous to a screen reader reading the
                // page's controls out of context.
                aria-label={
                  member.isAdmin
                    ? `Remove admin from ${member.name}`
                    : `Make ${member.name} an admin`
                }
                disabled={busyId === member.id}
                onClick={() => setAdmin(member, !member.isAdmin)}
              >
                {busyId === member.id ? (
                  <LoadingDots size="sm" />
                ) : member.isAdmin ? (
                  "Remove admin"
                ) : (
                  "Make admin"
                )}
              </Button>
            )}
          </Card>
        ))}
      </div>

      {editing && (
        <RolesModal
          member={editing}
          busy={busyId === editing.id}
          onClose={() => setEditing(null)}
          onSave={(roles) => saveRoles(editing, roles)}
        />
      )}
    </div>
  );
}

/**
 * What a member is to the club: whether they fly here, and which offices they
 * hold. Admins only — the server re-checks.
 *
 * The two live on one screen because they answer the same question from
 * different sides, and because the CFI case only makes sense read together:
 * "Flight Instructor" plus "flies here" is a member who also teaches, and
 * without "flies here" it's a visiting instructor. Every office is listed with
 * what it actually lets someone do, since "Finance Officer" is the difference
 * between seeing your own charges and seeing the whole club's.
 */
function RolesModal({
  member,
  busy,
  onClose,
  onSave,
}: {
  member: ApiMember;
  busy: boolean;
  onClose: () => void;
  onSave: (roles: { positions: Position[]; clubMember: boolean }) => void;
}) {
  const [selected, setSelected] = useState<Position[]>(member.positions);
  const [clubMember, setClubMember] = useState(member.clubMember);

  function toggle(position: Position) {
    setSelected((current) =>
      current.includes(position)
        ? current.filter((p) => p !== position)
        : [...current, position]
    );
  }

  return (
    <Modal open onClose={onClose} title={`${member.name}'s roles`}>
      <div className="space-y-3">
        {/* Membership first: it decides whether half the app exists for this
            account, which the office list below does not. */}
        <button
          type="button"
          onClick={() => setClubMember((v) => !v)}
          aria-pressed={clubMember}
          disabled={member.isAdmin}
          className="flex w-full items-start gap-3 rounded-lg border border-gray-200 px-3 py-2 text-left transition-colors hover:bg-gray-50 disabled:opacity-60 disabled:hover:bg-transparent dark:border-gray-700 dark:hover:bg-gray-700/50"
        >
          <span
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 text-white transition-colors ${
              clubMember
                ? "border-green-500 bg-green-500"
                : "border-gray-300 dark:border-gray-600"
            }`}
          >
            {clubMember && (
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                <path
                  fillRule="evenodd"
                  d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">
              Flying member of the club
            </span>
            <span className="block text-xs text-gray-500 dark:text-gray-400">
              {member.isAdmin
                ? "Admins run the club and book its airplane, so this can't be turned off. Remove admin first."
                : clubMember
                  ? "Books the airplane, files flights, gets a monthly statement."
                  : "Reads the schedule and signs training flights, but doesn't book the airplane and isn't billed. Tick this for a CFI who also flies here as a member."}
            </span>
          </span>
        </button>

        {member.isAdmin && (
          <p className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-200">
            {member.me ? "You are" : `${member.name} is`} an admin, so{" "}
            {member.me ? "you" : "they"} can already do everything any office
            can. These titles still show on the roster.
          </p>
        )}

        <ul className="space-y-1">
          {POSITIONS.map((position) => {
            const on = selected.includes(position);
            return (
              <li key={position}>
                <button
                  type="button"
                  onClick={() => toggle(position)}
                  aria-pressed={on}
                  className="flex w-full items-start gap-3 rounded-lg border border-gray-200 px-3 py-2 text-left transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/50"
                >
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 text-white transition-colors ${
                      on
                        ? "border-green-500 bg-green-500"
                        : "border-gray-300 dark:border-gray-600"
                    }`}
                  >
                    {on && (
                      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                        <path
                          fillRule="evenodd"
                          d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {POSITION_LABELS[position]}
                    </span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">
                      {POSITION_BLURBS[position]}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button
            onClick={() => onSave({ positions: selected, clubMember })}
            disabled={busy}
          >
            {busy ? <LoadingDots size="sm" /> : "Save"}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
