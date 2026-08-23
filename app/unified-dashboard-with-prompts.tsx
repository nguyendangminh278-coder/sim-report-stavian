'use client';

import { KeyboardEvent, MouseEvent, useEffect, useRef, useState } from 'react';
import WorkspaceV2 from './workspace-v2';
import MonthlyReportTool from './tong-hop-lenh/monthly-tool';
import WeeklyReportTool from './bao-cao-tuan/weekly-tool';
import NewsTool from './tin-tuc/news-tool';
import PromptLibrary from './prompts/prompt-library';
import type { TradeRecord } from './lib/excel-report';
import './unified-tab-fix.css';
import './prompt-nav.css';

export type UnifiedTabId = 'doc-anh' | 'tong-hop-lenh' | 'bao-cao-tuan' | 'tin-tuc' | 'prompt';

const TABS: Array<{ id: UnifiedTabId; label: string }> = [
  { id: 'doc-anh', label: 'Đọc ảnh' },
  { id: 'tong-hop-lenh', label: 'Tổng hợp lệnh' },
  { id: 'bao-cao-tuan', label: 'Báo cáo tuần' },
  { id: 'tin-tuc', label: 'Tin tức AI' },
  { id: 'prompt', label: 'Câu lệnh Prompt' },
];

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

function tabUrl(tabId: UnifiedTabId) {
  return `${BASE_PATH}/?tab=${tabId}`;
}

function tabFromLocation(fallback: UnifiedTabId): UnifiedTabId {
  const value = new URLSearchParams(window.location.search).get('tab');
  return TABS.some((tab) => tab.id === value) ? value as UnifiedTabId : fallback;
}

export default function UnifiedDashboardWithPrompts({ initialTab = 'doc-anh' }: { initialTab?: UnifiedTabId }) {
  const [activeTab, setActiveTab] = useState<UnifiedTabId>(initialTab);
  const tabRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const [aggregatedTrades, setAggregatedTrades] = useState<TradeRecord[]>([]);
  const [aggregatedMonthLabel, setAggregatedMonthLabel] = useState('');

  useEffect(() => {
    const handlePopState = () => {
      setActiveTab(tabFromLocation(initialTab));
      window.scrollTo({ top: 0, behavior: 'auto' });
    };
    handlePopState();
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [initialTab]);

  const selectTab = (tabId: UnifiedTabId) => {
    setActiveTab(tabId);
    window.history.replaceState({ tab: tabId }, '', tabUrl(tabId));
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const handleTabClick = (event: MouseEvent<HTMLAnchorElement>, tabId: UnifiedTabId) => {
    event.preventDefault();
    selectTab(tabId);
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLAnchorElement>, index: number) => {
    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = TABS.length - 1;
    else return;

    event.preventDefault();
    const nextTab = TABS[nextIndex];
    selectTab(nextTab.id);
    tabRefs.current[nextIndex]?.focus();
  };

  return (
    <div className="unified-app">
      <header className="unified-header">
        <div className="unified-header-inner">
          <button className="unified-brand" type="button" onClick={() => selectTab('doc-anh')}>
            <span className="unified-brand-mark" aria-hidden="true">S</span>
            <span><strong>SIM Report</strong><small>Stavian Industrial Metal</small></span>
          </button>

          <nav className="unified-tablist unified-tablist-five" role="tablist" aria-label="Công cụ SIM Report">
            {TABS.map((tab, index) => {
              const selected = activeTab === tab.id;
              return (
                <a
                  key={tab.id}
                  ref={(element) => { tabRefs.current[index] = element; }}
                  id={`tab-${tab.id}`}
                  className={`unified-tab${selected ? ' active' : ''}`}
                  href={tabUrl(tab.id)}
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`panel-${tab.id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={(event) => handleTabClick(event, tab.id)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                >
                  {tab.label}
                </a>
              );
            })}
          </nav>

          <div className="unified-account">
            <span className="unified-account-fallback" aria-hidden="true">AI</span>
            <span className="unified-account-copy">
              <strong>Không cần đăng nhập</strong>
              <small>API Key lưu trên trình duyệt này</small>
            </span>
          </div>
        </div>
      </header>

      <section id="panel-doc-anh" className="unified-panel unified-panel-image" role="tabpanel" aria-labelledby="tab-doc-anh" hidden={activeTab !== 'doc-anh'}>
        <WorkspaceV2 />
      </section>
      <section id="panel-tong-hop-lenh" className="unified-panel unified-panel-monthly" role="tabpanel" aria-labelledby="tab-tong-hop-lenh" hidden={activeTab !== 'tong-hop-lenh'}>
        <MonthlyReportTool
          onAggregated={(trades, monthLabel) => {
            setAggregatedTrades(trades);
            setAggregatedMonthLabel(monthLabel);
          }}
        />
      </section>
      <section id="panel-bao-cao-tuan" className="unified-panel unified-panel-weekly" role="tabpanel" aria-labelledby="tab-bao-cao-tuan" hidden={activeTab !== 'bao-cao-tuan'}>
        <WeeklyReportTool
          key={aggregatedTrades.map((trade) => [trade.sourceSheet, trade.sourceRow, trade.pnlAfterFee].join(':')).join('|') || 'empty'}
          trades={aggregatedTrades}
          monthLabel={aggregatedMonthLabel}
          onOpenMonthly={() => selectTab('tong-hop-lenh')}
        />
      </section>
      <section id="panel-tin-tuc" className="unified-panel unified-panel-news" role="tabpanel" aria-labelledby="tab-tin-tuc" hidden={activeTab !== 'tin-tuc'}>
        <NewsTool onOpenSettings={() => selectTab('doc-anh')} />
      </section>
      <section id="panel-prompt" className="unified-panel unified-panel-prompts" role="tabpanel" aria-labelledby="tab-prompt" hidden={activeTab !== 'prompt'}>
        <PromptLibrary />
      </section>
    </div>
  );
}
