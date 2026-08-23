'use client';

import { KeyboardEvent, useEffect, useRef, useState } from 'react';
import WorkspaceV2 from './workspace-v2';
import MonthlyReportTool from './tong-hop-lenh/monthly-tool';
import WeeklyReportTool from './bao-cao-tuan/weekly-tool';

export type UnifiedTabId = 'doc-anh' | 'tong-hop-lenh' | 'bao-cao-tuan';

const TABS: Array<{ id: UnifiedTabId; label: string }> = [
  { id: 'doc-anh', label: 'Đọc ảnh' },
  { id: 'tong-hop-lenh', label: 'Tổng hợp lệnh' },
  { id: 'bao-cao-tuan', label: 'Báo cáo tuần' },
];

function tabFromLocation(): UnifiedTabId {
  const value = new URLSearchParams(window.location.search).get('tab');
  return TABS.some((tab) => tab.id === value) ? value as UnifiedTabId : 'doc-anh';
}

export default function UnifiedDashboard({ initialTab = 'doc-anh' }: { initialTab?: UnifiedTabId }) {
  const [activeTab, setActiveTab] = useState<UnifiedTabId>(initialTab);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const handlePopState = () => {
      setActiveTab(tabFromLocation());
      window.scrollTo({ top: 0, behavior: 'auto' });
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const selectTab = (tabId: UnifiedTabId) => {
    setActiveTab(tabId);
    const url = tabId === 'doc-anh' ? '/' : `/?tab=${tabId}`;
    window.history.pushState({ tab: tabId }, '', url);
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
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

          <div className="unified-tablist" role="tablist" aria-label="Công cụ SIM Report">
            {TABS.map((tab, index) => {
              const selected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  ref={(element) => { tabRefs.current[index] = element; }}
                  id={`tab-${tab.id}`}
                  className={`unified-tab${selected ? ' active' : ''}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`panel-${tab.id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => selectTab(tab.id)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="unified-privacy"><span aria-hidden="true" />Không cần đăng nhập</div>
        </div>
      </header>

      <section
        id="panel-doc-anh"
        className="unified-panel unified-panel-image"
        role="tabpanel"
        aria-labelledby="tab-doc-anh"
        hidden={activeTab !== 'doc-anh'}
      >
        <WorkspaceV2 />
      </section>

      <section
        id="panel-tong-hop-lenh"
        className="unified-panel unified-panel-monthly"
        role="tabpanel"
        aria-labelledby="tab-tong-hop-lenh"
        hidden={activeTab !== 'tong-hop-lenh'}
      >
        <MonthlyReportTool />
      </section>

      <section
        id="panel-bao-cao-tuan"
        className="unified-panel unified-panel-weekly"
        role="tabpanel"
        aria-labelledby="tab-bao-cao-tuan"
        hidden={activeTab !== 'bao-cao-tuan'}
      >
        <WeeklyReportTool />
      </section>
    </div>
  );
}
