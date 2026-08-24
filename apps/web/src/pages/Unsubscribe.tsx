import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { Button, Checkbox, CheckboxLabel, Alert } from "../components/ui/index.js";

interface PreferenceData {
  email: string;
  lists: { id: number; name: string }[];
}

export default function Unsubscribe() {
  const { campaignUuid, subscriberUuid } = useParams();
  const [searchParams] = useSearchParams();
  const sig = searchParams.get("sig") ?? "";

  const [data, setData] = useState<PreferenceData | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const base = `/unsubscribe/${campaignUuid}/${subscriberUuid}`;

  useEffect(() => {
    api
      .get<PreferenceData>(`${base}/lists?sig=${encodeURIComponent(sig)}`)
      .then((result) => {
        setData(result);
        setChecked(new Set(result.lists.map((l) => l.id)));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "invalid unsubscribe link"))
      .finally(() => setLoading(false));
  }, [campaignUuid, subscriberUuid, sig]);

  function toggle(id: number) {
    setChecked((ids) => {
      const next = new Set(ids);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function unsubscribeSelected() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`${base}/lists`, { sig, list_ids: [...checked] });
      setDone("You've been unsubscribed from the selected lists.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to update your preferences");
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribeAll() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`${base}/all`, { sig });
      setDone("You've been unsubscribed from all mailing lists.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to unsubscribe");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-background flex min-h-screen items-center justify-center p-4">
      <div className="w-[420px]">
        <div className="border-border bg-block-layout rounded-lg border p-6 shadow-sm">
          <h2 className="mb-1 text-xl font-medium">Unsubscribe</h2>

          {loading && <p className="text-muted-foreground text-sm">Loading…</p>}

          {!loading && error && !data && <Alert variant="destructive">{error}</Alert>}

          {!loading && data && !done && (
            <>
              <p className="text-muted-foreground mb-4 text-sm">{data.email}</p>

              {data.lists.length > 0 ? (
                <>
                  <p className="mb-2 text-sm">Select the lists you want to unsubscribe from:</p>
                  <div className="mb-4 space-y-2">
                    {data.lists.map((l) => (
                      <div key={l.id} className="flex items-center gap-1.5">
                        <Checkbox
                          checked={checked.has(l.id)}
                          onCheckedChange={() => toggle(l.id)}
                          id={`list-${l.id}`}
                        />
                        <CheckboxLabel htmlFor={`list-${l.id}`}>{l.name}</CheckboxLabel>
                      </div>
                    ))}
                  </div>
                  {error && (
                    <Alert variant="destructive" className="mb-4">
                      {error}
                    </Alert>
                  )}
                  <div className="flex flex-col gap-2">
                    <Button disabled={busy} onClick={unsubscribeSelected}>
                      Unsubscribe from selected
                    </Button>
                    <Button variant="outline" disabled={busy} onClick={unsubscribeAll}>
                      Unsubscribe from everything
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="mb-4 text-sm">
                    Click below to stop receiving any further emails from us.
                  </p>
                  {error && (
                    <Alert variant="destructive" className="mb-4">
                      {error}
                    </Alert>
                  )}
                  <Button disabled={busy} onClick={unsubscribeAll} className="w-full">
                    Unsubscribe
                  </Button>
                </>
              )}
            </>
          )}

          {done && <p className="text-sm">{done}</p>}
        </div>
      </div>
    </div>
  );
}
