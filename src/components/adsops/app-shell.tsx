import { useEffect, useMemo, useRef, useState } from "react";
import { AnalyticsView } from "@/components/adsops/analytics-view";
import { ClassifyView } from "@/components/adsops/classify-view";
import { ClientPortal } from "@/components/adsops/client-portal";
import type { PacePreview } from "@/components/adsops/budget-banner";
import { PermissionsPanel } from "@/components/adsops/permissions-panel";
import {
  AlertsPanel,
  ConnectPanel,
  FinalPanel,
  GuardPanel,
  HubPanel,
  ProposalsPanel,
  ReportPanel,
  SopPanel,
} from "@/components/adsops/side-panels";
import {
  getWorkspaceDirectory,
  getWorkspacePack,
  getWorkspaceScene,
  type AccessSnap,
} from "@/lib/adsops/access.functions";
import { adminUpdateAdAccount, stopViewAs } from "@/lib/adsops/admin.functions";
import { AccountPicker } from "@/components/adsops/account-picker";
import type { AnalyticsSnap } from "@/lib/adsops/analytics";
import type { ClassifySnap } from "@/lib/adsops/classify.types";
import { clientSignOut } from "@/lib/adsops/client-auth.functions";
import { pullAnalyticsWarehouseFn, pullDeepChunkFn } from "@/lib/adsops/connect.functions";
import { MODULE_CAPABILITY, ROLE_LABEL_VI, formatSaigon } from "@/lib/adsops/permissions.types";
import { UserButton } from "@/lib/auth/gates";
import { cn } from "@/lib/cn";

