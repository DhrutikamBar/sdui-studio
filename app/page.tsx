"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { validateSduiDocument } from "../lib/validate";

type JsonObject = {
  type?: string;
  id?: string;
  props?: Record<string, unknown>;
  children?: JsonObject[];
  [key: string]: unknown;
};

type Screen = {
  id: string;
  route: string;
  title: string;
  status: "Draft" | "Published";
  version: number;
  updatedAt: string;
};

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

const bindings = [
  ["user.firstName", "Profile / first name"],
  ["user.name", "Profile / full name"],
  ["wallet.accountName", "Wallet summary / account name"],
  ["wallet.balanceDisplay", "Wallet summary / formatted balance"],
  ["transactions", "Transactions / list"],
  ["item.title", "Transaction item / title"],
  ["item.amountDisplay", "Transaction item / formatted amount"]
];

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
  const padding = style.padding === "md" ? 16 : style.padding === "sm" ? 8 : style.padding === "lg" ? 24 : 0;
  return {
    padding,
    background: resolveText(style.background, scope) || undefined,
    color: resolveText(style.color, scope) || undefined,
    fontSize: typeof style.fontSize === "number" ? style.fontSize : undefined,
    fontWeight: style.fontWeight === "bold" ? 700 : style.fontWeight === "medium" ? 600 : undefined,
    borderRadius: typeof style.cornerRadius === "number" ? style.cornerRadius : undefined,
    width: style.width === "fill" ? "100%" : undefined
  };
}

function MobilePreview({ document }: { document: JsonObject | null }) {
  function renderNode(node: JsonObject, scope: Record<string, unknown>, key: string): ReactNode {
    const props = node.props ?? {};
    const children = node.children ?? [];
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

    if (node.type === "text") {
      return <p key={key} style={{ margin: "0 0 8px", ...styleFor(node, scope) }}>{resolveText(props.value, scope)}</p>;
    }

    if (node.type === "button") {
      return <button key={key} className="preview-button">{resolveText(props.label, scope)}</button>;
    }

    if (node.type === "spacer") {
      return <div key={key} style={{ height: 12 }} />;
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
        {document ? renderNode(document, sampleData, "root") : <p>Fix JSON to restore preview.</p>}
      </div>
      <div className="phone-home" />
    </div>
  );
}

export default function StudioPage() {
  const [screens, setScreens] = useState(initialScreens);
  const [selectedId, setSelectedId] = useState("wallet");
  const [title, setTitle] = useState("Wallet");
  const [route, setRoute] = useState("wallet");
  const [json, setJson] = useState(JSON.stringify(starterDocument, null, 2));
  const [notice, setNotice] = useState("Draft loaded. Make a change, preview it, then publish.");
  const [showSampleData, setShowSampleData] = useState(false);

  const parsed = useMemo(() => {
    try {
      const document = JSON.parse(json) as JsonObject;
      const errors = validateSduiDocument(document);
      return { document: errors.length === 0 ? document : null, error: errors.join(" ") };
    } catch (error) {
      return { document: null, error: error instanceof Error ? error.message : "Invalid JSON" };
    }
  }, [json]);

  function saveDraft() {
    if (parsed.error) {
      setNotice("Fix the JSON error before saving.");
      return;
    }
    setScreens((current) => current.map((screen) =>
      screen.id === selectedId ? { ...screen, title, route, status: "Draft", updatedAt: "Just now" } : screen
    ));
    setNotice("Draft saved locally. Connect Firestore publishing in the next backend step.");
  }

  function publish() {
    if (parsed.error) {
      setNotice("Publishing blocked: the document JSON is invalid.");
      return;
    }
    setScreens((current) => current.map((screen) =>
      screen.id === selectedId
        ? { ...screen, title, route, status: "Published", version: screen.version + 1, updatedAt: "Just now" }
        : screen
    ));
    setNotice("Published locally as a new immutable version. A production publish endpoint will validate and write this document.");
  }

  function chooseScreen(screen: Screen) {
    setSelectedId(screen.id);
    setTitle(screen.title);
    setRoute(screen.route);
    setNotice("Selected " + screen.title + ". This MVP keeps edits in browser memory.");
  }

  return (
    <main>
      <aside className="sidebar">
        <div className="brand"><span>◆</span><div><strong>SDUI Studio</strong><small>Control centre</small></div></div>
        <button className="new-screen" onClick={() => setNotice("New-screen creation will be connected to persistent storage next.")}>+ New screen</button>
        <p className="sidebar-label">SCREENS</p>
        <nav>
          {screens.map((screen) => (
            <button key={screen.id} className={"screen-link " + (screen.id === selectedId ? "active" : "")} onClick={() => chooseScreen(screen)}>
              <span>{screen.title}</span><em className={screen.status === "Published" ? "published" : "draft"}>{screen.status}</em>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer"><span className="avatar">DK</span><div><strong>DhrutikamBar</strong><small>Studio editor</small></div></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">SCREENS / {route.toUpperCase()}</p><h1>{title}</h1></div>
          <div className="top-actions"><button className="secondary" onClick={saveDraft}>Save draft</button><button className="primary" onClick={publish}>Publish version</button></div>
        </header>

        <div className="notice" role="status">{notice}</div>

        <div className="studio-grid">
          <section className="editor-panel">
            <div className="panel-heading"><div><h2>Screen document</h2><p>Use the form fields for basics or edit the SDUI document directly.</p></div><span className={parsed.error ? "invalid" : "valid"}>{parsed.error ? "Invalid JSON" : "Valid JSON"}</span></div>

            <div className="field-grid">
              <label>Screen name<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
              <label>Route<input value={route} onChange={(event) => setRoute(event.target.value.replace(/\s/g, "-"))} /></label>
            </div>

            <label className="json-label">Advanced document editor<textarea value={json} onChange={(event) => setJson(event.target.value)} spellCheck={false} /></label>
            {parsed.error && <p className="error-message">{parsed.error}</p>}
          </section>

          <aside className="right-column">
            <section className="card">
              <div className="panel-heading compact"><div><h2>Approved data bindings</h2><p>Bindings come from API contracts, not arbitrary URLs.</p></div></div>
              <div className="binding-list">
                {bindings.map(([path, description]) => (
                  <button
                    key={path}
                    onClick={() => {
                      if (navigator.clipboard) {
                        void navigator.clipboard.writeText("{{" + path + "}}");
                      }
                      setNotice("Copied {{" + path + "}}. Paste it into the document.");
                    }}
                  >
                    <strong>{"{{" + path + "}}"}</strong><span>{description}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="card">
              <button className="sample-toggle" onClick={() => setShowSampleData((value) => !value)}>
                <span><strong>Sample API response</strong><small>Wallet and transactions</small></span><span>{showSampleData ? "−" : "+"}</span>
              </button>
              {showSampleData && <pre>{JSON.stringify(sampleData, null, 2)}</pre>}
            </section>

            <section className="card versions">
              <h2>Version history</h2>
              <div><strong>v{screens.find((screen) => screen.id === selectedId)?.version}</strong><span>Current draft</span><small>Just now</small></div>
              <div><strong>v11</strong><span>Published</span><small>Today, 10:24</small></div>
              <button className="link-button" onClick={() => setNotice("Rollback is intentionally disabled until versions are stored server-side.")}>View and rollback versions →</button>
            </section>
          </aside>
        </div>

        <section className="preview-section">
          <div className="preview-copy"><p className="eyebrow">LIVE PREVIEW</p><h2>Wallet with sample API data</h2><p>This browser preview validates layout and bindings quickly. Android and iOS SDK rendering remain the release authority.</p><div className="preview-state"><span className="state-active">Content</span><span>Loading</span><span>Empty</span><span>Error</span></div></div>
          <MobilePreview document={parsed.document} />
        </section>
      </section>
    </main>
  );
}
