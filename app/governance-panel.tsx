"use client";

import { useEffect, useState } from "react";
import { resetStudioPassword } from "../lib/firebase";
import { changeStudioProjectMember, type StudioProject } from "../lib/studio-projects";
import {
  loadStudioMember,
  observeStudioAudit,
  observeStudioMembers,
  saveStudioMember,
  type StudioAuditEntry,
  type StudioMember,
  type StudioRole,
} from "../lib/studio-governance";

type StudioActor = {
  uid: string;
  email: string | null;
  displayName: string | null;
};

const roles: StudioRole[] = ["designer", "reviewer", "admin"];

export function StudioGovernancePanel({ actor, project }: { actor: StudioActor | null; project: StudioProject }) {
  const [profile, setProfile] = useState<StudioMember | null>(null);
  const [members, setMembers] = useState<StudioMember[]>([]);
  const [audit, setAudit] = useState<StudioAuditEntry[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uid, setUid] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<StudioRole>("designer");
  const [active, setActive] = useState(true);
  const [projectMemberUid, setProjectMemberUid] = useState("");
  const [projectBusy, setProjectBusy] = useState(false);

  useEffect(() => setProjectMemberUid(""), [project.id]);

  useEffect(() => {
    if (!actor) {
      setProfile(null);
      setMembers([]);
      setAudit([]);
      return;
    }
    let cancelled = false;
    void loadStudioMember(actor.uid).then((member) => {
      if (!cancelled) setProfile(member);
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load your Studio role.");
    });
    const stopAudit = observeStudioAudit(setAudit, (message) => setError(message));
    return () => {
      cancelled = true;
      stopAudit();
    };
  }, [actor]);

  useEffect(() => {
    if (!actor || profile?.role !== "admin") {
      setMembers([]);
      return;
    }
    return observeStudioMembers(setMembers, (message) => setError(message));
  }, [actor, profile?.role]);

  if (!actor) return null;
  const currentActor = actor;

  const isAdmin = profile?.role === "admin";
  const canManage = isAdmin && profile?.active !== false;
  const projectMembers = project.memberIds.map((memberUid) => members.find((member) => member.uid === memberUid) ?? {
    uid: memberUid, email: memberUid, displayName: "", role: "reviewer" as const, active: false, updatedAt: 0,
  });
  const availableProjectMembers = members.filter((member) => member.active && !project.memberIds.includes(member.uid));

  async function changeProjectAccess(targetUid: string, action: "add" | "remove") {
    if (!canManage || project.id === "legacy" || projectBusy) return;
    setProjectBusy(true);
    setError("");
    try {
      await changeStudioProjectMember({ projectId: project.id, targetUid, action });
      const member = members.find((item) => item.uid === targetUid);
      setNotice((member?.email ?? targetUid) + (action === "add" ? " added to " : " removed from ") + project.name + ".");
      setProjectMemberUid("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update project access.");
    } finally {
      setProjectBusy(false);
    }
  }

  async function saveAccessRecord() {
    if (!canManage) return;
    if (!uid.trim() || !email.trim()) {
      setNotice("Enter the Firebase Authentication UID and email address first.");
      return;
    }
    try {
      await saveStudioMember({
        uid: uid.trim(),
        email: email.trim().toLowerCase(),
        displayName: displayName.trim(),
        role,
        active,
      }, {
        uid: currentActor.uid,
        label: currentActor.displayName ?? currentActor.email ?? currentActor.uid,
      });
      setNotice("Studio access record saved. The account can now use the selected role.");
      setUid("");
      setEmail("");
      setDisplayName("");
      setRole("designer");
      setActive(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the access record.");
    }
  }

  async function updateMember(member: StudioMember, changes: Partial<Pick<StudioMember, "role" | "active">>) {
    if (!canManage) return;
    try {
      await saveStudioMember({ ...member, ...changes }, {
        uid: currentActor.uid,
        label: currentActor.displayName ?? currentActor.email ?? currentActor.uid,
      });
      setNotice("Access updated for " + member.email + ".");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update access.");
    }
  }

  async function sendReset(member: StudioMember) {
    try {
      await resetStudioPassword(member.email);
      setNotice("Password reset email requested for " + member.email + ".");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not request the password reset.");
    }
  }

  return (
    <section className="governance-section">
      <div className="governance-heading">
        <div>
          <p className="eyebrow">WORKSPACE GOVERNANCE</p>
          <h2>People and activity</h2>
          <p>Roles control Studio access. Every saved draft and published version is recorded below.</p>
        </div>
        <span className={"role-pill " + (profile?.role ?? "unknown")}>{profile?.role ?? "role pending"}</span>
      </div>
      {error && <p className="governance-error">{error}</p>}
      {notice && <p className="governance-notice">{notice}</p>}
      {!profile && !error && <p className="empty-state">Loading your Studio access record…</p>}

      {canManage && <div className="access-grid">
        <section className="governance-card">
          <h3>Add or update Studio access</h3>
          <p>Create the Firebase Authentication account in Firebase Console first, then paste its UID here. Passwords never enter Studio.</p>
          <div className="governance-form">
            <label>Authentication UID<input value={uid} onChange={(event) => setUid(event.target.value)} placeholder="Firebase user UID" /></label>
            <label>Work email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" /></label>
            <label>Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Optional" /></label>
            <label>Role<select value={role} onChange={(event) => setRole(event.target.value as StudioRole)}>{roles.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label className="check-label"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> Account can access Studio</label>
            <button className="primary" type="button" onClick={saveAccessRecord}>Save access</button>
          </div>
        </section>
        <section className="governance-card">
          <h3>Studio members</h3>
          <div className="member-list">
            {members.map((member) => <div className="member-row" key={member.uid}>
              <div><strong>{member.displayName || member.email}</strong><small>{member.email}</small></div>
              <select aria-label={"Role for " + member.email} value={member.role} disabled={member.uid === currentActor.uid} onChange={(event) => void updateMember(member, { role: event.target.value as StudioRole })}>{roles.map((value) => <option key={value}>{value}</option>)}</select>
              <label className="member-active"><input type="checkbox" checked={member.active} disabled={member.uid === currentActor.uid} onChange={(event) => void updateMember(member, { active: event.target.checked })} /> Active</label>
              <button className="link-button" type="button" onClick={() => void sendReset(member)}>Reset password</button>
            </div>)}
            {!members.length && <p className="empty-state">No access records are visible yet.</p>}
          </div>
        </section>
      </div>}

      <section className="governance-card project-members-card" aria-label="Project members">
        <h3>{project.id === "legacy" ? "Demo workspace access" : project.name + " members"}</h3>
        {project.id === "legacy" ? <p>The demo workspace uses Studio access. Choose a client project to manage its members.</p> : <>
          <p>{project.memberIds.length} member{project.memberIds.length === 1 ? "" : "s"} can open this client project. Studio roles still determine who can edit or publish.</p>
          {canManage ? <>
            <div className="project-member-add">
              <label>Studio member to add<select value={projectMemberUid} onChange={(event) => setProjectMemberUid(event.target.value)} disabled={projectBusy}>
                <option value="">Choose a Studio member</option>
                {availableProjectMembers.map((member) => <option key={member.uid} value={member.uid}>{member.displayName ? member.displayName + " · " : ""}{member.email} ({member.role})</option>)}
              </select></label>
              <button className="primary" type="button" disabled={!projectMemberUid || projectBusy} onClick={() => void changeProjectAccess(projectMemberUid, "add")}>Add to project</button>
            </div>
            {!availableProjectMembers.length && <p className="empty-state">All active Studio members already have access.</p>}
            <div className="project-member-list">
              {projectMembers.map((member) => <div className="project-member-row" key={member.uid}>
                <div><strong>{member.displayName || member.email}</strong><small>{member.email !== member.uid ? member.email + " · " : ""}{member.active ? member.role : "Inactive or missing Studio record"}</small></div>
                <button className="link-button" type="button" disabled={member.uid === currentActor.uid || projectBusy} onClick={() => void changeProjectAccess(member.uid, "remove")}>{member.uid === currentActor.uid ? "Current admin" : "Remove from project"}</button>
              </div>)}
            </div>
          </> : <p>Only an active Studio admin who belongs to this project can change its members.</p>}
        </>}
      </section>

      <section className="governance-card audit-card">
        <h3>Recent activity</h3>
        <div className="audit-list">
          {audit.map((entry) => <div className="audit-row" key={entry.id}>
            <span className={"audit-dot " + entry.action} />
            <div><strong>{entry.action.replaceAll("_", " ")}</strong><small>{entry.targetLabel || entry.screenId || "Studio workspace"}{entry.projectName ? " · " + entry.projectName : ""} · {entry.actorLabel}</small></div>
            <time>{new Date(entry.createdAt).toLocaleString()}</time>
          </div>)}
          {!audit.length && <p className="empty-state">Activity appears here after the next draft save, publish, restore, archive, or access change.</p>}
        </div>
      </section>
    </section>
  );
}
