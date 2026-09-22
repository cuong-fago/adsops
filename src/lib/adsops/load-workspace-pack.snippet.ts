const WORKSPACE_MODULE_KEYS = [
  "report",
  "alerts",
  "guard",
  "hub",
  "proposals",
  "classify",
  "final",
  "connect",
  "sop",
  "analytics",
  "pace",
  "compare",
] as const;

type WorkspaceModuleKey = (typeof WORKSPACE_MODULE_KEYS)[number];

function normalizeModules(modules?: string[]): Set<WorkspaceModuleKey> | null {
  if (!modules || !modules.length) return null;
  const allowed = new Set<string>(WORKSPACE_MODULE_KEYS);
  const picked = new Set<WorkspaceModuleKey>();
  for (const raw of modules) {
    const key = String(raw || "").trim() as WorkspaceModuleKey;
    if (!allowed.has(key)) continue;
    picked.add(key);
  }
  return picked.size ? picked : null;
}

function wantsModule(filter: Set<WorkspaceModuleKey> | null, key: WorkspaceModuleKey): boolean {
  if (!filter) return true;
  if (key === "report" || key === "compare") {
    return filter.has("report") || filter.has("compare");
  }
  return filter.has(key);
}

export async function loadWorkspacePack(
  userId: string,
  clientId: string,
  modules?: string[],
): Promise<WorkspacePack> {
  const access = await assertClientAccess(userId, clientId);
  const viewer = access.role === "sale" || access.role === "client";
  const filter = normalizeModules(modules);

  if (viewer) {
    const [reportRaw, compareRaw] = await Promise.all([
      readFolder("report", clientId),
      readFolder("compare", clientId),
    ]);
    const report = asRec(reportRaw);
    const compare = asRec(compareRaw);
    const pack = emptyPack();
    pack.report = report ? { ...report, ...(compare ? { compare } : {}) } : null;
    return pack;
  }

  const needReport = wantsModule(filter, "report");
  const needAlerts = wantsModule(filter, "alerts");
  const needGuard = wantsModule(filter, "guard");
  const needHub = wantsModule(filter, "hub");
  const needProposals = wantsModule(filter, "proposals");
  const needClassify = wantsModule(filter, "classify");
  const needFinal = wantsModule(filter, "final");
  const needConnect = wantsModule(filter, "connect");
  const needSop = wantsModule(filter, "sop");
  const needAnalytics = wantsModule(filter, "analytics");
  const needPace = wantsModule(filter, "pace");

  const [
    reportRaw,
    compareRaw,
    alerts,
    guard,
    hub,
    proposals,
    classify,
    final,
    connect,
    sop,
    analytics,
    pace,
  ] = await Promise.all([
    needReport ? readFolder("report", clientId) : Promise.resolve(null),
    needReport ? readFolder("compare", clientId) : Promise.resolve(null),
    needAlerts ? readFolder("alerts", clientId) : Promise.resolve(null),
    needGuard ? readFolder("guard", clientId) : Promise.resolve(null),
    needHub ? readFolder("hub", clientId) : Promise.resolve(null),
    needProposals ? readFolder("proposals", clientId) : Promise.resolve(null),
    needClassify ? readFolder("classify", clientId) : Promise.resolve(null),
    needFinal ? readFolder("final", clientId) : Promise.resolve(null),
    needConnect ? readFolder("connect", clientId) : Promise.resolve(null),
    needSop ? readJsonRelative("sop.json") : Promise.resolve(null),
    needAnalytics ? readFolder("analytics", clientId) : Promise.resolve(null),
    needPace ? readFolder("budget-email", clientId) : Promise.resolve(null),
  ]);

  const pack = emptyPack();
  if (needReport) {
    const report = asRec(reportRaw);
    const compare = asRec(compareRaw);
    pack.report = report ? { ...report, ...(compare ? { compare } : {}) } : null;
  }
  if (needAlerts) pack.alerts = alerts;
  if (needGuard) pack.guard = guard;
  if (needHub) pack.hub = hub;
  if (needProposals) pack.proposals = proposals;
  if (needClassify) pack.classify = classify;
  if (needFinal) pack.final = final;
  if (needConnect) pack.connect = connect;
  if (needSop) pack.sop = sop;
  if (needAnalytics) pack.analytics = analytics;
  if (needPace) pack.pace = pace;
  return pack;
}

