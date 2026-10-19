"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  ShieldAlert,
  Clock,
  Sparkles,
  FolderGit2,
  FileCode2,
  Lock,
  Mail,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LeakedKey, Provider } from "@/types";
import { cn } from "@/lib/utils";
import { INTEL_PROVIDERS, PROVIDER_LABELS } from "@/lib/constants";



interface LeakFeedProps {
  leaks: (LeakedKey | null)[];
  total?: number;
  isLoading?: boolean;
  selectedProvider: Provider;
  plan: "free" | "pro";
  onSignIn?: () => void;
  isOffline?: boolean;
}

const formatTimeAgo = (date: Date): string => {
  return formatDistanceToNow(date, { addSuffix: true })
    .replace(/less than a minute/gi, "1 min")
    .replace(/about\s+/gi, "")
    .replace(/\b1\s+minute?s?\b/gi, "1 min")
    .replace(/\b(\d+)\s+minutess?\b/gi, "$1 mins")
    .replace(/\b1\s+hour?s?\b/gi, "1 hr")
    .replace(/\b(\d+)\s+hourss?\b/gi, "$1 hrs")
    .replace(/a minute/gi, "1 min")
    .replace(/an hour/gi, "1 hr")
    .replace(/\bhours\b/gi, "hrs")
    .replace(/\bminutes\b/gi, "mins");
};

// --- Loading Skeleton ---
const FeedSkeleton = React.memo(({ isUnauthenticated }: { isUnauthenticated?: boolean }) => (
  <div className="flex flex-col divide-y divide-border/20">
    {Array.from({ length: isUnauthenticated ? 8 : 12 }).map((_, i) => (
      <div
        key={`skel-${i}`}
        className="block px-2 py-1 sm:px-5 sm:py-1.5 animate-pulse opacity-50"
      >
        <div className="flex items-start sm:items-center gap-3 sm:gap-4">
          <div className="flex flex-row items-center gap-3 sm:gap-5 flex-1 min-w-0">
            {/* Main Content Row */}
            <div className="flex items-center justify-between sm:justify-start gap-2.5 flex-1 sm:flex-initial sm:w-[240px] lg:w-[260px] min-w-0">
              {/* Redacted key skeleton */}
              <Skeleton className="h-[16px] sm:h-[22px] w-[140px] sm:w-[210px] rounded-md bg-muted/40" />
              
              {/* Mobile-only status tools skeleton */}
              <div className="flex sm:hidden items-center justify-end gap-1.5 flex-shrink-0 min-w-[125px]">
                <div className="w-5 flex items-center justify-center shrink-0"></div>
                <Skeleton className="h-[14px] w-[68px] rounded-md bg-muted/30 shrink-0" />
                <Skeleton className="h-[10px] w-[32px] rounded bg-muted/20 shrink-0" />
              </div>
            </div>

            {/* Bottom Row / Middle Content (Desktop) */}
            <div className="hidden sm:flex flex-row sm:items-center gap-1 sm:gap-5 text-[10px] sm:text-sm text-muted-foreground/80 min-w-0 flex-1">
              {/* Repository Column */}
              <div className="flex items-center gap-1.5 sm:w-[160px] lg:w-[190px] flex-shrink-0">
                <Skeleton className="h-3 sm:h-3.5 w-3 sm:w-3.5 rounded-full bg-muted/30 flex-shrink-0" />
                <Skeleton className="h-[12px] sm:h-[14px] w-[110px] sm:w-[130px] rounded bg-muted/30" />
              </div>

              {/* Path Column */}
              <div className="flex items-center gap-1.5 truncate flex-1 min-w-0">
                <span className="text-border flex-shrink-0 font-light opacity-40 hidden sm:inline">/</span>
                <Skeleton className="h-3 sm:h-3.5 w-3 sm:w-3.5 rounded bg-muted/30 flex-shrink-0" />
                <Skeleton className="h-[12px] sm:h-[14px] w-[120px] sm:w-[160px] rounded bg-muted/20" />
              </div>
            </div>
          </div>

          {/* Desktop-only status tools */}
          <div className="hidden sm:flex items-center gap-4 flex-shrink-0 sm:ml-auto">
             <Skeleton className="h-[16px] sm:h-[16px] w-[95px] rounded-md bg-muted/30 shrink-0" />
             <span className="text-border flex-shrink-0 text-muted-foreground/30">·</span>
             <div className="inline-flex items-center gap-2 sm:w-[100px] justify-start">
               <Skeleton className="h-3.5 w-3.5 rounded-full bg-muted/30" />
               <Skeleton className="h-[12px] w-[48px] bg-muted/20 rounded shrink-0" />
             </div>
          </div>
        </div>
      </div>
    ))}

    {/* Sign-in prompt skeleton */}
    {isUnauthenticated && (
      <div className="block px-2 py-2 sm:px-5 sm:py-2 border-t border-border/10 opacity-50 animate-pulse">
        <div className="flex items-start sm:items-center gap-3 sm:gap-4">
          <div className="mt-1 sm:mt-0 flex-shrink-0">
            <Skeleton className="h-3.5 w-3.5 sm:h-4 sm:w-4 rounded-sm bg-muted/30" />
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 flex-1 min-w-0">
            <div className="flex flex-col flex-1 min-w-0 justify-center">
               <Skeleton className="h-[14px] sm:h-[17px] w-[80%] max-w-[400px] rounded bg-muted/20" />
            </div>
            <div className="flex-shrink-0 sm:ml-auto pt-1 sm:pt-0 w-full sm:w-auto">
              <Skeleton className="h-7 sm:h-10 w-full sm:w-[160px] rounded-md bg-muted/30" />
            </div>
          </div>
        </div>
      </div>
    )}
  </div>
));
FeedSkeleton.displayName = "FeedSkeleton";

// --- Empty State ---
const FeedEmptyState = React.memo(
  ({
    selectedProvider,
    isOffline,
  }: {
    selectedProvider: Provider;
    isOffline?: boolean;
  }) => {
    const isAll = selectedProvider === "all";
    const providerLabel = isAll ? "SYSTEM" : (PROVIDER_LABELS.find(lbl => lbl.value === selectedProvider)?.label || selectedProvider).toUpperCase();
    const [nextRetry, setNextRetry] = React.useState(30.0);

    React.useEffect(() => {
      let timer: NodeJS.Timeout;
      if (isOffline) {
        timer = setInterval(() => {
          setNextRetry((prev) => (prev <= 0.1 ? 30.0 : prev - 0.1));
        }, 100);
      }
      return () => clearInterval(timer);
    }, [isOffline]);

    return (
      <div className="text-center py-16 px-4 animate-fade-in transition-all duration-300">
        <div className="space-y-4 max-w-md mx-auto">
          {isOffline ? (
            <>
              <div className="space-y-1.5">
                <h3 className="text-xl font-bold tracking-tight text-foreground uppercase">
                  System Offline
                </h3>
                <div className="flex items-center justify-center gap-2">

                  <span className="text-[8px] sm:text-[9px] font-bold uppercase tracking-[0.2em] text-red-500/80 font-mono">
                    [SIGNAL_LOST] // UPLINK_SEVERED_CORE_STREAM
                  </span>
                </div>
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground/80 leading-relaxed">
                The intelligence bridge has been severed. Autonomous recovery
                protocols have been initiated to restore the live intel stream.
              </p>
              <div className="pt-2">
                <span className="text-[9px] font-bold font-mono tracking-widest text-amber-500/60 uppercase">
                  AUTONOMOUS_RECOVERY: RETRYING_IN {nextRetry.toFixed(1)}s
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <h3 className="text-xl font-bold tracking-tight text-foreground uppercase">
                  Sensors are clear
                </h3>
                <div className="flex items-center justify-center gap-2">

                  <span className="text-[8px] sm:text-[9px] font-bold uppercase tracking-[0.2em] text-emerald-500/80 font-mono">
                    [STATUS: NOMINAL] // NO_EXPOSURES_DETECTED_FOR_{providerLabel}
                  </span>
                </div>
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground/80 leading-relaxed">
                The scanning engine reports zero active exposures for the current
                filters. All monitored{" "}
                {isAll
                  ? "provider repositories"
                  : `${providerLabel} assets`}{" "}
                are currently secured and verified.
              </p>
            </>
          )}
        </div>
      </div>
    );
  }
);
FeedEmptyState.displayName = "FeedEmptyState";

type VerificationData = {
  enabled: boolean;
  total: number;
  coverage: Array<{ repository: string; branchesSeen: number; filesSeen: number; skippedBlobs: number; skippedLarge: number; skippedBinary: number; truncatedTrees: number; commitsSeen: number; missingPatches: number; historyCompleteAt?: string; historyError?: string; alertsPermission: string; snapshotCompleteAt?: string; error?: string }>;
  findings: Array<{ repository: string; provider: string; path: string; branch?: string; encoded: boolean; source: string; state: string; validity: string; url: string; observedAt: string }>;
};
type VerificationStatus = {
  enabled: boolean;
  scope: string;
  repositories: number;
  discoveredRepositories: number;
  visitedRepositories: number;
  installedRepositories: number;
  queuedRepositories: number;
  findings: number;
  validity: Record<string, number>;
  lastScannedAt: string | null;
  coverage: null | { branchesSeen: number; commitsSeen: number; snapshotComplete: number; historyComplete: number; missingPatches: number; skippedLarge: number; skippedBinary: number; skippedBlobs: number; alertsDenied: number };
};

const VerificationPanel = ({ onSignIn, isAuthenticated }: { onSignIn?: () => void; isAuthenticated: boolean }) => {
  const [data, setData] = useState<VerificationData | null>(null);
  const [status, setStatus] = useState<VerificationStatus | null>(null);
  const [message, setMessage] = useState('Loading verification status…');

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      fetch('/api/verification/status', { cache: 'no-store' })
        .then(async response => {
          if (!response.ok) throw new Error('Verification service unavailable.');
          return response.json() as Promise<VerificationStatus>;
        })
        .then(value => { if (!cancelled) setStatus(value); })
        .catch(error => { if (!cancelled) setMessage(error.message); });
    };
    refresh();
    const interval = setInterval(refresh, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    fetch('/api/verification', { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error(response.status === 403 ? 'Operator access required.' : 'Verification service unavailable.');
        return response.json() as Promise<VerificationData>;
      })
      .then(value => { if (!cancelled) setData(value); })
      .catch(error => { if (!cancelled) setMessage(error.message); });
    return () => { cancelled = true; };
  }, [isAuthenticated]);

  return (
    <div className="overflow-y-auto p-4 sm:p-6 space-y-4 text-xs sm:text-sm">
      <div className="flex flex-wrap gap-3 items-center">
        <strong>Live Verification</strong>
        <span>{status ? (status.enabled ? 'Public repository backfill enabled' : 'Public repository backfill disabled') : message}</span>
        {status && <span>{status.repositories.toLocaleString()} queued or tracked repositories · {status.findings.toLocaleString()} findings</span>}
      </div>
      {status && <div className="flex flex-wrap gap-3 text-muted-foreground">
        <span>Active: {status.validity.active || 0}</span>
        <span>Inactive: {status.validity.inactive || 0}</span>
        <span>Unknown: {status.validity.unknown || 0}</span>
        <span>Incremental discovery: {status.discoveredRepositories.toLocaleString()}</span>
        <span>Backfill visited: {status.visitedRepositories.toLocaleString()}</span>
        <span>Waiting: {status.queuedRepositories.toLocaleString()}</span>
        <span>App installed: {status.installedRepositories.toLocaleString()}</span>
        {status.lastScannedAt && <span>Last scan: {new Date(status.lastScannedAt).toLocaleString()}</span>}
      </div>}
      {status?.coverage && <div className="flex flex-wrap gap-3 text-muted-foreground">
        <span>Branch heads: {status.coverage.branchesSeen}</span>
        <span>Commit visits: {status.coverage.commitsSeen}</span>
        <span>Snapshot passes: {status.coverage.snapshotComplete}/{status.repositories}</span>
        <span>History passes: {status.coverage.historyComplete}/{status.repositories}</span>
        {status.coverage.alertsDenied > 0 && <span className="text-amber-500">GitHub alerts permission missing: {status.coverage.alertsDenied}</span>}
        {(status.coverage.missingPatches + status.coverage.skippedLarge + status.coverage.skippedBinary + status.coverage.skippedBlobs) > 0 && <span className="text-amber-500">Coverage gaps: {status.coverage.missingPatches + status.coverage.skippedLarge + status.coverage.skippedBinary + status.coverage.skippedBlobs}</span>}
      </div>}
      <p className="text-muted-foreground">Scope: public repositories observed by the existing global code search or public push feed, plus App installed public repositories. The queue is rate limited; a repository is covered only when its snapshot and history passes complete. Discovery is limited by GitHub search indexing and the public event feed.</p>
      <p className="text-muted-foreground">GitHub secret scanning alerts are available only for App installed repositories; other public repositories use APIRadar branch and commit matching.</p>
      <p className="text-muted-foreground">GitHub reports active or inactive only for supported alert types. Branch and commit matches remain unknown. APIRadar does not test discovered credentials.</p>
      {!isAuthenticated && <div className="flex gap-2 items-center text-muted-foreground"><Lock className="h-4 w-4" /> Location details require operator sign-in. {onSignIn && <button className="text-amber-500 underline" onClick={onSignIn}>Sign in</button>}</div>}
      {isAuthenticated && !data && <p className="text-muted-foreground">{message}</p>}
      {data?.coverage.map(repo => (
        <div key={repo.repository} className="border border-border/50 rounded p-2">
          <strong>{repo.repository}</strong> · {repo.branchesSeen} branches · {repo.filesSeen} files · {repo.commitsSeen || 0} commits · alerts: {repo.alertsPermission}
          {repo.truncatedTrees > 0 && <span> · {repo.truncatedTrees} trees recovered</span>}
          {repo.skippedBlobs > 0 && <span> · {repo.skippedBlobs} skipped blobs</span>}
          {repo.skippedLarge > 0 && <span> · {repo.skippedLarge} large files skipped</span>}
          {repo.skippedBinary > 0 && <span> · {repo.skippedBinary} binary files skipped</span>}
          {repo.missingPatches > 0 && <span> · {repo.missingPatches} commit patches unavailable</span>}
          {repo.snapshotCompleteAt ? <span> · last complete pass {new Date(repo.snapshotCompleteAt).toLocaleString()}</span> : <span> · snapshot in progress</span>}
          {repo.historyCompleteAt ? <span> · history pass completed {new Date(repo.historyCompleteAt).toLocaleString()}</span> : <span> · history in progress</span>}
          {repo.error && <span className="text-amber-500"> · scan error</span>}
          {repo.historyError && <span className="text-amber-500"> · history error</span>}
        </div>
      ))}
      {data?.findings.map((finding, index) => (
        <div key={`${finding.repository}:${index}`} className="border-b border-border/30 pb-2 flex flex-wrap gap-x-2">
          <span className="font-semibold">{finding.provider}</span>
          <span>{finding.validity}</span>
          <span>{finding.repository}{finding.path ? ` / ${finding.path}` : ''}</span>
          {finding.branch && <span>branch: {finding.branch}</span>}
          {finding.encoded && <span>Base64</span>}
          <span>{finding.source === 'github-secret-scanning' ? 'GitHub alert' : finding.source === 'commit-diff' ? 'commit history' : 'branch snapshot'}</span>
          {finding.url && <a href={finding.url} target="_blank" rel="noopener noreferrer" className="text-amber-500 underline">View location</a>}
        </div>
      ))}
      {data && data.findings.length === 0 && <p className="text-muted-foreground">No findings synced yet. Check the repository coverage and alert permission above.</p>}
    </div>
  );
};

// --- Single Feed Item ---
const FeedItem = React.memo(
  ({
    leak,
    index,
  }: {
    leak: LeakedKey;
    index: number;
  }) => {
    return (
      <div 
        className={cn(
          "block px-2 py-1 sm:px-5 sm:py-1.5 transition-colors duration-50 group/item animate-fade-in-up sm:hover:bg-white/[0.03]",
        )}
        style={{ animationDelay: `${Math.min(index * 20, 200)}ms` }}
      >
        <div className="flex items-start sm:items-center gap-3 sm:gap-4">
          <div className="flex flex-row items-center gap-3 sm:gap-5 flex-1 min-w-0">
            {/* Main Content Row */}
            <div className="flex items-center justify-between sm:justify-start gap-2.5 flex-1 sm:flex-initial sm:w-[240px] lg:w-[260px] min-w-0">
              {/* Redacted key */}
              <code className="text-[10px] sm:text-sm font-mono bg-muted/40 px-1.5 sm:px-2 py-0 rounded-md border border-border/40 text-foreground transition-colors duration-50 truncate min-w-0 tracking-tight">
                <span className="sm:hidden">
                  {leak.redactedKey.length > 20 && leak.redactedKey.includes('*')
                    ? `${leak.redactedKey.slice(0, 6)}${"*".repeat(8)}${leak.redactedKey.slice(-6)}`
                    : leak.redactedKey}
                </span>
                <span className="hidden sm:inline">{leak.redactedKey}</span>
              </code>

              {/* Mobile status tools */}
              <div className="flex sm:hidden items-center justify-end gap-1.5 flex-shrink-0 min-w-[125px]">
                <div className="flex items-center justify-center gap-1 px-1 py-0 rounded-md text-[8px] uppercase font-bold tracking-wider w-[68px] shrink-0 border bg-red-500/10 text-red-500 border-red-500/20">
                  <ShieldAlert className="h-3 w-3 shrink-0" />
                  <span>IDENTIFIED</span>
                </div>
                <span className="text-[9px] text-muted-foreground/60 tabular-nums flex items-center gap-1 font-medium min-w-[32px] justify-end">
                  {formatTimeAgo(new Date(leak.leakIntroducedAt)).replace(" ago", "")}
                </span>
              </div>
            </div>

            {/* Bottom Row (Hides on Mobile) / Middle Content (Desktop) */}
            <div className="hidden sm:flex flex-row sm:items-center gap-1 sm:gap-5 text-[10px] sm:text-sm text-muted-foreground/80 min-w-0 flex-1">
              {/* Repository Column */}
              <div className="flex items-center gap-1.5 sm:w-[160px] lg:w-[190px] flex-shrink-0">
                <FolderGit2 className="h-3 w-3 sm:h-3.5 sm:w-3.5 flex-shrink-0 text-amber-500/80" />
                <span 
                  className={cn(
                    "text-amber-500/90 font-semibold truncate group-hover/item:text-amber-500 transition-colors duration-50",
                    leak.originalUrl && "cursor-pointer group-hover/item:underline"
                  )}
                  onClick={(e) => {
                    if (leak.originalUrl) {
                      e.stopPropagation();
                      let baseUrl = leak.originalUrl;
                      if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
                      let finalUrl = baseUrl;
                      if (leak.filePath && !baseUrl.includes('/blob/') && !baseUrl.includes('/tree/')) {
                         finalUrl = `${baseUrl}/blob/main/${leak.filePath}`;
                      }
                      if (!finalUrl.startsWith('http')) finalUrl = `https://${finalUrl}`;
                      window.open(finalUrl, '_blank', 'noopener,noreferrer');
                    }
                  }}
                >
                  {leak.repoUrl || "***"}
                </span>
              </div>

              {/* Path Column (Aligned vertically) */}
              <div className="flex items-center gap-1.5 truncate flex-1 min-w-0">
                <span className="text-border flex-shrink-0 font-light opacity-40 hidden sm:inline">/</span>
                <FileCode2 className="h-3 w-3 sm:h-3.5 sm:w-3.5 flex-shrink-0 opacity-70" />
                <span className="truncate text-foreground/80 font-medium">
                  {leak.filePath || "***"}
                </span>
              </div>
            </div>
          </div>

          {/* Desktop-only status tools */}
          <div className="hidden sm:flex items-center gap-4 flex-shrink-0 sm:ml-auto">
            <div className="w-[95px] items-center justify-center gap-1.5 flex px-2 py-0 rounded-md text-[10px] uppercase font-bold tracking-widest flex-shrink-0 border bg-red-500/10 text-red-500 border-red-500/20">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
              <span>Identified</span>
            </div>
            <span className="text-border flex-shrink-0 text-muted-foreground/30">·</span>
            <span className="text-[13px] text-muted-foreground/70 whitespace-nowrap flex-shrink-0 tabular-nums font-medium inline-flex items-center gap-2 sm:w-[100px] justify-start">
              <Clock className="h-3.5 w-3.5 opacity-60" />
              {formatTimeAgo(new Date(leak.leakIntroducedAt))}
            </span>
          </div>
        </div>
      </div>
    );
  }
);
FeedItem.displayName = "FeedItem";

// --- Main Feed Component ---
const LeakFeedComponent = React.memo(
  ({
    leaks,
    total = 0,
    isLoading,
    selectedProvider,
    plan,
    onSignIn,
    isOffline,
  }: LeakFeedProps) => {
    const [activeTab, setActiveTab] = useState<"finds" | "working">("finds");

    const validLeaks = useMemo(
      () => leaks.filter((leak) => leak !== null) as LeakedKey[],
      [leaks]
    );

    const isUnauthenticated = plan === "free";
    const isRestrictionReached = isUnauthenticated && validLeaks.length >= 8;
    const showSignInPrompt = isUnauthenticated;

    const activeDataProvider = validLeaks.length > 0 && selectedProvider !== 'all' 
      ? validLeaks[0].provider 
      : selectedProvider;
      
    const providerObj = INTEL_PROVIDERS.find(p => p.value === activeDataProvider);
    const providerDisplayName = activeDataProvider === 'all' 
      ? 'global'
      : (providerObj?.label || activeDataProvider);

    return (
      <div className="w-full">
        {/* Sub-tabs: Latest Finds / Working Keys */}
        <div className="mb-2 sm:mb-5">
          <div className="relative flex items-center p-1 bg-card/30 backdrop-blur-sm border border-border/50 rounded-lg gap-1 sm:gap-1.5 h-[32px] sm:h-11">
            <button
              onClick={() => setActiveTab("finds")}
              className={cn(
                "relative flex items-center justify-center py-1 px-2 sm:py-2 sm:px-3 text-[11px] sm:text-sm transition-all duration-200 z-10 flex-1 min-w-[fit-content] rounded-md touch-manipulation font-medium h-full",
                activeTab === "finds"
                  ? "text-foreground font-semibold bg-background border border-border/50"
                  : "text-muted-foreground sm:hover:text-foreground sm:hover:bg-muted/50"
              )}
            >
              <span className="relative z-10 truncate px-1 flex items-center justify-center gap-1.5">
                <ShieldAlert className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                <span className="hidden sm:inline">Recent</span> Detections
              </span>
            </button>
            <button
              onClick={() => setActiveTab("working")}
              className={cn(
                "relative flex items-center justify-center py-1 px-2 sm:py-2 sm:px-3 text-[11px] sm:text-sm transition-all duration-200 z-10 flex-1 min-w-[fit-content] rounded-md font-medium h-full",
                activeTab === "working"
                  ? "text-foreground font-semibold bg-background border border-border/50"
                  : "text-muted-foreground"
              )}
            >
              <span className="relative z-10 truncate px-1 flex items-center justify-center gap-1 sm:gap-1.5">
                <Sparkles className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                <span className="hidden sm:inline text-nowrap">Live Verification</span>
                <span className="sm:hidden">Verification</span>
              </span>
            </button>
          </div>
        </div>

        {/* Feed content */}
        {activeTab === "working" ? (
          <Card className="border-border/50 bg-card/40 backdrop-blur-sm overflow-hidden flex flex-col h-[380px] sm:h-[450px]">
             <VerificationPanel onSignIn={onSignIn} isAuthenticated={!isUnauthenticated} />
          </Card>
        ) : (
          <Card 
            className={cn(
              "border-border/50 bg-card/40 backdrop-blur-sm overflow-hidden flex flex-col",
              isUnauthenticated ? "h-fit" : "h-[420px] sm:h-[450px]"
            )}
          >
            <div className="flex-1 overflow-y-auto overscroll-auto custom-scrollbar min-h-0" style={{ WebkitOverflowScrolling: 'touch' }}>
              {isLoading && validLeaks.length === 0 ? (
                <FeedSkeleton isUnauthenticated={isUnauthenticated} />
              ) : (validLeaks.length === 0 || isOffline) ? (
                <FeedEmptyState
                  selectedProvider={selectedProvider}
                  isOffline={isOffline}
                />
              ) : (
                <>
                  <div className="flex flex-col divide-y divide-border/20">
                  {validLeaks.map((leak, index) => (
                    <FeedItem
                      key={leak.id || `feed-${index}`}
                      leak={leak}
                      index={index}
                    />
                  ))}
                </div>

                {/* Sign in prompt imitating a feed row */}
                {showSignInPrompt && onSignIn && (
                  <div 
                    onClick={onSignIn}
                    className="block px-2 py-2 sm:px-5 sm:py-2 sm:hover:bg-white/[0.03] transition-colors duration-150 cursor-pointer group animate-fade-in-up border-t border-border/10"
                  >
                    <div className="flex items-start sm:items-center gap-3 sm:gap-4">
                      {/* Lock Icon */}
                      <div className="mt-1 sm:mt-0 flex-shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-lock h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground/40 transition-colors group-hover:text-amber-500/60" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                      </div>
                      
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 flex-1 min-w-0">
                        {/* Content Section */}
                        <div className="flex flex-col flex-1 min-w-0 justify-center">
                          <p className="text-[10px] sm:text-[13px] text-foreground/80 font-medium leading-[1.3] sm:line-clamp-none">
                            <span className="font-bold text-foreground/90">[LOCKED]</span> Sign in with Google to view repositories, file paths, and more for all {total.toLocaleString()} {providerDisplayName} secrets.
                          </p>
                        </div>

                        {/* Action Section */}
                        <div className="flex-shrink-0 sm:ml-auto pt-1 sm:pt-0">
                          <button
                            onClick={(e) => { e.stopPropagation(); onSignIn(); }}
                            className="w-full sm:w-auto flex h-7 sm:h-10 items-center justify-center gap-2 px-3 sm:px-6 text-[9px] sm:text-[11px] font-black text-amber-500 uppercase tracking-[0.2em] rounded-md bg-amber-500/5 hover:bg-amber-500/10 transition-all duration-300 border border-amber-500/20 hover:border-amber-500/40 whitespace-nowrap"
                          >
                            <span>Sign In with Google</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Contact CTA banner for authenticated users at end of feed */}
                {!isUnauthenticated && (
                  <div className="block px-3 py-3 sm:px-5 sm:py-3.5 bg-amber-500/[0.03] border-t border-amber-500/20">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 min-w-0">
                      <div className="flex items-start sm:items-center gap-2.5 min-w-0">
                        <div className="p-1.5 rounded-md bg-amber-500/10 text-amber-500 shrink-0 mt-0.5 sm:mt-0">
                          <Mail className="h-4 w-4" />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-[11px] sm:text-xs font-semibold text-foreground/90 leading-tight">
                            Need full database access or custom secret monitoring?
                          </span>
                          <span className="text-[10px] sm:text-[11px] text-muted-foreground/70 leading-tight mt-0.5">
                            Contact us for enterprise access, custom API integrations & bulk dumps.
                          </span>
                        </div>
                      </div>
                      <a
                        href="https://mail.google.com/mail/?view=cm&fs=1&to=zaim.k.abbasi@gmail.com&su=API%20Radar%20Enterprise%20Inquiry"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex h-7 sm:h-8 items-center justify-center gap-1.5 px-3 sm:px-4 text-[10px] sm:text-[11px] font-bold text-amber-500 rounded-md bg-amber-500/10 hover:bg-amber-500/20 transition-all duration-200 border border-amber-500/30 whitespace-nowrap shrink-0"
                      >
                        <span>Enterprise Inquiries</span>
                      </a>
                    </div>
                  </div>
                )}
              </>
            )}
            </div>
          </Card>
        )}
      </div>
    );
  },
  (prevProps, nextProps) => {
    if (prevProps.isLoading !== nextProps.isLoading) return false;
    if (prevProps.selectedProvider !== nextProps.selectedProvider) return false;
    if (prevProps.plan !== nextProps.plan) return false;
    if (prevProps.isOffline !== nextProps.isOffline) return false;
    if (prevProps.leaks.length !== nextProps.leaks.length) return false;

    const prevIds = new Set(
      (prevProps.leaks || [])
        .map((l) => l?.id)
        .filter((id): id is string => Boolean(id))
    );
    const nextIds = new Set(
      (nextProps.leaks || [])
        .map((l) => l?.id)
        .filter((id): id is string => Boolean(id))
    );
    if (prevIds.size !== nextIds.size) return false;
    for (const id of Array.from(prevIds)) {
      if (!nextIds.has(id)) return false;
    }

    return true;
  }
);

LeakFeedComponent.displayName = "LeakFeedComponent";

export const LeakFeed = LeakFeedComponent;
