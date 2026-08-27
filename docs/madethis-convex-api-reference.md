# MadeThis — Convex internal API reference (observed)

Reconstructed from authenticated websocket capture (4 HARs). Each function shows observed **args** and an **inferred output schema** (types; short strings shown as enums; ids/secrets redacted). `null|absent` = seen null or optional. Not exhaustive — only code paths the session exercised appear.

Companion docs: [`madethis-rebuild-plan.md`](madethis-rebuild-plan.md) · [`madethis-agent-architecture.md`](madethis-agent-architecture.md).


## `adFleetHealth`

### `adFleetHealth:getBusinessCampaignHealth`
**args:** `[{"businessId": "<businessId>"}]`
**returns:**
```
[ <empty> ]
```


## `adGrowth`

### `adGrowth:ensureGoalContract`
**args:** `[{"businessId": "<businessId>"}]`
**returns:** _(no response frame captured)_

### `adGrowth:getGoalContract`
**args:** `[{"businessId": "<businessId>"}]`
**returns:**
```
{
  outcomeLabel: string
  destinationUrl: string
  status: str:'draft'
  maxCostPerOutcomeCents: number
  outcomeType: str:'purchase'
  inferredAt: number
  offerProductId: <id>
  createdAt: number
  _creationTime: number
  readinessChecks: [ {
    label: str:'Storefront destination'
    status: str:'pass'
    detail: string
    key: str:'destination'
  } ]
  recommendedDailyBudgetCents: number
  updatedAt: number
  outcomeValueCents: number
  businessId: <id>
  minimumRunDays: number
  readinessStatus: str:'warning'
  offerName: str:'Website + Care'
  measurementReady: bool
  _id: <id>
  assumptions: [ {
    source: string
    value: str:'Purchase'
    confidence: str:'high'
    key: str:'primary_goal'
  } ]
  measurementSource: str:'madethis_hosted_checkout'
  plan: {
    creativeConcepts: [ {
      role: str:'incumbent'
      angle: string
      name: str:'Proof in use'
    } ]
    stopRules: [ string ]
    audienceSummary: string
    hypothesis: string
    aiPermissions: [ string ]
  }
  version: number
}
```

### `adGrowth:getOutcomeSummary`
**args:** `[{"businessId": "<businessId>", "days": 28}]`
**returns:**
```
{
  metaAttributedOutcomeValueCents: number
  costPerAttributedOutcomeCents: null|absent
  metaSpendCents: number
  outcomeEvidenceTruncated: bool
  allInCostPerAttributedOutcomeCents: null|absent
  deliveryReadLimit: number
  allInOwnerSpendCents: number
  verifiedOutcomeValueCents: number
  verifiedOutcomeCount: number
  verifiedRoas: null|absent
  delivery: {
    impressions: number
    landingPageViews: number
    outboundClicks: number
  }
  outcomeType: str:'purchase'
  metaAttributedOutcomeCount: number
  outcomeReadLimit: number
  deliveryEvidenceTruncated: bool
  allInRoas: null|absent
  dataMaturity: str:'no_attributed_outcomes'
  windowDays: number
}
```

### `adGrowth:listAllocationDecisions`
**args:** `[{"businessId": "<businessId>", "limit": 8}]`
**returns:**
```
[ {
  decisionType: str:'launch_learning_campaign'
  domain: str:'ads.meta'
  nextReviewAt: number
  uncertainty: string
  evidenceWindowEnd: number
  businessId: <id>
  status: str:'proposed'
  expectedEffect: string
  proposedDailyBudgetCents: number
  _id: <id>
  createdAt: number
  _creationTime: number
  hypothesis: string
  evidenceWindowStart: number
  goalContractId: <id>
  updatedAt: number
  evidence: {
    completedOrders: number
    activeProducts: number
    readinessStatus: str:'blocked'
  }
} ]
```


## `adQueries`

### `adQueries:getAdBudget`
**args:** `[{"businessId": "<businessId>"}]`
**returns:** _(no response frame captured)_

### `adQueries:listAdCampaigns`
**args:** `[{"businessId": "<businessId>"}]`
**returns:**
```
[ <empty> ]
```

### `adQueries:listAdProposals`
**args:** `[{"businessId": "<businessId>"}]`
**returns:**
```
[ <empty> ]
```

### `adQueries:listBusinessFiles`
**args:** `[{"businessId": "<businessId>", "limit": 20, "mimeTypePrefix": "video/"}]`
**returns:**
```
[ <empty> ]
```


## `agent/chat`

### `agent/chat:sendMessage`
**args:** `[{"businessId": "<businessId>", "content": "test", "platform": "web"}]`
**returns:** _(no response frame captured)_

### `agent/chat:syncWorkspaceFiles`
**args:** `[{"businessId": "<businessId>"}]`
**returns:** _(no response frame captured)_


## `agentQueries`

### `agentQueries:getActiveSession`
**args:** `[{"businessId": "<businessId>"}]`
**returns:**
```
{
  sessionTokenHash: str:''
  businessId: <id>
  initiatedByUserId: <id>
  status: str:'running'
  proseMessageCount: number
  startedAt: number
  _id: <id>
  _creationTime: number
  agentRole: str:'ceo'
  triggerPayload: {
    message: str:'test'
    triggerId: <id>
    queuedAt: number
  }
  currentStep: number
  triggeredBy: str:'user_message'
}
```

### `agentQueries:getActiveWorkerTasks`
**args:** `[{"businessId": "<businessId>"}]`
**returns:**
```
[ {
  businessId: <id>
  initiatedByUserId: <id>
  status: str:'in_progress'
  groupKey: string
  instructions: <redacted>
  workerSessionId: <id>
  title: string
  _id: <id>
  createdAt: number
  _creationTime: number
  assignedRole: str:'marketing'
  ceoSessionId: <id>
} ]
```

### `agentQueries:getFreeTierUsage`
**args:** `[{"businessId": "<businessId>"}]`
**returns:** _(no response frame captured)_

### `agentQueries:getMessages`
**args:** `[{"businessId": "<businessId>"}]`
**returns:**
```
[ {
  content: enum:{Updated MEMORY.md}
  businessId: <id>
  role: str:'assistant'
  sessionId: <id>
  turnSeq: number
  _id: <id>
  createdAt: number
  _creationTime: number
  richContent: {
    type: enum:{workspace_file}
    data: {
      period: str:'Daily'
      action: str:'write'
      metrics: [ {
        change: str:'0% vs prior day'
        label: str:'Gross revenue'
        value: str:'$0.00'
      } ]
      todaysPlan: [ string ]
      preview: string
      highlights: [ string ]
      fileName: str:'MEMORY.md'
    }
  }
  agentRole: str:'ceo'
} ]
```

### `agentQueries:getPendingApprovalCount`
**args:** `[{"businessId": "<businessId>"}]`
**returns:**
```
number
```

### `agentQueries:getPendingApprovals`
**args:** `[{"businessId": "<businessId>"}]`
**returns:**
```
[ <empty> ]
```

### `agentQueries:getSessionSteps`
**args:** `[{"sessionId": "<sessionId>"}]`
**returns:**
```
[ <empty> ]
```

### `agentQueries:getTaskBoard`
**args:** `[{"businessId": "<businessId>"}]`
**returns:**
```
{
  counts: {
    needs_review: number
    in_progress: number
    todo: number
    done: number
    incomplete: number
  }
  completedToday: number
  pendingApprovalCount: number
  groups: {
    needs_review: [ <empty> ]
    in_progress: [ {
      title: string
      stage: str:'in_progress'
      credits: number
      createdAt: number
      assignedRole: str:'marketing'
      kind: str:'worker'
      id: <id>
      hasTrace: bool
    } ]
    todo: [ <empty> ]
    done: [ {
      title: string
      stage: str:'done'
      credits: number
      createdAt: number
      assignedRole: str:'coding'
      result: <redacted>
      kind: str:'worker'
      id: <id>
      hasTrace: bool
    } ]
    incomplete: [ <empty> ]
  }
}
```

### `agentQueries:getWorkspaceFiles`
**args:** `[{"businessId": "<businessId>"}]`
**returns:**
```
[ {
  content: <redacted>
  _id: <id>
  businessId: <id>
  _creationTime: number
  updatedAt: number
  fileName: str:'SOUL.md'
} ]
```


## `analytics/backfillQueries`

### `analytics/backfillQueries:listActiveCampaignsForBusiness`
**args:** `[{"businessId": "<businessId>"}]`
**returns:**
```
[ <empty> ]
```


## `analytics/snapshot`

### `analytics/snapshot:getAnalyticsContext`
**args:** `[{"businessId": "<businessId>"}]`
**returns:**
```
{
  payload: {
    search: {
      sitemapStatus: null|absent
      topQueries: [ <empty> ]
      indexedPages: null|absent
    }
    traffic: {
      last30d: {
        deviceSplit: [ <empty> ]
        sessions: number
        pageViews: number
        topCountries: [ <empty> ]
        topPages: [ <empty> ]
        visitors: number
        topSources: [ <empty> ]
      }
      last7d: {
        deviceSplit: [ <empty> ]
        sessions: number
        pageViews: number
        topCountries: [ <empty> ]
        topPages: [ <empty> ]
        visitors: number
        topSources: [ <empty> ]
      }
    }
    funnel: {
      last30d: {
        overallConversion: number
        steps: [ {
          count: number
          name: str:'$pageview'
        } ]
      }
    }
    business: {
      firstActivityAt: number
    }
    activityFeed: [ {
      geo: str:'Edinburgh, SCT'
      eventType: str:'$pageview'
      timestamp: number
      description: str:'viewed the storefront'
    } ]
    revenue: {
      last30d: {
        revenueBySource: [ <empty> ]
        orders: number
        topProducts: [ <empty> ]
        grossCents: number
        aovCents: null|absent
      }
    }
    lastUpdated: {
      posthog: number
      gsc: null|absent
      stripe: number
    }
    callout: {
      title: str:''
      action: null|absent
      state: str:'healthy'
      body: str:''
    }
  }
  refreshInFlight: bool
  stale: bool
  refreshedAt: number
}
```


## `artifacts`

### `artifacts:listArtifacts`
**args:** `[{"businessId": "<businessId>", "surface": "chat"}]`
**returns:**
```
[ {
  content: {
    apex: str:'madethis.app'
    previewScreenshotUrl: null|absent
    vercelPreviewUrl: string
    heroPreviewUrl: string
    subdomain: str:'shopface'
    slug: str:'shopface'
    provisioningStatus: str:'ready'
    siteStatus: str:'ready'
    vercelPreviewReadyAt: number
    state: str:'live'
  }
  backed: bool
  type: str:'landing_page'
  supportedSizes: [ str:'1x1' ]
  title: str:'Landing'
  source: str:'system'
  contentKind: str:'derived'
  order: number
  materialized: bool
  hidden: bool
  size: str:'1x1'
} ]
```


## `businesses`

### `businesses:getById`
**args:** `[{"businessId": "<businessId>"}]`
**returns:**
```
{
  lastSuccessfulDeploymentAt: number
  revenueGrossCents: number
  brandLogoLightMode: string
  description: <redacted>
  appLogoTaskId: <id>
  heroImageStatus: str:'ready'
  createdAt: number
  _creationTime: number
  heroPreviewCapturedAt: number
  heroImageUrl: string
  rateLimitPerHour: number
  authKeysProvisioned: bool
  inboxProvisioningExpected: bool
  revenuePayoutsCents: number
  brandKitTaskId: <id>
  approvalSettings: {
    ad_proposal: bool
    outbound_sequence: bool
    social_post: bool
  }
  brandKitStatus: str:'ready'
  heroPreviewUrl: string
  slug: str:'shopface'
  lifecycleStatus: str:'active'
  githubRepoId: number
  githubRepoFullName: string
  brandKitUrl: string
  _id: <id>
  brandLogo: string
  chatEventNotifyStamps: {
    site_live:shopface.madethis.app: number
  }
  provisioningStatus: str:'ready'
  revenueFeesCents: number
  siteStatus: str:'ready'
  githubRepoUrl: string
  name: str:'shopface'
  stripeConnectDetailsSubmitted: bool
  brandLogoDarkMode: string
  brandKitApprovedAt: number
  briefingFrequency: str:'daily'
  brandLogoSourceUrl: string
  siteStatusUpdatedAt: number
  brandVibe: str:'techy'
  inboxStatus: str:'ready'
  agentmailEmailAddress: string
  cofounderName: str:'Wee Davy'
  brandLogoSource: str:'brand_kit_derived'
  brandKitPrompt: <redacted>
  state: str:'live'
  customerEmailApex: str:'madethis.app'
  revenueNetCents: number
  stripeConnectChargesEnabled: bool
  autonomyMode: str:'autopilot'
  apex: str:'madethis.app'
  heroCommittedAt: number
  previewScreenshotUrl: null|absent
  brandTone: str:'bold'
  memberRole: str:'owner'
  launchRequestedAt: number
  storefrontBrandWiringAppliedAt: number
  previewRefreshRequestedAt: number
  brandKitUpdatedAt: number
  cofounderPersonality: str:'hustler'
  inboxRequestedAt: number
  chatVisibleFrom: number
}
```

### `businesses:getBySlug`
**args:** `[{"slug": "shopface"}]`
**returns:**
```
{
  lastSuccessfulDeploymentAt: number
  revenueGrossCents: number
  brandLogoLightMode: string
  description: <redacted>
  appLogoTaskId: <id>
  heroImageStatus: str:'ready'
  createdAt: number
  _creationTime: number
  heroPreviewCapturedAt: number
  heroImageUrl: string
  rateLimitPerHour: number
  authKeysProvisioned: bool
  inboxProvisioningExpected: bool
  revenuePayoutsCents: number
  brandKitTaskId: <id>
  approvalSettings: {
    ad_proposal: bool
    outbound_sequence: bool
    social_post: bool
  }
  brandKitStatus: str:'ready'
  heroPreviewUrl: string
  slug: str:'shopface'
  lifecycleStatus: str:'active'
  githubRepoId: number
  githubRepoFullName: string
  brandKitUrl: string
  _id: <id>
  brandLogo: string
  chatEventNotifyStamps: {
    site_live:shopface.madethis.app: number
  }
  provisioningStatus: str:'ready'
  revenueFeesCents: number
  siteStatus: enum:{ready}
  githubRepoUrl: string
  name: str:'shopface'
  stripeConnectDetailsSubmitted: bool
  brandLogoDarkMode: string
  brandKitApprovedAt: number
  briefingFrequency: str:'daily'
  brandLogoSourceUrl: string
  siteStatusUpdatedAt: number
  brandVibe: str:'techy'
  inboxStatus: str:'ready'
  agentmailEmailAddress: string
  cofounderName: str:'Wee Davy'
  brandLogoSource: str:'brand_kit_derived'
  brandKitPrompt: <redacted>
  state: str:'live'
  customerEmailApex: str:'madethis.app'
  revenueNetCents: number
  siteStatusBeforeDeploy: str:'ready'
  stripeConnectChargesEnabled: bool
  autonomyMode: str:'autopilot'
  apex: str:'madethis.app'
  heroCommittedAt: number
  previewScreenshotUrl: null|absent
  brandTone: str:'bold'
  memberRole: str:'owner'
  launchRequestedAt: number
  storefrontBrandWiringAppliedAt: number
  previewRefreshRequestedAt: number
  brandKitUpdatedAt: number
  cofounderPersonality: str:'hustler'
  inboxRequestedAt: number
  chatVisibleFrom: number
}
```

### `businesses:listByUser`
**args:** _(none / [{}])_
**returns:**
```
[ {
  lastSuccessfulDeploymentAt: number
  revenueGrossCents: number
  brandLogoLightMode: string
  description: <redacted>
  appLogoTaskId: <id>
  heroImageStatus: str:'ready'
  createdAt: number
  _creationTime: number
  heroPreviewCapturedAt: number
  heroImageUrl: string
  rateLimitPerHour: number
  authKeysProvisioned: bool
  inboxProvisioningExpected: bool
  revenuePayoutsCents: number
  brandKitTaskId: <id>
  approvalSettings: {
    ad_proposal: bool
    outbound_sequence: bool
    social_post: bool
  }
  brandKitStatus: str:'ready'
  heroPreviewUrl: string
  slug: str:'shopface'
  lifecycleStatus: str:'active'
  githubRepoId: number
  githubRepoFullName: string
  brandKitUrl: string
  _id: <id>
  brandLogo: string
  chatEventNotifyStamps: {
    site_live:shopface.madethis.app: number
  }
  provisioningStatus: str:'ready'
  revenueFeesCents: number
  siteStatus: enum:{ready}
  githubRepoUrl: string
  name: str:'shopface'
  stripeConnectDetailsSubmitted: bool
  brandLogoDarkMode: string
  brandKitApprovedAt: number
  briefingFrequency: str:'daily'
  brandLogoSourceUrl: string
  siteStatusUpdatedAt: number
  brandVibe: str:'techy'
  inboxStatus: str:'ready'
  agentmailEmailAddress: string
  cofounderName: str:'Wee Davy'
  brandLogoSource: str:'brand_kit_derived'
  brandKitPrompt: <redacted>
  state: str:'live'
  customerEmailApex: str:'madethis.app'
  revenueNetCents: number
  siteStatusBeforeDeploy: str:'ready'
  stripeConnectChargesEnabled: bool
  autonomyMode: str:'autopilot'
  apex: str:'madethis.app'
  heroCommittedAt: number
  previewScreenshotUrl: null|absent
  brandTone: str:'bold'
  launchRequestedAt: number
  storefrontBrandWiringAppliedAt: number
  previewRefreshRequestedAt: number
  brandKitUpdatedAt: number
  cofounderPersonality: str:'hustler'
  inboxRequestedAt: number
  chatVisibleFrom: number
  stripeConnectPayoutsEnabled: bool
} ]
```


## `creative/studio`

### `creative/studio:getStudio`
**args:** `[{"businessId": "<businessId>"}]`
**returns:**
```
{
  formats: [ {
    aspectChoice: bool
    creditRange: {
      high: number
      low: number
    }
    requiresLogo: bool
    optionCounts: [ number ]
    defaultOptionCount: number
    etaLabel: str:'about a minute'
    placements: [ str:'9:16' ]
    blurb: string
    label: str:'Offer image'
    defaultAspect: str:'9:16'
    creditRangeByOptionCount: [ {
      optionCount: number
      range: {
        high: number
        low: number
      }
    } ]
    key: str:'static.offer'
    availability: str:'ready'
    looks: [ {
      key: str:'clean_studio'
      label: str:'Clean studio'
    } ]
  } ]
  brandBook: {
    palette: {
      primary: str:'#b93780'
      background: str:'#fefbfc'
      ground: str:'#fefbfc'
      inkContrastRatio: number
      contrastRepaired: bool
      secondary: str:'#b88dba'
      ink: str:'#1a1417'
      accent: str:'#ee6a49'
      groundIsDark: bool
      source: str:'vibe_derived'
      foreground: str:'#1a1417'
      onAccent: str:'#2b2827'
    }
    status: str:'ready'
    type: {
      bodyFamily: str:'Archivo'
      headingFamily: str:'Archivo'
      pairLabel: str:'grotesque-bold'
    }
    headline: str:'shopface'
    tone: str:'bold'
    logo: {
      ownerUploaded: bool
      status: str:'ready'
      previewUrl: string
    }
    imageryRules: [ <empty> ]
    vibe: str:'techy'
    disclaimer: null|absent
    name: str:'shopface'
  }
  journeyStates: [ str:'first_run_no_cap' ]
  businessId: <id>
  canMake: bool
  destinations: [ {
    ready: bool
    key: str:'download'
    label: str:'Download'
  } ]
  slug: str:'shopface'
  artifacts: {
    revealed: bool
  }
  creditsMetered: bool
  library: {
    items: [ {
      height: null|absent
      variants: [ <empty> ]
      assetId: null|absent
      kind: str:'image'
      formatKey: null|absent
      firstComment: null|absent
      formatLabel: null|absent
      group: str:'existing'
      mimeType: str:'image/png'
      byteCount: number
      createdAt: number
      picked: bool
      caption: null|absent
      publishEligible: bool
      id: string
      durationMs: null|absent
      jobId: null|absent
      fileUrl: string
      source: str:'business_file'
      stateLabel: null|absent
      width: null|absent
      fileName: string
    } ]
    truncated: bool
    total: number
  }
  thisMonth: {
    monthlyCapCredits: null|absent
    goodwillRerunsRemaining: null|absent
    periodSpentCredits: null|absent
    creditsPerPiece: null|absent
    remainingCredits: null|absent
    dailyCapCredits: null|absent
    piecesThisPeriod: number
    inFlight: [ <empty> ]
    capState: str:'unset'
    dailySpentCredits: null|absent
    finishedThisPeriod: number
    periodStart: null|absent
    capBlockedCopy: null|absent
    recent: [ <empty> ]
  }
  make: {
    references: [ {
      mimeType: str:'image/png'
      url: string
      fileName: string
    } ]
    formats: [ {
      aspectChoice: bool
      creditRange: {
        high: number
        low: number
      }
      requiresLogo: bool
      optionCounts: [ number ]
      defaultOptionCount: number
      etaLabel: str:'about a minute'
      placements: [ str:'9:16' ]
      blurb: string
      label: str:'Offer image'
      defaultAspect: str:'9:16'
      creditRangeByOptionCount: [ {
        optionCount: number
        range: {
          high: …
          low: …
        }
      } ]
      key: str:'static.offer'
      availability: str:'ready'
      looks: [ {
        key: str:'clean_studio'
        label: str:'Clean studio'
      } ]
    } ]
    products: [ {
      priceCents: number
      name: str:'Website + Care'
      productId: <id>
    } ]
    defaultFormatKey: str:'static.offer'
    blockedReason: null|absent
  }
}
```


## `emailThreads`

### `emailThreads:list`
**args:** `[{"businessId": "<businessId>", "paginationOpts": {"cursor": null, "id": 1, "numItems": 10}, "view": "all"}]`
**returns:**
```
{
  isDone: bool
  page: [ {
    hasDraft: bool
    failedSendCount: number
    latestMessageSortKey: <id>
    searchText: string
    participantEmail: str:'dean@rough.ink'
    subject: string
    messageCount: number
    hasSent: bool
    needsReply: bool
    threadId: <id>
    hasAwaitingApproval: bool
    latestMessageKey: string
    hasInbound: bool
    lastDirection: str:'outbound'
    stream: str:'business'
    lastMessageAt: number
    unreadCount: number
    preview: string
    participantName: str:'dean@rough.ink'
  } ]
  continueCursor: string
}
```


## `globalSearch`

### `globalSearch:getCatalog`
**args:** `[{"businessId": "<businessId>"}]`
**returns:**
```
{
  business: {
    role: str:'owner'
    id: <id>
    name: str:'shopface'
    slug: str:'shopface'
  }
  items: [ {
    title: enum:{founding-offer-copy.md}|string
    subtitle: enum:{task activity}
    href: string
    status: enum:{task}
    searchText: string|<redacted>|string|<redacted>
    updatedAt: number
    kind: enum:{activity}
    id: string
  } ]
}
```


## `impersonation`

### `impersonation:availability`
**args:** _(none / [{}])_
**returns:**
```
{
  available: bool
}
```


## `incorporation`

### `incorporation:getIncorporationOverview`
**args:** `[{"businessId": "<businessId>"}]`
**returns:**
```
{
  docFiles: [ <empty> ]
  eligibility: {
    eligible: bool
    minGmvCents: number
    minRealOrders: number
    realGmvCents: number
    realOrders: number
  }
  incorporation: null|absent
  openItems: [ <empty> ]
}
```


## `launchPlan`

### `launchPlan:getLaunchPlan`
**args:** `[{"businessId": "<businessId>"}]`
**returns:**
```
{
  currentDay: number
  status: str:'active'
  steps: [ {
    title: str:'Site & first offer'
    day: number
    completedAt: number
    state: str:'done'
    key: str:'build'
  } ]
  headline: str:'Launch week — day 2 of 7'
  planId: <id>
  startedAt: number
}
```


## `memberships`

### `memberships:listAccessible`
**args:** _(none / [{}])_
**returns:**
```
[ {
  lastSuccessfulDeploymentAt: number
  revenueGrossCents: number
  brandLogoLightMode: string
  description: <redacted>
  appLogoTaskId: <id>
  heroImageStatus: str:'ready'
  createdAt: number
  _creationTime: number
  heroPreviewCapturedAt: number
  heroImageUrl: string
  rateLimitPerHour: number
  authKeysProvisioned: bool
  inboxProvisioningExpected: bool
  revenuePayoutsCents: number
  brandKitTaskId: <id>
  approvalSettings: {
    ad_proposal: bool
    outbound_sequence: bool
    social_post: bool
  }
  brandKitStatus: str:'ready'
  heroPreviewUrl: string
  slug: str:'shopface'
  lifecycleStatus: str:'active'
  githubRepoId: number
  githubRepoFullName: string
  brandKitUrl: string
  _id: <id>
  brandLogo: string
  chatEventNotifyStamps: {
    site_live:shopface.madethis.app: number
  }
  provisioningStatus: str:'ready'
  revenueFeesCents: number
  siteStatus: enum:{ready}
  githubRepoUrl: string
  name: str:'shopface'
  stripeConnectDetailsSubmitted: bool
  brandLogoDarkMode: string
  brandKitApprovedAt: number
  briefingFrequency: str:'daily'
  brandLogoSourceUrl: string
  siteStatusUpdatedAt: number
  brandVibe: str:'techy'
  inboxStatus: str:'ready'
  agentmailEmailAddress: string
  cofounderName: str:'Wee Davy'
  brandLogoSource: str:'brand_kit_derived'
  brandKitPrompt: <redacted>
  state: str:'live'
  customerEmailApex: str:'madethis.app'
  revenueNetCents: number
  siteStatusBeforeDeploy: str:'ready'
  stripeConnectChargesEnabled: bool
  autonomyMode: str:'autopilot'
  apex: str:'madethis.app'
  heroCommittedAt: number
  previewScreenshotUrl: null|absent
  brandTone: str:'bold'
  memberRole: str:'owner'
  launchRequestedAt: number
  storefrontBrandWiringAppliedAt: number
  previewRefreshRequestedAt: number
  brandKitUpdatedAt: number
  cofounderPersonality: str:'hustler'
  inboxRequestedAt: number
  chatVisibleFrom: number
} ]
```


## `meteringQueries`

### `meteringQueries:getMeteringCopy`
**args:** _(none / [{}])_
**returns:**
```
{
  cadence: str:'monthly'
  freeTier: str:'300 free credits'
  plans: {
    scale: str:'30,000 credits/month'
    growth: str:'10,000 credits/month'
    starter: str:'5,000 credits/month'
  }
  model: str:'credits'
  capsNote: string
}
```


## `outbound/queries`

### `outbound/queries:getOutboundSettings`
**args:** `[{"businessId": "<businessId>"}]`
**returns:** _(no response frame captured)_

### `outbound/queries:listSequences`
**args:** `[{"businessId": "<businessId>"}]`
**returns:**
```
[ <empty> ]
```


## `preview`

### `preview:requestPreviewRefresh`
**args:** `[{"businessId": "<businessId>"}]`
**returns:** _(no response frame captured)_


## `qa/fixtures`

### `qa/fixtures:availability`
**args:** _(none / [{}])_
**returns:**
```
{
  available: bool
}
```


## `referrals`

### `referrals:getCheckoutDiscountInfo`
**args:** _(none / [{}])_
**returns:**
```
{
  kind: null|absent
}
```

### `referrals:getReferralCode`
**args:** _(none / [{}])_
**returns:**
```
{
  code: str:'gthd2hpc'
  shareUrl: string
}
```

### `referrals:getReferralStats`
**args:** _(none / [{}])_
**returns:**
```
{
  rewardDollarsEarned: number
  rewardCreditDollars: number
  monthsEarned: number
  referralCode: str:'gthd2hpc'
  completedCount: number
  referrals: [ <empty> ]
  canEarnReferralReward: bool
}
```


## `scheduledTasks`

### `scheduledTasks:getScheduledTasks`
**args:** `[{"businessId": "<businessId>"}]`
**returns:**
```
[ {
  intervalMinutes: number
  lastRun: number
  businessId: <id>
  status: str:'active'
  createdBy: str:'agent'
  taskType: str:'briefing'
  description: string
  _id: <id>
  approvedByHuman: bool
  _creationTime: number
  createdAt: number
  schedule: str:'every day at 9am'
  lastResult: string
  nextRunAt: number
  name: str:'Daily Briefing'
} ]
```


## `social`

### `social:getDashboard`
**args:** `[{"businessId": "<businessId>"}]`
**returns:**
```
{
  business: {
    avatarUrl: string
    name: str:'shopface'
  }
  connection: {
    status: enum:{not_connected}
    lastConnectAttempt: null|absent
    accounts: [ <empty> ]
    refreshedAt: number
  }
  posts: [ <empty> ]
}
```


## `usageQueries`

### `usageQueries:getTodayUsage`
**args:** `[{"businessId": "<businessId>"}]`
**returns:**
```
{
  reservedCostCents: number
  limitType: str:'monthly_credits'
  creditsUsed: number
  limits: {
    costCentsPerMonth: number
    tasksPerMonth: number
    tasksPerDay: number
    costCentsPerDay: number
  }
  autopilotPausedReason: null|absent
  autopilotPaused: bool
  autopilotResumesAt: null|absent
  date: str:'2026-08-26'
  isUnlimited: bool
  monthAutonomousCreditsCap: number
  creditsPerDay: number
  monthTasksRemaining: number
  creditsRemaining: number
  topupCreditsBalance: number
  percentUsed: number
  tasksCount: number
  hasPlan: bool
  monthCreditsRemaining: number
  monthTasksAllowance: number
  cadence: str:'monthly'
  monthCreditsAllowance: number
  monthTasksUsed: number
  resetsAt: number
  plan: str:'growth'
  allowed: bool
  monthAutonomousCreditsUsed: number
  model: str:'credits'
  estimatedCostCents: number
  monthCreditsUsed: number
}
```


## `users`

### `users:currentUser`
**args:** _(none / [{}])_
**returns:**
```
{
  subscriptionCanceling: bool
  location: str:'Birmingham, ENG, GB'
  tokenIdentifier: string
  image: string
  phoneCaptureLastSurfacedAt: number
  onboardingCompletedAt: number
  subscriptionSource: str:'stripe'
  notificationPreferences: {
    approvalNeeded: bool
    errorAlert: bool
    welcome: bool
    inboundEmail: bool
    milestone: bool
    briefing: bool
    lifecycle: bool
  }
  referredBy: <id>
  createdAt: number
  _creationTime: number
  metaAttribution: {
    userAgent: string
    capturedAt: number
  }
  phoneCaptureSurfaceCount: number
  referredByCode: str:'ahlyzik'
  stripeCustomerId: str:'cus_V8GSMhyje8sJ2S'
  subscriptionWelcomeEmailSentAt: number
  paywallHitAt: number
  allowanceCadence: str:'monthly'
  phoneCaptureSkippedAt: number
  referralCode: str:'gthd2hpc'
  subscriptionCancelStateAt: number
  meteringModel: str:'credits'
  welcomeEmailQueuedAt: number
  clerkUserId: <id>
  _id: <id>
  timezone: str:'Europe/London'
  explodingOfferConsumedAt: number
  plan: str:'growth'
  email: str:'dean@rough.ink'
  utmAttribution: {
    referrer: str:'l.instagram.com'
    content: str:'link_in_bio'
    landingPath: str:'/r/ahlyzik'
    source: str:'ig'
    medium: str:'social'
    capturedAt: number
  }
  name: str:'Dean Newton'
}
```

### `users:ensureUser`
**args:** `[{"location": "Birmingham, ENG, GB", "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36"}]`
**returns:** _(no response frame captured)_

### `users:setTimezone`
**args:** `[{"timezone": "Europe/London"}]`
**returns:** _(no response frame captured)_

---

## Transport & conventions
- **Protocol:** Convex reactive sync over `wss://<deployment>.convex.cloud/api/1.34.1/sync`. Client frames: `Connect`, `Authenticate` (Clerk JWT), `ModifyQuerySet` (`Add`/`Remove` a `{queryId, udfPath, args}` subscription), `Mutation` (`{requestId, udfPath, args}`). Server frames: `Transition` (pushes new `value` per changed `queryId`), `MutationResponse`, `QueryUpdated`, `QueryRemoved`.
- **udfPath format:** `module:function` (slashes = nested module dir, e.g. `agent/chat:sendMessage`, `outbound/queries:listSequences`).
- **Reactivity:** queries are live subscriptions — the server re-pushes `value` on any underlying data change; there is no polling and no REST.
- **File storage:** Convex storage — `GET https://<deployment>.convex.cloud/api/storage/{uuid}`.
- **Mutations observed:** `agent/chat:sendMessage {businessId, content, platform}`, `agent/chat:syncWorkspaceFiles`, `adGrowth:ensureGoalContract {businessId}`, `users:ensureUser`, `users:setTimezone`, `preview:requestPreviewRefresh`. Everything else observed is a live **query**.

## Generated business site (`{slug}.madethis.app`)
Separate **Next.js (App Router)** deployment per business, on Vercel.
- Route group `(public)` with `layout`, `error`, `page`; observed pages `/`, `/about`, `/pricing`, `/sign-in`.
- Self-hosted fonts (`_next/static/media/*.woff2`), Tailwind-style single CSS bundle, `next/image` optimizer.
- Per-business brand asset (`/brand/{slug}-lockup-duo.svg`) + marketing imagery under `/images/marketing/`.
- Agent trace confirms the repo ships a **MadeThis footer badge, offer/checkout, forms, email capture, and a "conversion-handoff"** module (tested via `npm run test:conversion-handoff`) — i.e. the hosted checkout ties back to the parent platform's Stripe/orders.
- Hero uses **Mux** HLS video with `hls.js`/native fallback, poster image, Save-Data + reduced-motion opt-outs.
