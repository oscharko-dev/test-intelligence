export function cx(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(" ");
}

export const ui = {
  app: "app grid h-screen min-h-screen grid-rows-[40px_1fr_24px]",
  body: "body row-start-2 grid min-h-0 grid-cols-[48px_1fr_auto]",
  primary: "primary min-h-0 min-w-0 overflow-auto bg-bg-base",

  topbar: {
    root: "topbar row-start-1 flex h-10 items-center gap-3 border-b border-border-subtle bg-bg-panel px-3",
    mark: "topbar__mark inline-flex items-center gap-2 font-mono text-xs tracking-[0.04em] text-fg-default",
    logo: "shrink-0 h-[23px] w-[23px]",
    brandText: "text-[color:var(--brand-green)] font-medium",
    sep: "topbar__sep h-[18px] w-px bg-border-subtle",
    workspace:
      "topbar__workspace inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-bg-base px-2 py-1 font-mono text-xs text-fg-muted",
    workspaceStrong: "font-medium text-fg-default",
    spacer: "topbar__spacer flex-1",
    user: "topbar__user inline-flex items-center gap-2 text-xs text-fg-muted",
    avatar:
      "topbar__avatar grid h-[22px] w-[22px] place-items-center rounded-full border border-border-default bg-bg-elev font-mono text-[10px] text-fg-default",
    inline:
      "topbar__inline inline-flex items-center gap-2 font-mono text-[11px] text-fg-muted",
    subtle: "topbar__inline--subtle text-fg-subtle",
  },

  activity: {
    root: "activitybar flex w-12 flex-col gap-0.5 border-r border-border-subtle bg-bg-panel py-1.5",
    item: "activitybar__item tip relative grid h-10 w-12 place-items-center border-0 bg-transparent text-fg-subtle hover:text-fg-default aria-[current=page]:text-fg-default aria-[current=page]:before:absolute aria-[current=page]:before:left-0 aria-[current=page]:before:top-2 aria-[current=page]:before:bottom-2 aria-[current=page]:before:w-0.5 aria-[current=page]:before:rounded-r aria-[current=page]:before:bg-accent after:pointer-events-none after:absolute after:left-[calc(100%+8px)] after:top-1/2 after:z-50 after:hidden after:-translate-y-1/2 after:whitespace-nowrap after:rounded after:border after:border-border-default after:bg-bg-elev after:px-2 after:py-1 after:font-ui after:text-[11px] after:text-fg-default after:content-[attr(data-tip)] hover:after:block",
    spacer: "activitybar__spacer flex-1",
  },

  statusbar: {
    root: "statusbar row-start-3 flex h-6 items-center overflow-hidden whitespace-nowrap border-t border-border-subtle bg-bg-panel px-2.5 font-mono text-[11px] text-fg-muted",
    segment:
      "statusbar__seg inline-flex h-6 items-center gap-1.5 border-r border-border-subtle px-2 last:border-r-0",
    muted: "muted text-fg-subtle",
    spacer: "statusbar__spacer flex-1",
    dot: "statusbar__dot h-1.5 w-1.5 rounded-full bg-fg-subtle",
    ok: "ok bg-success",
    warn: "warn bg-warn",
    err: "err bg-danger",
    info: "info bg-info",
    run: "run bg-accent [animation:pulse_1.6s_ease-in-out_infinite]",
    dim: "text-fg-subtle",
  },

  inspector: {
    root: "inspector flex min-h-0 w-80 flex-col border-l border-border-subtle bg-bg-panel",
    collapsed: "collapsed w-0 overflow-hidden border-l-0",
    head: "inspector__head flex h-9 items-center gap-2 border-b border-border-subtle px-2.5 py-2",
    title:
      "inspector__title font-mono text-[11px] uppercase tracking-[0.08em] text-fg-muted",
    body: "inspector__body flex-1 overflow-auto p-3",
    spacer: "inspector__spacer ml-auto",
    floating:
      "inspector__toggle--floating fixed right-2 top-12 z-10 border border-border-subtle bg-bg-panel",
  },

  panel: {
    root: "panel rounded-md border border-border-subtle bg-bg-panel [&+.panel]:mt-3",
    stack: "mt-3",
    head: "panel__head flex items-center gap-2.5 border-b border-border-subtle px-3 py-2.5",
    title:
      "m-0 font-ui text-xs font-medium uppercase tracking-[0.02em] text-fg-default",
    desc: "panel__desc px-3 pt-1.5 text-xs text-fg-muted",
    body: "panel__body p-3",
    bodyFlush: "panel__body--flush -m-3",
    actions: "panel__actions ml-auto inline-flex gap-1.5",
  },

  badge: {
    base: "badge inline-flex items-center gap-1 rounded border border-border-default bg-bg-elev px-1.5 py-0.5 font-mono text-[10px] uppercase leading-[1.2] tracking-[0.08em] text-fg-muted",
    neutral: "neutral",
    info: "info border-[hsl(200_60%_30%)] bg-[hsl(200_60%_14%_/_0.6)] text-info",
    success:
      "success border-[hsl(142_40%_26%)] bg-[hsl(142_40%_12%_/_0.6)] text-success",
    warn: "warn border-[hsl(38_60%_28%)] bg-[hsl(38_60%_12%_/_0.6)] text-warn",
    danger:
      "danger border-[hsl(0_50%_30%)] bg-[hsl(0_50%_14%_/_0.5)] text-danger",
    accent:
      "accent border-[hsl(210_60%_30%)] bg-[hsl(210_60%_14%_/_0.6)] text-accent",
  },

  chip: {
    base: "chip inline-flex items-center gap-1.5 rounded-full border border-border-default bg-bg-elev py-[3px] pr-2 pl-[7px] font-mono text-[11px] lowercase tracking-[0.04em] text-fg-default",
    dot: "chip__dot h-1.5 w-1.5 rounded-full bg-fg-muted",
    idle: "idle text-fg-subtle",
    running: "running border-[hsl(210_60%_30%)] text-accent",
    judging: "judging border-[hsl(200_60%_28%)] text-info",
    policyGate: "policy-gate border-[hsl(38_50%_28%)] text-warn",
    ok: "sealed clean border-[hsl(142_40%_26%)] bg-[hsl(142_40%_10%_/_0.6)] text-success",
    danger:
      "blocked blocked_failure failed border-[hsl(0_50%_30%)] bg-[hsl(0_50%_12%_/_0.4)] text-danger",
    degraded: "degraded border-[hsl(38_50%_28%)] text-warn",
    dotRun: "bg-accent [animation:pulse_1.4s_ease-in-out_infinite]",
    dotInfo: "bg-info [animation:pulse_1.4s_ease-in-out_infinite]",
    dotWarn: "bg-warn [animation:pulse_1.4s_ease-in-out_infinite]",
    dotOk: "bg-success",
    dotDanger: "bg-danger",
  },

  iconButton: {
    base: "iconbtn inline-grid h-7 w-7 place-items-center rounded-md border border-transparent bg-transparent text-fg-muted transition-colors duration-75 hover:bg-bg-elev hover:text-fg-default aria-pressed:border-border-default aria-pressed:bg-bg-elev aria-pressed:text-fg-default",
    sm: "sm h-[22px] w-[22px] rounded",
    ghostBorder: "ghost-border border-border-subtle",
  },

  tabs: {
    root: "tabs flex gap-0 border-b border-border-subtle",
    button:
      "tabs__btn relative border-0 bg-transparent px-3 pt-2 pb-[9px] font-ui text-xs tracking-[0.02em] text-fg-muted hover:text-fg-default aria-selected:text-fg-default aria-selected:after:absolute aria-selected:after:left-2 aria-selected:after:right-2 aria-selected:after:bottom-[-1px] aria-selected:after:h-0.5 aria-selected:after:bg-accent",
    count: "tabs__count ml-1.5 font-mono text-[10px] text-fg-subtle",
  },

  metadata: {
    row: "metarow grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-baseline gap-2.5 border-b border-dashed border-border-subtle py-1 text-xs last:border-b-0",
    label: "metarow__label text-fg-muted",
    value:
      "metarow__value break-all text-right font-mono text-fg-default",
    muted: "muted text-fg-subtle",
  },

  code: {
    root: "code relative overflow-auto rounded-md border border-border-subtle bg-bg-input font-mono text-xs leading-[1.55] text-fg-default",
    pre: "m-0 whitespace-pre px-3 py-2.5",
    copy: "code__copy absolute top-1.5 right-1.5",
  },

  token: {
    line: "block",
    env: "tok-env text-accent",
    str: "tok-str text-success",
    cont: "tok-cont text-warn",
    flag: "tok-flag text-info",
    cmd: "tok-cmd text-fg-default",
  },

  field: {
    root: "field mb-2.5 grid gap-1 last:mb-0",
    label:
      "field__label flex items-baseline justify-between gap-2 text-xs font-medium text-fg-default",
    required: "req font-mono text-[11px] text-accent",
    envName:
      "field__envname block font-mono text-[11px] tracking-[0.02em] text-fg-muted",
    hint: "field__hint font-mono text-[11px] text-fg-muted",
    hintWarn: "warn text-warn",
    hintErr: "err text-danger",
    inputWrap: "field__input-wrap relative",
    rightSlot:
      "field__right-slot absolute top-0 right-1 inline-flex h-full items-center gap-0.5",
    input:
      "input w-full rounded-md border border-border-default bg-bg-input px-2.5 py-[7px] text-[13px] text-fg-default placeholder:text-fg-subtle hover:border-border-strong focus:border-accent",
    mono: "mono font-mono text-xs",
    invalid: "invalid border-danger",
    hasRightSlot: "has-right-slot pr-9",
    selectWrap: "select-wrap relative",
    select: "appearance-none pr-7",
    chev:
      "chev pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-fg-muted",
  },

  switch: {
    row: "switch-row grid grid-cols-[1fr_auto] items-center gap-3 border-t border-border-subtle py-2 first:border-t-0",
    main: "switch-row__main grid gap-0.5",
    title: "switch-row__title text-xs font-medium text-fg-default",
    sub: "switch-row__sub font-mono text-[11px] text-fg-muted",
    control:
      "switch relative inline-flex h-[18px] w-8 items-center rounded-full border border-border-default bg-bg-input p-0 transition-colors duration-100 after:absolute after:top-px after:left-0.5 after:h-3 after:w-3 after:rounded-full after:bg-fg-muted after:transition after:duration-100 aria-checked:border-[hsl(210_80%_36%)] aria-checked:bg-[hsl(210_80%_22%)] aria-checked:after:translate-x-3.5 aria-checked:after:bg-accent",
  },

  button: {
    base: "btn inline-flex items-center gap-1.5 rounded-md border border-border-default bg-bg-elev px-3 py-[7px] text-xs font-medium text-fg-default hover:border-border-strong hover:bg-[hsl(220_13%_17%)] disabled:cursor-not-allowed disabled:opacity-70",
    primary:
      "primary border-accent bg-accent font-semibold text-accent-fg hover:bg-[hsl(210_100%_65%)] disabled:border-[hsl(210_20%_24%)] disabled:bg-[hsl(210_30%_22%)] disabled:text-[hsl(220_8%_50%)]",
    ghost:
      "ghost border-transparent bg-transparent text-fg-muted hover:border-border-subtle hover:bg-bg-elev hover:text-fg-default",
    danger:
      "danger border-[hsl(0_50%_30%)] bg-[hsl(0_50%_12%_/_0.4)] text-danger",
  },

  kbd: "kbd inline-grid h-[18px] min-w-[18px] place-items-center rounded border border-b-2 border-border-default bg-bg-input px-1 font-mono text-[10px] tracking-[0.04em] text-fg-muted",

  screen: {
    root: "screen mx-auto max-w-[980px] px-5 pt-4 pb-6",
    head: "screen__head flex items-center gap-3 pb-3.5",
    title: "screen__title m-0 text-[15px] font-semibold",
    spacer: "screen__spacer flex-1",
    actions: "screen__actions inline-flex gap-1.5",
    meta: "screen__meta inline-flex items-center gap-1.5 font-mono text-[11px] text-fg-muted",
  },

  formGrid: {
    twoCol: "fields-2col grid grid-cols-2 gap-x-4 gap-y-3",
    full: "full col-span-full",
  },

  advanced: {
    root: "advanced rounded-md border border-border-subtle bg-bg-panel",
    button:
      "advanced__btn flex w-full items-center gap-1.5 border-0 bg-transparent px-3 py-2.5 text-xs font-medium text-fg-default hover:bg-bg-elev",
    chev: "chev text-fg-muted transition-transform duration-100",
    chevOpen: "rotate-90",
    body: "advanced__body border-t border-border-subtle px-3 pt-2 pb-3.5",
  },

  bottomBar: {
    root: "bottom-bar mt-4 flex items-center gap-2 pt-3",
    spacer: "bottom-bar__spacer flex-1",
    hint: "bottom-bar__hint inline-flex items-center gap-1.5 font-mono text-[11px] text-fg-subtle",
  },

  policyWarning:
    "policy-warning mt-1.5 flex items-start gap-2 rounded-md border border-[hsl(38_50%_28%)] bg-[hsl(38_60%_12%_/_0.4)] px-2.5 py-2 font-mono text-[11px] text-warn",

  runDetail: {
    header:
      "rd-header flex items-center gap-3 rounded-md border border-border-subtle bg-bg-panel px-3.5 py-2.5",
    job: "rd-header__job mono font-mono text-[13px] text-fg-default",
    meta: "rd-header__meta mono inline-flex gap-3.5 font-mono text-[11px] text-fg-muted",
    spacer: "rd-header__spacer flex-1",
    stages: "rd-stages mt-3 grid grid-cols-4 gap-3",
    stage:
      "rd-stage grid min-h-[132px] gap-2.5 rounded-md border border-border-subtle bg-bg-panel p-3",
    stageActive:
      "active border-[hsl(210_60%_36%)] shadow-[inset_0_0_0_1px_hsl(210_100%_60%_/_0.16)]",
    stageDone: "done border-[hsl(142_40%_26%)]",
    stageFail: "fail border-[hsl(0_50%_30%)]",
    stageHead:
      "rd-stage__head flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.04em] text-fg-muted",
    stageName: "rd-stage__name font-medium text-fg-default",
    metrics: "rd-stage__metrics grid grid-cols-3 gap-1.5 font-mono text-[11px]",
    metric: "rd-stage__metric grid gap-px",
    metricLabel: "text-[10px] text-fg-subtle",
    metricValue: "text-[13px] font-medium text-fg-default",
    metricOk: "ok text-success",
    metricFail: "fail text-danger",
    outcome:
      "rd-stage__outcome flex items-center justify-between border-t border-dashed border-border-subtle pt-2 font-mono text-[11px] text-fg-muted",
    outcomeOk:
      "rd-stage__outcome--ok inline-flex items-center gap-1 text-success",
    outcomeDanger:
      "rd-stage__outcome--blocked rd-stage__outcome--failed inline-flex items-center gap-1 text-danger",
    outcomeInflight:
      "rd-stage__outcome--inflight inline-flex items-center gap-1 text-accent",
    outcomePending: "rd-stage__outcome--pending text-fg-subtle",
  },

  table: {
    table: "table w-full border-collapse font-mono text-xs",
    row: "group",
    rowLink: "row-link group cursor-pointer",
    th: "border-b border-border-subtle bg-bg-panel px-3 py-2 text-left align-middle font-ui text-[11px] font-medium uppercase tracking-[0.06em] text-fg-muted sticky top-0",
    td: "border-b border-border-subtle px-3 py-2 text-left align-middle group-hover:bg-bg-elev",
    colStatus: "col-status w-6",
    colSize: "col-size w-20 text-right text-fg-muted",
    colName: "col-name text-fg-default",
    colStages: "col-stages text-fg-muted",
    colJob: "col-job text-fg-default",
    colArtifacts: "col-artifacts text-right text-fg-default",
    colAction: "col-action w-6",
    rowStatus: "row-status",
    iconOk: "ok text-success",
    iconWarn: "warn text-warn",
    iconErr: "err text-danger",
    iconInfo: "info text-info",
    label: "row-status__label font-mono text-[11px]",
    labelOk: "ok text-success",
    labelErr: "err text-danger",
    labelPending: "pending text-fg-subtle",
  },

  diff: {
    list: "difflist grid gap-1",
    row: "diffrow grid grid-cols-1 gap-1 rounded-md border border-border-subtle bg-bg-input px-2.5 py-2 font-mono text-[11px]",
    name: "diffrow__name text-fg-default",
    from: "diffrow__from text-fg-subtle",
    fromValue: "font-medium text-danger",
    to: "diffrow__to text-fg-muted",
    toValue: "font-medium text-success",
  },

  validation: {
    list: "vlist m-0 grid list-none gap-1.5 p-0 [counter-reset:v]",
    item: "vitem grid grid-cols-[22px_1fr] gap-2 rounded-md border border-border-subtle bg-bg-input px-2.5 py-2 text-xs before:grid before:h-[22px] before:w-[22px] before:place-items-center before:rounded before:border before:border-border-default before:bg-bg-elev before:font-mono before:text-[11px] before:text-fg-muted before:[counter-increment:v] before:content-[counter(v)]",
    okItem:
      "ok grid-cols-1 border-[hsl(142_30%_22%)] before:hidden",
    success: "vitem__success inline-flex items-center gap-1.5 text-success",
    label: "vitem__label font-mono text-[11px] text-fg-default",
    message: "vitem__message text-fg-muted",
    fieldAnchor:
      "field-anchor cursor-pointer border-0 bg-transparent p-0 font-mono text-[11px] text-accent hover:underline",
  },

  inspectorGroup: {
    group: "insp-group mb-3.5 grid gap-1.5 last:mb-0",
    title:
      "insp-group__title font-mono text-[10px] uppercase tracking-[0.1em] text-fg-subtle",
    empty: "insp-empty py-2 text-xs italic text-fg-subtle",
    artifact:
      "insp-artifact grid grid-cols-[1fr_auto] gap-2 border-b border-dashed border-border-subtle py-1 font-mono text-[11px]",
    artifactName: "insp-artifact__name text-fg-default",
    artifactStatus: "insp-artifact__status font-mono",
    artifactOk: "ok text-success",
    artifactPending: "pending text-fg-subtle",
    artifactErr: "err text-danger",
  },

  seedHint:
    "seed-hint mx-auto mt-[-8px] mb-6 flex max-w-[980px] items-center gap-2.5 rounded-md border border-dashed border-border-subtle px-3.5 py-2.5 font-mono text-[11px] text-fg-muted",
  seedSpacer: "seed-hint__spacer flex-1",
  detailPlaceholder:
    "detail-placeholder rounded-md border border-dashed border-border-subtle p-6 text-center font-mono text-xs text-fg-muted",
};
