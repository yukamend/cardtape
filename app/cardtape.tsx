'use client';

/* oxlint-disable jsx-a11y/prefer-tag-over-role, jsx-a11y/no-interactive-element-to-noninteractive-role */

import { memo, useEffect, useState, type ReactNode } from 'react';
import type { TapeEvent } from '../packages/core/src/tape';
import { useTapeFeed, type TapeFeed } from './use-tape-feed';

type View = 'campaigns' | 'tape' | 'baseline' | 'tiers' | 'methodology' | 'detail';
type Provenance = 'measured' | 'inferred' | 'estimated' | 'demo';

const campaigns = [
  { id:'iphone', registryId:'etherfi-iphone18-preorder', status:'LIVE', name:'IPHONE 18 PRE-ORDER', short:'IPHONE 18', window:'SEP 12—18', mechanic:'CASHBACK LOTTERY', tiers:'LUXE · PINNACLE · VIP', budget:'$100,000', lift:'+31.8%', cost:'PENDING', retention:'TRACKING', source:'ETHER.FI / EVENTS / IPHONE 18' },
  { id:'lunar', registryId:'etherfi-lunar-new-year-2026', status:'SETTLED', name:'LUNAR NEW YEAR 2026', short:'LUNAR NEW YEAR', window:'FEB 08—28', mechanic:'REFERRAL CASHBACK', tiers:'NEW · APAC', budget:'$20,000', lift:'+18.4%', cost:'$16,842', retention:'41.2%', source:'ETHER.FI / EVENTS / LUNAR NEW YEAR' },
  { id:'membership', registryId:'etherfi-membership-rewards-2025', status:'SETTLED', name:'MEMBERSHIP REWARDS', short:'MEMBERSHIP REWARDS', window:'JUN—AUG 25', mechanic:'TIER CASHBACK', tiers:'CORE → VIP', budget:'VARIABLE', lift:'—', cost:'$48,320', retention:'36.7%', source:'ETHER.FI / EVENTS / MEMBERSHIP REWARDS' },
] as const;

const tiers = [
  {name:'CORE', population:'8,492', flow:'+184', rule:'FREE', rate:'3%', cap:'$2,000'},
  {name:'LUXE', population:'2,186', flow:'+96', rule:'30K ETHFI / $15K LIQUID', rate:'3%', cap:'$10,000'},
  {name:'PINNACLE', population:'428', flow:'+22', rule:'150K ETHFI / $100K LIQUID', rate:'3%', cap:'$50,000'},
  {name:'VIP', population:'74', flow:'+03', rule:'500K ETHFI / $500K LIQUID', rate:'4%', cap:'$50,000'},
] as const;

export default function Cardtape() {
  const [view,setView] = useState<View>('campaigns');
  const [currency,setCurrency] = useState('USD');
  const [windowRange,setWindowRange] = useState('7D');
  const [paused,setPaused] = useState(false);
  const [selectedCampaign,setSelectedCampaign] = useState('iphone');
  const [rightOpen,setRightOpen] = useState(true);
  const tape = useTapeFeed(paused);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 's' && !event.metaKey && !event.ctrlKey) window.print();
      if (event.code === 'Space' && view === 'tape') { event.preventDefault(); setPaused((current) => !current); }
      if (event.key === 'Escape' && view === 'detail') setView('campaigns');
    };
    window.addEventListener('keydown',onKey);
    return () => window.removeEventListener('keydown',onKey);
  },[view]);

  const selected = campaigns.find((campaign) => campaign.id === selectedCampaign) ?? campaigns[0];
  const openCampaign = (id: string) => { setSelectedCampaign(id); setView('detail'); };

  return <main className="terminal-shell">
    <header className="topbar">
      <button className="wordmark" onClick={() => setView('campaigns')}>CARDTAPE<span className="version">/0.1</span></button>
      <div className="ticker"><span>ETHFI</span><b>$0.7421</b><i>+2.81%</i><span className="ticker-sep">BTC</span><b>$108,420</b><i>+0.64%</i></div>
      <nav className="windows" aria-label="Time window">{['1H','24H','7D','30D','ALL'].map((item)=><button key={item} className={item===windowRange?'active':''} onClick={()=>setWindowRange(item)}>{item}</button>)}</nav>
      <div className="header-actions"><button aria-label={paused?'Resume tape':'Pause tape'} onClick={()=>setPaused(!paused)}>{paused?'RESUME':'PAUSE'}</button><button aria-label="Print screenshot mode" onClick={()=>window.print()}>[S]</button><span className={`live ${tape.connection==='connected'?'':'offline'}`}><span className="live-dot"/>{tape.connection==='connected'?'WS · OP':'WS · OFFLINE'}</span></div>
    </header>
    <div className="demo-banner">{tape.mode==='live'
      ? 'MIXED DATA · LIVE OP SETTLEMENT TAPE · CAMPAIGN ANALYTICS REMAIN LABELED DEMO / ESTIMATED'
      : 'DEMO DATA · SYNTHETIC SETTLEMENTS · VALUES ARE NOT CLAIMS ABOUT LIVE ACTIVITY'}</div>
    <div className={`workspace ${rightOpen?'':'right-closed'}`}>
      <LeftRail view={view} setView={setView} openCampaign={openCampaign} selectedCampaign={selectedCampaign}/>
      <section className="main-panel">
        {view==='campaigns' && <CampaignIndex onOpen={openCampaign} currency={currency} setCurrency={setCurrency} tape={tape}/>}
        {view==='detail' && <CampaignDetail campaign={selected} onBack={()=>setView('campaigns')} currency={currency} setCurrency={setCurrency} tape={tape}/>}
        {view==='tape' && <TapeView paused={paused} setPaused={setPaused} tape={tape}/>}
        {view==='baseline' && <BaselineView currency={currency} setCurrency={setCurrency}/>} 
        {view==='tiers' && <TierView/>}
        {view==='methodology' && <MethodologyView/>}
      </section>
      {rightOpen && <ContextRail campaign={selected} onOpen={()=>openCampaign(selected.id)} onClose={()=>setRightOpen(false)}/>} 
      {!rightOpen && <button className="rail-reopen" onClick={()=>setRightOpen(true)} aria-label="Open context panel">‹</button>}
    </div>
    <Footer tape={tape}/>
  </main>;
}

function LeftRail({view,setView,openCampaign,selectedCampaign}:{view:View;setView:(view:View)=>void;openCampaign:(id:string)=>void;selectedCampaign:string}) {
  const nav: Array<[View,string]> = [['campaigns','CAMPAIGNS'],['tape','TAPE'],['baseline','BASELINE'],['tiers','TIERS'],['methodology','METHODOLOGY']];
  return <aside className="left-rail"><div className="rail-label">VIEWS</div>{nav.map(([id,label],index)=><button key={id} className={(view===id||(view==='detail'&&id==='campaigns'))?'selected':''} onClick={()=>setView(id)}><span>0{index+1}</span>{label}</button>)}<div className="rail-label campaigns-label">CAMPAIGNS / 03</div>{campaigns.map((campaign)=><button key={campaign.id} className={`campaign-link ${selectedCampaign===campaign.id&&view==='detail'?'selected':''}`} onClick={()=>openCampaign(campaign.id)}>{campaign.status==='LIVE'&&<span className="live-dot"/>}{campaign.short}</button>)}</aside>;
}

function CampaignIndex({onOpen,currency,setCurrency,tape}:{onOpen:(id:string)=>void;currency:string;setCurrency:(value:string)=>void;tape:TapeFeed}) {
  const signatureCount = tape.rows.filter((event) => event.signatureCampaignIds.length > 0).length;
  return <>
    <PageHeading eyebrow="ETHER.FI CASH / CAMPAIGN INDEX" title="EVERY PROMO. WHAT IT MOVED. WHAT IT COST." meta={<>AS OF 2026-09-17 08:42:16 UTC<br/><span>6,284 SETTLEMENTS / 7D</span></>}/>
    <div className="control-line"><span>PROGRAM <b>ETHER.FI CASH</b></span><Denomination value={currency} setValue={setCurrency}/></div>
    <div className="stat-grid"><Stat label="ACTIVE CAMPAIGNS" value="01" note="CLOSES IN 1D 15H" provenance="demo" live/><Stat label="SPEND / 7D" value="$1.84M" note="SETTLEMENTS" provenance="measured"/><Stat label="ACTIVE CARDS / 7D" value="2,418" note="UNIQUE ACCOUNTS" provenance="measured"/><Stat label="MEDIAN TICKET" value="$84.20" note="SETTLEMENT VALUE" provenance="measured"/></div>
    <div className="table-title"><span>CAMPAIGN LEAGUE TABLE</span><span>SELECT A ROW FOR FULL READOUT ↗</span></div>
    <div className="campaign-table" role="table" aria-label="Campaign performance"><div className="table-row table-head" role="row"><span>STATE</span><span>CAMPAIGN</span><span>WINDOW</span><span>MECHANIC</span><span>ELIGIBLE</span><span>BUDGET</span><span>LIFT</span><span>COST</span><span>12W PERSIST.</span></div>{campaigns.map((campaign)=><button className="table-row" role="row" key={campaign.id} onClick={()=>onOpen(campaign.id)}><span className={campaign.status==='LIVE'?'status-live':'status'}>{campaign.status==='LIVE'&&<span className="live-dot"/>}{campaign.status}</span><strong>{campaign.name}</strong><span>{campaign.window}</span><span>{campaign.mechanic}</span><span>{campaign.tiers}</span><span className="num">{campaign.budget}</span><span className={`num ${campaign.lift==='—'?'muted':'positive'}`}>{campaign.lift==='—'?'— NO EFFECT':campaign.lift}</span><span className="num">{campaign.cost}</span><span className="num">{campaign.retention}</span></button>)}</div>
    <div className="bottom-grid"><Panel title="SETTLEMENT VOLUME / 7D" meta={currency}><LineChart/></Panel><Panel title="LIVE TAPE" meta={`${signatureCount} SIGNATURE MATCHES`}><TapeExcerpt rows={tape.rows} limit={5}/></Panel></div>
  </>;
}

function CampaignDetail({campaign,onBack,currency,setCurrency,tape}:{campaign:(typeof campaigns)[number];onBack:()=>void;currency:string;setCurrency:(value:string)=>void;tape:TapeFeed}) {
  const noEffect=campaign.id==='membership';
  return <>
    <button className="back-link" onClick={onBack}>← CAMPAIGN INDEX</button>
    <div className="campaign-header"><div><div className="eyebrow">ETHER.FI CASH / CAMPAIGN READOUT / <span className={campaign.status==='LIVE'?'accent-text':''}>{campaign.status}</span></div><h1>{campaign.name}</h1><div className="badges inline"><Provenance type="demo"/><span>{campaign.mechanic}</span><span>{campaign.tiers}</span></div></div><div className="campaign-meta"><Denomination value={currency} setValue={setCurrency}/><div><span>WINDOW</span><b>{campaign.window}, 2026</b></div><div><span>STATED BUDGET</span><b>{campaign.budget}</b></div><a href={campaign.id==='iphone'?'https://etherfi.gitbook.io/etherfi/events/events/apple-iphone-18-pre-order-promo':'https://etherfi.gitbook.io/etherfi/events/events/lunar-new-year-2026'} target="_blank" rel="noreferrer">SOURCE ↗</a></div></div>
    {campaign.status==='LIVE'&&<div className="live-callout"><span><span className="live-dot"/>WINDOW CLOSES IN</span><b>01D : 15H : 17M</b><span>PAYOUT SCHEDULED 2026-11-01</span></div>}
    <SectionTitle n="01" title="PRE-TRENDS / PARALLEL-TRENDS CHECK" meta="8 WEEKS BEFORE → CAMPAIGN WINDOW"/>
    <div className="chart-panel tall"><TrendChart/><div className="chart-caption"><Provenance type="estimated"/>Eligible and control cohorts moved in parallel before the window. The shaded band marks the campaign; demo series shown.</div></div>
    <SectionTitle n="02" title="VERDICT" meta="THE FOUR NUMBERS THAT MATTER"/>
    <div className="stat-grid verdict"><Stat label="CAUSAL LIFT" value={noEffect?'—':campaign.lift} note={noEffect?'NO DETECTABLE EFFECT':'95% CI +18.6—44.9%'} provenance="estimated"/><Stat label="MEASURED COST" value={campaign.cost} note={campaign.status==='LIVE'?'PAYOUT NOT YET DUE':'ON-CHAIN DISBURSEMENT'} provenance="measured"/><Stat label="COST / INCR. TXN" value={campaign.status==='LIVE'?'PENDING':'$28.41'} note="CAUSAL DENOMINATOR" provenance="estimated"/><Stat label="12W PERSISTENCE" value={campaign.retention} note={campaign.status==='LIVE'?'COHORT MATURING':'STILL SPENDING'} provenance="estimated"/></div>
    <div className="analysis-grid"><div><SectionTitle n="03" title="SIGNATURE MATCH" meta="TICKET DISTRIBUTION"/><div className="chart-panel"><Histogram/><div className="chart-caption"><Provenance type="inferred"/>Settlements ≥ $1,000 from eligible tiers. Merchant identity is not visible on-chain.</div></div></div><div><SectionTitle n="04" title="ACQUISITION" meta="FIRST-SPEND ACCOUNTS"/><div className="metric-list"><MetricRow label="NEW CARDS / WINDOW" value="184" type="measured"/><MetricRow label="REACTIVATED CARDS" value="73" type="estimated"/><MetricRow label="LUXE + SHARE" value="62.4%" type="measured"/><MetricRow label="COST / NEW CARD" value="PENDING" type="estimated"/></div></div></div>
    <div className="analysis-grid"><div><SectionTitle n="05" title="TIER MIGRATION" meta="14D RUN-UP → WINDOW"/><div className="chart-panel"><FlowChart/></div></div><div><SectionTitle n="06" title="TOKEN EVENT STUDY" meta="BETA-ADJUSTED RETURN"/><div className="chart-panel"><EventChart/><div className="chart-caption"><Provenance type="estimated"/>ETHFI return minus estimated market beta. Announcement day = 0.</div></div></div></div>
    <SectionTitle n="07" title="PERSISTENCE" meta="CAMPAIGN COHORT VS BASELINE"/><div className="chart-panel tall"><PersistenceChart/><div className="chart-caption"><Provenance type="estimated"/>Share of acquired or reactivated cards still spending. Weeks 8 and 12 are pending for live cohorts.</div></div>
    <SectionTitle n="08" title="SIGNATURE-MATCHED TAPE" meta="RAW SETTLEMENT EVIDENCE"/><div className="full-tape"><TapeTable rows={tape.rows.filter((event) => event.signatureCampaignIds.includes(campaign.registryId)).slice(0,6)}/></div>
  </>;
}

function TapeView({paused,setPaused,tape}:{paused:boolean;setPaused:(value:boolean)=>void;tape:TapeFeed}) {
  const [filter,setFilter] = useState<'all'|'signature'|'spend'>('all');
  const rows = tape.rows.filter((event) => filter==='all' || (filter==='signature' ? event.signatureCampaignIds.length > 0 : event.eventType==='spend'));
  const feedState = paused
    ? `PAUSED · ${tape.pending} QUEUED`
    : tape.connection==='connected'
      ? `${tape.mode==='demo-replay'?'DEMO REPLAY':'LIVE'} · ${tape.received} RECEIVED`
      : tape.connection.toUpperCase();
  const adapterLabel = tape.mode==='demo-replay' ? 'SYNTHETIC ADAPTER' : 'OP MAINNET ADAPTER';
  return <>
    <PageHeading eyebrow="ETHER.FI CASH / SETTLEMENT TAPE" title="RAW SETTLEMENTS. CAMPAIGN SIGNATURES MARKED." meta={<>POSTGRES → WEBSOCKET / {adapterLabel}<br/><span>{feedState}</span></>}/>
    <div className="control-line"><span>ROWS <b>{rows.length} / 500 RING BUFFER</b></span><div className="segmented"><button className={filter==='all'?'active':''} onClick={()=>setFilter('all')}>ALL</button><button className={filter==='signature'?'active':''} onClick={()=>setFilter('signature')}>SIGNATURE</button><button className={filter==='spend'?'active':''} onClick={()=>setFilter('spend')}>SPEND</button><button onClick={()=>setPaused(!paused)}>{paused?'RESUME [SPACE]':'PAUSE [SPACE]'}</button></div></div>
    <div className={`full-tape ${paused?'paused':''}`}><TapeTable rows={rows}/></div>
    <div className="method-note"><Provenance type={tape.mode==='demo-replay'?'demo':'measured'}/>Rows stream from Postgres through the local WebSocket server. Campaign-window shading and signature marks are registry-derived; merchant identity remains unavailable.</div>
  </>;
}

function BaselineView({currency,setCurrency}:{currency:string;setCurrency:(value:string)=>void}) { return <><PageHeading eyebrow="ETHER.FI CASH / PROGRAM BASELINE" title="SPEND, CARDS AND TICKET SHAPE OVER TIME." meta={<>18 MONTH SYNTHETIC HISTORY<br/><span>CAMPAIGN WINDOWS SHADED</span></>}/><div className="control-line"><span>ROLLUP <b>DAILY / FINALIZED</b></span><Denomination value={currency} setValue={setCurrency}/></div><div className="stat-grid"><Stat label="SETTLED VOLUME / 30D" value="$6.82M" note="+12.4% VS PRIOR" provenance="measured"/><Stat label="ACTIVE CARDS / 30D" value="4,921" note="+8.1% VS PRIOR" provenance="measured"/><Stat label="TXN / ACTIVE CARD" value="8.41" note="MONTHLY" provenance="estimated"/><Stat label="UNPRICED VOLUME" value="0.03%" note="NEVER COERCED TO ZERO" provenance="measured"/></div><SectionTitle n="01" title="SETTLEMENT VOLUME" meta="CAMPAIGN WINDOWS OVERLAID"/><div className="chart-panel tall"><BaselineChart/></div><div className="analysis-grid"><div><SectionTitle n="02" title="ACTIVE CARDS" meta="UNIQUE / 7D ROLLING"/><div className="chart-panel"><LineChart/></div></div><div><SectionTitle n="03" title="TICKET DISTRIBUTION" meta="LOG SCALE"/><div className="chart-panel"><Histogram/></div></div></div></>; }

function TierView() { return <><PageHeading eyebrow="ETHER.FI CASH / TIER STATE" title="WHO QUALIFIED, WHEN, AND BY WHICH ROUTE." meta={<>INTERVAL RECONSTRUCTION<br/><span>AS OF BLOCK 141,802,991</span></>}/><div className="tier-table"><div className="tier-row tier-head"><span>TIER</span><span>POPULATION</span><span>30D FLOW</span><span>QUALIFY BY ANY ROUTE</span><span>CASHBACK</span><span>MONTHLY CAP</span></div>{tiers.map((tier)=><div className="tier-row" key={tier.name}><strong>{tier.name}</strong><span className="num">{tier.population}</span><span className="num positive">{tier.flow}</span><span>{tier.rule}</span><span className="num">{tier.rate}</span><span className="num">{tier.cap}</span></div>)}</div><SectionTitle n="01" title="POPULATION OVER TIME" meta="CAMPAIGN WINDOWS SHADED"/><div className="chart-panel tall"><TierChart/></div><div className="analysis-grid"><div><SectionTitle n="02" title="UPGRADE FLOW" meta="14D / BY ROUTE"/><div className="metric-list"><MetricRow label="sETHFI STAKE" value="84" type="measured"/><MetricRow label="LIQUID DEPOSIT" value="27" type="measured"/><MetricRow label="POINTS / PAID / UNKNOWN" value="19" type="estimated"/></div></div><div><SectionTitle n="03" title="POST-WINDOW UNSTAKE" meta="MERCENARY VS STICKY"/><div className="metric-list"><MetricRow label="STILL STAKED / 30D" value="68.2%" type="estimated"/><MetricRow label="UNSTAKED / 30D" value="31.8%" type="measured"/><MetricRow label="COHORT SIZE" value="107" type="measured"/></div></div></div></>; }

function MethodologyView() { return <><PageHeading eyebrow="CARDTAPE / METHODOLOGY" title="WHAT WE KNOW. WHAT WE INFER. WHAT WE CANNOT SEE." meta={<>METHOD VERSION 0.1.0<br/><span>UPDATED 2026-09-17</span></>}/><div className="method-grid"><MethodBlock n="01" title="SETTLEMENT, NOT AUTHORIZATION"><p>On-chain card data shows timestamp, chain, token, amount, cardholder smart account and program treasury. It does not show merchant, MCC, country, decline reason, approval rate or FX spread.</p><p>We never create merchant-level labels or imply that declined authorizations exist in the dataset.</p></MethodBlock><MethodBlock n="02" title="DIFFERENCE-IN-DIFFERENCES"><p>Lift = (eligible during − eligible before) − (control during − control before).</p><p>Assumption: eligible and control tiers would have moved in parallel without the campaign. Eight weeks of pre-trends appear above every estimate. Divergent trends void the estimate.</p></MethodBlock><MethodBlock n="03" title="SIGNATURE PROXY"><p>Apple is not identifiable on-chain. The iPhone campaign proxy is a single settlement of at least $1,000 from an eligible-tier account inside the campaign window.</p><p>This over-counts unrelated large purchases and under-counts pre-orders split across cards.</p></MethodBlock><MethodBlock n="04" title="PERSISTENCE / SURVIVAL"><p>Campaign-acquired or reactivated accounts are tracked at weeks 4, 8 and 12, compared with accounts acquired outside a campaign window.</p><p>Separately, we track whether accounts that staked before a campaign unstaked within 30 days after it ended.</p></MethodBlock></div><SectionTitle n="05" title="PROVENANCE" meta="REQUIRED ON EVERY PUBLISHED NUMBER"/><div className="provenance-grid"><ProvenanceCard type="measured" text="Directly observed on-chain or in a public campaign document."/><ProvenanceCard type="inferred" text="A reproducible proxy for behavior that is not directly visible."/><ProvenanceCard type="estimated" text="Output from a statistical model with assumptions and uncertainty."/><ProvenanceCard type="demo" text="Synthetic fixture data. Never a claim about real-world activity."/></div><div className="privacy-note">PRIVACY RULE · CARD ACCOUNTS ARE PSEUDONYMOUS BUT PERSISTENT. CARDTAPE NEVER BUILDS INDIVIDUAL PROFILES OR RANKS CARDHOLDERS.</div></>; }

function ContextRail({campaign,onOpen,onClose}:{campaign:(typeof campaigns)[number];onOpen:()=>void;onClose:()=>void}) { return <aside className="right-rail"><button className="rail-close" onClick={onClose} aria-label="Close context panel">×</button><div className="context-kicker">SELECTED CAMPAIGN</div><h2>{campaign.name}</h2><div className="badges"><span>{campaign.status}</span><Provenance type="inferred"/></div><dl><div><dt>WINDOW</dt><dd>{campaign.window}, 2026</dd></div><div><dt>QUALIFYING TICKET</dt><dd>{campaign.id==='iphone'?'≥ $1,000.00':'≥ $88.00'}</dd></div><div><dt>STATED BUDGET</dt><dd>{campaign.budget}</dd></div><div><dt>ELIGIBLE TIERS</dt><dd>{campaign.tiers}</dd></div></dl><div className="context-note"><span>ATTRIBUTION NOTE</span>{campaign.id==='iphone'?'Apple is not identifiable on-chain. Qualifying purchases are proxied by ticket size, tier and window.':'Campaign participation is proxied from qualifying settlement and referral timing.'}</div><button className="open-readout" onClick={onOpen}>OPEN FULL READOUT <span>↗</span></button></aside>; }

function PageHeading({eyebrow,title,meta}:{eyebrow:string;title:string;meta:ReactNode}) { return <div className="section-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1></div><div className="asof">{meta}</div></div>; }
function Denomination({value,setValue}:{value:string;setValue:(value:string)=>void}) { return <div className="segmented" aria-label="Settlement denomination">{['USD','EUR','GBP'].map((item)=><button key={item} className={value===item?'active':''} onClick={()=>setValue(item)}>{item}</button>)}</div>; }
function Stat({label,value,note,provenance,live=false}:{label:string;value:string;note:string;provenance:Provenance;live?:boolean}) { return <div className="stat"><span>{label}</span><strong className={value==='—'?'muted':''}>{value}</strong><small className={live?'accent':''}>{live&&<span className="live-dot"/>}{note}</small><Provenance type={provenance}/></div>; }
function Provenance({type}:{type:Provenance}) { return <span className={`provenance ${type}`}>{type.toUpperCase()}</span>; }
function SectionTitle({n,title,meta}:{n:string;title:string;meta:string}) { return <div className="section-title"><span>{n}</span><b>{title}</b><em>{meta}</em></div>; }
function Panel({title,meta,children}:{title:string;meta:string;children:ReactNode}) { return <div className="mini-panel"><div className="panel-head"><span>{title}</span><span>{meta}</span></div>{children}</div>; }
function MetricRow({label,value,type}:{label:string;value:string;type:Provenance}) { return <div className="metric-row"><span>{label}</span><b>{value}</b><Provenance type={type}/></div>; }
function MethodBlock({n,title,children}:{n:string;title:string;children:ReactNode}) { return <article className="method-block"><span>{n}</span><h2>{title}</h2>{children}</article>; }
function ProvenanceCard({type,text}:{type:Provenance;text:string}) { return <div className="provenance-card"><Provenance type={type}/><p>{text}</p></div>; }
function Footer({tape}:{tape:TapeFeed}) {
  const latestBlock = tape.rows[0]?.blockNumber;
  return <footer><span>WS {tape.connection.toUpperCase()}</span><span>LAST BLOCK {latestBlock?.toLocaleString() ?? '—'}</span><span>● MEASURED&nbsp;&nbsp; ◐ INFERRED&nbsp;&nbsp; ○ ESTIMATED&nbsp;&nbsp; ◇ DEMO</span><span>NEVER ASKS FOR YOUR KEYS</span></footer>;
}

function formatTapeAmount(event:TapeEvent):string {
  if (event.amountUsd===null) return 'UNPRICED';
  return `+$${Number(event.amountUsd).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
}

function shortAddress(value:string):string { return `${value.slice(0,6)}…${value.slice(-4)}`; }

function tapeLabel(event:TapeEvent):string {
  if (event.signatureCampaignIds.length>0) return 'SIGNATURE';
  return event.eventType.toUpperCase();
}

function TapeExcerpt({rows,limit}:{rows:readonly TapeEvent[];limit:number}) {
  if (rows.length===0) return <div className="tape-empty">WAITING FOR POSTGRES SNAPSHOT…</div>;
  return <>{rows.slice(0,limit).map((event)=><div className={`tape-row ${event.campaignWindowIds.length>0?'campaign-window':''}`} key={event.id}><span>{event.blockTime.slice(11,19)}</span><span>{formatTapeAmount(event)}</span><span>{event.tokenSymbol}</span><span>{shortAddress(event.cardAccount)}</span><span className={event.signatureCampaignIds.length>0?'signature':''}>{tapeLabel(event)}</span></div>)}</>;
}

const TapeEventRow = memo(function TapeEventRow({event,isNewest}:{event:TapeEvent;isNewest:boolean}) {
  const classes = ['tape-full-row'];
  if (isNewest) classes.push('new-row');
  if (event.campaignWindowIds.length>0) classes.push('campaign-window');
  if (event.signatureCampaignIds.length>0) classes.push('signature-match');
  return <div className={classes.join(' ')} title={event.campaignWindowIds.length>0?`Campaign window: ${event.campaignWindowIds.join(', ')}`:undefined}>
    <span>{event.blockTime.slice(11,19)}</span><span className="positive">●</span><span>ETHER.FI</span><strong>{formatTapeAmount(event)}</strong><span>{event.tokenSymbol}</span><span>OP</span><span>{shortAddress(event.cardAccount)}</span><span className={event.signatureCampaignIds.length>0?'signature':''}>{tapeLabel(event)}</span><a href={`https://optimistic.etherscan.io/tx/${event.txHash}`} target="_blank" rel="noreferrer" aria-label="Open transaction">↗</a>
  </div>;
});

function TapeTable({rows}:{rows:readonly TapeEvent[]}) {
  return <div className="tape-table"><div className="tape-full-row tape-head"><span>TIME / UTC</span><span>DIR</span><span>PROGRAM</span><span>AMOUNT</span><span>TOKEN</span><span>CHAIN</span><span>CARD</span><span>TYPE</span><span>TX</span></div>{rows.length===0?<div className="tape-empty">NO MATCHING SETTLEMENTS</div>:rows.map((event,index)=><TapeEventRow event={event} isNewest={index===0} key={event.id}/>)}</div>;
}

function LineChart(){return <svg className="terminal-chart" viewBox="0 0 600 150" role="img" aria-label="Settlement volume rising over seven days"><path className="gridline" d="M0 28H600M0 72H600M0 116H600"/><path className="area" d="M0 115L45 109L92 102L137 107L184 86L230 92L276 75L322 81L368 51L414 59L460 38L506 43L552 19L600 30V150H0Z"/><path className="line" d="M0 115L45 109L92 102L137 107L184 86L230 92L276 75L322 81L368 51L414 59L460 38L506 43L552 19L600 30"/><text x="592" y="24" textAnchor="end">$1.84M</text></svg>}
function TrendChart(){return <svg className="terminal-chart" viewBox="0 0 800 220" role="img" aria-label="Eligible and control cohort pre-trends"><path className="gridline" d="M40 35H780M40 95H780M40 155H780M40 205H780"/><rect className="window-band" x="665" y="18" width="115" height="187"/><path className="control-line-svg" d="M40 170L118 155L196 160L274 140L352 146L430 128L508 119L586 105L665 96L722 91L780 88"/><path className="eligible-line" d="M40 166L118 151L196 157L274 135L352 141L430 124L508 114L586 101L665 94L722 52L780 34"/><text x="770" y="28" textAnchor="end">ELIGIBLE</text><text x="770" y="105" textAnchor="end">CONTROL</text><text x="672" y="198">WINDOW</text></svg>}
function Histogram(){const bars=[10,20,33,45,62,70,55,39,28,20,14,9,7,5,18,24,12];return <svg className="terminal-chart" viewBox="0 0 600 190" role="img" aria-label="Ticket distribution histogram with one thousand dollar threshold"><path className="gridline" d="M25 30H585M25 90H585M25 150H585"/>{bars.map((height,index)=><rect key={index} className={index>=14?'hist-accent':'hist-bar'} x={32+index*31} y={160-height*1.7} width="20" height={height*1.7}/>)}<path className="threshold" d="M459 20V166"/><text x="465" y="32">$1,000 THRESHOLD</text><text x="25" y="181">$0</text><text x="540" y="181">$2,000+</text></svg>}
function FlowChart(){return <svg className="terminal-chart" viewBox="0 0 600 190" role="img" aria-label="Tier upgrade flow"><path className="gridline" d="M20 45H580M20 95H580M20 145H580"/><path className="flow-line" d="M20 154L70 150L120 146L170 151L220 137L270 127L320 113L370 103L420 80L470 61L520 49L580 28"/><path className="threshold" d="M420 20V166"/><text x="427" y="178">WINDOW START</text><text x="570" y="23" textAnchor="end">+130 UPGRADES</text></svg>}
function EventChart(){return <svg className="terminal-chart" viewBox="0 0 600 190" role="img" aria-label="Cumulative abnormal ETHFI return"><path className="gridline" d="M20 35H580M20 95H580M20 155H580"/><path className="zero-line" d="M20 95H580"/><path className="event-line" d="M20 102L80 98L140 105L200 101L260 93L300 95L340 72L400 59L460 64L520 48L580 53"/><path className="threshold" d="M300 20V165"/><text x="306" y="178">DAY 0</text><text x="570" y="47" textAnchor="end">+4.8%</text></svg>}
function PersistenceChart(){return <svg className="terminal-chart" viewBox="0 0 800 220" role="img" aria-label="Campaign cohort persistence compared with baseline"><path className="gridline" d="M40 30H780M40 85H780M40 140H780M40 195H780"/><path className="eligible-line" d="M40 27L220 62L400 92L580 117L760 133"/><path className="control-line-svg" d="M40 27L220 76L400 118L580 151L760 169"/><circle className="plot-point" cx="220" cy="62" r="3"/><circle className="plot-point" cx="400" cy="92" r="3"/><circle className="plot-point" cx="580" cy="117" r="3"/><text x="760" y="127" textAnchor="end">CAMPAIGN 41.2%</text><text x="760" y="185" textAnchor="end">BASELINE 23.8%</text><text x="40" y="214">W0</text><text x="212" y="214">W4</text><text x="392" y="214">W8</text><text x="570" y="214">W12</text></svg>}
function BaselineChart(){return <svg className="terminal-chart" viewBox="0 0 800 220" role="img" aria-label="Eighteen month baseline settlement volume"><path className="gridline" d="M30 30H780M30 85H780M30 140H780M30 195H780"/><rect className="window-band" x="230" y="20" width="55" height="175"/><rect className="window-band" x="620" y="20" width="70" height="175"/><path className="eligible-line" d="M30 180L70 176L110 170L150 173L190 162L230 149L270 118L310 142L350 135L390 128L430 132L470 116L510 107L550 111L590 96L630 82L670 40L710 71L750 59L780 54"/><text x="238" y="34">LNY</text><text x="628" y="34">IPHONE</text></svg>}
function TierChart(){return <svg className="terminal-chart" viewBox="0 0 800 220" role="img" aria-label="Tier population over time"><path className="gridline" d="M30 30H780M30 85H780M30 140H780M30 195H780"/><path className="tier-core" d="M30 55L150 58L270 65L390 72L510 81L630 88L780 97"/><path className="tier-luxe" d="M30 155L150 150L270 143L390 132L510 119L630 101L780 78"/><path className="tier-pinnacle" d="M30 184L150 181L270 177L390 170L510 160L630 148L780 133"/><text x="770" y="92" textAnchor="end">CORE 8,492</text><text x="770" y="73" textAnchor="end">LUXE 2,186</text><text x="770" y="128" textAnchor="end">PINNACLE 428</text></svg>}
