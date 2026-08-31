import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api.js";
import type { Connection, List, Template } from "../lib/types.js";

interface AutomationData {
  lists: List[];
  connections: Connection[];
  templates: Template[];
}

const EMPTY: AutomationData = { lists: [], connections: [], templates: [] };

const AutomationDataContext = createContext<AutomationData>(EMPTY);

/** Lists, connections and templates are needed by most node settings panels
 * (and by the one-line summaries on the canvas blocks), so they're fetched
 * once per builder session instead of per panel. */
export function AutomationDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AutomationData>(EMPTY);

  useEffect(() => {
    Promise.all([
      api.get<List[]>("/lists"),
      api.get<Connection[]>("/connections"),
      api.get<Template[]>("/templates"),
    ])
      .then(([lists, connections, templates]) => setData({ lists, connections, templates }))
      .catch(() => setData(EMPTY));
  }, []);

  return <AutomationDataContext.Provider value={data}>{children}</AutomationDataContext.Provider>;
}

export function useAutomationData(): AutomationData {
  return useContext(AutomationDataContext);
}
