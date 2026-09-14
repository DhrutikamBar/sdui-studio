"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { validateSduiDocument } from "../lib/validate";
import { isFirebaseConfigured, observeStudioUser, resetStudioPassword, signInToStudio, signOutOfStudio } from "../lib/firebase";
import { loadRemoteVersions, saveRemoteVersion, watchRemoteScreens } from "../lib/studio-store";
import { writeStudioAudit } from "../lib/studio-governance";
import { StudioGovernancePanel } from "./governance-panel";
import { createStudioProject, legacyProject, watchStudioProjects, type StudioProject } from "../lib/studio-projects";

type JsonObject = {
  type?: string;
  id?: string;
  props?: Record<string, unknown>;
  children?: JsonObject[];
  action?: { type?: string; target?: string };
  [key: string]: unknown;
};

type Screen = {
  id: string;
  route: string;
  title: string;
  status: "Draft" | "Published" | "Archived";
  version: number;
  updatedAt: string;
};

type Version = {
  id: string;
  number: number;
  status: "Draft" | "Published";
  title: string;
  route: string;
  document: string;
  createdAt: string;
  note?: string;
};

type ImportCandidate = {
  document: JsonObject;
  source: string;
  warnings: string[];
};

type SyncState = "local" | "syncing" | "saved" | "failed";

const starterDocument = {
  type: "column",
  props: {
    style: {
      padding: "md",
      background: "#10265D"
    }
  },
  children: [
    {
      type: "text",
      props: {
        value: "Welcome back, {{user.firstName}}",
        style: {
          color: "#FFFFFF",
          fontSize: 22,
          fontWeight: "bold"
        }
      }
    },
    {
      type: "text",
      props: {
        value: "{{wallet.accountName}}",
        style: {
          color: "#D5E3FF",
          fontSize: 14
        }
      }
    },
    {
      type: "text",
      props: {
        value: "{{wallet.balanceDisplay}}",
        style: {
          color: "#FFFFFF",
          fontSize: 30,
          fontWeight: "bold"
        }
      }
    },
    {
      type: "text",
      props: {
        value: "Recent transactions",
        style: {
          color: "#FFFFFF",
          fontSize: 18,
          fontWeight: "bold"
        }
      }
    },
    {
      type: "repeater",
      props: {
        items: "{{transactions}}"
      },
      children: [
        {
          type: "row",
          props: {
            style: {
              width: "fill",
              arrangement: "spaceBetween",
              padding: "sm"
            }
          },
          children: [
            {
              type: "text",
              props: {
                value: "{{item.title}}",
                style: {
                  color: "#FFFFFF"
                }
              }
            },
            {
              type: "text",
              props: {
                value: "{{item.amountDisplay}}",
                style: {
                  color: "{{item.amountColor}}",
                  fontWeight: "bold"
                }
              }
            }
          ]
        }
      ]
    },
    {
      type: "button",
      props: {
        label: "Send money"
      },
      action: {
        type: "navigate",
        target: "send"
      }
    }
  ]
};

const sampleData: Record<string, unknown> = {
  user: {
    firstName: "Tanjiro",
    name: "Tanjiro Kamado"
  },
  wallet: {
    accountName: "Everyday account",
    balanceDisplay: "$32,149.00",
    currency: "USD"
  },
  transactions: [
    {
      title: "Coffee shop",
      amountDisplay: "- $4.50",
      amountColor: "#D13D34"
    },
    {
      title: "Salary",
      amountDisplay: "+ $2,500.00",
      amountColor: "#36A269"
    },
    {
      title: "Streaming subscription",
      amountDisplay: "- $12.99",
      amountColor: "#D13D34"
    }
  ]
};

const initialScreens: Screen[] = [
  { id: "home", route: "home", title: "Home", status: "Published", version: 8, updatedAt: "Today, 10:24" },
  { id: "wallet", route: "wallet", title: "Wallet", status: "Draft", version: 12, updatedAt: "Today, 10:42" },
  { id: "checkout", route: "checkout", title: "Checkout", status: "Published", version: 5, updatedAt: "Yesterday" },
  { id: "send", route: "send", title: "Send money", status: "Published", version: 4, updatedAt: "Yesterday" },
  { id: "settings", route: "settings", title: "Settings", status: "Published", version: 3, updatedAt: "Sep 11" }
];

function localScreenDocument(title: string, subtitle: string, actionLabel: string, actionTarget: string, background: string): JsonObject {
  return {
    type: "column",
    props: { style: { padding: "md", background } },
    children: [
      { type: "text", props: { value: title, style: { color: "#FFFFFF", fontSize: 26, fontWeight: "bold" } } },
      { type: "text", props: { value: subtitle, style: { color: "#D5E3FF", fontSize: 15 } } },
      { type: "spacer", props: { height: 20 } },
      { type: "button", props: { label: actionLabel }, action: { type: "navigate", target: actionTarget } }
    ]
  };
}

const localScreenDocuments: Record<string, JsonObject> = {
  home: localScreenDocument("Home", "Your personalised dashboard is ready.", "Open wallet", "wallet", "#173B76"),
  wallet: starterDocument,
  checkout: localScreenDocument("Checkout", "Review the order before payment.", "Continue", "order-confirmed", "#3C235C"),
  send: localScreenDocument("Send money", "Choose a contact and enter an amount.", "Continue", "send-success", "#1D5C54"),
  settings: localScreenDocument("Settings", "Manage notifications and preferences.", "Return home", "home", "#34415B")
};

function uniqueRoute(baseRoute: string, screens: Screen[]): string {
  const route = baseRoute.trim().replace(/^\/+|\/+$/g, "") || "screen";
  const existingRoutes = new Set(screens.map((screen) => screen.route));
  if (!existingRoutes.has(route)) return route;

  let suffix = 2;
  while (existingRoutes.has(route + "-" + suffix)) suffix += 1;
  return route + "-" + suffix;
}

const bindings = [
  ["user.firstName", "Profile / first name"],
  ["user.name", "Profile / full name"],
  ["wallet.accountName", "Wallet summary / account name"],
  ["wallet.balanceDisplay", "Wallet summary / formatted balance"],
  ["transactions", "Transactions / list"],
  ["item.title", "Transaction item / title"],
  ["item.amountDisplay", "Transaction item / formatted amount"],
  ["item.amountColor", "Transaction item / amount color"]
];

const componentTemplates: Record<string, JsonObject> = {
  text: { type: "text", props: { value: "New text", style: { color: "#142039", fontSize: 16 } } },
  button: { type: "button", props: { label: "Continue" }, action: { type: "navigate", target: "home" } },
  row: { type: "row", props: { style: { padding: "sm", arrangement: "spaceBetween" } }, children: [{ type: "text", props: { value: "Left label" } }, { type: "text", props: { value: "Right value" } }] },
  card: { type: "box", props: { style: { padding: "md", background: "#FFFFFF", cornerRadius: 16 } }, children: [{ type: "text", props: { value: "Card title", style: { color: "#142039", fontWeight: "bold" } } }] },
  spacer: { type: "spacer", props: { height: 16 } },
  image: { type: "image", props: { src: "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=600&q=80", contentDescription: "" } },
  icon: { type: "icon", props: { name: "star" } },
  textInput: { type: "textInput", props: { label: "Label", placeholder: "Enter a value" } },
  switch: { type: "switch", props: { label: "Enable notifications", checked: false } },
  chip: { type: "chip", props: { label: "New" } },
  divider: { type: "divider", props: {} },
  tabs: { type: "tabs", props: { items: ["Overview", "Activity", "Settings"], selectedIndex: 0 } },
  bottomNavigation: { type: "bottomNavigation", props: { items: ["Home", "Wallet", "Profile"], selectedIndex: 0 } },
  lazyColumn: { type: "lazyColumn", props: { height: 260, style: { gap: "sm" } }, children: [{ type: "box", props: { style: { padding: "sm", background: "#FFFFFF", cornerRadius: 12 } }, children: [{ type: "text", props: { value: "Lazy list item" } }] }] },
  lazyRow: { type: "lazyRow", props: { height: 156, itemWidth: 180, style: { gap: "sm" } }, children: [{ type: "box", props: { style: { padding: "sm", background: "#FFFFFF", cornerRadius: 12 } }, children: [{ type: "text", props: { value: "Horizontal item" } }] }] },
  lazyGrid: { type: "lazyGrid", props: { columns: 2, height: 260, style: { gap: "sm" } }, children: [{ type: "box", props: { style: { padding: "sm", background: "#FFFFFF", cornerRadius: 12 } }, children: [{ type: "text", props: { value: "Grid item" } }] }] },
  repeater: { type: "repeater", props: { items: "{{transactions}}", style: { gap: "sm" } }, children: [{ type: "row", props: { style: { width: "fill", arrangement: "spaceBetween", padding: "sm" } }, children: [{ type: "text", props: { value: "{{item.title}}" } }, { type: "text", props: { value: "{{item.amountDisplay}}" } }] }] },
  flowRow: { type: "flowRow", props: { style: { gap: "sm" } }, children: [{ type: "chip", props: { label: "Filter" } }, { type: "chip", props: { label: "Popular" } }, { type: "chip", props: { label: "Nearby" } }] },
  pager: { type: "pager", props: { height: 180 }, children: [{ type: "box", props: { style: { padding: "md", background: "#DDEBFF", cornerRadius: 16 } }, children: [{ type: "text", props: { value: "Page one" } }] }, { type: "box", props: { style: { padding: "md", background: "#E7F8EE", cornerRadius: 16 } }, children: [{ type: "text", props: { value: "Page two" } }] }] },
  checkbox: { type: "checkbox", props: { label: "I agree to the terms", checked: false } },
  badge: { type: "badge", props: { label: "New" } },
  progressBar: { type: "progressBar", props: { progress: 0.65, label: "Profile complete" } },
  rating: { type: "rating", props: { rating: 4 } },
};

const sampleScenarios: Record<string, { label: string; data: Record<string, unknown> }> = {
  standard: { label: "Standard wallet", data: sampleData },
  lowBalance: { label: "Low balance", data: { ...sampleData, wallet: { accountName: "Travel wallet", balanceDisplay: "$12.40", currency: "USD" }, transactions: [{ title: "Coffee shop", amountDisplay: "- $4.50", amountColor: "#D13D34" }] } },
  emptyTransactions: { label: "No transactions", data: { ...sampleData, wallet: { accountName: "New wallet", balanceDisplay: "$0.00", currency: "USD" }, transactions: [] } },
};

function getValue(path: string, source: Record<string, unknown>): unknown {
  return path.split(".").reduce<unknown>((value, segment) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return (value as Record<string, unknown>)[segment];
    }
    return undefined;
  }, source);
}

function resolveText(value: unknown, scope: Record<string, unknown>): string {
  if (typeof value !== "string") return String(value ?? "");
  return value.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_.-]*)\s*\}\}/g, (_, path: string) => {
    const resolved = getValue(path, scope);
    return typeof resolved === "string" || typeof resolved === "number" ? String(resolved) : "";
  });
}

function styleFor(node: JsonObject, scope: Record<string, unknown>): CSSProperties {
  const style = (node.props?.style ?? {}) as Record<string, unknown>;
  const spacing = (value: unknown) => value === "xs" ? 4 : value === "sm" ? 8 : value === "md" ? 16 : value === "lg" ? 24 : value === "xl" ? 32 : typeof value === "number" ? value : 0;
  return {
    padding: spacing(style.padding),
    gap: spacing(style.gap) || undefined,
    background: resolveText(style.background, scope) || undefined,
    color: resolveText(style.color, scope) || undefined,
    fontSize: typeof style.fontSize === "number" ? style.fontSize : undefined,
    fontWeight: style.fontWeight === "bold" ? 700 : style.fontWeight === "medium" ? 600 : undefined,
    textAlign: style.textAlign === "center" || style.textAlign === "end" ? style.textAlign : undefined,
    borderRadius: typeof style.cornerRadius === "number" ? style.cornerRadius : undefined,
    width: style.width === "fill" ? "100%" : undefined,
    minHeight: typeof style.height === "number" ? style.height : undefined,
  };
}

function MobilePreview({ document, data, state, onRetry }: { document: JsonObject | null; data: Record<string, unknown>; state: string; onRetry: () => void }) {
  function renderNode(node: JsonObject, scope: Record<string, unknown>, key: string): ReactNode {
    const props = node.props ?? {};
    const children = node.children ?? [];
    if (props.visible === false) return null;
    if (node.type === "repeater") {
      const rawItems = props.items;
      const path = typeof rawItems === "string" ? rawItems.replace(/[{}\s]/g, "") : "";
      const items = getValue(path, scope);
      if (!Array.isArray(items)) return null;
      return items.map((item, index) =>
        children.map((child, childIndex) =>
          renderNode(child, { ...scope, item, index }, key + "-" + index + "-" + childIndex)
        )
      );
    }

    if (node.type === "lazyColumn" || node.type === "lazyRow" || node.type === "lazyGrid" || node.type === "list" || node.type === "grid") {
      const isRow = node.type === "lazyRow";
      const isGrid = node.type === "lazyGrid" || node.type === "grid";
      const columns = typeof props.columns === "number" ? Math.max(1, Math.floor(props.columns)) : 2;
      const rawItems = props.items;
      const path = typeof rawItems === "string" ? rawItems.replace(/[{}\\s]/g, "") : "";
      const boundItems = getValue(path, scope);
      const renderedItems = Array.isArray(boundItems)
        ? boundItems.flatMap((item, index) => children.map((child, childIndex) => ({ child, scope: { ...scope, item, index }, key: key + "-" + index + "-" + childIndex })))
        : children.map((child, index) => ({ child, scope, key: key + "-" + index }));
      return <div key={key} style={{ display: isGrid ? "grid" : "flex", gridTemplateColumns: isGrid ? `repeat(${columns}, minmax(0, 1fr))` : undefined, flexDirection: isRow ? "row" : "column", overflowX: isRow ? "auto" : undefined, overflowY: !isRow ? "auto" : undefined, maxHeight: typeof props.height === "number" ? props.height : isRow ? undefined : 260, gap: 8, ...styleFor(node, scope) }}>{renderedItems.map((item) => <div key={item.key} style={isRow ? { flex: `0 0 ${typeof props.itemWidth === "number" ? props.itemWidth : 180}px` } : undefined}>{renderNode(item.child, item.scope, item.key)}</div>)}</div>;
    }

    if (node.type === "text") {
      return <p key={key} style={{ margin: "0 0 8px", ...styleFor(node, scope) }}>{resolveText(props.value, scope)}</p>;
    }

    if (node.type === "button") {
      return <button key={key} className="preview-button">{resolveText(props.label, scope)}</button>;
    }

    if (node.type === "image") {
      return <img key={key} className="preview-image" src={resolveText(props.src, scope)} alt={resolveText(props.contentDescription, scope)} />;
    }

    if (node.type === "icon") {
      return <span key={key} className="preview-icon" aria-label={resolveText(props.contentDescription, scope)}>{resolveText(props.name, scope) || "●"}</span>;
    }

    if (node.type === "textInput") {
      return <label key={key} className="preview-input"><span>{resolveText(props.label, scope)}</span><input placeholder={resolveText(props.placeholder, scope)} disabled /></label>;
    }

    if (node.type === "switch") {
      return <label key={key} className="preview-switch"><span>{resolveText(props.label, scope)}</span><input type="checkbox" checked={props.checked === true} readOnly /></label>;
    }

    if (node.type === "checkbox") {
      return <label key={key} className="preview-switch"><span>{resolveText(props.label, scope)}</span><input type="checkbox" checked={props.checked === true} readOnly /></label>;
    }

    if (node.type === "chip") {
      return <span key={key} className="preview-chip">{resolveText(props.label, scope)}</span>;
    }

    if (node.type === "badge") return <span key={key} className="preview-chip">{resolveText(props.label, scope) || "New"}</span>;
    if (node.type === "progressBar") return <div key={key}><span>{resolveText(props.label, scope)}</span><progress value={typeof props.progress === "number" ? props.progress : undefined} max="1" style={{ width: "100%" }} /></div>;
    if (node.type === "rating") return <span key={key} aria-label={`${String(props.rating ?? 0)} out of 5 stars`}>{"★".repeat(Math.max(0, Math.min(5, Number(props.rating) || 0)))}{"☆".repeat(Math.max(0, 5 - Math.min(5, Number(props.rating) || 0)))}</span>;

    if (node.type === "divider") return <hr key={key} className="preview-divider" />;

    if (node.type === "tabs" || node.type === "bottomNavigation") {
      const items = Array.isArray(props.items) ? props.items : [];
      return <div key={key} className={node.type === "tabs" ? "preview-tabs" : "preview-bottom-nav"}>{items.map((item, index) => <span className={props.selectedIndex === index ? "selected" : ""} key={index}>{String(item)}</span>)}</div>;
    }

    if (node.type === "spacer") {
      return <div key={key} style={{ height: 12 }} />;
    }

    if (node.type === "flowRow") {
      return <div key={key} style={{ display: "flex", flexWrap: "wrap", gap: 8, ...styleFor(node, scope) }}>{children.map((child, index) => renderNode(child, scope, key + "-" + index))}</div>;
    }
    if (node.type === "pager") {
      return <div key={key} style={{ display: "flex", overflowX: "auto", scrollSnapType: "x mandatory", gap: 10, ...styleFor(node, scope) }}>{children.map((child, index) => <div key={index} style={{ flex: "0 0 100%", scrollSnapAlign: "start" }}>{renderNode(child, scope, key + "-" + index)}</div>)}</div>;
    }

    const isRow = node.type === "row";
    const isBox = node.type === "box";
    return (
      <div
        key={key}
        style={{
          display: "flex",
          flexDirection: isRow ? "row" : "column",
          justifyContent: isRow && (node.props?.style as Record<string, unknown> | undefined)?.arrangement === "spaceBetween" ? "space-between" : undefined,
          gap: isRow ? 8 : 0,
          marginBottom: isBox ? 10 : 0,
          ...styleFor(node, scope)
        }}
      >
        {children.map((child, index) => renderNode(child, scope, key + "-" + index))}
      </div>
    );
  }

  return (
    <div className="phone-shell">
      <div className="phone-status"><span>10:39</span><span>5G ◒ 80%</span></div>
      <div className="phone-screen">
        {state === "loading" && <div className="preview-loading"><i /><i /><i /><i /></div>}
        {state === "empty" && <div className="preview-message"><strong>Nothing here yet</strong><span>There is no content to display for this state.</span></div>}
        {(state === "error" || state === "retry") && <div className="preview-message"><strong>We could not load this screen</strong><span>Check the connection and try again.</span>{state === "retry" && <button onClick={onRetry}>Try again</button>}</div>}
        {state === "content" && (document ? renderNode(document, data, "root") : <p>Fix JSON to restore preview.</p>)}
      </div>
      <div className="phone-home" />
    </div>
  );
}

export default function StudioPage() {
  const [screens, setScreens] = useState(initialScreens);
  const [projects, setProjects] = useState<StudioProject[]>([legacyProject]);
  const [selectedProjectId, setSelectedProjectId] = useState(legacyProject.id);
  const [showProjectDialog, setShowProjectDialog] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectPackageName, setProjectPackageName] = useState("");
  const [projectError, setProjectError] = useState("");
  const [selectedId, setSelectedId] = useState("wallet");
  const [title, setTitle] = useState("Wallet");
  const [route, setRoute] = useState("wallet");
  const [json, setJson] = useState(JSON.stringify(starterDocument, null, 2));
  const [screenDocuments, setScreenDocuments] = useState<Record<string, string>>(() => Object.fromEntries(
    Object.entries(localScreenDocuments).map(([id, document]) => [id, JSON.stringify(document, null, 2)])
  ));
  const [notice, setNotice] = useState("Draft loaded. Make a change, preview it, then publish.");
  const [showSampleData, setShowSampleData] = useState(false);
  const [showImporter, setShowImporter] = useState(false);
  const [importText, setImportText] = useState("");
  const [importCandidate, setImportCandidate] = useState<ImportCandidate | null>(null);
  const [selectedPath, setSelectedPath] = useState<number[]>([]);
  const [nestingTargetPath, setNestingTargetPath] = useState<number[] | null>(null);
  const [bindingTarget, setBindingTarget] = useState("value");
  const [bindingFilter, setBindingFilter] = useState("");
  const [previewState, setPreviewState] = useState("content");
  const [showFloatingPreview, setShowFloatingPreview] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [workspaceView, setWorkspaceView] = useState<"build" | "preview" | "governance">("build");
  const [sampleScenario, setSampleScenario] = useState("standard");
  const [showArchived, setShowArchived] = useState(false);
  const [screenSearch, setScreenSearch] = useState("");
  const [publishNote, setPublishNote] = useState("");
  const [previewConfirmed, setPreviewConfirmed] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<Version | null>(null);
  const [versions, setVersions] = useState<Record<string, Version[]>>({
    wallet: [
      { id: "wallet-v12-draft", number: 12, status: "Draft", title: "Wallet", route: "wallet", document: JSON.stringify(starterDocument, null, 2), createdAt: "Just now" },
      { id: "wallet-v11", number: 11, status: "Published", title: "Wallet", route: "wallet", document: JSON.stringify(starterDocument, null, 2), createdAt: "Today, 10:24" }
    ]
  });
  const [firebaseUser, setFirebaseUser] = useState<{ uid: string; displayName: string | null; email: string | null } | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("local");
  const [syncDetail, setSyncDetail] = useState("Local browser workspace");
  const [authReady, setAuthReady] = useState(false);
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [signInError, setSignInError] = useState("");
  const [signInBusy, setSignInBusy] = useState(false);

  useEffect(() => observeStudioUser((user) => {
    setFirebaseUser(user ? { uid: user.uid, displayName: user.displayName, email: user.email } : null);
    setSyncState("local");
    setSyncDetail(user ? "Signed in — connecting to shared workspace" : "Local browser workspace");
    setAuthReady(true);
  }), []);

  useEffect(() => {
    if (!firebaseUser) return;
    return watchStudioProjects(firebaseUser.uid, (remoteProjects) => {
      setProjects([legacyProject, ...remoteProjects.filter((project) => project.id !== legacyProject.id)]);
    }, (message) => {
      setNotice("Project list could not load: " + message);
    });
  }, [firebaseUser]);

  useEffect(() => {
    if (!firebaseUser) return;
    return watchRemoteScreens(selectedProjectId === legacyProject.id ? undefined : selectedProjectId, (remote) => {
      if (!remote.length) return;
      // Firestore may initially contain only the screen that was just saved.
      // Merge that metadata into the local/bundled catalog rather than replacing it,
      // so a partial remote collection can never make other screens disappear.
      setScreens((current) => {
        const remoteById = new Map(remote.map((screen) => [
          screen.id,
          { ...screen, updatedAt: new Date(screen.updatedAt).toLocaleString() }
        ]));
        const merged = current.map((screen) => ({ ...screen, ...(remoteById.get(screen.id) ?? {}) }));
        const knownIds = new Set(merged.map((screen) => screen.id));
        remoteById.forEach((screen, id) => {
          if (!knownIds.has(id)) merged.push(screen);
        });
        return merged;
      });
      setSyncState("saved");
      setSyncDetail("Shared workspace is in sync");
    }, (message) => {
      setSyncState("failed");
      setSyncDetail("Shared sync needs attention");
      setNotice("Firestore sync is unavailable: " + message);
    });
  }, [firebaseUser, selectedProjectId]);

  const parsed = useMemo(() => {
    try {
      const document = JSON.parse(json) as JsonObject;
      const errors = validateSduiDocument(document);
      return { document: errors.length === 0 ? document : null, error: errors.join(" ") };
    } catch (error) {
      return { document: null, error: error instanceof Error ? error.message : "Invalid JSON" };
    }
  }, [json]);

  async function saveDraft() {
    if (parsed.error) {
      setNotice("Fix the JSON error before saving.");
      return;
    }
    setScreens((current) => current.map((screen) =>
      screen.id === selectedId ? { ...screen, title, route, status: "Draft", updatedAt: "Just now" } : screen
    ));
    setVersions((current) => ({
      ...current,
      [selectedId]: [{ id: selectedId + "-draft-" + Date.now(), number: (screens.find((screen) => screen.id === selectedId)?.version ?? 0) + 1, status: "Draft", title, route, document: json, createdAt: "Just now" }, ...(current[selectedId] ?? [])]
    }));
    if (firebaseUser) {
      try {
        setSyncState("syncing");
        setSyncDetail("Saving draft to shared workspace…");
        await saveRemoteVersion({ screenId: selectedId, projectId: selectedProjectId === legacyProject.id ? undefined : selectedProjectId, number: (screens.find((screen) => screen.id === selectedId)?.version ?? 0) + 1, status: "Draft", title, route, document: json }, { uid: firebaseUser.uid, label: firebaseUser.displayName ?? firebaseUser.email ?? firebaseUser.uid });
        setSyncState("saved");
        setSyncDetail("Draft saved to shared workspace");
        setNotice("Draft snapshot saved to Firestore.");
      } catch (error) {
        setSyncState("failed");
        setSyncDetail("Draft saved locally — shared save failed");
        setNotice("Local draft saved, but Firestore rejected the write: " + (error instanceof Error ? error.message : "Unknown error"));
      }
    } else {
      setNotice(isFirebaseConfigured ? "Draft saved locally. Sign in to save it to Firestore." : "Draft snapshot saved locally. Add Firebase environment variables to enable shared storage.");
    }
  }

  async function publish() {
    if (parsed.error) {
      setNotice("Publishing blocked: the document JSON is invalid.");
      return;
    }
    if (!previewConfirmed) {
      setNotice("Publishing blocked: confirm that you tested the preview states.");
      return;
    }
    if (!publishNote.trim()) {
      setNotice("Publishing blocked: add a short release note.");
      return;
    }
    if (!route.trim()) {
      setNotice("Publishing blocked: give this screen a route.");
      return;
    }
    const routeConflict = screens.find((screen) =>
      screen.id !== selectedId && screen.status !== "Archived" && screen.route === route
    );
    if (routeConflict) {
      setNotice("Publishing blocked: /" + route + " is already used by " + routeConflict.title + ".");
      return;
    }
    const nextVersion = (screens.find((screen) => screen.id === selectedId)?.version ?? 0) + 1;
    setScreens((current) => current.map((screen) =>
      screen.id === selectedId ? { ...screen, title, route, status: "Published", version: nextVersion, updatedAt: "Just now" } : screen
    ));
    setVersions((current) => ({
      ...current,
      [selectedId]: [{ id: selectedId + "-v" + nextVersion, number: nextVersion, status: "Published", title, route, document: json, createdAt: "Just now", note: publishNote.trim() }, ...(current[selectedId] ?? [])]
    }));
    if (firebaseUser) {
      try {
        setSyncState("syncing");
        setSyncDetail("Publishing to shared workspace…");
        await saveRemoteVersion({ screenId: selectedId, projectId: selectedProjectId === legacyProject.id ? undefined : selectedProjectId, number: nextVersion, status: "Published", title, route, document: json }, { uid: firebaseUser.uid, label: firebaseUser.displayName ?? firebaseUser.email ?? firebaseUser.uid });
        setSyncState("saved");
        setSyncDetail("Published version saved to shared workspace");
        setNotice("Published v" + nextVersion + " to Firestore.");
      } catch (error) {
        setSyncState("failed");
        setSyncDetail("Published locally — shared publish failed");
        setNotice("Local version published, but Firestore rejected the write: " + (error instanceof Error ? error.message : "Unknown error"));
      }
    } else {
      setNotice(isFirebaseConfigured ? "Local version published. Sign in before publishing to Firestore." : "Published locally as v" + nextVersion + ". Add Firebase environment variables to publish for the mobile SDK.");
    }
    setPublishNote("");
    setPreviewConfirmed(false);
  }

  function duplicateScreen() {
    const id = selectedId + "-copy-" + Date.now();
    const copyRoute = uniqueRoute(route + "-copy", screens);
    const copy: Screen = { id, title: title + " copy", route: copyRoute, status: "Draft", version: 0, updatedAt: "Just now" };
    setScreens((current) => [...current, copy]);
    setSelectedId(id);
    setTitle(copy.title);
    setRoute(copy.route);
    setScreenDocuments((current) => ({ ...current, [selectedId]: json, [id]: json }));
    setJson(json);
    setVersions((current) => ({ ...current, [id]: [{ id: id + "-draft", number: 0, status: "Draft", title: copy.title, route: copy.route, document: json, createdAt: "Just now", note: "Copied from " + selectedId }] }));
    setNotice("Created a draft copy. Give it a unique route before publishing.");
  }

  function archiveScreen() {
    setScreens((current) => current.map((screen) => screen.id === selectedId ? { ...screen, status: "Archived", updatedAt: "Just now" } : screen));
    if (firebaseUser) void writeStudioAudit("screen_archived", { uid: firebaseUser.uid, label: firebaseUser.displayName ?? firebaseUser.email ?? firebaseUser.uid }, { screenId: selectedId, targetLabel: title });
    const next = screens.find((screen) => screen.id !== selectedId && screen.status !== "Archived");
    if (next) void chooseScreen(next);
    setNotice("Screen archived. Enable archived screens in the sidebar to restore it.");
  }

  function restoreArchivedScreen() {
    setScreens((current) => current.map((screen) => screen.id === selectedId ? { ...screen, status: "Draft", updatedAt: "Just now" } : screen));
    if (firebaseUser) void writeStudioAudit("screen_restored", { uid: firebaseUser.uid, label: firebaseUser.displayName ?? firebaseUser.email ?? firebaseUser.uid }, { screenId: selectedId, targetLabel: title });
    setNotice("Screen restored as a draft.");
  }

  function createScreen() {
    const name = "New screen";
    const id = "screen-" + Date.now();
    const newRoute = uniqueRoute("new-screen", screens);
    const newScreen: Screen = { id, route: newRoute, title: name, status: "Draft", version: 0, updatedAt: "Just now" };
    setScreens((current) => [...current, newScreen]);
    setSelectedId(id);
    setTitle(name);
    setRoute(newRoute);
    const document = JSON.stringify({ type: "column", props: { style: { padding: "md" } }, children: [] }, null, 2);
    setScreenDocuments((current) => ({ ...current, [selectedId]: json, [id]: document }));
    setJson(document);
    setNotice("New draft screen created. Give it a route, add content, then save a draft.");
  }

  function inspectImport(document: JsonObject): string[] {
    const warnings: string[] = [];
    const walk = (node: JsonObject, path: string) => {
      if (node.type === "image" && typeof node.props?.src !== "string") warnings.push(path + ": image has no source URL.");
      if (node.type === "icon" && typeof node.props?.contentDescription !== "string") warnings.push(path + ": icon has no accessibility description.");
      if (node.action?.type === "openUrl") warnings.push(path + ": web URLs must be approved by the production mobile host.");
      node.children?.forEach((child, index) => walk(child, path + "/" + (child.type ?? "component") + "[" + index + "]"));
    };
    walk(document, document.type ?? "root");
    return warnings;
  }

  function stageImport() {
    try {
      const imported = JSON.parse(importText) as JsonObject;
      const document = (imported.document && typeof imported.document === "object" ? imported.document : imported) as JsonObject;
      const errors = validateSduiDocument(document);
      if (errors.length) {
        setNotice("Import blocked: " + errors.join(" "));
        return;
      }
      const exporterWarnings = Array.isArray(imported.warnings) ? imported.warnings.filter((warning): warning is string => typeof warning === "string") : [];
      setImportCandidate({ document, source: imported.document ? "Figma exporter" : "SDUI JSON", warnings: [...exporterWarnings, ...inspectImport(document)] });
      setNotice("Import is valid and ready for review. Apply it only after checking the review panel.");
    } catch {
      setNotice("Import blocked: paste a complete JSON document from Studio or the Figma exporter.");
    }
  }

  function applyImport() {
    if (!importCandidate) return;
    setJson(JSON.stringify(importCandidate.document, null, 2));
    setShowImporter(false);
    setImportText("");
    setImportCandidate(null);
    setNotice("Import applied to the draft. Review its mobile preview, then save it as a new draft.");
  }

  function cancelImportReview() {
    setImportCandidate(null);
    setNotice("Import review dismissed. Your current draft is unchanged.");
  }

  function exportDocument(document: string, label: string) {
    const file = new Blob([document], { type: "application/json" });
    const url = URL.createObjectURL(file);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = route + "-" + label.replace(/[^a-z0-9-]/gi, "-").toLowerCase() + ".json";
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("Downloaded " + label + " as JSON.");
  }

  function restoreVersion(version: Version) {
    setPendingRestore(version);
  }

  function confirmRestoreVersion() {
    if (!pendingRestore) return;
    const version = pendingRestore;
    setTitle(version.title);
    setRoute(version.route);
    setJson(version.document);
    if (firebaseUser) void writeStudioAudit("version_restored", { uid: firebaseUser.uid, label: firebaseUser.displayName ?? firebaseUser.email ?? firebaseUser.uid }, { screenId: selectedId, targetLabel: title + " v" + version.number });
    setNotice("Restored v" + version.number + " into the editor. Save it as a new draft before publishing.");
    setPendingRestore(null);
  }

  function addComponent(kind: keyof typeof componentTemplates) {
    if (parsed.error || !parsed.document) {
      setNotice("Fix the document before adding a component.");
      return;
    }
    const document = JSON.parse(JSON.stringify(parsed.document)) as JsonObject;
    const selectedContainer = nodeAtPath(document, selectedPath);
    const target = selectedContainer && isContainer(selectedContainer) ? selectedContainer : document;
    target.children = [...(target.children ?? []), componentTemplates[kind]];
    setJson(JSON.stringify(document, null, 2));
    const targetPath = selectedContainer && isContainer(selectedContainer) ? selectedPath : [];
    setSelectedPath([...targetPath, (target.children?.length ?? 1) - 1]);
    setNotice("Added a " + kind + " component " + (targetPath.length ? "inside the selected container." : "to the root screen."));
  }

  function nodeAtPath(document: JsonObject, path: number[]) {
    return path.reduce<JsonObject | null>((node, index) => node?.children?.[index] ?? null, document);
  }

  function updateSelectedNode(update: (node: JsonObject) => void) {
    if (!parsed.document) return;
    const document = JSON.parse(JSON.stringify(parsed.document)) as JsonObject;
    const node = nodeAtPath(document, selectedPath);
    if (!node) return;
    update(node);
    setJson(JSON.stringify(document, null, 2));
  }

  function setSelectedProp(key: string, value: unknown) {
    updateSelectedNode((node) => { node.props = { ...node.props, [key]: value }; });
  }

  function setSelectedStyle(key: string, value: unknown) {
    updateSelectedNode((node) => {
      node.props = { ...node.props, style: { ...((node.props?.style ?? {}) as Record<string, unknown>), [key]: value } };
    });
  }

  function bindableTargets(node: JsonObject | null) {
    if (!node) return [] as Array<{ value: string; label: string }>;
    const common = [{ value: "style.color", label: "Text color" }, { value: "style.background", label: "Background color" }];
    if (node.type === "text") return [{ value: "value", label: "Text value" }, ...common];
    if (["repeater", "lazyColumn", "lazyRow", "lazyGrid"].includes(node.type ?? "")) return [{ value: "items", label: "Items binding" }, ...common];
    if (node.type === "button" || node.type === "chip") return [{ value: "label", label: "Label" }, ...common];
    if (node.type === "image") return [{ value: "src", label: "Image URL" }, { value: "contentDescription", label: "Accessibility description" }];
    if (node.type === "icon") return [{ value: "name", label: "Icon name" }, { value: "contentDescription", label: "Accessibility description" }, ...common];
    if (node.type === "textInput") return [{ value: "label", label: "Label" }, { value: "placeholder", label: "Placeholder" }, ...common];
    return common;
  }

  function applyBinding(path: string) {
    if (!selectedNode) {
      setNotice("Select a component before applying a data binding.");
      return;
    }
    const value = "{{" + path + "}}";
    if (bindingTarget.startsWith("style.")) setSelectedStyle(bindingTarget.slice(6), value);
    else setSelectedProp(bindingTarget, value);
    setNotice("Bound " + bindingTarget + " to " + value + ".");
  }

  function actionCapable(node: JsonObject) {
    return ["button", "chip", "icon", "image", "box", "row", "text"].includes(node.type ?? "");
  }

  function setActionType(type: string) {
    updateSelectedNode((node) => {
      if (type === "none") {
        delete node.action;
        return;
      }
      const defaultTarget = type === "navigate" ? screens[0]?.route ?? "home" : type === "analytics" ? "component_tapped" : type === "refreshData" ? "screen" : type === "openUrl" ? "https://example.com" : type === "toggleState" ? "isEnabled" : "";
      node.action = { type, target: node.action?.target || defaultTarget };
    });
  }

  function setActionTarget(target: string) {
    updateSelectedNode((node) => { node.action = { ...node.action, target }; });
  }

  function deleteSelectedNode() {
    if (!selectedPath.length || !parsed.document) return;
    const document = JSON.parse(JSON.stringify(parsed.document)) as JsonObject;
    const parent = nodeAtPath(document, selectedPath.slice(0, -1));
    parent?.children?.splice(selectedPath[selectedPath.length - 1], 1);
    setJson(JSON.stringify(document, null, 2));
    setSelectedPath([]);
    setNotice("Component removed from this draft.");
  }

  function isContainer(node: JsonObject) {
    return ["column", "row", "box", "list", "grid", "repeater", "lazyColumn", "lazyRow", "lazyGrid", "flowRow", "pager"].includes(node.type ?? "");
  }

  function moveSelectedBy(offset: number) {
    if (!selectedPath.length || !parsed.document) return;
    const document = JSON.parse(JSON.stringify(parsed.document)) as JsonObject;
    const parent = nodeAtPath(document, selectedPath.slice(0, -1));
    const index = selectedPath[selectedPath.length - 1];
    const destination = index + offset;
    if (!parent?.children || destination < 0 || destination >= parent.children.length) {
      setNotice("This component is already at the " + (offset < 0 ? "top" : "bottom") + " of its container.");
      return;
    }
    [parent.children[index], parent.children[destination]] = [parent.children[destination], parent.children[index]];
    setJson(JSON.stringify(document, null, 2));
    setSelectedPath([...selectedPath.slice(0, -1), destination]);
    setNotice("Component moved " + (offset < 0 ? "up" : "down") + ".");
  }

  function duplicateSelectedNode() {
    if (!selectedPath.length || !parsed.document) return;
    const document = JSON.parse(JSON.stringify(parsed.document)) as JsonObject;
    const parent = nodeAtPath(document, selectedPath.slice(0, -1));
    const index = selectedPath[selectedPath.length - 1];
    const selected = parent?.children?.[index];
    if (!parent?.children || !selected) return;
    parent.children.splice(index + 1, 0, JSON.parse(JSON.stringify(selected)) as JsonObject);
    setJson(JSON.stringify(document, null, 2));
    setSelectedPath([...selectedPath.slice(0, -1), index + 1]);
    setNotice("Component duplicated.");
  }

  function setNestingTarget() {
    if (!selectedNode || !isContainer(selectedNode)) {
      setNotice("Choose a layout, collection, or pager as the nesting target.");
      return;
    }
    setNestingTargetPath([...selectedPath]);
    setNotice("Nesting target selected. Choose another component, then use Move into target.");
  }

  function moveSelectedIntoTarget() {
    if (!nestingTargetPath || !selectedPath.length || !parsed.document) {
      setNotice("Choose a nesting target first.");
      return;
    }
    if (selectedPath.every((segment, index) => segment === nestingTargetPath[index]) && selectedPath.length <= nestingTargetPath.length) {
      setNotice("A container cannot be moved into itself or one of its children.");
      return;
    }
    const document = JSON.parse(JSON.stringify(parsed.document)) as JsonObject;
    const sourceParent = nodeAtPath(document, selectedPath.slice(0, -1));
    const sourceIndex = selectedPath[selectedPath.length - 1];
    const selected = sourceParent?.children?.[sourceIndex];
    if (!sourceParent?.children || !selected) return;
    sourceParent.children.splice(sourceIndex, 1);
    const adjustedTargetPath = [...nestingTargetPath];
    const sameParent = selectedPath.length === nestingTargetPath.length && selectedPath.slice(0, -1).every((segment, index) => segment === nestingTargetPath[index]);
    if (sameParent && sourceIndex < adjustedTargetPath[adjustedTargetPath.length - 1]) adjustedTargetPath[adjustedTargetPath.length - 1] -= 1;
    const target = nodeAtPath(document, adjustedTargetPath);
    if (!target || !isContainer(target)) {
      setNotice("The selected nesting target is no longer a container.");
      return;
    }
    target.children = [...(target.children ?? []), selected];
    setJson(JSON.stringify(document, null, 2));
    setSelectedPath([...adjustedTargetPath, target.children.length - 1]);
    setNestingTargetPath(null);
    setNotice("Component moved into the selected container.");
  }

  function outline(node: JsonObject, path: number[] = [], depth = 0): ReactNode {
    const isSelected = path.length === selectedPath.length && path.every((value, index) => value === selectedPath[index]);
    return <div className="outline-node" key={node.id ?? (path.join("-") || "root")} style={{ paddingLeft: depth * 12 }}><button className={isSelected ? "outline-selected" : ""} onClick={() => { setSelectedPath(path); setBindingTarget(bindableTargets(node)[0]?.value ?? "style.color"); }}>{node.type ?? "unknown"}</button>{node.children?.map((child, index) => outline(child, [...path, index], depth + 1))}</div>;
  }

  const selectedNode = parsed.document ? nodeAtPath(parsed.document, selectedPath) : null;
  const selectedProps = (selectedNode?.props ?? {}) as Record<string, unknown>;
  const selectedStyle = (selectedProps.style ?? {}) as Record<string, unknown>;
  const activeSampleData = sampleScenarios[sampleScenario].data;
  const activeScreens = screens.filter((screen) => showArchived || screen.status !== "Archived");
  const visibleScreens = activeScreens.filter((screen) => (screen.title + " " + screen.route).toLowerCase().includes(screenSearch.trim().toLowerCase()));
  const publishedCount = screens.filter((screen) => screen.status === "Published").length;
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? legacyProject;

  function chooseProject(project: StudioProject) {
    setSelectedProjectId(project.id);
    setScreens(initialScreens);
    setSelectedId("wallet");
    setTitle("Wallet");
    setRoute("wallet");
    setJson(JSON.stringify(starterDocument, null, 2));
    setScreenDocuments(Object.fromEntries(Object.entries(localScreenDocuments).map(([id, document]) => [id, JSON.stringify(document, null, 2)])));
    setVersions({});
    setSelectedPath([]);
    setNestingTargetPath(null);
    setWorkspaceView("build");
    setMobileMenuOpen(false);
    setNotice("Opened " + project.name + ". Its screen catalog and versions are isolated from other client projects.");
  }

  async function chooseScreen(screen: Screen) {
    setWorkspaceView("build");
    const fallback = screenDocuments[screen.id] ?? JSON.stringify(
      localScreenDocument(screen.title, "This bundled screen is ready to edit.", "Continue", "home", "#34415B"),
      null,
      2
    );
    setScreenDocuments((current) => ({ ...current, [selectedId]: json }));
    setSelectedId(screen.id);
    setTitle(screen.title);
    setRoute(screen.route);
    setJson(fallback);
    setSelectedPath([]);
    setNestingTargetPath(null);
    if (firebaseUser) {
      try {
        const remoteVersions = await loadRemoteVersions(screen.id, selectedProjectId === legacyProject.id ? undefined : selectedProjectId);
        if (remoteVersions.length) {
          setVersions((current) => ({ ...current, [screen.id]: remoteVersions.map((item) => ({ ...item, createdAt: new Date(item.createdAt).toLocaleString() })) }));
          const latest = remoteVersions[0];
          setJson(latest.document);
          setScreenDocuments((current) => ({ ...current, [screen.id]: latest.document }));
        } else {
          setNotice("Selected " + screen.title + ". No shared version exists yet, so the bundled draft is shown.");
          return;
        }
      } catch (error) {
        setNotice("Selected " + screen.title + ". Using bundled draft because Firestore versions could not load: " + (error instanceof Error ? error.message : "Unknown error"));
        return;
      }
    }
    setNotice("Selected " + screen.title + ". Showing its own bundled draft.");
  }

  async function submitProject() {
    if (!firebaseUser) return;
    const name = projectName.trim();
    const packageName = projectPackageName.trim();
    if (!name || !packageName) {
      setProjectError("Enter both a client project name and an Android/iOS package identifier.");
      return;
    }
    if (!/^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+$/.test(packageName)) {
      setProjectError("Use a package identifier such as com.acme.mobile.");
      return;
    }
    try {
      setProjectError("");
      const project = await createStudioProject({ name, packageName }, { uid: firebaseUser.uid, label: firebaseUser.displayName ?? firebaseUser.email ?? firebaseUser.uid });
      setProjects((current) => current.some((item) => item.id === project.id) ? current : [...current, project]);
      setShowProjectDialog(false);
      setProjectName("");
      setProjectPackageName("");
      chooseProject(project);
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "Project creation failed. Check your Studio role and Firestore rules.");
    }
  }

  async function signOutFromStudio() {
    try {
      await signOutOfStudio();
      setNotice("Signed out of the shared workspace.");
    } catch (error) {
      setNotice("Sign-out failed: " + (error instanceof Error ? error.message : "Unknown error"));
    }
  }

  async function submitStudioSignIn() {
    if (!signInEmail.trim() || !signInPassword) {
      setSignInError("Enter your email address and password.");
      return;
    }
    setSignInBusy(true);
    setSignInError("");
    try {
      await signInToStudio(signInEmail.trim(), signInPassword);
      setSignInPassword("");
      setNotice("Signed in. Connecting to the shared workspace…");
    } catch (error) {
      setSignInError(error instanceof Error ? error.message.replace("Firebase: ", "") : "Sign-in failed. Check your email and password.");
    } finally {
      setSignInBusy(false);
    }
  }

  async function requestPasswordReset() {
    if (!signInEmail.trim()) {
      setSignInError("Enter your email address first, then request a reset link.");
      return;
    }
    setSignInBusy(true);
    setSignInError("");
    try {
      await resetStudioPassword(signInEmail.trim());
      setSignInError("A password-reset link was sent if this address has a Studio account.");
    } catch (error) {
      setSignInError(error instanceof Error ? error.message.replace("Firebase: ", "") : "Could not request a reset link.");
    } finally {
      setSignInBusy(false);
    }
  }

  if (!authReady) {
    return <main className="auth-page"><div className="auth-loading"><span>◆</span><strong>Preparing SDUI Studio</strong><small>Checking your secure workspace…</small></div></main>;
  }

  if (!firebaseUser) {
    return <main className="auth-page"><section className="auth-showcase"><div className="auth-brand"><span>◆</span><strong>SDUI Studio</strong></div><div><p className="eyebrow">MOBILE EXPERIENCE PLATFORM</p><h1>Build, review, and publish mobile experiences together.</h1><p>One secure workspace for SDUI screens, data bindings, version history, and mobile preview.</p></div><div className="auth-points"><span>Visual screen builder</span><span>Shared version history</span><span>Safe Firestore publishing</span></div></section><section className="auth-card"><div className="auth-card-heading"><p className="eyebrow">SECURE WORKSPACE</p><h2>Welcome back</h2><p>Use your administrator-created Studio account to continue.</p></div>{!isFirebaseConfigured && <p className="sign-in-error">Firebase setup is not available for this deployment.</p>}<label>Work email<input type="email" autoComplete="email" value={signInEmail} onChange={(event) => setSignInEmail(event.target.value)} placeholder="you@company.com" /></label><label>Password<input type="password" autoComplete="current-password" value={signInPassword} onChange={(event) => setSignInPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submitStudioSignIn(); }} placeholder="Your password" /></label>{signInError && <p className="sign-in-error">{signInError}</p>}<button className="reset-link" disabled={signInBusy || !isFirebaseConfigured} onClick={() => void requestPasswordReset()}>Forgot password?</button><button className="primary auth-submit" disabled={signInBusy || !isFirebaseConfigured} onClick={() => void submitStudioSignIn()}>{signInBusy ? "Signing in…" : "Sign in to Studio"}</button><small className="auth-help">Need access? Ask a Studio administrator to create your account.</small></section></main>;
  }

  const profileInitial = (firebaseUser.displayName ?? firebaseUser.email ?? "S").trim().charAt(0).toUpperCase();

  return (
    <main className="studio-shell">
      <aside className={"sidebar " + (mobileMenuOpen ? "mobile-open" : "")}>
        <button className="mobile-drawer-close" onClick={() => setMobileMenuOpen(false)} aria-label="Close screen library">×</button>
        <div className="sidebar-brand"><span>◆</span><div><strong>SDUI Studio</strong><small>Experience control room</small></div><i title="Shared workspace online" /></div>
        <div className="workspace-switcher"><span>CLIENT PROJECT</span><select value={selectedProjectId} onChange={(event) => chooseProject(projects.find((project) => project.id === event.target.value) ?? legacyProject)} aria-label="Active client project">{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><small>{selectedProject.packageName}</small></div>
        <button className="project-create-button" onClick={() => { setProjectError(""); setShowProjectDialog(true); }}>＋ New client project</button>
        <button className="new-screen" onClick={createScreen}><b>＋</b> New screen <kbd>N</kbd></button>
        <div className="sidebar-summary"><div><strong>{activeScreens.length}</strong><span>screens</span></div><div><strong>{publishedCount}</strong><span>live</span></div><div><strong>{syncState === "saved" ? "●" : "○"}</strong><span>sync</span></div></div>
        <div className="sidebar-label-row"><p className="sidebar-label">SCREEN LIBRARY</p><button onClick={() => setShowArchived((value) => !value)}>{showArchived ? "Hide archived" : "Archived"}</button></div>
        <label className="screen-search"><span>⌕</span><input value={screenSearch} onChange={(event) => setScreenSearch(event.target.value)} placeholder="Find a screen" /></label>
        <nav aria-label="Screen library">
          {visibleScreens.map((screen) => (
            <button key={screen.id} className={"screen-link " + (screen.id === selectedId ? "active" : "")} onClick={() => { void chooseScreen(screen); setMobileMenuOpen(false); }}>
              <span><b>{screen.title.slice(0, 1).toUpperCase()}</b>{screen.title}</span><em className={screen.status === "Published" ? "published" : screen.status === "Archived" ? "archived" : "draft"}>{screen.status}</em>
            </button>
          ))}
          {!visibleScreens.length && <p className="sidebar-empty">No screens found</p>}
        </nav>
        <div className="sidebar-tools"><p className="sidebar-label">WORKSPACE TOOLS</p><div><span>◈</span><small>Versioned publishing</small></div><div><span>⌁</span><small>Data binding ready</small></div><div><span>✓</span><small>{syncDetail}</small></div></div>
        <div className="sidebar-footer"><span className="avatar">{profileInitial}</span><div><strong>{firebaseUser.displayName ?? "Studio member"}</strong><small>{firebaseUser.email}</small></div></div>
      </aside>
      {mobileMenuOpen && <button className="mobile-drawer-backdrop" aria-label="Close screen library" onClick={() => setMobileMenuOpen(false)} />}

      <section className="workspace">
        <header className="app-topbar">
          <div className="app-brand"><button className="mobile-menu-toggle" onClick={() => setMobileMenuOpen((open) => !open)} aria-label="Open screen library" aria-expanded={mobileMenuOpen}><span /><span /><span /></button><span>◆</span><strong>SDUI Studio</strong><em>{selectedProject.name} · {selectedProject.packageName}</em></div>
          <div className="app-user"><div className={"sync-state " + syncState}><span>{syncState === "syncing" ? "◌" : syncState === "saved" ? "●" : syncState === "failed" ? "!" : "○"}</span><small>{syncDetail}</small></div><div className="profile-chip" title={firebaseUser.email ?? "Studio account"}><span>{profileInitial}</span><div><strong>{firebaseUser.displayName ?? "Studio member"}</strong><small>{firebaseUser.email}</small></div></div><button className="logout-button" onClick={() => void signOutFromStudio()}>Log out</button></div>
        </header>
        {showProjectDialog && <div className="floating-preview-backdrop project-dialog-backdrop" role="presentation"><section className="project-dialog" role="dialog" aria-modal="true" aria-labelledby="new-project-title"><button className="dialog-close" onClick={() => setShowProjectDialog(false)} aria-label="Close">×</button><p className="eyebrow">NEW CLIENT PROJECT</p><h2 id="new-project-title">Create an isolated workspace</h2><p>Its screens, drafts, published versions, and package identifier stay separate from every other client.</p><label>Project name<input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="Acme Banking" autoFocus /></label><label>Android / iOS package name<input value={projectPackageName} onChange={(event) => setProjectPackageName(event.target.value)} placeholder="com.acme.mobile" /></label>{projectError && <div className="project-error">{projectError}</div>}<div className="dialog-actions"><button className="secondary" onClick={() => setShowProjectDialog(false)}>Cancel</button><button className="primary" onClick={() => void submitProject()}>Create project</button></div></section></div>}
        <nav className="workspace-view-tabs" aria-label="Studio workspace sections">
          <button className={workspaceView === "build" ? "active" : ""} aria-current={workspaceView === "build" ? "page" : undefined} onClick={() => setWorkspaceView("build")}><span>◫</span><div><strong>Build</strong><small>Screen editor</small></div></button>
          <button className={workspaceView === "preview" ? "active" : ""} aria-current={workspaceView === "preview" ? "page" : undefined} onClick={() => setWorkspaceView("preview")}><span>▣</span><div><strong>Preview</strong><small>Test states</small></div></button>
          <button className={workspaceView === "governance" ? "active" : ""} aria-current={workspaceView === "governance" ? "page" : undefined} onClick={() => setWorkspaceView("governance")}><span>◈</span><div><strong>Governance</strong><small>People & activity</small></div></button>
        </nav>

        {workspaceView === "build" && <>
        <header className="topbar">
          <div><p className="eyebrow">SCREEN LIBRARY / {route.toUpperCase()}</p><h1>{title}</h1><small className="screen-context">v{screens.find((screen) => screen.id === selectedId)?.version ?? 1} · {screens.find((screen) => screen.id === selectedId)?.status ?? "Draft"} · Updated {screens.find((screen) => screen.id === selectedId)?.updatedAt ?? "now"}</small></div>
          <div className="top-actions"><button className="secondary" onClick={duplicateScreen}>Duplicate</button>{screens.find((screen) => screen.id === selectedId)?.status === "Archived" ? <button className="secondary" onClick={restoreArchivedScreen}>Restore screen</button> : <button className="secondary" onClick={archiveScreen}>Archive</button>}<button className="secondary" onClick={saveDraft}>Save draft</button><button className="primary" onClick={publish}>Publish version</button></div>
        </header>
        <section className="workspace-insights" aria-label="Workspace summary"><div><span>ACTIVE SCREEN</span><strong>/{route}</strong><small>Editing a reusable mobile document</small></div><div><span>DOCUMENT HEALTH</span><strong className={parsed.error ? "metric-warning" : "metric-success"}>{parsed.error ? "Needs review" : "Validated"}</strong><small>{parsed.error ? "Fix document issues before publishing" : "Schema and bindings are ready"}</small></div><div><span>RELEASE STATUS</span><strong>{screens.find((screen) => screen.id === selectedId)?.status ?? "Draft"}</strong><small>{publishedCount} published screen{publishedCount === 1 ? "" : "s"} in this workspace</small></div></section>

        <div className="notice" role="status">{notice}</div>

        <div className="studio-grid">
          <section className="editor-panel">
            <div className="panel-heading"><div><h2>Screen document</h2><p>Use the form fields for basics or edit the SDUI document directly.</p></div><span className={parsed.error ? "invalid" : "valid"}>{parsed.error ? "Invalid JSON" : "Valid JSON"}</span></div>

            <div className="field-grid">
              <label>Screen name<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
              <label>Route<input value={route} onChange={(event) => setRoute(event.target.value.replace(/\s/g, "-"))} /></label>
            </div>

            <div className="import-bar">
              <div><strong>Import or export a document</strong><span>Review Figma-export JSON safely, or download this draft as portable SDUI JSON.</span></div>
              <div className="import-actions"><button className="secondary" onClick={() => exportDocument(json, "draft")}>Export draft</button>
              <button className="secondary" onClick={() => setShowImporter((value) => !value)}>{showImporter ? "Close import" : "Import JSON"}</button>
              </div>
            </div>
            {showImporter && <div className="importer"><textarea value={importText} onChange={(event) => setImportText(event.target.value)} placeholder="Paste SDUI JSON or Figma exporter output here…" /><button className="primary" onClick={stageImport}>Validate for review</button>{importCandidate && <div className="import-review"><div><span className="review-badge">Ready to review</span><strong>{importCandidate.source}</strong><p>The incoming document is valid. Applying it replaces the editor draft, not any published version.</p></div><div className="import-review-grid"><div><small>Incoming JSON</small><pre>{JSON.stringify(importCandidate.document, null, 2)}</pre></div><div><small>Current draft</small><pre>{json}</pre></div></div><div className="review-warnings"><strong>Conversion checks</strong>{importCandidate.warnings.length ? <ul>{importCandidate.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : <p>No conversion warnings found.</p>}</div><div className="review-actions"><button className="secondary" onClick={cancelImportReview}>Keep current draft</button><button className="primary" onClick={applyImport}>Apply to draft</button></div></div>}</div>}

            <label className="json-label">Advanced document editor<textarea value={json} onChange={(event) => setJson(event.target.value)} spellCheck={false} /></label>
            {parsed.error && <p className="error-message">{parsed.error}</p>}
          </section>

          <aside className="right-column">
            <section className="card component-palette">
              <div className="panel-heading compact"><div><h2>Visual builder</h2><p>Add to {selectedNode && isContainer(selectedNode) ? "selected " + selectedNode.type : "root screen"}.</p></div></div>
              <div className="palette-grid">
                {Object.keys(componentTemplates).map((kind) => <button key={kind} onClick={() => addComponent(kind)}><strong>+ {kind}</strong><span>Add to root</span></button>)}
              </div>
              <div className="outline"><strong>Screen outline</strong>{nestingTargetPath && <span className="nesting-target">Target: {nodeAtPath(parsed.document as JsonObject, nestingTargetPath)?.type}</span>}{parsed.document ? outline(parsed.document) : <span>Valid JSON is required.</span>}</div>
            </section>

            {selectedNode && <section className="card property-editor">
              <div className="panel-heading compact"><div><h2>Component properties</h2><p>Editing <code>{selectedNode.type}</code></p></div>{selectedPath.length > 0 && <button className="danger-link" onClick={deleteSelectedNode}>Remove</button>}</div>
              {selectedPath.length > 0 && <div className="layout-actions"><button onClick={() => moveSelectedBy(-1)}>↑ Move up</button><button onClick={() => moveSelectedBy(1)}>↓ Move down</button><button onClick={duplicateSelectedNode}>Duplicate</button><button onClick={moveSelectedIntoTarget} disabled={!nestingTargetPath}>Move into target</button></div>}
              {isContainer(selectedNode) && <button className="nest-button" onClick={setNestingTarget}>Use {selectedNode.type} as nesting target</button>}
              {selectedNode.type === "text" && <>
                <label>Text value<input value={typeof selectedProps.value === "string" ? selectedProps.value : ""} onChange={(event) => setSelectedProp("value", event.target.value)} /></label>
                <label>Font size<input type="number" min="8" max="72" value={typeof selectedStyle.fontSize === "number" ? selectedStyle.fontSize : ""} onChange={(event) => setSelectedStyle("fontSize", Number(event.target.value) || 16)} /></label>
                <label>Font weight<select value={typeof selectedStyle.fontWeight === "string" ? selectedStyle.fontWeight : ""} onChange={(event) => setSelectedStyle("fontWeight", event.target.value)}><option value="">Regular</option><option value="medium">Medium</option><option value="bold">Bold</option></select></label>
                <label>Text alignment<select value={typeof selectedStyle.textAlign === "string" ? selectedStyle.textAlign : ""} onChange={(event) => setSelectedStyle("textAlign", event.target.value)}><option value="">Start</option><option value="center">Center</option><option value="end">End</option></select></label>
              </>}
              {selectedNode.type === "button" && <>
                <label>Button label<input value={typeof selectedProps.label === "string" ? selectedProps.label : ""} onChange={(event) => setSelectedProp("label", event.target.value)} /></label>
              </>}
              {actionCapable(selectedNode) && <fieldset className="property-group action-builder"><legend>Action builder</legend><label>On tap<select value={selectedNode.action?.type ?? "none"} onChange={(event) => setActionType(event.target.value)}><option value="none">No action</option><option value="navigate">Navigate to screen</option><option value="back">Go back</option><option value="analytics">Track analytics event</option><option value="refreshData">Refresh data</option><option value="openUrl">Open web URL</option><option value="toggleState">Toggle local state</option></select></label>{selectedNode.action?.type === "navigate" && <label>Destination screen<select value={selectedNode.action.target ?? ""} onChange={(event) => setActionTarget(event.target.value)}>{screens.map((screen) => <option key={screen.id} value={screen.route}>{screen.title} — /{screen.route}</option>)}</select></label>}{selectedNode.action?.type === "analytics" && <label>Event name<input value={selectedNode.action.target ?? ""} placeholder="button_tapped" onChange={(event) => setActionTarget(event.target.value.replace(/\s+/g, "_"))} /></label>}{selectedNode.action?.type === "refreshData" && <label>Data source key<input value={selectedNode.action.target ?? ""} placeholder="wallet" onChange={(event) => setActionTarget(event.target.value)} /></label>}{selectedNode.action?.type === "openUrl" && <label>HTTPS URL<input type="url" value={selectedNode.action.target ?? ""} placeholder="https://example.com" onChange={(event) => setActionTarget(event.target.value)} /></label>}{selectedNode.action?.type === "toggleState" && <label>State key<input value={selectedNode.action.target ?? ""} placeholder="isEnabled" onChange={(event) => setActionTarget(event.target.value)} /></label>}{selectedNode.action?.type === "openUrl" && <p className="action-note">The production mobile host must allowlist approved URL domains.</p>}</fieldset>}
              {selectedNode.type === "image" && <><label>Image URL<input value={typeof selectedProps.src === "string" ? selectedProps.src : ""} onChange={(event) => setSelectedProp("src", event.target.value)} /></label><label>Accessibility description<input value={typeof selectedProps.contentDescription === "string" ? selectedProps.contentDescription : ""} onChange={(event) => setSelectedProp("contentDescription", event.target.value)} /></label></>}
              {selectedNode.type === "icon" && <><label>Icon name<input value={typeof selectedProps.name === "string" ? selectedProps.name : ""} onChange={(event) => setSelectedProp("name", event.target.value)} /></label><label>Accessibility description<input value={typeof selectedProps.contentDescription === "string" ? selectedProps.contentDescription : ""} onChange={(event) => setSelectedProp("contentDescription", event.target.value)} /></label></>}
              {(selectedNode.type === "textInput" || selectedNode.type === "switch" || selectedNode.type === "checkbox" || selectedNode.type === "chip" || selectedNode.type === "badge" || selectedNode.type === "progressBar") && <label>Label<input value={typeof selectedProps.label === "string" ? selectedProps.label : ""} onChange={(event) => setSelectedProp("label", event.target.value)} /></label>}
              {selectedNode.type === "textInput" && <label>Placeholder<input value={typeof selectedProps.placeholder === "string" ? selectedProps.placeholder : ""} onChange={(event) => setSelectedProp("placeholder", event.target.value)} /></label>}
              {selectedNode.type === "switch" && <label className="check-label"><input type="checkbox" checked={selectedProps.checked === true} onChange={(event) => setSelectedProp("checked", event.target.checked)} /> Default value on</label>}
              {selectedNode.type === "checkbox" && <label className="check-label"><input type="checkbox" checked={selectedProps.checked === true} onChange={(event) => setSelectedProp("checked", event.target.checked)} /> Default value checked</label>}
              {["lazyColumn", "lazyRow", "lazyGrid", "repeater"].includes(selectedNode.type ?? "") && <label>Items binding<input value={typeof selectedProps.items === "string" ? selectedProps.items : ""} placeholder="{{transactions}}" onChange={(event) => setSelectedProp("items", event.target.value)} /></label>}
              {["lazyColumn", "lazyRow", "lazyGrid", "list", "grid", "pager"].includes(selectedNode.type ?? "") && <label>Viewport height<input type="number" min="80" value={typeof selectedProps.height === "number" ? selectedProps.height : ""} onChange={(event) => setSelectedProp("height", Number(event.target.value) || 0)} /></label>}
              {selectedNode.type === "lazyRow" && <label>Item width<input type="number" min="80" value={typeof selectedProps.itemWidth === "number" ? selectedProps.itemWidth : ""} onChange={(event) => setSelectedProp("itemWidth", Number(event.target.value) || 0)} /></label>}
              {["lazyGrid", "grid"].includes(selectedNode.type ?? "") && <label>Columns<input type="number" min="1" max="6" value={typeof selectedProps.columns === "number" ? selectedProps.columns : 2} onChange={(event) => setSelectedProp("columns", Math.max(1, Number(event.target.value) || 1))} /></label>}
              {selectedNode.type === "progressBar" && <label>Progress (0–1)<input type="number" min="0" max="1" step="0.05" value={typeof selectedProps.progress === "number" ? selectedProps.progress : 0} onChange={(event) => setSelectedProp("progress", Math.max(0, Math.min(1, Number(event.target.value) || 0)))} /></label>}
              {selectedNode.type === "rating" && <label>Rating (0–5)<input type="number" min="0" max="5" step="1" value={typeof selectedProps.rating === "number" ? selectedProps.rating : 0} onChange={(event) => setSelectedProp("rating", Math.max(0, Math.min(5, Number(event.target.value) || 0)))} /></label>}
              {(selectedNode.type === "tabs" || selectedNode.type === "bottomNavigation") && <><label>Items (comma-separated)<input value={Array.isArray(selectedProps.items) ? selectedProps.items.join(", ") : ""} onChange={(event) => setSelectedProp("items", event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} /></label><label>Selected item<input type="number" min="0" value={typeof selectedProps.selectedIndex === "number" ? selectedProps.selectedIndex : 0} onChange={(event) => setSelectedProp("selectedIndex", Number(event.target.value) || 0)} /></label></>}
              {isContainer(selectedNode) && <label>Arrangement<select value={typeof selectedStyle.arrangement === "string" ? selectedStyle.arrangement : ""} onChange={(event) => setSelectedStyle("arrangement", event.target.value)}><option value="">Start</option><option value="spaceBetween">Space between</option><option value="center">Center</option><option value="end">End</option></select></label>}
              <fieldset className="property-group"><legend>Layout and style</legend><label>Background color<input value={typeof selectedStyle.background === "string" ? selectedStyle.background : ""} placeholder="#FFFFFF" onChange={(event) => setSelectedStyle("background", event.target.value)} /></label><label>Text color<input value={typeof selectedStyle.color === "string" ? selectedStyle.color : ""} placeholder="#142039" onChange={(event) => setSelectedStyle("color", event.target.value)} /></label><label>Padding<select value={typeof selectedStyle.padding === "string" ? selectedStyle.padding : ""} onChange={(event) => setSelectedStyle("padding", event.target.value)}><option value="">None</option><option value="xs">Extra small</option><option value="sm">Small</option><option value="md">Medium</option><option value="lg">Large</option><option value="xl">Extra large</option></select></label><label>Gap<select value={typeof selectedStyle.gap === "string" ? selectedStyle.gap : ""} onChange={(event) => setSelectedStyle("gap", event.target.value)}><option value="">None</option><option value="xs">Extra small</option><option value="sm">Small</option><option value="md">Medium</option><option value="lg">Large</option><option value="xl">Extra large</option></select></label><label>Corner radius<input type="number" min="0" value={typeof selectedStyle.cornerRadius === "number" ? selectedStyle.cornerRadius : ""} onChange={(event) => setSelectedStyle("cornerRadius", Number(event.target.value) || 0)} /></label><label>Width<select value={typeof selectedStyle.width === "string" ? selectedStyle.width : ""} onChange={(event) => setSelectedStyle("width", event.target.value)}><option value="">Wrap content</option><option value="fill">Fill available width</option></select></label><label className="check-label"><input type="checkbox" checked={selectedProps.visible !== false} onChange={(event) => setSelectedProp("visible", event.target.checked)} /> Visible</label></fieldset>
            </section>}

            <section className="card">
              <div className="panel-heading compact"><div><h2>Data binding</h2><p>Connect a selected property to an approved API field.</p></div></div>
              {selectedNode ? <>
                <label>Bind to property<select value={bindingTarget} onChange={(event) => setBindingTarget(event.target.value)}>{bindableTargets(selectedNode).map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}</select></label>
                <input className="binding-filter" value={bindingFilter} onChange={(event) => setBindingFilter(event.target.value)} placeholder="Filter API fields…" />
                <div className="binding-list">
                  {bindings.filter(([path, description]) => (path + " " + description).toLowerCase().includes(bindingFilter.toLowerCase())).map(([path, description]) => {
                    const sample = getValue(path, activeSampleData);
                    return <button key={path} onClick={() => applyBinding(path)}><strong>{"{{" + path + "}}"}</strong><span>{description}</span><small>{Array.isArray(sample) ? sample.length + " sample items" : "Sample: " + String(sample ?? "not available")}</small></button>;
                  })}
                </div>
                <button className="clear-binding" onClick={() => bindingTarget.startsWith("style.") ? setSelectedStyle(bindingTarget.slice(6), "") : setSelectedProp(bindingTarget, "")}>Clear selected binding</button>
              </> : <p className="empty-state">Select a component in the screen outline to choose a property and bind it.</p>}
            </section>

            <section className="card">
              <button className="sample-toggle" onClick={() => setShowSampleData((value) => !value)}>
                <span><strong>Sample API response</strong><small>{sampleScenarios[sampleScenario].label}</small></span><span>{showSampleData ? "−" : "+"}</span>
              </button>
              {showSampleData && <pre>{JSON.stringify(activeSampleData, null, 2)}</pre>}
            </section>

            <section className="card versions">
              <div className="panel-heading compact"><div><h2>Release workflow</h2><p>Publish only after validation and preview review.</p></div><button className="link-button" onClick={() => setShowCompare((value) => !value)}>Compare</button></div>
              <label>Release note<input value={publishNote} placeholder="What changed in this version?" onChange={(event) => setPublishNote(event.target.value)} /></label>
              <label className="check-label"><input type="checkbox" checked={previewConfirmed} onChange={(event) => setPreviewConfirmed(event.target.checked)} /> I tested content, loading, empty, and error previews</label>
              <p className={parsed.error ? "workflow-error" : "workflow-ok"}>{parsed.error ? "JSON, bindings, or actions need attention." : "Document validation passed."}</p>
              {showCompare && <div className="compare-panel"><strong>Current draft vs latest published</strong><div><pre>{(versions[selectedId] ?? []).find((version) => version.status === "Published")?.document ?? "No published version yet."}</pre><pre>{json}</pre></div></div>}
              <h2>Version history</h2>
              {(versions[selectedId] ?? []).slice(0, 4).map((version) => <div className="version-row" key={version.id}><strong>v{version.number}</strong><span>{version.status}{version.note ? " · " + version.note : ""}</span><small>{version.createdAt}</small><div className="version-actions"><button className="link-button" onClick={() => restoreVersion(version)}>Restore</button><button className="link-button" onClick={() => exportDocument(version.document, "v" + version.number + "-" + version.status)}>Export</button></div></div>)}
              {!(versions[selectedId] ?? []).length && <p className="empty-state">No saved versions yet.</p>}
            </section>
          </aside>
        </div>

        </>}
        {workspaceView === "governance" && <><div className="notice workspace-notice" role="status">Manage roles, access, and the immutable activity history for this workspace.</div><StudioGovernancePanel actor={firebaseUser} /></>}
        {workspaceView === "preview" && <><div className="notice workspace-notice" role="status">Test the selected screen before publishing it. Preview data and failure states never change the live mobile screen.</div>

        <section className="preview-launcher">
          <div><p className="eyebrow">LIVE PREVIEW</p><h2>Open the mobile demo in a floating window</h2><p>Resize the preview while testing the same screen with representative API data and failure states.</p></div>
          <button className="primary preview-launch-button" onClick={() => setShowFloatingPreview(true)}>Open mobile preview</button>
        </section>
        </>}
        {showFloatingPreview && <div className="floating-preview-backdrop" role="presentation">
          <section className="floating-preview-dialog" role="dialog" aria-modal="true" aria-label="Mobile screen preview">
            <header className="floating-preview-header"><div><p className="eyebrow">LIVE PREVIEW</p><strong>{title}</strong><small>Drag the lower-right corner to resize on desktop.</small></div><button className="logout-button" onClick={() => setShowFloatingPreview(false)} aria-label="Close mobile preview">Close</button></header>
            <div className="floating-preview-body">
              <div className="floating-preview-controls"><div className="scenario-picker">{Object.entries(sampleScenarios).map(([key, scenario]) => <button key={key} className={sampleScenario === key ? "selected" : ""} onClick={() => setSampleScenario(key)}>{scenario.label}</button>)}</div><div className="preview-state">{[["content", "Content"], ["loading", "Loading"], ["empty", "Empty"], ["error", "Error"], ["retry", "Retry"]].map(([key, label]) => <button key={key} className={previewState === key ? "state-active" : ""} onClick={() => setPreviewState(key)}>{label}</button>)}</div></div>
              <div className="floating-phone-wrap"><MobilePreview document={parsed.document} data={activeSampleData} state={previewState} onRetry={() => setPreviewState("content")} /></div>
            </div>
          </section>
        </div>}
        {pendingRestore && <div className="dialog-backdrop"><section className="confirm-dialog"><h2>Restore version v{pendingRestore.number}?</h2><p>This replaces the document currently in the editor. It will remain a draft until you save and publish again.</p><div><button className="secondary" onClick={() => setPendingRestore(null)}>Cancel</button><button className="primary" onClick={confirmRestoreVersion}>Restore into draft</button></div></section></div>}
      </section>
    </main>
  );
}

