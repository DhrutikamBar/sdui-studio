"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { archiveStudioComponent, saveStudioComponent, type ComponentNode, type StudioComponent } from "../lib/component-library";
import { validateFlexflowDocument } from "../lib/validate";
import { LoadingSpinner } from "./loading-spinner";

const blank: ComponentNode = { type: "column", props: { style: { padding: "md", gap: "sm" } }, children: [] };
const productItem: ComponentNode = { type: "column", props: { style: { padding: "sm", gap: "xs" } }, children: [{ type: "icon", props: { name: "shopping_bag", contentDescription: "Product" } }, { type: "text", props: { value: "Product name", style: { fontSize: 14 } } }] };
const productSection: ComponentNode = { type: "box", props: { style: { padding: "md", gap: "md", background: "#FFFFFF", cornerRadius: 16 } }, children: [{ type: "text", props: { value: "Featured products", style: { fontSize: 18, fontWeight: "bold" } } }, { type: "row", props: { style: { gap: "sm" } }, children: [productItem, productItem] }] };

type Props = {
  projectId: string;
  components: StudioComponent[];
  templates: Record<string, ComponentNode>;
  initialDocument: ComponentNode | null;
  resetKey: number;
  canEdit: boolean;
  onChanged: () => Promise<void>;
  onInsert: (component: StudioComponent) => void;
  renderPreview: (document: ComponentNode | null) => ReactNode;
};

function nodeAtPath(document: ComponentNode, path: number[]) {
  return path.reduce<ComponentNode | null>((node, index) => node?.children?.[index] ?? null, document);
}

function isContainer(node: ComponentNode) {
  return ["column", "row", "box", "list", "grid", "repeater", "lazyColumn", "lazyRow", "lazyGrid", "flowRow", "pager"].includes(node.type ?? "");
}

export function ComponentLibraryPanel({ projectId, components, templates, initialDocument, resetKey, canEdit, onChanged, onInsert, renderPreview }: Props) {
  const [id, setId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("General");
  const [description, setDescription] = useState("");
  const [json, setJson] = useState(JSON.stringify(blank, null, 2));
  const [selectedPath, setSelectedPath] = useState<number[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Start with a container, then add widgets to build a reusable group.");
  const parsed = useMemo(() => {
    try {
      const document = JSON.parse(json) as ComponentNode;
      const errors = validateFlexflowDocument(document);
      return { document: errors.length ? null : document, error: errors.join(" ") };
    } catch { return { document: null, error: "Enter valid JSON to preview or save this component." }; }
  }, [json]);
  const selected = parsed.document ? nodeAtPath(parsed.document, selectedPath) : null;
  const filtered = components.filter((component) => (component.name + " " + component.category + " " + component.description).toLowerCase().includes(query.trim().toLowerCase()));

  function startNew(document: ComponentNode = blank, title = "") {
    setId(null);
    setRevision(0);
    setName(title);
    setCategory("General");
    setDescription("");
    setJson(JSON.stringify(document, null, 2));
    setSelectedPath([]);
    setMessage("New component ready. Give it a name, arrange its widgets, and save it to this project.");
  }

  useEffect(() => { startNew(initialDocument ?? blank); }, [projectId, resetKey]);

  function open(component: StudioComponent) {
    setId(component.id);
    setRevision(component.revision);
    setName(component.name);
    setCategory(component.category);
    setDescription(component.description);
    setJson(JSON.stringify(component.document, null, 2));
    setSelectedPath([]);
    setMessage("Editing " + component.name + ". Changes to this template will affect future insertions only.");
  }

  function mutate(change: (document: ComponentNode) => number[] | void) {
    if (!parsed.document) return;
    const document = JSON.parse(JSON.stringify(parsed.document)) as ComponentNode;
    const nextPath = change(document);
    setJson(JSON.stringify(document, null, 2));
    if (nextPath) setSelectedPath(nextPath);
  }

  function addWidget(kind: string) {
    mutate((document) => {
      const selectedNode = nodeAtPath(document, selectedPath);
      const target = selectedNode && isContainer(selectedNode) ? selectedNode : document;
      if (!isContainer(target)) { setMessage("Choose a container such as Column, Row, or Card before adding widgets."); return; }
      target.children = [...(target.children ?? []), JSON.parse(JSON.stringify(templates[kind])) as ComponentNode];
      const path = target === document ? [] : selectedPath;
      return [...path, target.children.length - 1];
    });
  }

  function updateSelected(field: "value" | "label" | "name" | "src" | "background" | "gap", value: string) {
    mutate((document) => {
      const node = nodeAtPath(document, selectedPath);
      if (!node) return;
      node.props = { ...node.props };
      if (field === "background" || field === "gap") node.props.style = { ...(node.props.style as Record<string, unknown> ?? {}), [field]: value };
      else node.props[field] = value;
    });
  }

  function removeSelected() {
    if (!selectedPath.length) { setMessage("The root widget cannot be removed. Start a new component to replace it."); return; }
    mutate((document) => {
      const parent = nodeAtPath(document, selectedPath.slice(0, -1));
      parent?.children?.splice(selectedPath[selectedPath.length - 1], 1);
      return selectedPath.slice(0, -1);
    });
  }

  async function save() {
    if (!canEdit || busy) return;
    if (!name.trim()) { setMessage("Give this component a name before saving."); return; }
    if (!parsed.document) { setMessage(parsed.error || "Fix the component JSON before saving."); return; }
    setBusy(true);
    try {
      const saved = await saveStudioComponent({ id: id ?? undefined, revision: id ? revision : undefined, projectId, name, category, description, document: parsed.document });
      setId(saved.id);
      setRevision(saved.revision);
      await onChanged();
      setMessage(saved.name + " saved to this project's component library.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save this component."); }
    finally { setBusy(false); }
  }

  async function archive() {
    if (!id || !canEdit || busy) return;
    setBusy(true);
    try {
      await archiveStudioComponent(projectId, id, revision);
      await onChanged();
      startNew();
      setMessage("Component archived. Screens that already use a copy are unchanged.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not archive this component."); }
    finally { setBusy(false); }
  }

  function outline(node: ComponentNode, path: number[] = [], depth = 0): ReactNode {
    const active = path.length === selectedPath.length && path.every((value, index) => value === selectedPath[index]);
    return <div className="component-outline-node" key={path.join("-") || "root"} style={{ paddingLeft: depth * 13 }}><button className={active ? "active" : ""} onClick={() => setSelectedPath(path)}>{node.type ?? "widget"}</button>{node.children?.map((child, index) => outline(child, [...path, index], depth + 1))}</div>;
  }

  return <section className="component-library-workspace">
    <header className="component-workspace-header"><div><p className="eyebrow">PROJECT COMPONENT LIBRARY</p><h1>{id ? "Edit component" : "New component"}</h1><p>Build a reusable group of widgets. Each insertion is an independent copy, so existing screens remain stable.</p></div><button className="secondary" onClick={() => startNew()} disabled={busy}>Start new</button></header>
    <div className="component-workspace-grid">
      <section className="card component-library-list"><div className="panel-heading compact"><div><h2>Saved components</h2><p>{components.length} in this project</p></div></div><input aria-label="Find a component" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search components" />{filtered.map((component) => <div className="saved-component" key={component.id}><div><strong>{component.name}</strong><small>{component.category} · {component.document.type}</small><p>{component.description || "Reusable widget group"}</p></div><div><button className="secondary" onClick={() => open(component)}>Open</button><button className="secondary" onClick={() => onInsert(component)}>Add to screen</button></div></div>)}{!filtered.length && <p className="empty-state">{components.length ? "No components match your search." : "No components saved yet. Build your first one here."}</p>}</section>
      <section className="card component-editor"><div className="panel-heading compact"><div><h2>Component editor</h2><p>Compose a widget tree, then preview and save it.</p></div><span className={parsed.error ? "invalid" : "valid"}>{parsed.error ? "Needs review" : "Valid tree"}</span></div><div className="component-meta-fields"><label>Component name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="Product card" /></label><label>Category<input value={category} onChange={(event) => setCategory(event.target.value)} maxLength={40} placeholder="Commerce" /></label><label className="component-description">Description<input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={300} placeholder="Header with a product list" /></label></div><div className="component-examples"><span>Start from example</span><button onClick={() => startNew(productItem, "Product item")}>Icon + text</button><button onClick={() => startNew(productSection, "Product section")}>Card + product list</button></div><h3>Add widgets</h3><div className="component-widget-grid">{Object.keys(templates).map((kind) => <button key={kind} onClick={() => addWidget(kind)} disabled={!parsed.document}>+ {kind}</button>)}</div><div className="component-edit-grid"><div><h3>Widget tree</h3>{parsed.document ? outline(parsed.document) : <p className="error-message">{parsed.error}</p>}</div><div><h3>Selected widget</h3>{selected ? <><p className="component-selected-type">{selected.type}</p>{selected.type === "text" && <label>Text<input value={String(selected.props?.value ?? "")} onChange={(event) => updateSelected("value", event.target.value)} /></label>}{["button", "chip", "badge", "textInput"].includes(selected.type ?? "") && <label>Label<input value={String(selected.props?.label ?? "")} onChange={(event) => updateSelected("label", event.target.value)} /></label>}{selected.type === "icon" && <label>Icon name<input value={String(selected.props?.name ?? "")} onChange={(event) => updateSelected("name", event.target.value)} /></label>}{selected.type === "image" && <label>Image URL<input value={String(selected.props?.src ?? "")} onChange={(event) => updateSelected("src", event.target.value)} /></label>}{isContainer(selected) && <><label>Background<input value={String((selected.props?.style as Record<string, unknown> | undefined)?.background ?? "")} onChange={(event) => updateSelected("background", event.target.value)} placeholder="#FFFFFF" /></label><label>Gap<select value={String((selected.props?.style as Record<string, unknown> | undefined)?.gap ?? "")} onChange={(event) => updateSelected("gap", event.target.value)}><option value="">None</option><option value="xs">Extra small</option><option value="sm">Small</option><option value="md">Medium</option><option value="lg">Large</option></select></label></>}{selectedPath.length > 0 && <button className="danger-link" onClick={removeSelected}>Remove selected widget</button>}</> : <p>Select a widget in the tree.</p>}</div></div><label className="json-label">Advanced component JSON<textarea value={json} onChange={(event) => { setJson(event.target.value); setSelectedPath([]); }} spellCheck={false} /></label>{parsed.error && <p className="error-message" role="alert">{parsed.error}</p>}<p className="component-feedback" role="status">{message}</p><div className="component-editor-actions"><button className="primary loading-action" onClick={() => void save()} disabled={!canEdit || busy || !!parsed.error || !name.trim()} aria-busy={busy}>{busy && <LoadingSpinner />}{busy ? "Saving…" : id ? "Save changes" : "Save component"}</button>{id && <button className="secondary" onClick={() => void archive()} disabled={!canEdit || busy}>Archive component</button>}</div>{!canEdit && <p className="empty-state">Reviewers can browse and insert components. A designer or admin can create and manage them.</p>}</section>
      <aside className="card component-preview"><div className="panel-heading compact"><div><h2>Preview</h2><p>Representative sample content</p></div></div>{renderPreview(parsed.document)}</aside>
    </div>
  </section>;
}

