import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api.js";
import type { Connection, List } from "../lib/types.js";

interface AutomationData {
  lists: List[];
  connections: Connection[];
}

const AutomationDataContext = createContext<AutomationData>({ lists: [], connections: [] });

/** Lists and connections are needed by most node settings panels (and by the
 * one-line summaries on the canvas blocks), so they're fetched once per
 * builder session instead of per panel. */
export function AutomationDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AutomationData>({ lists: [], connections: [] });

  useEffect(() => {
    Promise.all([api.get<List[]>("/lists"), api.get<Connection[]>("/connections")])
      .then(([lists, connections]) => setData({ lists, connections }))
      .catch(() => setData({ lists: [], connections: [] }));
  }, []);

  return <AutomationDataContext.Provider value={data}>{children}</AutomationDataContext.Provider>;
}

export function useAutomationData(): AutomationData {
  return useContext(AutomationDataContext);
}
