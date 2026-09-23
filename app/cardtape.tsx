'use client';

/* oxlint-disable jsx-a11y/prefer-tag-over-role, next/no-img-element */

import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowLeft, ArrowRight, Check, ChevronDown, CircleAlert, Database, Landmark,
  Minus, ShieldCheck, TrendingDown, TrendingUp,
} from 'lucide-react';
import { snapshotImpact } from '../packages/core/src/published-snapshot';
import {
  dataSources, getCampaignsForNeobank, getNeobank, getNeobankCampaign, neobanks,
  type CampaignImpact, type CampaignMetric, type EvidenceKind, type ImpactVerdict,
  type NeobankCampaign,
} from '../packages/core/src/neobanks';
import { useTapeFeed, type TapeFeed } from './use-tape-feed';

type View =
  | { page: 'overview' }
  | { page: 'neobank'; neobankId: string }
  | { page: 'campaign'; neobankId: string; campaignId: string }
  | { page: 'methodology' };

const DAY = 86_400_000;

export default function Cardtape() {
  const [view, setView] = useState<View>({ page: 'overview' });
  const tape = useTapeFeed(false);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [view]);
  const openNeobank = (neobankId: string) => setView({ page: 'neobank', neobankId });
  const openCampaign = (campaign: NeobankCampaign) => setView({ page: 'campaign', neobankId: campaign.neobankId, campaignId: campaign.id });

  return <div className="app-shell">
    <Header view={view} setView={setView} />
    <main className="content-shell">
      {view.page === 'overview' && <Overview onOpenNeobank={openNeobank} />}
      {view.page === 'neobank' && <NeobankPage neobankId={view.neobankId} onBack={() => setView({ page: 'overview' })} onOpenCampaign={openCampaign} />}
      {view.page === 'campaign' && <CampaignPage campaignId={view.campaignId} tape={tape} onBack={() => setView({ page: 'neobank', neobankId: view.neobankId })} />}
      {view.page === 'methodology' && <Methodology tape={tape} />}
    </main>
    <Footer view={view} tape={tape} />
  </div>;
}

function Header({ view, setView }: { view: View; setView: (view: View) => void }) {
  return <header className="site-header">
    <button className="brand" onClick={() => setView({ page: 'overview' })} aria-label="CARDTAPE overview">CARDTAPE</button>
    <nav className="primary-nav" aria-label="Primary navigation">
      <button className={view.page === 'overview' ? 'active' : ''} onClick={() => setView({ page: 'overview' })}>Overview</button>
      <button className={view.page === 'methodology' ? 'active' : ''} onClick={() => setView({ page: 'methodology' })}>Data methodology</button>
    </nav>
    <div className="header-note"><span>Campaign impact</span><b>Observed, not overstated</b></div>
  </header>;
}

function Overview({ onOpenNeobank }: { onOpenNeobank: (id: string) => void }) {
  return <div className="page overview-page">
    <section className="overview-hero">
      <div className="hero-copy"><h1>See what changed<br />when a campaign ran.</h1><p>CARDTAPE compares observable activity with a clear baseline, so teams can understand impact in under 30 seconds.</p></div>
      <div className="hero-sequence" aria-label="Product hierarchy"><span>01</span><b>Neobank</b><ArrowRight size={16} /><span>02</span><b>Campaign</b><ArrowRight size={16} /><span>03</span><b>KPI impact</b></div>
    </section>
    <section className="neobank-section">
      <SectionIntro kicker="AVAILABLE NEOBANKS" title="Choose a program" copy="Each program keeps its own data sources behind one consistent campaign view." />
      <div className="neobank-grid">{neobanks.map((neobank) => {
        const campaigns = getCampaignsForNeobank(neobank.id);
        const demo = campaigns.every((campaign) => campaign.status === 'demonstration');
        return <button className="neobank-card" key={neobank.id} onClick={() => onOpenNeobank(neobank.id)}>
          <div className="neobank-card-top"><NeobankLogo neobankId={neobank.id} /><span className={`availability ${demo ? 'demo' : ''}`}>{demo ? 'Demo adapter' : 'Available'}</span></div>
          <div><h2>{neobank.name}</h2><p>{neobank.description}</p></div>
          <div className="neobank-card-footer"><span>{campaigns.length} {campaigns.length === 1 ? 'campaign' : 'campaigns'}</span><span>View campaigns <ArrowRight size={15} /></span></div>
        </button>;
      })}</div>
    </section>
  </div>;
}

function NeobankPage({ neobankId, onBack, onOpenCampaign }: { neobankId: string; onBack: () => void; onOpenCampaign: (campaign: NeobankCampaign) => void }) {
  const neobank = getNeobank(neobankId);
  const campaigns = getCampaignsForNeobank(neobankId);
  return <div className="page neobank-page">
    <BackButton onClick={onBack}>All neobanks</BackButton>
    <section className="neobank-hero"><div><Eyebrow><Landmark size={14} /> {neobank.shortName} / Campaigns</Eyebrow><h1>{neobank.name}</h1><p>{neobank.description}</p></div><div className="program-summary"><span>PROGRAM VIEW</span><strong>{String(campaigns.length).padStart(2, '0')}</strong><small>{campaigns.length === 1 ? 'onchain view' : 'onchain views'}</small></div></section>
    {campaigns.some((campaign) => campaign.status === 'demonstration') && <div className="disclosure"><CircleAlert size={16} /><span><b>Demonstration environment.</b> Plasma values below are illustrative normalized outputs, not live claims.</span></div>}
    <section className="campaign-list-section">
      <div className="list-heading"><span>CAMPAIGN</span><span>OBSERVATION WINDOW</span><span>READOUT</span><span /></div>
      <div className="campaign-list">{campaigns.map((campaign) => <button key={campaign.id} className="campaign-row" onClick={() => onOpenCampaign(campaign)}>
        <div className="campaign-name"><StatusDot status={campaign.status} /><div><strong>{campaign.name}</strong><small>{campaign.description}</small></div></div>
        <div className="campaign-period">{campaign.id === 'plasma-one-platinum-locks' ? <span>Rolling 7 days</span> : campaign.id === 'etherfi-cash-live' ? <span>Rolling 24 hours</span> : <><span>{formatDate(campaign.startsAt)}</span><span className="period-line" /><span>{formatDate(campaign.endsAt)}</span></>}</div>
        <div><StatusLabel status={campaign.status} /></div><ArrowRight size={18} />
      </button>)}</div>
    </section>
    <div className="neobank-note"><ShieldCheck size={18} /><p><b>One interface, program-specific evidence.</b> Each published snapshot contains normalized onchain readouts, observation windows, and source metadata.</p></div>
  </div>;
}

function CampaignPage({ campaignId, tape, onBack }: { campaignId: string; tape: TapeFeed; onBack: () => void }) {
  const campaign = getNeobankCampaign(campaignId);
  const neobank = getNeobank(campaign.neobankId);
  const plasmaMonitor = campaign.neobankId === 'plasma-one';
  const cashMonitor = campaign.id === 'etherfi-cash-live';
  const rollingMonitor = plasmaMonitor || cashMonitor;
  const [baselineDays, setBaselineDays] = useState(plasmaMonitor ? 7 : 14);
  const [initialAsOf] = useState(() => Date.now());
  const impact = snapshotImpact(tape.snapshot, campaign.id, cashMonitor ? 1 : baselineDays);
  const error = tape.connection === 'disconnected' || (tape.snapshot !== null && impact === null);
  const asOf = tape.snapshot ? Date.parse(tape.snapshot.generatedAt) : initialAsOf;
  const periods = impact ? { campaign: impact.campaignPeriod, baseline: impact.baselinePeriod } : (() => {
    const campaignStart = rollingMonitor ? new Date(asOf - (cashMonitor ? DAY : 7 * DAY)) : new Date(campaign.startsAt);
    const campaignEnd = rollingMonitor ? new Date(asOf).toISOString() : campaign.endsAt;
    return { campaign: { start: campaignStart.toISOString(), end: campaignEnd }, baseline: { start: new Date(campaignStart.getTime() - (cashMonitor ? 1 : baselineDays) * DAY).toISOString(), end: new Date(campaignStart.getTime() - 1).toISOString() } };
  })();

  return <div className="page campaign-page">
    <BackButton onClick={onBack}>{neobank.name} campaigns</BackButton>
    <header className="campaign-hero">
      <div className="campaign-title-block"><Eyebrow><span className="eyebrow-dot" /> {neobank.name} / {rollingMonitor ? 'Onchain snapshot' : 'Impact readout'}</Eyebrow><h1>{campaign.name}</h1><p>{campaign.description}</p>{campaign.sourceUrl && <a href={campaign.sourceUrl} target="_blank" rel="noreferrer">Official program details ↗</a>}{plasmaMonitor && <> · <a href="https://plasmascan.to/address/0xe035a6a5aba726bd162e273a22ff85ae5f6e04c3#events" target="_blank" rel="noreferrer">Onchain vault ↗</a></>}</div>
      <div className="period-control"><label htmlFor="baseline">COMPARE WITH</label>{cashMonitor ? <strong>Previous 24 hours</strong> : <div className="select-wrap"><select id="baseline" value={baselineDays} onChange={(event) => setBaselineDays(Number(event.target.value))}><option value={7}>Previous 7 days</option><option value={14}>Previous 14 days</option><option value={30}>Previous 30 days</option></select><ChevronDown size={15} /></div>}<small>{formatDate(periods.baseline.start)} — {formatDate(periods.baseline.end)}</small></div>
    </header>
    {tape.snapshot && <div className="disclosure"><CircleAlert size={16} /><span>Published onchain snapshot from {formatDateTime(tape.snapshot.generatedAt)}. Rolling windows stay fixed until the next publication.</span></div>}
    {campaign.status === 'demonstration' && <div className="disclosure"><CircleAlert size={16} /><span><b>Demo analysis.</b> This is not an official campaign or live-data claim. Values demonstrate the adapter contract.</span></div>}
    {error && <div className="error-state">No published onchain readout is available for this campaign.</div>}
    {!impact && !error && <CampaignLoading />}
    {impact && <>
      <VerdictPanel impact={impact} />
      <section className="metrics-section"><div className="section-heading"><div><span>CORE KPIs</span><h2>Campaign period versus baseline</h2></div><p>Only the most decision-useful signals are shown.</p></div><div className="metric-grid">{impact.metrics.map((metric) => <MetricCard metric={metric} key={metric.id} />)}</div></section>
      {impact.trend.length > 0 && <section className="trend-section"><div className="section-heading"><div><span>DAILY TREND</span><h2>Observable activity over time</h2></div><div className="chart-legend"><i className="legend-line" />{plasmaMonitor ? 'Platinum-sized locks' : 'Daily settlement USD'} <i className="legend-window" />Observation window</div></div><TrendChart impact={impact} /></section>}
      <section className="evidence-section"><details><summary><span><Database size={17} />Evidence & limitations</span><span>Observation periods, source notes and confidence <ChevronDown size={16} /></span></summary><div className="evidence-content"><div><h3>What this readout can say</h3><p>It compares observable activity in two time windows. A change can be consistent with campaign impact, but it is not automatically causal.</p></div><div><h3>Important limitations</h3><ul>{impact.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul></div><div><h3>Periods</h3><p>Campaign: {formatDate(impact.campaignPeriod.start)} — {formatDate(impact.campaignPeriod.end)}<br />Baseline: {formatDate(impact.baselinePeriod.start)} — {formatDate(impact.baselinePeriod.end)}</p></div></div></details></section>
    </>}
  </div>;
}

function VerdictPanel({ impact }: { impact: CampaignImpact }) {
  const labels: Record<ImpactVerdict, string> = { positive: 'Observed increase', neutral: 'Broadly unchanged', negative: 'Observed decrease', insufficient: 'Insufficient measured history' };
  const icons: Record<ImpactVerdict, ReactNode> = { positive: <TrendingUp size={25} />, neutral: <Minus size={25} />, negative: <TrendingDown size={25} />, insufficient: <CircleAlert size={25} /> };
  return <section className={`verdict-panel ${impact.verdict}`}><div className="verdict-icon">{icons[impact.verdict]}</div><div><span>OBSERVATION</span><h2>{labels[impact.verdict]}</h2><p>{impact.conclusion}</p></div><div className="verdict-period"><span>OBSERVATION WINDOW</span><strong>{formatDate(impact.campaignPeriod.start)} — {formatDate(impact.campaignPeriod.end)}</strong></div></section>;
}

function MetricCard({ metric }: { metric: CampaignMetric }) {
  const positive = metric.changeValue !== null && metric.changeValue > 0;
  const negative = metric.changeValue !== null && metric.changeValue < 0;
  return <article className="metric-card">
    <div className="metric-top"><span>{metric.label}</span><EvidencePill kind={metric.evidence.kind} /></div>
    <div className="metric-values"><div><small>CAMPAIGN</small><strong>{formatMetric(metric.campaignValue, metric.format)}</strong></div><div><small>BASELINE</small><strong>{formatMetric(metric.baselineValue, metric.format)}</strong></div></div>
    <div className={`metric-change ${positive ? 'up' : negative ? 'down' : ''}`}>{positive ? <TrendingUp size={15} /> : negative ? <TrendingDown size={15} /> : <Minus size={15} />}<strong>{formatChange(metric)}</strong><span>vs baseline</span></div>
    <p>{metric.interpretation}</p>
    <details className="metric-evidence"><summary>View evidence <ChevronDown size={13} /></summary><div><b>{metric.evidence.confidence} confidence</b> · updated {formatDateTime(metric.evidence.lastUpdatedAt)}<br />{metric.evidence.note}</div></details>
  </article>;
}

function TrendChart({ impact }: { impact: CampaignImpact }) {
  const values = impact.trend.map((point) => point.value);
  const min = Math.min(...values) - 5; const max = Math.max(...values) + 5;
  const x = (index: number) => 52 + (index / Math.max(1, impact.trend.length - 1)) * 836;
  const y = (value: number) => 230 - ((value - min) / Math.max(1, max - min)) * 174;
  const path = impact.trend.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)} ${y(point.value).toFixed(1)}`).join(' ');
  const campaignIndices = impact.trend.map((point, index) => point.phase === 'campaign' ? index : -1).filter((index) => index >= 0);
  const startIndex = campaignIndices[0] ?? 0; const endIndex = campaignIndices.at(-1) ?? startIndex;
  const startX = x(startIndex); const endX = x(Math.min(impact.trend.length - 1, endIndex + 1));
  return <div className="trend-chart-wrap"><svg className="trend-chart" viewBox="0 0 940 285" role="img" aria-label="Daily activity trend with campaign start and end markers">
    <defs><linearGradient id="chart-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#caff5b" stopOpacity=".22" /><stop offset="1" stopColor="#caff5b" stopOpacity="0" /></linearGradient></defs>
    <path className="chart-grid" d="M52 56H888M52 114H888M52 172H888M52 230H888" /><rect className="campaign-band" x={startX} y="38" width={Math.max(2, endX - startX)} height="192" /><path className="area-path" d={`${path} L888 230 L52 230 Z`} /><path className="trend-path" d={path} /><path className="marker-line" d={`M${startX} 38V244M${endX} 38V244`} />
    <text x={startX + 7} y="28">START</text><text x={endX - 7} y="28" textAnchor="end">END</text>{impact.trend.map((point, index) => <circle key={point.date} className={point.phase === 'campaign' ? 'trend-point active' : 'trend-point'} cx={x(index)} cy={y(point.value)} r={point.phase === 'campaign' ? 3.3 : 2.4} />)}
    <text x="52" y="266">{formatDate(impact.trend[0]?.date ?? impact.baselinePeriod.start)}</text><text x="888" y="266" textAnchor="end">{formatDate(impact.trend.at(-1)?.date ?? impact.campaignPeriod.end)}</text><text x="44" y="60" textAnchor="end">{Math.round(max)}</text><text x="44" y="234" textAnchor="end">{Math.round(min)}</text>
  </svg><p>{impact.neobankId === 'plasma-one' ? 'Daily Platinum-sized vault locks · Locks do not confirm card signups or activations.' : 'Daily finalized settlement USD · Campaign boundaries shown for orientation · Changes indicate correlation, not automatic causation.'}</p></div>;
}

function Methodology({ tape }: { tape: TapeFeed }) {
  return <div className="page methodology-page">
    <section className="method-hero"><Eyebrow><ShieldCheck size={14} /> Data methodology</Eyebrow><h1>Technical detail,<br />kept in its place.</h1><p>The main journey stays focused on neobanks and campaign impact. Source, network and indexing context lives here for review.</p></section>
    <section className="method-principles"><article><span>01</span><h2>Observed before attributed</h2><p>We describe changes as observed impact or correlation. Causal language requires a defensible design and control.</p></article><article><span>02</span><h2>Provenance on every metric</h2><p>Each normalized metric carries source IDs, observation period, last-updated time and confidence.</p></article><article><span>03</span><h2>Unknown stays unknown</h2><p>No merchant label or confirmed card purchase is inferred from a token transfer or balance debit alone.</p></article></section>
    <section className="source-section"><div className="section-heading"><div><span>DATA SOURCES</span><h2>Adapters and observable signals</h2></div><p>Implementation details are intentionally absent from campaign navigation.</p></div><div className="source-list">{dataSources.map((source) => <article key={source.id} className="source-row"><div className="source-title"><Database size={17} /><div><strong>{source.name}</strong><EvidencePill kind={source.kind} /></div></div><p>{source.description}</p><div><span>NETWORK</span><strong>{source.networks.join(', ') || 'Off-chain registry'}</strong></div><div><span>SIGNALS</span><strong>{source.signals.join(' · ')}</strong></div><details><summary>Method <ChevronDown size={13} /></summary><p>{source.methodology}</p></details></article>)}</div></section>
    <section className="adapter-status"><div><span className={`status-light ${tape.connection}`} /><div><strong>Published onchain snapshot</strong><small>{tape.snapshot ? `Generated ${formatDateTime(tape.snapshot.generatedAt)} · Optimism block ${tape.snapshot.optimism.blockNumber}` : 'No snapshot published yet'}</small></div></div><p>{tape.snapshot?.optimism.tiersIndexedAt ? `Tier assignments last reconstructed ${formatDateTime(tape.snapshot.optimism.tiersIndexedAt)}; newer tape events have an unknown tier. ` : 'Tier assignments have not been reconstructed. '}The local indexer and database are used only when publishing an update.</p></section>
  </div>;
}

function CampaignLoading() { return <div className="campaign-loading"><div /><div /><div /><div /></div>; }

function Footer({ view, tape }: { view: View; tape: TapeFeed }) {
  const context = view.page === 'campaign' || view.page === 'neobank' ? getNeobank(view.neobankId).name : 'Multi-neobank view';
  return <footer className="site-footer"><span>© 2026 CARDTAPE</span><span>{context}</span><span className="footer-source"><i className={tape.connection} />{tape.snapshot ? `Snapshot ${formatDateTime(tape.snapshot.generatedAt)}` : 'Snapshot unavailable'}</span><span>Evidence-aware campaign analytics</span></footer>;
}

function BackButton({ onClick, children }: { onClick: () => void; children: ReactNode }) { return <button className="back-button" onClick={onClick}><ArrowLeft size={15} />{children}</button>; }
function Eyebrow({ children }: { children: ReactNode }) { return <div className="eyebrow">{children}</div>; }
function SectionIntro({ kicker, title, copy }: { kicker: string; title: string; copy: string }) { return <div className="section-intro"><div><span>{kicker}</span><h2>{title}</h2></div><p>{copy}</p></div>; }
function NeobankLogo({ neobankId }: { neobankId: string }) {
  const etherfi = neobankId === 'etherfi-cash';
  return <img className={`neobank-logo ${etherfi ? 'etherfi' : 'plasma'}`} src={etherfi ? '/etherfi-symbol.svg' : 'https://www.plasma.org/brand/logo/plasma-symbol-dark.svg'} alt={etherfi ? 'ether.fi' : 'Plasma'} />;
}
function StatusDot({ status }: { status: NeobankCampaign['status'] }) { return <span className={`status-dot ${status}`}>{status === 'unavailable' ? <CircleAlert size={11} /> : <Check size={11} />}</span>; }
function StatusLabel({ status }: { status: NeobankCampaign['status'] }) { const label = status === 'complete' ? 'Onchain window' : status === 'active' ? 'Snapshot monitor' : status === 'unavailable' ? 'History unavailable' : 'Demo readout'; return <span className={`status-label ${status}`}>{label}</span>; }
function EvidencePill({ kind }: { kind: EvidenceKind }) { const labels: Record<EvidenceKind, string> = { live: 'Live', cached: 'Snapshot', inferred: 'Inferred', estimated: 'Estimated', demo: 'Demo data' }; return <span className={`evidence-pill ${kind}`}>{labels[kind]}</span>; }
function formatDate(value: string): string { return new Intl.DateTimeFormat('en-US', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(value)); }
function formatDateTime(value: string): string { return new Intl.DateTimeFormat('en-US', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }).format(new Date(value)); }
function formatMetric(value: number | null, format: CampaignMetric['format']): string { if (value === null) return '—'; if (format === 'currency') { if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}m`; if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}k`; return `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`; } if (format === 'percent') return `${value.toFixed(1)}%`; return value.toLocaleString('en-US', { maximumFractionDigits: format === 'count' ? 0 : 1 }); }
function formatChange(metric: CampaignMetric): string { if (metric.changeValue === null) return 'Not available'; const sign = metric.changeValue > 0 ? '+' : ''; return metric.changeUnit === 'percentage-points' ? `${sign}${metric.changeValue.toFixed(1)}pp` : `${sign}${metric.changeValue.toFixed(1)}%`; }
