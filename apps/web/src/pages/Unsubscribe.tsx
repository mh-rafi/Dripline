import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { REASON_COMMENT_MAX, UNSUBSCRIBE_REASONS } from "../lib/unsubscribeReasons.js";
import {
  Button,
  Checkbox,
  CheckboxLabel,
  Alert,
  RadioGroup,
  RadioGroupItem,
  RadioGroupLabel,
  Textarea,
} from "../components/ui/index.js";

interface PreferenceData {
  email: string;
  lists: { id: number; name: string }[];
}

interface UnsubscribeResult {
  ok: boolean;
  /** Null when the click changed nothing (a repeat visit), in which case there
   * is no record to attach feedback to and the question is not offered. */
  unsubscribe_id: string | null;
}

export default function Unsubscribe() {
  // Two URL shapes reach this page: the short /u/:ref/:sub/:sig one that new
  // mail carries, and the older /unsubscribe/:campaignUuid/:subscriberUuid?sig=
  // one that already-delivered mail still does. Each has its own endpoints,
  // since the ids they carry aren't the same.
  const { campaignUuid, subscriberUuid, ref, sub, sig: pathSig } = useParams();
  const [searchParams] = useSearchParams();
  const short = ref !== undefined;
  const sig = short ? (pathSig ?? "") : (searchParams.get("sig") ?? "");

  const [data, setData] = useState<PreferenceData | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  // Feedback is asked for only after the unsubscribe has already been
  // recorded, so the question can never gate or delay someone leaving.
  const [unsubscribeId, setUnsubscribeId] = useState<string | null>(null);
  const [reason, setReason] = useState<string>("");
  const [comment, setComment] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackDone, setFeedbackDone] = useState(false);

  const base = short ? `/u/${ref}/${sub}/${sig}` : `/unsubscribe/${campaignUuid}/${subscriberUuid}`;
  // The short form signs the whole path, so there is no query string to add.
  const listsUrl = short ? `${base}/lists` : `${base}/lists?sig=${encodeURIComponent(sig)}`;

  useEffect(() => {
    api
      .get<PreferenceData>(listsUrl)
      .then((result) => {
        setData(result);
        setChecked(new Set(result.lists.map((l) => l.id)));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "invalid unsubscribe link"))
      .finally(() => setLoading(false));
  }, [listsUrl]);

  function toggle(id: number) {
    setChecked((ids) => {
      const next = new Set(ids);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function leave(path: string, body: object, message: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<UnsubscribeResult>(path, { sig, ...body });
      setUnsubscribeId(result.unsubscribe_id);
      setDone(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to update your preferences");
    } finally {
      setBusy(false);
    }
  }

  async function sendFeedback() {
    if (!reason || !unsubscribeId) return;
    setFeedbackBusy(true);
    try {
      await api.post(`${base}/reason`, {
        sig,
        unsubscribe_id: unsubscribeId,
        reason,
        comment: comment || null,
      });
    } catch {
      // Deliberately swallowed: they have already unsubscribed, and a failed
      // optional survey is not something to hand them an error about.
    } finally {
      setFeedbackBusy(false);
      setFeedbackDone(true);
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
                    <Button
                      disabled={busy}
                      onClick={() =>
                        leave(
                          `${base}/lists`,
                          { list_ids: [...checked] },
                          "You've been unsubscribed from the selected lists.",
                        )
                      }
                    >
                      Unsubscribe from selected
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        leave(`${base}/all`, {}, "You've been unsubscribed from all mailing lists.")
                      }
                    >
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
                  <Button
                    disabled={busy}
                    onClick={() =>
                      leave(`${base}/all`, {}, "You've been unsubscribed from all mailing lists.")
                    }
                    className="w-full"
                  >
                    Unsubscribe
                  </Button>
                </>
              )}
            </>
          )}

          {done && <p className="text-sm">{done}</p>}

          {done && unsubscribeId && !feedbackDone && (
            <div className="border-border mt-5 border-t pt-5">
              <p className="mb-3 text-sm font-medium">
                Mind telling us why?{" "}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </p>
              <RadioGroup value={reason} onValueChange={setReason} className="mb-4 gap-2">
                {UNSUBSCRIBE_REASONS.map((r) => (
                  <RadioGroupLabel key={r.value} htmlFor={`reason-${r.value}`}>
                    <RadioGroupItem value={r.value} id={`reason-${r.value}`} />
                    <span>{r.label}</span>
                  </RadioGroupLabel>
                ))}
              </RadioGroup>

              {reason && (
                <Textarea
                  rows={3}
                  maxLength={REASON_COMMENT_MAX}
                  className="mb-4"
                  placeholder="Anything else you'd like us to know? (optional)"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              )}

              <div className="flex gap-2">
                <Button disabled={!reason || feedbackBusy} onClick={sendFeedback}>
                  Send feedback
                </Button>
                <Button
                  variant="outline"
                  disabled={feedbackBusy}
                  onClick={() => setFeedbackDone(true)}
                >
                  No thanks
                </Button>
              </div>
            </div>
          )}

          {done && feedbackDone && reason && (
            <p className="text-muted-foreground mt-5 text-sm">Thanks — that's helpful.</p>
          )}
        </div>
      </div>
    </div>
  );
}
