"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Save, Play, Trash2, Eye } from "lucide-react";
import type {
  DevSimulatorPreviewResult,
  MockContextProfile,
  MockContextProfileUpsert,
  OrchestrationResult,
} from "@city-wallet/contracts";
import { Badge, Button, Card, JsonPanel } from "@city-wallet/ui";

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Card>
      <div className="mb-3">
        <div className="font-serif text-base">{title}</div>
        {subtitle ? <div className="text-xs text-ink-muted">{subtitle}</div> : null}
      </div>
      {children}
    </Card>
  );
}
import {
  activateMockContextProfile,
  apiProbeStatus,
  deleteMockContextProfile,
  listMockContextProfiles,
  listScenarios,
  previewSimulator,
  runSimulatorContext,
  saveMockContextProfile,
} from "./api";

type ProbeState = "checking" | "enabled" | "disabled";

type Scenario = Awaited<ReturnType<typeof listScenarios>>[number];
type ProfileOverrides = NonNullable<MockContextProfileUpsert["profileOverrides"]>;

const ALL_SOURCES: Array<{ key: string; label: string }> = [
  { key: "calendar", label: "Calendar" },
  { key: "fitness", label: "Fitness" },
  { key: "mobility", label: "Mobility" },
  { key: "mood", label: "Mood" },
  { key: "payment_preference", label: "Payment preference" },
  { key: "social", label: "Social" },
  { key: "transit", label: "Transit" },
  { key: "dietary", label: "Dietary" },
  { key: "device_attention", label: "Device attention" },
  { key: "local_events", label: "Local events" },
];

export function ContextSimulatorApp() {
  const [probe, setProbe] = useState<ProbeState>("checking");
  const [profiles, setProfiles] = useState<MockContextProfile[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MockContextProfileUpsert>(() => emptyDraft());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<DevSimulatorPreviewResult | null>(null);
  const [runResult, setRunResult] = useState<OrchestrationResult | null>(null);
  const [signalsText, setSignalsText] = useState<string>("{}");

  useEffect(() => {
    apiProbeStatus(`/api/dev/context-simulator/profiles?userId=user_mia`)
      .then((status) => {
        if (status === 0) {
          setProbe("disabled");
          setError("Could not reach API. Check the API base URL or that ENABLE_DEV_CONTEXT_SIMULATOR=true on the server.");
          return;
        }
        if (status === 404) {
          setProbe("disabled");
          return;
        }
        setProbe("enabled");
      })
      .catch(() => {
        setProbe("disabled");
        setError("Could not reach API. Check the API base URL or that ENABLE_DEV_CONTEXT_SIMULATOR=true on the server.");
      });
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [list, scen] = await Promise.all([listMockContextProfiles("user_mia"), listScenarios()]);
      setProfiles(list);
      setScenarios(scen);
      const active = list.find((p) => p.isActive) ?? list[0] ?? null;
      if (active) {
        setSelectedProfileId(active.id);
        setDraft(profileToDraft(active));
        setSignalsText(JSON.stringify(active.signalPayloads ?? {}, null, 2));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load profiles.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (probe === "enabled") {
      refresh().catch(console.error);
    }
  }, [probe, refresh]);

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );

  function selectProfile(profileId: string) {
    const p = profiles.find((profile) => profile.id === profileId);
    if (!p) return;
    setSelectedProfileId(profileId);
    setDraft(profileToDraft(p));
    setSignalsText(JSON.stringify(p.signalPayloads ?? {}, null, 2));
    setPreview(null);
  }

  function applyScenario(id: string) {
    const scenario = scenarios.find((s) => s.id === id);
    if (!scenario) return;
    // Always seed a NEW profile from a scenario so "Save & Activate" creates
    // a fresh active profile instead of overwriting whichever profile was
    // last selected. The previous behaviour silently mutated the active
    // profile, which is why "save & activate sometimes didn't switch".
    setSelectedProfileId(null);
    setDraft({
      userId: "user_mia",
      name: scenario.label,
      enabledSources: scenario.enabledSources,
      signalPayloads: scenario.signalPayloads as MockContextProfileUpsert["signalPayloads"],
      profileOverrides: (scenario.profileOverrides ?? undefined) as ProfileOverrides | undefined,
      activeScenario: scenario.id as MockContextProfileUpsert["activeScenario"],
    });
    setSignalsText(JSON.stringify(scenario.signalPayloads ?? {}, null, 2));
    setPreview(null);
  }

  function newProfile() {
    setSelectedProfileId(null);
    setDraft(emptyDraft());
    setSignalsText("{}");
    setPreview(null);
  }

  async function handleSave(activate = false) {
    setBusy(true);
    setError(null);
    try {
      let payloads: MockContextProfileUpsert["signalPayloads"] = {};
      try {
        payloads = JSON.parse(signalsText) as MockContextProfileUpsert["signalPayloads"];
      } catch {
        throw new Error("Signal payloads must be valid JSON.");
      }
      const saved = await saveMockContextProfile({
        ...draft,
        signalPayloads: payloads,
        setActive: activate,
      });
      setSelectedProfileId(saved.id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleActivate() {
    if (!selectedProfileId) return;
    setBusy(true);
    setError(null);
    try {
      await activateMockContextProfile(selectedProfileId, "user_mia");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Activate failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!selectedProfileId) return;
    if (!confirm("Delete this profile?")) return;
    setBusy(true);
    setError(null);
    try {
      await deleteMockContextProfile(selectedProfileId);
      newProfile();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handlePreview() {
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      let payloads: MockContextProfileUpsert["signalPayloads"] = {};
      try {
        payloads = JSON.parse(signalsText) as MockContextProfileUpsert["signalPayloads"];
      } catch {
        throw new Error("Signal payloads must be valid JSON.");
      }
      const result = await previewSimulator({
        userId: "user_mia",
        profileOverride: { ...draft, signalPayloads: payloads },
      });
      setPreview(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRun() {
    setBusy(true);
    setError(null);
    setRunResult(null);
    try {
      const result = await runSimulatorContext("user_mia");
      setRunResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run failed.");
    } finally {
      setBusy(false);
    }
  }

  if (probe === "checking") {
    return (
      <main className="mx-auto max-w-[1400px] px-5 py-10 sm:px-6">
        <div className="flex items-center gap-2 text-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking developer simulator availability…
        </div>
      </main>
    );
  }

  if (probe === "disabled") {
    return (
      <main className="mx-auto max-w-[1400px] px-5 py-10 sm:px-6">
        <Panel title="Dev context simulator unavailable" subtitle="This developer-only route is not enabled.">
          <p className="text-sm text-ink-muted">
            Set <code>ENABLE_DEV_CONTEXT_SIMULATOR=true</code> on the API server and restart it to access this page.
          </p>
          {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}
        </Panel>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-[1400px] flex-col gap-6 px-5 py-8 sm:px-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl">Context simulator</h1>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink-muted">Developer-only</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => refresh()} disabled={busy}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
          <Button variant="secondary" onClick={newProfile}>New profile</Button>
        </div>
      </header>

      {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
        <aside className="space-y-3">
          <Panel title="Profiles">
            <ul className="space-y-1">
              {profiles.length === 0 ? <li className="text-sm text-ink-muted">No profiles.</li> : null}
              {profiles.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => selectProfile(p.id)}
                    className={`w-full rounded-md border px-3 py-2 text-left text-sm ${selectedProfileId === p.id ? "border-ink-strong bg-black/5" : "border-black/10 hover:bg-black/5"}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{p.name}</span>
                      {p.isActive ? <Badge tone="green">active</Badge> : null}
                    </div>
                    <div className="text-xs text-ink-muted">v{p.version}</div>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Scenarios" subtitle="Click to seed a new profile from a preset.">
            <ul className="space-y-1">
              {scenarios.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => applyScenario(s.id)}
                    className="w-full rounded-md border border-black/10 px-3 py-2 text-left text-sm hover:bg-black/5"
                  >
                    <div className="font-medium">{s.label}</div>
                    <div className="text-xs text-ink-muted">{s.description}</div>
                    {s.profileOverrides ? (
                      <div className="mt-1 font-mono text-[10px] uppercase tracking-wide text-ink-muted">
                        walk {s.profileOverrides.walkingToleranceMeters ?? "—"}m · stops {s.profileOverrides.maxBundleStops ?? "—"} · {s.profileOverrides.declaredIntent ?? "—"}
                      </div>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        </aside>

        <section className="space-y-4">
          <Panel
            title={selectedProfile ? `Editing: ${selectedProfile.name}` : "New profile"}
            subtitle={
              selectedProfile
                ? `${selectedProfile.isActive ? "ACTIVE — applies to wallet now. " : "Inactive draft. "}v${selectedProfile.version}`
                : "Save & activate to make this the active profile for the wallet."
            }
          >
            {draft.profileOverrides ? (
              <div className="mb-3 rounded-md border border-black/10 bg-black/[0.02] p-3 text-xs text-ink-muted">
                <div className="font-mono uppercase tracking-wide">Effective overrides on this run</div>
                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 font-mono">
                  <span>walking</span><span>{draft.profileOverrides.walkingToleranceMeters ?? "—"} m</span>
                  <span>max stops</span><span>{draft.profileOverrides.maxBundleStops ?? "—"}</span>
                  <span>max offers/hr</span><span>{draft.profileOverrides.maxOffersPerHour ?? "—"}</span>
                  <span>reward</span><span>{draft.profileOverrides.rewardPreference ?? "—"}</span>
                  <span>privacy</span><span>{draft.profileOverrides.privacyMode ?? "—"}</span>
                  <span>intent</span><span>{draft.profileOverrides.declaredIntent ?? "—"}</span>
                  <span>available min</span><span>{draft.profileOverrides.availableMinutes ?? "—"}</span>
                </div>
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="block text-sm">
                <span className="block text-xs uppercase tracking-wide text-ink-muted">Name</span>
                <input
                  className="mt-1 w-full rounded-md border border-black/10 px-3 py-2"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <label className="block text-sm">
                <span className="block text-xs uppercase tracking-wide text-ink-muted">User ID</span>
                <input
                  className="mt-1 w-full rounded-md border border-black/10 px-3 py-2"
                  value={draft.userId}
                  onChange={(e) => setDraft({ ...draft, userId: e.target.value })}
                />
              </label>
            </div>

            <div className="mt-4">
              <div className="mb-2 text-xs uppercase tracking-wide text-ink-muted">Enabled sources</div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                {ALL_SOURCES.map((src) => (
                  <label key={src.key} className="flex items-center gap-2 rounded-md border border-black/10 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.enabledSources?.[src.key])}
                      onChange={(e) => setDraft({
                        ...draft,
                        enabledSources: { ...(draft.enabledSources ?? {}), [src.key]: e.target.checked },
                      })}
                    />
                    {src.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-2 text-xs uppercase tracking-wide text-ink-muted">Signal payloads (JSON)</div>
              <textarea
                className="h-64 w-full rounded-md border border-black/10 px-3 py-2 font-mono text-xs"
                value={signalsText}
                onChange={(e) => setSignalsText(e.target.value)}
              />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => handleSave(false)} disabled={busy}>
                <Save className="mr-2 h-4 w-4" /> Save
              </Button>
              <Button variant="secondary" onClick={() => handleSave(true)} disabled={busy}>
                Save & activate
              </Button>
              {selectedProfileId && !selectedProfile?.isActive ? (
                <Button variant="secondary" onClick={handleActivate} disabled={busy}>
                  Activate
                </Button>
              ) : null}
              {selectedProfileId ? (
                <Button variant="ghost" onClick={handleDelete} disabled={busy}>
                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                </Button>
              ) : null}
              <Button variant="secondary" onClick={handlePreview} disabled={busy}>
                <Eye className="mr-2 h-4 w-4" /> Preview agents
              </Button>
              <Button variant="secondary" onClick={handleRun} disabled={busy}>
                <Play className="mr-2 h-4 w-4" /> Run full pipeline
              </Button>
            </div>
          </Panel>

          {preview ? (
            <Panel title="Agent preview" subtitle="Runs assembler + user-negotiator only. No offers, tokens, or analytics for offers are created.">
              {preview.errorMessage ? (
                <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{preview.errorMessage}</div>
              ) : null}
              <JsonPanel title="Privacy metadata" data={preview.privacyMetadata} />
              <JsonPanel title="Filtered signals" data={preview.filteredSignals} />
              <JsonPanel title="Assembled user context" data={preview.assembledUserContext} />
              <JsonPanel title="User negotiation position" data={preview.userNegotiationPosition} />
              <JsonPanel title="Agent trace" data={preview.agentTrace} />
            </Panel>
          ) : null}

          {runResult ? (
            <Panel title="Last full pipeline result">
              <JsonPanel title="Orchestration result" data={runResult} />
            </Panel>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function emptyDraft(): MockContextProfileUpsert {
  return {
    userId: "user_mia",
    name: "New profile",
    enabledSources: {},
    signalPayloads: {},
    activeScenario: null,
  };
}

function profileToDraft(profile: MockContextProfile): MockContextProfileUpsert {
  return {
    id: profile.id,
    userId: profile.userId,
    name: profile.name,
    enabledSources: profile.enabledSources,
    signalPayloads: profile.signalPayloads,
    profileOverrides: profile.profileOverrides,
    activeScenario: profile.activeScenario,
  };
}
