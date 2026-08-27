import { useEffect, useState } from "react";

const STORAGE_KEY = "dripline_test_emails";
const MAX_ENTRIES = 10;

function readEmails(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === "string") : [];
  } catch {
    return [];
  }
}

/** Most-recently-used email lives at the front, so `emails[0]` is always the
 * one to prefill a "Send test" field with. */
export function useEmailHistory() {
  const [emails, setEmails] = useState<string[]>(() => readEmails());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(emails));
  }, [emails]);

  function addEmail(email: string) {
    const trimmed = email.trim();
    if (!trimmed) return;
    setEmails((prev) => [trimmed, ...prev.filter((e) => e !== trimmed)].slice(0, MAX_ENTRIES));
  }

  function removeEmail(email: string) {
    setEmails((prev) => prev.filter((e) => e !== email));
  }

  return { emails, addEmail, removeEmail };
}
