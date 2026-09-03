import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import type { List, Subscriber } from "../lib/types.js";
import Badge from "../components/Badge.js";
import {
  PageHeaderWrapper,
  BlockLayout,
  Button,
  Input,
  Textarea,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  FormLabel,
  TableWrapper,
  Table,
  TableBody,
  TableRow,
  TableCell,
  Tag,
  Popconfirm,
  Alert,
  Skeleton,
  Typography,
} from "../components/ui/index.js";

interface SubscriberWithLists extends Subscriber {
  lists: { id: number; name: string; optin: "single" | "double"; status: string }[];
}

function listMembershipBadge(l: { optin: "single" | "double"; status: string }) {
  if (l.status === "unsubscribed") {
    return {
      status: "unsubscribed",
      label: "unsubscribed",
      title: "Won't receive campaigns from this list.",
    };
  }
  if (l.optin === "double") {
    return l.status === "confirmed"
      ? {
          status: "confirmed",
          label: "confirmed",
          title: "Confirmed their double opt-in -- eligible to receive campaigns.",
        }
      : {
          status: "unconfirmed",
          label: "awaiting confirmation",
          title:
            "Double opt-in list: excluded from campaigns until they confirm. No confirmation email is sent yet -- this flow isn't built.",
        };
  }
  return {
    status: "confirmed",
    label: "subscribed",
    title: "Single opt-in list -- eligible to receive campaigns.",
  };
}

export default function SubscriberDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [subscriber, setSubscriber] = useState<SubscriberWithLists | null>(null);
  const [lists, setLists] = useState<List[]>([]);
  const [addListId, setAddListId] = useState<string>("");
  const [newTag, setNewTag] = useState("");
  const [editingProfile, setEditingProfile] = useState(false);
  const [name, setName] = useState("");
  const [attribsText, setAttribsText] = useState("{}");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  function load() {
    api.get<SubscriberWithLists>(`/subscribers/${id}`).then(setSubscriber);
  }

  useEffect(() => {
    load();
    api.get<List[]>("/lists").then(setLists);
  }, [id]);

  if (!subscriber) return <Skeleton className="h-48" />;

  const tags = subscriber.tags ?? [];
  const availableLists = lists.filter((l) => !subscriber.lists.some((sl) => sl.id === l.id));

  async function addToList() {
    if (!addListId) return;
    await api.put(`/subscribers/${id}/lists/${addListId}`, {});
    setAddListId("");
    load();
  }

  async function removeFromList(listId: number) {
    await api.delete(`/subscribers/${id}/lists/${listId}`);
    load();
  }

  async function resubscribeToList(listId: number) {
    await api.put(`/subscribers/${id}/lists/${listId}`, {});
    load();
  }

  async function addTag(e: React.FormEvent) {
    e.preventDefault();
    if (!newTag) return;
    await api.put(`/subscribers/${id}/tags/${encodeURIComponent(newTag)}`, {});
    setNewTag("");
    load();
  }

  async function removeTag(tag: string) {
    await api.delete(`/subscribers/${id}/tags/${encodeURIComponent(tag)}`);
    load();
  }

  async function blocklist() {
    await api.post(`/subscribers/${id}/blocklist`);
    load();
  }

  async function unblocklist() {
    await api.post(`/subscribers/${id}/unblocklist`);
    load();
  }

  async function remove() {
    await api.delete(`/subscribers/${id}`);
    navigate("/subscribers");
  }

  function beginEditProfile() {
    if (!subscriber) return;
    setName(subscriber.name);
    setAttribsText(JSON.stringify(subscriber.attribs, null, 2));
    setProfileError(null);
    setEditingProfile(true);
  }

  async function saveProfile() {
    let attribs: Record<string, unknown>;
    try {
      attribs = JSON.parse(attribsText);
    } catch {
      setProfileError("Attributes must be valid JSON.");
      return;
    }
    setSavingProfile(true);
    setProfileError(null);
    try {
      // The editor holds the whole object, so a keystroke deleting a key has
      // to actually delete it -- the API merges by default.
      await api.patch(`/subscribers/${id}`, { name, attribs, attribs_mode: "replace" });
      setEditingProfile(false);
      load();
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSavingProfile(false);
    }
  }

  return (
    <div>
      <PageHeaderWrapper
        variant="title-with-actions"
        title={subscriber.email}
        actions={<Badge status={subscriber.status} />}
      />

      <BlockLayout className="mb-4">
        {editingProfile ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <FormLabel>Name</FormLabel>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <FormLabel>Attributes (JSON)</FormLabel>
              <Textarea
                rows={8}
                value={attribsText}
                onChange={(e) => setAttribsText(e.target.value)}
                className="font-mono"
              />
            </div>
            {profileError && <Alert variant="destructive">{profileError}</Alert>}
            <div className="flex gap-2">
              <Button onClick={saveProfile} disabled={savingProfile}>
                {savingProfile ? "Saving…" : "Save"}
              </Button>
              <Button
                variant="outline"
                disabled={savingProfile}
                onClick={() => {
                  setEditingProfile(false);
                  setProfileError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div>
              <strong>Name:</strong>{" "}
              {subscriber.name || <span className="text-muted-foreground">—</span>}
            </div>
            <div>
              <strong>Attributes:</strong>
              <pre className="bg-muted mt-2 overflow-auto rounded-md p-2 font-mono text-sm">
                {JSON.stringify(subscriber.attribs, null, 2)}
              </pre>
            </div>
            <div>
              <Button variant="outline" size="sm" onClick={beginEditProfile}>
                Edit
              </Button>
            </div>
          </div>
        )}
      </BlockLayout>

      <BlockLayout className="mb-4">
        <Typography variant="h3" className="mb-4">
          Lists
        </Typography>
        <TableWrapper>
          <Table>
            <TableBody>
              {subscriber.lists.map((l) => {
                const badge = listMembershipBadge(l);
                return (
                  <TableRow key={l.id}>
                    <TableCell>
                      {l.name} <span className="text-muted-foreground">({l.optin} opt-in)</span>
                    </TableCell>
                    <TableCell>
                      <Badge status={badge.status} label={badge.label} title={badge.title} />
                    </TableCell>
                    <TableCell className="text-right">
                      {l.status === "unsubscribed" ? (
                        <Button variant="outline" size="sm" onClick={() => resubscribeToList(l.id)}>
                          Resubscribe
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => removeFromList(l.id)}>
                          Remove
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableWrapper>
        <div className="mt-4 flex gap-2">
          <Select value={addListId} onValueChange={setAddListId}>
            <SelectTrigger className="max-w-xs">
              <SelectValue placeholder="Add to list…" />
            </SelectTrigger>
            <SelectContent>
              {availableLists.map((l) => (
                <SelectItem key={l.id} value={String(l.id)}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={addToList} disabled={!addListId}>
            Add
          </Button>
        </div>
      </BlockLayout>

      <BlockLayout className="mb-4">
        <Typography variant="h3" className="mb-4">
          Tags
        </Typography>
        <div className="mb-4 flex flex-wrap gap-2">
          {tags.map((t) => (
            <Tag key={t} variant="default" onRemove={() => removeTag(t)}>
              {t}
            </Tag>
          ))}
          {tags.length === 0 && <span className="text-muted-foreground text-sm">No tags.</span>}
        </div>
        <form className="flex gap-2" onSubmit={addTag}>
          <Input
            placeholder="new tag"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            className="max-w-xs"
          />
          <Button type="submit">Add tag</Button>
        </form>
      </BlockLayout>

      <div className="flex gap-2">
        {subscriber.status === "blocklisted" ? (
          <Popconfirm
            description="Remove this subscriber from the blocklist? Lists they were unsubscribed from by blocklisting will be restored; any they'd already unsubscribed from before that stay unsubscribed."
            onConfirm={unblocklist}
            confirmText="Unblocklist"
          >
            <Button variant="outline">Remove from blocklist</Button>
          </Popconfirm>
        ) : (
          <Popconfirm
            description="Blocklist this subscriber? They'll be unsubscribed from every list and excluded from all future campaigns."
            onConfirm={blocklist}
            confirmText="Blocklist"
          >
            <Button variant="destructive">Blocklist</Button>
          </Popconfirm>
        )}
        <Popconfirm
          description="Delete this subscriber permanently?"
          onConfirm={remove}
          confirmText="Delete"
        >
          <Button variant="destructive">Delete</Button>
        </Popconfirm>
      </div>
    </div>
  );
}
