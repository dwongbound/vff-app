"use client";
// /profile's "Personal access keys" card: let an assistant of the member's own
// (Jarvis) read what they can see here, through /api/mcp or /api/agent — and,
// for a key made with the box ticked, book, cancel their bookings and file
// their flights as them.
//
// Not part of the page's form: making and revoking a key happen on the spot,
// through their own routes. A new key is shown ONCE, right after it's made —
// the server keeps only its hash, and (Dylan's call) no part of it is ever
// shown again, not even a prefix.
import { useEffect, useState } from "react";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import ConfirmModal from "@/components/common/ConfirmModal";
import Input from "@/components/common/Input";
import LoadingDots from "@/components/common/LoadingDots";
import { useMe } from "@/components/MeProvider";
import { fetchJsonList, sendJson } from "@/lib/api";
import { accessKeyLine } from "@/lib/accessKeyView";
import type { ApiAccessKey, ApiNewAccessKey } from "@/lib/types";

export default function AccessKeysCard() {
  const { me } = useMe();
  // null = still loading (or the list couldn't be read).
  const [keys, setKeys] = useState<ApiAccessKey[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [name, setName] = useState("");
  // Off by default: a key reads unless the member says otherwise.
  const [canWrite, setCanWrite] = useState(false);
  // Admins only, and off by default too: every pilot's flying and ratings.
  const [canReadClub, setCanReadClub] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The key just made, until the member closes it. Never stored anywhere.
  const [fresh, setFresh] = useState<ApiNewAccessKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<ApiAccessKey | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  useEffect(() => {
    void fetchJsonList<ApiAccessKey>("/api/access-keys").then((list) => {
      if (list) setKeys(list);
      else setLoadFailed(true);
    });
  }, []);

  /** Make a key from the name box and show it once. */
  async function create() {
    setError(null);
    setCreating(true);
    const result = await sendJson<ApiNewAccessKey>("/api/access-keys", "POST", {
      name,
      canWrite,
      canReadClub: me?.isAdmin === true && canReadClub,
    });
    setCreating(false);
    if (!result.ok || !result.data) {
      setError(result.error ?? "Couldn't make the key.");
      return;
    }
    const { key: _key, ...listed } = result.data;
    setKeys((list) => [listed, ...(list ?? [])]);
    setFresh(result.data);
    setCopied(false);
    setName("");
    setCanWrite(false);
    setCanReadClub(false);
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // No clipboard permission: the key is on screen to select by hand.
      setCopied(false);
    }
  }

  /** Revoke the key the confirm window is about. */
  async function revoke() {
    if (!revoking) return;
    setRevokeError(null);
    setRevokeBusy(true);
    const result = await sendJson(`/api/access-keys/${revoking.id}`, "DELETE");
    setRevokeBusy(false);
    if (!result.ok) {
      setRevokeError(result.error ?? "Couldn't revoke the key.");
      return;
    }
    setKeys((list) => (list ?? []).filter((k) => k.id !== revoking.id));
    if (fresh?.id === revoking.id) setFresh(null);
    setRevoking(null);
  }

  const mcpUrl = typeof window === "undefined" ? "/api/mcp" : `${window.location.origin}/api/mcp`;

  return (
    <Card className="space-y-3" data-testid="access-keys">
      <div>
        <h2 className="text-sm font-semibold">Personal access keys</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Let an assistant of yours, like Jarvis, read your bookings, flight log, the
          airplane&rsquo;s squawks and maintenance, and your balance. Turn on booking and filing
          for a key if you want it to do those for you, as you. No key can pay or change anything
          else. Revoke it here any time.
        </p>
      </div>

      {keys === null && !loadFailed && (
        <div className="flex min-h-11 items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <LoadingDots size="sm" label="Loading your keys" />
          Loading your keys…
        </div>
      )}
      {loadFailed && (
        <p className="text-sm text-red-700 dark:text-red-300">Couldn&rsquo;t load your keys.</p>
      )}

      {fresh && (
        <div className="space-y-2 rounded-lg bg-indigo-50 p-3 dark:bg-indigo-900/30">
          <p className="text-sm font-semibold">Copy this key now. It won&rsquo;t be shown again.</p>
          {/* break-all: the key has no space for a browser to break at. */}
          <p
            className="break-all rounded-md bg-white px-3 py-2 font-mono text-xs dark:bg-gray-900"
            data-testid="new-access-key"
          >
            {fresh.key}
          </p>
          <p className="break-words text-xs text-gray-600 dark:text-gray-300">
            To connect it as an MCP server, use <span className="font-mono">{mcpUrl}</span> with the
            header <span className="font-mono">Authorization: Bearer &lt;key&gt;</span>. Or read
            everything in one go from <span className="font-mono">/api/agent</span>.
            {fresh.canReadClub && (
              <>
                {" "}The club&rsquo;s flight log and pilots are at{" "}
                <span className="font-mono">/api/agent/club</span>.
              </>
            )}{" "}
            The full reference is at <span className="font-mono">/api-docs.html</span>.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" className="w-full sm:w-auto" onClick={() => void copy(fresh.key)}>
              {copied ? "Copied" : "Copy key"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="w-full sm:w-auto"
              onClick={() => setFresh(null)}
            >
              Close
            </Button>
          </div>
        </div>
      )}

      {keys && keys.length > 0 && (
        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
          {keys.map((k) => (
            <li key={k.id} className="flex min-h-11 items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{k.name}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{accessKeyLine(k)}</p>
              </div>
              <Button type="button" variant="danger" onClick={() => setRevoking(k)}>
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}

      {keys && (
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5 shrink-0 accent-indigo-600"
            checked={canWrite}
            onChange={(e) => setCanWrite(e.target.checked)}
          />
          Also let this key book, change and cancel my bookings, and file and correct my flights
        </label>
      )}

      {keys && me?.isAdmin && (
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5 shrink-0 accent-indigo-600"
            checked={canReadClub}
            onChange={(e) => setCanReadClub(e.target.checked)}
          />
          Also let this key read club data: every pilot&rsquo;s ratings, total time and
          landings in the last 90 days, and who last flew the airplane (admins only)
        </label>
      )}

      {keys && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Input
              label="Name for a new key"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Jarvis"
              error={error}
            />
          </div>
          <Button
            type="button"
            className="w-full sm:w-auto"
            disabled={creating || !name.trim()}
            onClick={() => void create()}
          >
            {creating ? <LoadingDots size="sm" label="Making the key" /> : "Create key"}
          </Button>
        </div>
      )}

      <ConfirmModal
        open={revoking !== null}
        title={`Revoke "${revoking?.name ?? ""}"?`}
        confirmLabel="Revoke"
        cancelLabel="Close"
        tone="danger"
        busy={revokeBusy}
        error={revokeError}
        onConfirm={() => void revoke()}
        onCancel={() => {
          setRevoking(null);
          setRevokeError(null);
        }}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Anything using this key stops working straight away. You can make a new one afterwards.
        </p>
      </ConfirmModal>
    </Card>
  );
}
